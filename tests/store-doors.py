#!/usr/bin/env python3
"""The app's own store doors — /device-config and /fm-data — over real HTTP.

⚠️ THESE WERE PINNED ONLY BY SOURCE TEXT. The security suite asserted that the
factory's source contained "expected_rev" and "async with lock"; nothing ever
sent a stale revision, a corrupt file or two racing writes at the doors the
kiosk actually uses. Served here by `build_app(data_dir=<a temp dir>)`, the
function main() serves, so a door that is unrouted or routed wrong fails too.

Run: python3 tests/store-doors.py   (also part of `npm run test:proxy`)
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

try:
    from aiohttp.test_utils import TestClient, TestServer
except ModuleNotFoundError:
    print("  FAIL  aiohttp is not installed — `python3 -m pip install aiohttp`")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"
TMP = Path(tempfile.mkdtemp(prefix="vk-stores-"))
DATA = TMP / "data"
DATA.mkdir()
(DATA / "options.json").write_text(json.dumps({"owner_pin": "1234"}))

_spec = importlib.util.spec_from_file_location("vk_store_proxy", PROXY)
proxy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(proxy)

FAIL = 0


def ck(name: str, ok: bool, detail: object = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        FAIL += 1
        if detail != "":
            print(f"          got: {detail}")


def cookie(role: str) -> dict:
    return {"Cookie": f"{proxy.SESSION_COOKIE}={proxy._make_session_token(role)}"}


def on_disk(name: str):
    return json.loads((DATA / name).read_text())


async def main() -> None:
    client = TestClient(TestServer(proxy.build_app(data_dir=str(DATA))))
    await client.start_server()
    owner, guest, ops = cookie("owner"), cookie("guest"), cookie("ops")

    async def call(method, path, headers, body=None):
        r = await client.request(method, path, headers=headers, json=body)
        return r.status, (await r.json() if r.content_type == "application/json" else None)

    # ── /device-config: the owner's shared settings ──────────────────────
    print("  /device-config:")
    status, body = await call("GET", "/device-config", guest)
    ck("never written: any session reads an empty document and a string rev",
       status == 200 and body == {"config": {}, "rev": "0"}, (status, body))
    status, _ = await call("PUT", "/device-config", guest, {"config": {"a": 1}})
    ck("a guest may not write it: 403", status == 403, status)
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 1}})
    rev1 = (body or {}).get("rev")
    ck("the owner writes it: 200 and the new rev", status == 200 and isinstance(rev1, str)
       and rev1 != "0" and on_disk("device-config.json") == {"a": 1}, (status, body))
    status, body = await call("GET", "/device-config", guest)
    ck("  ...and every session reads that document at that rev",
       body == {"config": {"a": 1}, "rev": rev1}, body)
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 2}, "rev": rev1})
    rev2 = (body or {}).get("rev")
    ck("a write naming the current rev lands", status == 200 and rev2 != rev1, (status, body))
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 3}, "rev": rev1})
    ck("a write naming a STALE rev: 409 with the current document and rev, nothing written",
       status == 409 and body == {"error": "conflict", "config": {"a": 2}, "rev": rev2}
       and on_disk("device-config.json") == {"a": 2}, (status, body))
    status, _ = await call("PUT", "/device-config", owner, {"config": [1, 2]})
    ck("the wrong top-level type: 400", status == 400, status)
    status, _ = await call("PUT", "/device-config", owner,
                           {"config": {"x": "y" * (proxy.DEVICE_CONFIG_MAX_BYTES + 1)}})
    ck("past the byte cap: 413, nothing written", status == 413
       and on_disk("device-config.json") == {"a": 2}, status)
    (DATA / "device-config.json").write_text("{not json")
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 9}})
    ck("a CORRUPT file refuses the write (409) and stays on disk to recover",
       status == 409 and (DATA / "device-config.json").read_text() == "{not json", (status, body))
    status, body = await call("GET", "/device-config", guest)
    ck("  ...while the GET degrades to empty, so a client can still render",
       status == 200 and body["config"] == {}, (status, body))
    (DATA / "device-config.json").unlink()

    # Two writes on ONE rev, sent together: the lock makes exactly one win.
    _, body = await call("PUT", "/device-config", owner, {"config": {"n": 0}})
    base = body["rev"]
    results = await asyncio.gather(*(
        call("PUT", "/device-config", owner, {"config": {"n": i}, "rev": base}) for i in (1, 2)))
    ck("two writes naming the same rev at once: exactly one lands",
       sorted(s for s, _ in results) == [200, 409], [s for s, _ in results])

    # ── /fm-data: the Facility record ────────────────────────────────────
    print("\n  /fm-data:")
    record = {"schedules": [], "completions": [], "costs": [], "savedDocuments": [],
              "tickets": [{"id": "t1", "status": "open", "reportedBy": "owner"}]}
    (DATA / "fm-data.json").write_text(json.dumps(record))
    status, body = await call("GET", "/fm-data", guest)
    ck("a guest reads an EMPTY record, with the real rev",
       status == 200 and body["data"]["tickets"] == [] and body["rev"] != "0", (status, body))
    guest_rev = body["rev"]
    report = {"id": "g1", "status": "open", "reportedBy": "guest", "title": "AC drips"}
    status, body = await call("PUT", "/fm-data", guest,
                              {"data": {**body["data"], "tickets": [report]}, "rev": guest_rev})
    ck("a guest's fault report is filed onto the REAL record, which keeps its tickets",
       status == 200 and [t["id"] for t in on_disk("fm-data.json")["tickets"]] == ["t1", "g1"],
       (status, body))
    status, body = await call("PUT", "/fm-data", guest, {"data": {
        "tickets": [{**report, "id": "g2", "status": "resolved"}]}})
    ck("  ...but not a pre-resolved one: 403", status == 403, (status, body))
    status, body = await call("PUT", "/fm-data", guest,
                              {"data": {"tickets": [{**report, "id": "g3"}]}, "rev": guest_rev})
    ck("a guest's STALE write gets the empty view back in its 409, not the record",
       status == 409 and body["data"]["tickets"] == [] and body["rev"] != guest_rev, (status, body))
    status, body = await call("GET", "/fm-data", ops)
    ck("a facility manager reads the whole record", len(body["data"]["tickets"]) == 2, body)
    status, body = await call("PUT", "/fm-data", ops, {"data": {**body["data"], "tickets": []},
                                                       "rev": body["rev"]})
    ck("deleting evidence without the superadmin code: 403, nothing deleted",
       status == 403 and len(on_disk("fm-data.json")["tickets"]) == 2, (status, body))

    # The app's door and the agent's door open ONE store, so they share ONE lock.
    options = on_disk("options.json")
    options["agent_enabled"] = True
    options["vesta_agent"] = {"token": "agent-token-for-tests-0123456789"}
    (DATA / "options.json").write_text(json.dumps(options))
    _, body = await call("GET", "/fm-data", ops)
    shared_rev, doc = body["rev"], body["data"]
    agent = {"Authorization": "Bearer agent-token-for-tests-0123456789", "X-VK-Peer": "10.0.0.9"}
    extra = {"id": "a1", "status": "open", "reportedBy": "owner"}
    results = await asyncio.gather(
        call("PUT", "/fm-data", ops, {"data": {**doc, "tickets": doc["tickets"] + [
            {"id": "o1", "status": "open", "reportedBy": "owner"}]}, "rev": shared_rev}),
        call("PUT", "/agent/v1/fm-data", agent, {"data": {**doc, "tickets": doc["tickets"] + [extra]},
                                                 "rev": shared_rev}))
    ck("the app and the agent writing on one rev at once: exactly one lands",
       sorted(s for s, _ in results) == [200, 409], results)

    # ── retention: a closed fault leaves by itself (owner, 2026-10-14) ───
    print("\n  closed-fault retention:")
    import time as _t
    def ago(days):
        return _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime(_t.time() - days * 86400))
    def closed(rid, days, kind=None):
        step = {"at": ago(days), "status": "resolved", "photoIds": []}
        if kind:
            step["kind"] = kind
        return {"id": rid, "status": "resolved", "reportedBy": "owner", "openedAt": ago(days + 1),
                "resolvedAt": ago(days), "photoIds": [], "updates": [step]}
    kept_ids = ["open1", "cleared89", "fixed100", "fixed364"]
    aged = {"schedules": [], "completions": [], "costs": [], "savedDocuments": [], "tickets": [
        {"id": "open1", "status": "open", "reportedBy": "owner"},
        closed("cleared89", 89, "cleared"), closed("cleared91", 91, "cleared"),
        closed("fixed100", 100), closed("fixed364", 364), closed("fixed366", 366),
        {**closed("old300", 300), "updates": []},
    ]}
    aged["tickets"][-1]["resolvedAt"] = ago(366)
    (DATA / "fm-data.json").write_text(json.dumps(aged))
    status, body = await call("GET", "/fm-data", ops)
    ck("the GET leaves out a no-action close past 90 days and a repair past the evidence window (365)",
       [t["id"] for t in body["data"]["tickets"]] == kept_ids, [t["id"] for t in body["data"]["tickets"]])
    ck("  ...and says so beside the record: the two windows the app names its figures by",
       body.get("retention") == {"clearedDays": 90, "repairedDays": 365, "recordsDays": 365} and "retention" not in body["data"], body.get("retention"))
    status, body2 = await call("GET", "/agent/v1/fm-data", agent)
    ck("  ...and so does the agent's GET", [t["id"] for t in body2["data"]["tickets"]] == kept_ids, body2)
    status, put = await call("PUT", "/fm-data", ops, {"data": aged, "rev": body["rev"]})
    ck("a write from a stale copy that still holds them: 200, no superadmin code, and they stay gone",
       status == 200 and [t["id"] for t in on_disk("fm-data.json")["tickets"]] == kept_ids,
       (status, put, [t["id"] for t in on_disk("fm-data.json")["tickets"]]))
    status, put = await call("PUT", "/agent/v1/fm-data", agent, {"data": body2["data"], "rev": put["rev"]})
    ck("the agent writing its copy back is not a delete it may not make", status == 200, (status, put))
    # the owner's "keep for ever" in Advanced Settings (2.496.454: a shared setting, no longer an add-on option)
    (DATA / "device-config.json").write_text(json.dumps({"recordsKeptDays": 0}))
    (DATA / "fm-data.json").write_text(json.dumps(aged))
    status, body = await call("GET", "/fm-data", ops)
    ck("evidence window 0: repairs are kept for ever, no-action closes still leave",
       [t["id"] for t in body["data"]["tickets"]] == ["open1", "cleared89", "fixed100", "fixed364", "fixed366", "old300"],
       [t["id"] for t in body["data"]["tickets"]])
    ck("  ...and the published window says it: repairs 0 (for ever)", body.get("retention") == {"clearedDays": 90, "repairedDays": 0, "recordsDays": 0},
       body.get("retention"))

    # ── /announcements: the villa's announcements, kept by the add-on (2.496.557, 2026-10-28) ──────────────────────
    # Driven through the add-on's own recorder (what its listener calls for each bus event) and read over HTTP.
    print("  /announcements:")
    app = client.server.app
    ev = lambda msg, at=None, et=proxy.ANNOUNCEMENT_EVENT: {
        "event_type": et, "data": {"message": msg}, **({"time_fired": at} if at else {})}
    status, _ = await call("GET", "/announcements", {})
    ck("no session: refused", status == 401, status)
    status, body = await call("GET", "/announcements", guest)
    ck("never written: a guest reads none, last 0", status == 200 and body == {"announcements": [], "last": 0, "first": 1},
       (status, body))
    ck("the event it keeps is named in the one table", proxy.ANNOUNCEMENT_EVENT == proxy.HA_COMMANDS.get("announcement")
       and bool(proxy.ANNOUNCEMENT_EVENT) and proxy.ANNOUNCEMENT_EVENT not in proxy.ALLOWED_EVENT_TYPES)
    await proxy._record_announcement(app, ev("<b>One</b>"))
    await proxy._record_announcement(app, ev("<b>Other</b>", et="telegram_text"))
    await proxy._record_announcement(app, ev("   "))
    status, body = await call("GET", "/announcements", ops)
    ck("an announcement is kept; another event type and an empty text are not",
       [a["message"] for a in body["announcements"]] == ["<b>One</b>"] and body["last"] == 1, body)

    async def later():
        await asyncio.sleep(0.3)
        await proxy._record_announcement(app, ev("<b>Two</b>"))
    t0 = asyncio.get_running_loop().time()
    (status, body), _ = await asyncio.gather(call("GET", "/announcements?after=1", guest), later())
    waited = asyncio.get_running_loop().time() - t0
    ck("a read after the last one waits for the next and answers it at once",
       status == 200 and [a["message"] for a in body["announcements"]] == ["<b>Two</b>"] and body["last"] == 2
       and waited < 5, (status, body, round(waited, 2)))
    proxy.ANNOUNCEMENT_WAIT_S = 0.2
    status, body = await call("GET", "/announcements?after=2", guest)
    ck("  ...and answers none when nothing came", status == 200 and body == {"announcements": [], "last": 2, "first": 1}, body)
    proxy.ANNOUNCEMENT_WAIT_S = 5
    t0 = asyncio.get_running_loop().time()
    status, body = await call("GET", "/announcements?after=9", guest)
    waited = asyncio.get_running_loop().time() - t0
    ck("  ...but at once when the page holds more than the store (it started again)", body["announcements"] == []
       and body["last"] == 2 and waited < 2, (body, round(waited, 2)))
    proxy.ANNOUNCEMENT_WAIT_S = 0.2
    status, _ = await call("GET", "/announcements?after=x", guest)
    ck("  ...and refuses an after that is no number", status == 400, status)
    old = "2020-01-01T00:00:00+00:00"
    await proxy._record_announcement(app, ev("<b>Old</b>", at=old))
    status, body = await call("PUT", "/device-config", owner, {"config": {"recordsKeptDays": 30}})
    status, body = await call("GET", "/announcements", guest)
    ck("one older than the records-kept days is no longer kept",
       [a["message"] for a in body["announcements"]] == ["<b>One</b>", "<b>Two</b>"], body)
    await proxy._record_announcement(app, ev("<b>Older</b>", at=old))
    ck("  ...nor written: the store is tidied as each one is kept (review Q 4: the feed's one tidy)",
       "<b>Older</b>" not in [a.get("message") for a in on_disk("announcements.json")], on_disk("announcements.json"))
    status, body = await call("PUT", "/device-config", owner, {"config": {"recordsKeptDays": 0}})
    status, body = await call("GET", "/announcements", guest)
    ck("  ...and it is deleted, not hidden: keeping for ever afterwards does not bring it back",
       "<b>Old</b>" not in [a["message"] for a in body["announcements"]], body)
    await proxy._record_announcement(app, ev("<b>Old</b>", at=old))
    status, body = await call("GET", "/announcements", guest)
    # numbered on from the last number given (4 was the tidied "Older"): never a number a page already holds
    ck("  ...and with records kept for ever, it is", "<b>Old</b>" in [a["message"] for a in body["announcements"]]
       and body["last"] == 5, body)
    (DATA / "announcements.json").write_text("{not json")
    await proxy._record_announcement(app, ev("<b>After</b>"))
    ck("a corrupt store starts again with the next one", on_disk("announcements.json")[0]["message"] == "<b>After</b>",
       (DATA / "announcements.json").read_text()[:80])
    # review Q round 2: what a page holds is what the add-on keeps, and a number is never given twice
    ck("  ...numbered on from the last given, never from 1: an open page takes it as news, not a store started again",
       on_disk("announcements.json")[0]["seq"] == 6, on_disk("announcements.json"))
    (DATA / "announcements.json").write_text("[]")                     # every one tidied away
    await proxy._record_announcement(app, ev("<b>Next</b>"))
    status, body = await call("GET", "/announcements", guest)
    ck("  ...nor when every one was tidied away", [a["seq"] for a in body["announcements"]] == [7] and body["last"] == 7, body)
    ck("each answer says the first number still kept: a page drops what it holds below it", body["first"] == 7, body)

    # ── one line per key, with its photo (2.496.558, 2026-10-28) ────────────────────────────────────────────────────
    print("  /announcements, one line per key, with its photo:")
    media = TMP / "media"
    (media / "cams").mkdir(parents=True)
    proxy.MEDIA_DIR = str(media)
    (media / "cams" / "ring1.jpg").write_bytes(proxy._JPEG_MAGIC + b"first ring")
    kev = lambda msg, **more: {"event_type": proxy.ANNOUNCEMENT_EVENT, "data": {"message": msg, **more}}
    (DATA / "announcements.json").write_text("[]")
    await proxy._record_announcement(app, kev("<b>Ring</b>", key="run-1", photo=f"{media}/cams/ring1.jpg",
                                               buttons=[[["🔓 Unlock", "/unlock_gate"]]]))
    status, body = await call("GET", "/announcements", owner)
    ring = body["announcements"][0]
    photo_file = DATA / proxy.ANNOUNCEMENT_PHOTO_DIR / ring.get("photo", "none")
    ck("the ring is kept with its key, its button and a copy of its photo",
       ring.get("key") == "run-1" and ring.get("buttons") == [[["🔓 Unlock", "/unlock_gate"]]]
       and photo_file.is_file() and photo_file.read_bytes().endswith(b"first ring"), ring)
    (media / "cams" / "ring1.jpg").write_bytes(proxy._JPEG_MAGIC + b"second ring")
    r = await client.get(f"/announcement-photo/{ring.get('photo')}", headers=owner)
    ck("  ...served to the owner as it was when the ring came, even after the file changed",
       r.status == 200 and (await r.read()).endswith(b"first ring") and r.headers.get("Content-Type") == "image/jpeg",
       r.status)
    r = await client.get(f"/announcement-photo/{ring.get('photo')}", headers=guest)
    status, gbody = await call("GET", "/announcements", guest)
    ck("  ...a guest sees it while it is the current notification (owner, 2026-10-28)",
       r.status == 200 and gbody["announcements"][0].get("photo") == ring.get("photo"), (r.status, gbody))
    await proxy._record_announcement(app, kev("<b>Weekly test</b>"))
    r = await client.get(f"/announcement-photo/{ring.get('photo')}", headers=guest)
    status, gbody = await call("GET", "/announcements", guest)
    ck("  ...but not once another notification came after it: 403, and its list names no photo",
       r.status == 403 and all("photo" not in a for a in gbody["announcements"]), (r.status, gbody))
    ck("  ...nor once it is older than the current notification's time, even as the newest",
       proxy._current_photo([{**ring, "seq": 9}], proxy._iso_epoch(ring["at"]) + proxy.ANNOUNCEMENT_CURRENT_S + 1) is None
       and proxy._current_photo([{**ring, "seq": 9}], proxy._iso_epoch(ring["at"]) + 1) == ring.get("photo"))
    await proxy._record_announcement(app, kev("<b>Opened at 09:03</b>", key="run-1"))
    status, body = await call("GET", "/announcements", owner)
    same = [a for a in body["announcements"] if a.get("key") == "run-1"]
    ck("the rewrite REPLACES the ring (one line), comes as a newer one, has no button, keeps the first photo",
       len(same) == 1 and same[0]["message"] == "<b>Opened at 09:03</b>" and same[0]["seq"] > ring["seq"]
       and "buttons" not in same[0] and same[0].get("photo") == ring.get("photo"), body)
    await proxy._record_announcement(app, kev("<b>Other</b>"))
    await proxy._record_announcement(app, kev("<b>Other</b>"))
    status, body = await call("GET", "/announcements", owner)
    ck("  ...while two announcements with no key stay two lines",
       [a["message"] for a in body["announcements"]].count("<b>Other</b>") == 2, body)
    # (A photo path outside the media folder, or not a picture: the private security suite.)
    pending = DATA / proxy.ANNOUNCEMENT_PHOTO_DIR / ("f" * 32 + ".jpg")
    pending.write_bytes(proxy._JPEG_MAGIC)
    proxy._sweep_announcement_photos([], [])
    ck("a copy made a moment ago, its record not yet written, is not swept as an orphan", pending.exists())
    pending.unlink()
    proxy.ANNOUNCEMENT_PHOTO_GRACE_S = 0   # the sweep's grace for a copy not yet recorded: none here
    (media / "cams" / "ring2.jpg").write_bytes(proxy._JPEG_MAGIC + b"new ring")
    await proxy._record_announcement(app, kev("<b>Ring again</b>", key="run-1", photo=f"{media}/cams/ring2.jpg"))
    ck("a rewrite bringing its own photo: the first copy is deleted", not photo_file.exists(),
       sorted(p.name for p in (DATA / proxy.ANNOUNCEMENT_PHOTO_DIR).iterdir()))
    (DATA / "announcements.json").write_text(json.dumps(
        [{**a, "at": old} for a in json.loads((DATA / "announcements.json").read_text())]))
    status, body = await call("PUT", "/device-config", owner, {"config": {"recordsKeptDays": 30}})
    status, body = await call("GET", "/announcements", owner)
    left = sorted(p.name for p in (DATA / proxy.ANNOUNCEMENT_PHOTO_DIR).iterdir())
    ck("past the records-kept days the announcements go, and their photos with them",
       body["announcements"] == [] and left == [], (body, left))

    # ── a button pressed on the tablet (ticket 15 of "One inbox", 2026-10-28) ──────────────────────────────────────
    print("  /announcement-press, a ring's button pressed on the tablet:")
    fired = []

    async def fire(_app, data):
        fired.append(data)
        return True

    proxy._fire_press = fire
    ck("the one event it fires is named in the one table, and no page may subscribe to it",
       proxy.ANNOUNCEMENT_PRESS == proxy.HA_COMMANDS.get("press") and bool(proxy.ANNOUNCEMENT_PRESS)
       and proxy.ANNOUNCEMENT_PRESS not in proxy.ALLOWED_EVENT_TYPES)
    await proxy._record_announcement(app, kev("<b>Ring</b>", key="run-2", buttons=[[["🔓 Unlock", "/unlock_gate"]]]))
    press = {"key": "run-2", "command": "/unlock_gate"}
    status, _ = await call("POST", "/announcement-press", {}, press)
    ck("no session: 401, nothing fired", status == 401 and fired == [], (status, fired))
    status, body = await call("POST", "/announcement-press", guest, press)
    ck("a guest presses a button the ring offers: the press signal goes with its command and the ring's key",
       status == 200 and fired == [press], (status, body, fired))
    fired.clear()
    for who, wrong in (("another command", {"key": "run-2", "command": "/open_everything"}),
                       ("another ring's key", {"key": "run-1", "command": "/unlock_gate"}),
                       ("a key no ring has", {"key": "run-9", "command": "/unlock_gate"}),
                       ("no key", {"command": "/unlock_gate"}),
                       ("a command that is not a string", {"key": "run-2", "command": ["/unlock_gate"]}),
                       ("more than the button says", {**press, "extra": "x"})):
        status, _ = await call("POST", "/announcement-press", guest, wrong)
        ck(f"  ...refused for {who}, nothing fired", status in (400, 409) and fired == [], (status, fired))
    status, _ = await call("POST", "/announcement-press", owner, {"key": "run-2", "command": "/open_everything"})
    ck("  ...and the owner too may press only what a ring offers", status == 409 and fired == [], (status, fired))
    await proxy._record_announcement(app, kev("<b>Opened at 09:05</b>", key="run-2"))
    status, _ = await call("POST", "/announcement-press", guest, press)
    ck("once the rewrite withdrew the button (answered, opened, timed out): 409, nothing fired",
       status == 409 and fired == [], (status, fired))
    await proxy._record_announcement(app, kev("<b>Ring</b>", key="run-3", buttons=[[["🔓 Unlock", "/unlock_gate"]]]))

    async def unreachable(_app, _data):
        return False

    proxy._fire_press = unreachable
    status, _ = await call("POST", "/announcement-press", guest, {"key": "run-3", "command": "/unlock_gate"})
    ck("the villa's system not reached: 502, so the tablet says it was not sent", status == 502, status)

    await client.close()


asyncio.run(main())

# ── how a closed fault was closed: the agreement's histories (architecture review, 2026-10-15) ───────────────────
# agent-contract.json `ticketUpdate.histories`: the cases tests/oracles/fault_close.mjs drives through the app's
# fmEngine.lastResolution / isClearedStep — the same ones, through the proxy's reading, so neither side is tested on
# histories of its own (2.496.372 fixed the same misreading on both). Each says which step last closed the fault,
# whether with no work done, and whether the server still keeps it at the agreement's `now` and evidence window.
print("  the close the server judges a fault by (the agreement's histories):")
H = json.loads((ROOT / "rootfs" / "usr" / "share" / "vesta" / "agent-contract.json").read_text())["ticketUpdate"]["histories"]
now = proxy._iso_epoch(H["now"])
proxy._evidence_retention_days = lambda: H["evidenceDays"]
ck("the agreement holds the histories both sides read", len(H["cases"]) >= 10, len(H["cases"]))
for c in H["cases"]:
    ticket = {"id": "h", "title": c["_"], "status": "resolved", "resolvedAt": c["resolvedAt"],
              "updates": [{"photoIds": [], **u} for u in c["updates"]]}
    last = proxy._fm_last_resolution(ticket)
    got = {"last": next((i for i, u in enumerate(ticket["updates"]) if u is last), None),
           "cleared": proxy._fm_cleared_step(last) if last else None,
           "expired": proxy._fm_ticket_expired(ticket, now)}
    ck(c["_"], got == {k: c[k] for k in ("last", "cleared", "expired")}, got)
shutil.rmtree(TMP, ignore_errors=True)
if FAIL:
    print(f"\n❌ {FAIL} store-door check(s) failed")
    sys.exit(1)
print("\n✅ the store doors hold")
