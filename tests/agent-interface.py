#!/usr/bin/env python3
"""The VESTA Agent interface v1, driven over real HTTP (PLAN workstream A).

⚠️ THE SHIPPED PROXY, NOT A COPY, AND ITS OWN ROUTE TABLE. The module is loaded
from rootfs/ unchanged and served by `build_app(data_dir=<a temp dir>)`, the
function main() serves. A handler that is not routed, or is routed to the wrong
path, fails here; a test of the handler alone would stay green through it.

⚠️ A FAKE SUPERVISOR, so the villa model's rooms and /agent/v1/info's version
are checked against answers the test controls, never against a guess.

Run: python3 tests/agent-interface.py   (also part of `npm run test:proxy`)
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
except ModuleNotFoundError:
    print("  FAIL  aiohttp is not installed — `python3 -m pip install aiohttp`")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"
TMP = Path(tempfile.mkdtemp(prefix="vk-agent-"))
(TMP / "data" / "www").mkdir(parents=True)

_spec = importlib.util.spec_from_file_location("vk_agent_proxy", PROXY)
proxy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(proxy)

FAIL = 0
TOKEN = "agent-token-for-tests-0123456789"
INGRESS = {"X-VK-Ingress": "1"}                     # nginx's mark: HA-authenticated owner


def ck(name: str, ok: bool, detail: object = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        FAIL += 1
        if detail != "":
            print(f"          got: {detail}")


def options(**opts) -> None:
    (TMP / "data" / "options.json").write_text(json.dumps(opts))


def agent(enabled=None, **fields) -> None:
    """options.json as the Configuration page writes it: the top-level switch
    `agent_enabled` and the `vesta_agent` settings group."""
    opts = {"vesta_agent": fields}
    if enabled is not None:
        opts["agent_enabled"] = enabled
    options(**opts)


def bearer(tok: str = TOKEN, peer: str = "10.0.0.5") -> dict:
    return {"Authorization": f"Bearer {tok}", "X-VK-Peer": peer}


def cookie(role: str) -> dict:
    return {"Cookie": f"{proxy.SESSION_COOKIE}={proxy._make_session_token(role)}"}


def reset_lockout() -> None:
    proxy._auth_failures.clear()
    for hits in proxy._auth_failures_global.values():
        hits[:] = []


async def fake_supervisor() -> TestServer:
    """/addons/self/info and /core/api/template, as the Supervisor answers."""
    async def info(_):
        return web.json_response({"result": "ok", "data": {"version": "9.9.9", "options": {}}})

    async def template(request):
        tpl = (await request.json())["template"]
        if tpl == proxy.LIGHT_SCENES_TEMPLATE:            # the scene-choice ask at start (2.496.440): none here
            return web.Response(text="[]")
        start = tpl.index("for e in ") + len("for e in ")
        ids = json.loads(tpl[start:tpl.index(" %}", start)])
        areas = {"light.living_ceiling": ["Living", "Ground", "Ceiling"],
                 "switch.pool_pump": ["Garden", None, "Pool pump"]}
        return web.Response(text=json.dumps({e: areas.get(e, [None, None, None]) for e in ids}))

    app = web.Application()
    app.router.add_get("/addons/self/info", info)
    app.router.add_post("/core/api/template", template)
    server = TestServer(app)
    await server.start_server()
    return server


async def main() -> None:
    print(f"  loaded {PROXY.relative_to(ROOT)}, data in a temp dir\n")
    sup = await fake_supervisor()
    proxy.SUPERVISOR = f"127.0.0.1:{sup.port}"
    client = TestClient(TestServer(proxy.build_app(data_dir=str(TMP / "data"))))
    stores = {n: v.path for n, v in vars(proxy).items() if isinstance(v, proxy.JsonStore)}
    ck(f"build_app(data_dir) moves every store ({len(stores)}) and the options",
       len(stores) >= 5 and all(p.startswith(str(TMP / "data") + "/") for p in stores.values())
       and proxy._data("options.json") == str(TMP / "data" / "options.json"), stores)
    # an older version's message stores, left on the install: the start must remove them (2.496.445)
    (TMP / "data").mkdir(parents=True, exist_ok=True)
    (TMP / "data" / "agent-messages.json").write_text('{"messages": []}')
    (TMP / "data" / "agent-choices.json").write_text('{"choices": [], "next_seq": 1}')
    await client.start_server()
    get, put, post = client.get, client.put, client.post

    async def jget(path, headers):
        r = await get(path, headers=headers)
        return r.status, (await r.json() if r.content_type == "application/json" else None)

    # ── off by default (PLAN A2) ─────────────────────────────────────────
    print("  switched off (the default):")
    options()
    status, _ = await jget("/agent/v1/info", bearer())
    ck("every /agent/v1 route answers 404", status == 404, status)
    status, body = await jget("/agent-status", INGRESS)
    ck("the Kiosk sees the agent as not configured", body == {"state": "not_configured"}, body)
    # ⚠️ THE SWITCH, NOT THE TOKEN (owner, 2026-09-29): a valid token left in
    # the field while "Connect the VESTA Agent" is off opens nothing.
    agent(token=TOKEN)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("a valid token with the switch OFF: still 404 — the switch decides", status == 404, status)
    status, body = await jget("/agent-status", INGRESS)
    ck("  ...and the Kiosk still sees no agent (no robot, no menu entry)", body == {"state": "not_configured"}, body)
    agent(enabled="true", token=TOKEN)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("  ...only a real `true` switches it on (a hand-edited string does not)", status == 404, status)
    print("\n  switched on without a usable token:")
    agent(enabled=True)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("no token: 404, the agent stays off", status == 404, status)
    ck("  ...and the start-up log says why", "switched on but its token is empty" in (proxy._agent_config_warning() or ""))
    agent(enabled=True, token="short")
    status, _ = await jget("/agent/v1/info", bearer("short"))
    ck("a token shorter than 16 characters counts as not configured", status == 404, status)
    options()
    ck("switched off: no warning at all (an empty token is then correct)", proxy._agent_config_warning() is None)

    # ── the switch above the group, and the updates that move an install ──
    print("\n  the switch, the settings group, and the updates into them:")
    options(agent_enabled=True, agent_token=TOKEN, vesta_agent={"token": ""})
    status, _ = await jget("/agent/v1/info", bearer())
    ck("before 2.496.218's move, the OLD flat token is read (an update must not drop it)", status == 200, status)
    options(agent_enabled=False, vesta_agent={"enabled": True, "token": TOKEN})
    status, _ = await jget("/agent/v1/info", bearer())
    ck("2.496.218's in-group switch wins over the top-level default beside it, until moved", status == 200, status)
    # the message retention left with the messages (2.496.445): dropped in both places it was ever stored
    pre218 = {"owner_pin": "1234", "sh3d_path": "x", "agent_enabled": True, "agent_token": TOKEN,
              "agent_offline_after_minutes": 7, "agent_message_retention_days": 30,
              "vesta_agent": {"token": "", "offline_after_minutes": 5, "message_retention_days": 90}}
    moved = proxy.migrate_options(pre218)
    ck("from before 2.496.218: the settings move into the group, the switch stays on top, the retention goes",
       moved == {"owner_pin": "1234", "agent_enabled": True, "vesta_agent": {"token": TOKEN,
                 "offline_after_minutes": 7}}, moved)
    from218 = {"owner_pin": "1234", "agent_enabled": False,
               "vesta_agent": {"enabled": True, "token": TOKEN, "offline_after_minutes": 7, "message_retention_days": 90}}
    moved218 = proxy.migrate_options(from218)
    ck("from 2.496.218: the switch moves OUT of the group, on as it was; the retention goes",
       moved218 == {"owner_pin": "1234", "agent_enabled": True, "vesta_agent": {"token": TOKEN,
                    "offline_after_minutes": 7}}, moved218)
    ck("  ...from 2.496.444 (the retention alone left): dropped",
       proxy.migrate_options({"vesta_agent": {"token": TOKEN, "message_retention_days": 90}}) == {"vesta_agent": {"token": TOKEN}})
    ck("  ...and there is nothing to do on an install already moved",
       proxy.migrate_options(moved218) is None)
    options(**moved218)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("after the move the top-level switch and the group open the door", status == 200 and proxy._agent_offline_minutes() == 7, status)
    reset_lockout()

    # ── the token, and only the token (PLAN A3) ──────────────────────────
    print("\n  the bearer gate:")
    agent(enabled=True, token=TOKEN, offline_after_minutes=5)
    reset_lockout()
    status, body = await jget("/agent/v1/info", bearer())
    ck("the right token reads /agent/v1/info", status == 200, status)
    ck("  ...contract 1, the Kiosk's own version, the agent's capabilities",
       body and body["contract"] == 1 and body["version"] == "9.9.9"
       and body["capabilities"] == ["agentPresence", "agentRead", "agentWrite"]
       and "message_retention_days" not in body, body)
    status, _ = await jget("/agent/v1/info", {"X-VK-Peer": "10.0.0.5"})
    ck("no token: 401", status == 401, status)
    status, _ = await jget("/agent/v1/info", {**INGRESS, **cookie("owner")})
    ck("an owner session or Home Assistant Ingress is not the agent: 401", status == 401, status)
    status, _ = await jget("/core/api/states", bearer())
    ck("the token opens nothing of the Home Assistant relay: 401", status == 401, status)
    status, _ = await jget("/fm-data", bearer())
    ck("  ...nor the app's own Facility door", status == 401, status)
    reset_lockout()
    for _ in range(proxy.AUTH_MAX_FAILURES):
        await get("/agent/v1/info", headers=bearer("wrong-token-0123456789", peer="10.9.9.9"))
    status, body = await jget("/agent/v1/info", bearer(peer="10.9.9.9"))
    ck("five wrong tokens lock that address out, the right one included: 429",
       status == 429 and body.get("retryAfter", 0) > 0, (status, body))
    status, _ = await jget("/agent/v1/info", bearer(peer="10.0.0.5"))
    ck("  ...but only that address", status == 200, status)
    ck("  ...in the agent's own bucket: no profile's lockout moved",
       all(not proxy._auth_failures_global[r] for r in proxy.AUTH_ROLES), proxy._auth_failures_global)
    reset_lockout()

    # ── Facility records (PLAN A4, A5) ───────────────────────────────────
    print("\n  Facility records:")
    base = {"schedules": [], "tickets": [
        {"id": "t1", "title": "Leak", "status": "open", "openedAt": "2026-09-01T00:00:00Z",
         "photoIds": ["ph_one"]}], "completions": [], "costs": [], "savedDocuments": []}
    (TMP / "data" / "fm-data.json").write_text(json.dumps(base))
    status, body = await jget("/agent/v1/fm-data", bearer())
    ck("the agent reads the whole record with its revision",
       status == 200 and body["data"]["tickets"][0]["id"] == "t1" and body["rev"], body)
    rev = body["rev"]

    async def agent_put(doc, rev_):
        r = await put("/agent/v1/fm-data", headers=bearer(),
                      json={"data": doc, **({"rev": rev_} if rev_ else {})})
        return r.status, await r.json()

    status, _ = await agent_put(base, None)
    ck("a write without rev is refused: 428", status == 428, status)
    status, _ = await agent_put(base, "stale")
    ck("a stale rev: 409", status == 409, status)
    new_doc = json.loads(json.dumps(base))
    new_doc["tickets"].append({"id": "t2", "title": "Pump noise", "status": "open",
                               "openedAt": "2026-09-28T00:00:00Z", "photoIds": []})
    new_doc["completions"].append({"id": "c1", "scheduleId": "", "ticketId": "t2", "at": "2026-09-28T01:00:00Z",
                                   "by": "someone", "photoIds": []})
    status, body = await agent_put(new_doc, rev)
    ck("creating records: 200", status == 200, (status, body))
    stored = json.loads((TMP / "data" / "fm-data.json").read_text())
    t2 = next(t for t in stored["tickets"] if t["id"] == "t2")
    t1 = next(t for t in stored["tickets"] if t["id"] == "t1")
    c1 = stored["completions"][0]
    ck("  ...each new record carries source vesta_agent and updatedAt (stamped by the Kiosk)",
       t2.get("source") == "vesta_agent" and t2.get("updatedAt"), t2)
    ck("  ...a completion is signed by the VESTA Agent, whatever it sent", c1.get("by") == "VESTA Agent", c1)
    ck("  ...a record sent back unchanged is not claimed", "source" not in t1, t1)
    rev = body["rev"]
    edited = json.loads(json.dumps(stored))
    edited["tickets"][0]["status"] = "in_progress"
    status, body = await agent_put(edited, rev)
    stored = json.loads((TMP / "data" / "fm-data.json").read_text())
    ck("updating a person's record marks it as changed by the agent",
       status == 200 and stored["tickets"][0].get("source") == "vesta_agent", (status, stored["tickets"][0]))
    rev = body["rev"]
    # ⚠️ t2 HAS NO PHOTO. Removing t1 would be refused by the photo rule
    # below whatever the delete rule said — mutation-testing this file found
    # the delete rule could be switched off with this check still green.
    gone = json.loads(json.dumps(stored))
    gone["tickets"] = [t for t in gone["tickets"] if t["id"] != "t2"]
    status, body = await agent_put(gone, rev)
    ck("removing a record: 403 'may not delete', and nothing is written",
       status == 403 and "may not delete" in body.get("error", "")
       and len(json.loads((TMP / "data" / "fm-data.json").read_text())["tickets"]) == 2,
       (status, body))
    no_photo = json.loads(json.dumps(stored))
    no_photo["tickets"][0]["photoIds"] = []
    status, body = await agent_put(no_photo, rev)
    ck("removing a photo from a record: 403 (it would delete the evidence file)",
       status == 403 and "photo" in body.get("error", ""), (status, body))
    extra = json.loads(json.dumps(stored))
    extra["somethingElse"] = 1
    status, _ = await agent_put(extra, rev)
    ck("changing a key the Kiosk does not know: 403", status == 403, status)
    no_id = json.loads(json.dumps(stored))
    no_id["costs"].append({"label": "x"})
    status, _ = await agent_put(no_id, rev)
    ck("a record without an id: 400", status == 400, status)
    # A record the agent writes is held to what a valid record is — the
    # same rules the Kiosk's own code meets (_fm_record_errors, 2.496.223).
    def with_record(name, record):
        d = json.loads(json.dumps(stored))
        d[name].append(record)
        return d
    before_disk = (TMP / "data" / "fm-data.json").read_text()
    for what, name, record in (
        ("a fault marked resolved with no resolution date", "tickets",
         {"id": "t9", "title": "x", "status": "resolved", "openedAt": "2026-09-28T00:00:00Z", "photoIds": []}),
        ("a fault with a status the Kiosk does not know", "tickets",
         {"id": "t9", "title": "x", "status": "done", "openedAt": "2026-09-28T00:00:00Z", "photoIds": []}),
        ("a cost whose amount is text", "costs",
         {"id": "k9", "at": "2026-09-28T00:00:00Z", "amountIdr": "150000", "label": "x",
          "category": "minor", "photoIds": []}),
        ("a cost in a category the Kiosk does not know", "costs",
         {"id": "k9", "at": "2026-09-28T00:00:00Z", "amountIdr": 5, "label": "x",
          "category": "urgent", "photoIds": []}),
        ("a completion tied to no schedule and no fault", "completions",
         {"id": "c9", "scheduleId": "", "at": "2026-09-28T00:00:00Z", "by": "x", "photoIds": []}),
    ):
        status, body = await agent_put(with_record(name, record), rev)
        ck(f"{what}: 400, named in the answer, nothing written",
           status == 400 and "invalid Facility record" in body.get("error", "")
           and (TMP / "data" / "fm-data.json").read_text() == before_disk, (status, body))
    status, body = await agent_put(with_record("tickets", {
        "id": "t9", "title": "x", "status": "resolved", "openedAt": "2026-09-28T00:00:00Z",
        "resolvedAt": "2026-09-28T02:00:00Z", "photoIds": []}), rev)
    ck("  ...the same fault WITH its resolution date is stored", status == 200, (status, body))
    rev = body.get("rev", rev)
    stored = json.loads((TMP / "data" / "fm-data.json").read_text())

    r = await post("/agent/v1/fm-evidence?id=agentphoto1", headers=bearer(), data=b"\xff\xd8\xff" + b"0" * 64)
    ck("the agent attaches a JPEG: 200", r.status == 200, r.status)
    r = await post("/agent/v1/fm-evidence?id=agentphoto2", headers=bearer(), data=b"not a jpeg")
    ck("  ...anything else: 400", r.status == 400, r.status)

    # ── the message channel is gone (2.496.445) ───────────────────────────
    # The agent never posted a message (people talk to it on Telegram, decision D4) and the Kiosk's agent window was
    # removed (2.496.443): every door of the channel answers 404, to the agent and to every profile alike.
    print("\n  the message channel is gone:")
    gone = []
    for method, path, headers in (("POST", "/agent/v1/messages", bearer()), ("GET", "/agent/v1/choices?since=0", bearer()),
                                  ("GET", "/agent-messages", cookie("owner")), ("GET", "/agent-messages", cookie("guest")),
                                  ("GET", "/agent-messages", INGRESS),
                                  ("POST", "/agent-messages/clear", cookie("owner")), ("GET", "/agent-choices", cookie("ops")),
                                  ("PUT", "/agent-choices", cookie("owner"))):
        r = await (client.request(method, path, headers=headers, json={}))
        if r.status != 404:
            gone.append(f"{method} {path}: {r.status}")
    ck("every route of the message channel answers 404, whoever asks", not gone, gone)
    ck("  ...and its stores, left on an install by an older version, were removed at start — once",
       not (TMP / "data" / "agent-messages.json").exists() and not (TMP / "data" / "agent-choices.json").exists()
       and proxy._remove_retired_data() == [])

    # ── presence (PLAN A7) ───────────────────────────────────────────────
    print("\n  presence:")
    (TMP / "data" / "agent-presence.json").unlink(missing_ok=True)   # start from no heartbeat on record
    status, body = await jget("/agent-status", cookie("ops"))
    ck("no heartbeat on record: offline", body.get("state") == "offline", body)
    r = await post("/agent/v1/heartbeat", headers=bearer(), json={"status": "all quiet"})
    ck("a heartbeat: 200", r.status == 200, r.status)
    status, body = await jget("/agent-status", cookie("ops"))
    ck("  ...online, with its status text", body.get("state") == "online" and body.get("status") == "all quiet", body)
    ck("  ...and no timing when the agent did not say it (the (i) then gives no number)", body.get("cadence") is None, body)
    beat = json.loads((ROOT / "rootfs" / "usr" / "share" / "vesta" / "agent-contract.json").read_text())["heartbeat"]["sample"]
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    status, body = await jget("/agent-status", cookie("ops"))
    ck("the agreement's heartbeat: its timing is kept and shown (architecture review, 2026-10-15)",
       r.status == 200 and body.get("cadence") == beat["cadence"], (r.status, body))
    # ⚠️ THE BEAT USED TO BE REFUSED WHOLE (400, to 2.496.427): a running Agent whose timing had one wrong field showed
    # Offline for good. A malformed cadence is dropped, the beat still counts (owner, 2026-10-19).
    dropped = []
    for bad in ({"checkMinutes": 0, "nightlyAt": "02:00"}, {"checkMinutes": 5, "nightlyAt": "2am"},
                {"checkMinutes": True, "nightlyAt": "02:00"}, "every 5 min"):
        presence_file = TMP / "data" / "agent-presence.json"
        presence_file.write_text(json.dumps({"last_seen": time.time() - 60 * 60, "status": None, "cadence": beat["cadence"]}))
        r = await post("/agent/v1/heartbeat", headers=bearer(), json={"status": "x", "cadence": bad})
        answer = await r.json()
        status, body = await jget("/agent-status", cookie("ops"))
        stored = json.loads(presence_file.read_text()).get("cadence", "absent")
        dropped.append((bad, r.status, answer.get("cadence"), body.get("state"), body.get("cadence"), stored))
    ck("  ...a malformed cadence is dropped, the beat still counts (online, cadence null), and the answer says why",
       all(st == 200 and isinstance(why, str) and why.startswith("refused: ") and state == "online" and cad is None
           for _, st, why, state, cad, _ in dropped), dropped)
    ck("  ...and it is never stored (the record's cadence is null, not the malformed one)",
       all(kept is None for *_, kept in dropped), dropped)
    # owner, 2026-10-20: the Agent no longer sends day times; an older one that still does — well-formed or not — keeps
    # its beat AND its timing, the times dropped, never a refusal
    kept = []
    for old in (["20:00", "08:00"], [], ["8:00"], "08:00", [f"{h:02d}:00" for h in range(13)]):
        r = await post("/agent/v1/heartbeat", headers=bearer(),
                       json={"status": "x", "cadence": {"checkMinutes": 5, "nightlyAt": "02:00", "dayChecksAt": old}})
        answer = await r.json()
        status, body = await jget("/agent-status", cookie("ops"))
        kept.append((old, r.status, answer.get("cadence"), body.get("state"), body.get("cadence")))
    ck("an older Agent's day times are dropped: the beat counts, its timing is kept as the two numbers, no refusal",
       all(st == 200 and why is None and state == "online" and cad == {"checkMinutes": 5, "nightlyAt": "02:00"}
           for _, st, why, state, cad in kept), kept)
    status, body = await jget("/agent/v1/info", bearer())
    ck("/agent/v1/info lists the checks this Kiosk reads, from the agreement — no \"day\" any more",
       status == 200 and body.get("ticket_checks") == json.loads((ROOT / "rootfs" / "usr" / "share" / "vesta"
       / "agent-contract.json").read_text())["ticket"]["checks"] and "day" not in body["ticket_checks"], body)
    # owner, 2026-10-21: the Agent says when its look last started (the card's Next check counts from it): kept when it
    # is a moment, dropped otherwise — never a refusal
    looks = []
    for look, want in (("2026-10-21T06:40:12+00:00", True), ("soon", False), (12, False), ("x" * 60, False)):
        r = await post("/agent/v1/heartbeat", headers=bearer(),
                       json={"status": "x", "cadence": {"checkMinutes": 5, "nightlyAt": "02:00", "lastLookAt": look}})
        answer = await r.json()
        status, body = await jget("/agent-status", cookie("ops"))
        looks.append((look, want, r.status, answer.get("cadence"), (body.get("cadence") or {}).get("lastLookAt")))
    ck("the Agent's last look is kept when it is a moment, dropped otherwise, the beat and its timing kept",
       all(st == 200 and why is None and (got == look if want else got is None) for look, want, st, why, got in looks), looks)
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    ck("  ...a well-formed beat's answer names no refusal", r.status == 200 and "cadence" not in await r.json())
    # ⚠️ THE KIOSK OWNS THE DEVICES ASLEEP BY DESIGN (owner, 2026-10-21): the Agent reads them in every beat's answer
    contract_answer = json.loads((ROOT / "rootfs" / "usr" / "share" / "vesta" / "agent-contract.json").read_text())[
        "heartbeat"]["answer"]
    cfg_file = TMP / "data" / "device-config.json"
    cfg_file.unlink(missing_ok=True)
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    none_marked = (await r.json()).get("unavailableByDesign")
    cfg_file.write_text(json.dumps({"unavailableByDesign": [
        "binary_sensor.back_door", "sensor.b_temp", "binary_sensor.back_door", "{{ states('x') }}", 7]}))
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    answer = await r.json()
    ck("the beat's answer carries the devices asleep by design, as the agreement declares it (sorted, once, ids only)",
       r.status == 200 and "unavailableByDesign" in contract_answer
       and answer.get("unavailableByDesign") == ["binary_sensor.back_door", "sensor.b_temp"], answer)
    ck("  ...an empty list when none is marked (no setting stored)", none_marked == [], none_marked)
    cfg_file.write_text(json.dumps({"unavailableByDesign": "binary_sensor.x"}))
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    ck("  ...and a setting of another shape is an empty list, never a refused beat",
       r.status == 200 and (await r.json()).get("unavailableByDesign") == [])
    cfg_file.unlink(missing_ok=True)
    # ⚠️ THE KIOSK OWNS THE VILLA'S MAINTENANCE MODE (owner, 2026-10-29): the Agent reads it in every beat's answer
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    unset = (await r.json()).get("maintenance")
    cfg_file.write_text(json.dumps({"maintenanceMode": True}))
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    on = (await r.json()).get("maintenance")
    cfg_file.write_text(json.dumps({"maintenanceMode": "yes"}))
    r = await post("/agent/v1/heartbeat", headers=bearer(), json=beat)
    odd = (await r.json()).get("maintenance")
    ck("the beat's answer carries the villa's maintenance mode, as the agreement declares it: on only when stored true",
       "maintenance" in contract_answer and on is True and unset is False and odd is False, (unset, on, odd))
    cfg_file.unlink(missing_ok=True)
    presence = TMP / "data" / "agent-presence.json"
    presence.write_text(json.dumps({"last_seen": time.time() - 6 * 60, "status": None, "cadence": beat["cadence"]}))
    status, body = await jget("/agent-status", cookie("ops"))
    ck("six minutes of silence (window 5): offline — computed, so a restart cannot lie",
       body.get("state") == "offline", body)
    # architecture review, 2026-10-19: the stored timing was answered offline too, so every card read "Next check:
    # within 5 min" days after the Agent had stopped
    ck("  ...and the cadence is withheld (null): no clock without an Agent to keep it", body.get("cadence") is None, body)
    agent(enabled=True, token=TOKEN, offline_after_minutes=10)
    status, body = await jget("/agent-status", cookie("ops"))
    ck("  ...and the window is the option's", body.get("state") == "online", body)
    ck("  ...online again, its stored timing is shown again", body.get("cadence") == beat["cadence"], body)

    # ── the villa model (PLAN A4) ────────────────────────────────────────
    print("\n  the villa model:")
    (TMP / "data" / "device-config.json").write_text(json.dumps({
        "entityMap": {"light.living_ceiling": {"entityId": "light.living_ceiling", "type": "light",
                                               "label": "Ceiling light"},
                      "light.gone": {"entityId": "light.gone", "type": "light", "label": "Gone"},
                      "light.hall": {"entityId": "light.hall", "type": "light", "label": "Hall light"}},
        "meshBindings": {"mesh_7": "switch.pool_pump"},
        "deviceGroups": [{"id": "g1", "primaryEntityId": "light.living_ceiling",
                          "memberEntityIds": ["sensor.living_power"]}],
        "teleportPoints": [{"name": "Rooftop", "floor": 3}, {"name": "Fitted", "floor": 1, "fitted": True}],
        "dismissedEntityIds": ["light.gone"]}))
    (TMP / "data" / "www" / "villa.glb").write_bytes(b"glTF")
    (TMP / "data" / "www" / "villa.rooms.json").write_text(json.dumps(
        {"rooms": [{"name": "Living", "floor": 1, "points": []}]}))
    async def share(headers, rooms):
        r = await put("/kiosk-rooms", headers=headers, json={"data": {"rooms": rooms}})
        return r.status

    ck("a guest's device does not share rooms: 403", await share(cookie("guest"), {"light.hall": "Hall"}) == 403)
    ck("  ...a room map that is not one: 400", await share(cookie("ops"), {"not an id": "x"}) == 400)
    ck("an owner/ops device shares the rooms it resolved: 200", await share(cookie("ops"), {
        "sensor.living_power": "Living", "light.living_ceiling": "Somewhere else"}) == 200)
    status, body = await jget("/agent/v1/villa-model", bearer())
    devices = {d["entity_id"]: d for d in body.get("devices", [])} if status == 200 else {}
    ck("devices: mapped, mesh-bound and grouped ids; the dismissed one left out",
       set(devices) == {"light.living_ceiling", "switch.pool_pump", "sensor.living_power", "light.hall"},
       sorted(devices))
    ck("  ...the Kiosk's label wins, Home Assistant's name otherwise",
       devices.get("light.living_ceiling", {}).get("name") == "Ceiling light"
       and devices.get("switch.pool_pump", {}).get("name") == "Pool pump")
    ck("  ...each device's room and floor are Home Assistant's area",
       devices.get("light.living_ceiling", {}).get("room") == "Living"
       and devices["light.living_ceiling"]["floor"] == "Ground"
       and devices.get("switch.pool_pump", {}).get("room") == "Garden")
    # each device's name and category as the Kiosk shows them, shared beside the rooms (architecture review scan 3,
    # 2026-10-19): the Kiosk's answer wins over the stored label and category
    r = await put("/kiosk-rooms", headers=cookie("ops"), json={"data": {
        "rooms": {"sensor.living_power": "Living"}, "names": {"light.hall": "Hallway lamp"},
        "categories": {"light.hall": "light"}}})
    ck("a device shares the names and categories the Kiosk shows: 200", r.status == 200)
    ck("  ...a name map that is not one: 400", (await put("/kiosk-rooms", headers=cookie("ops"), json={"data": {
        "rooms": {}, "names": {"light.hall": ""}}})).status == 400)
    status, body = await jget("/agent/v1/villa-model", bearer())
    devices = {d["entity_id"]: d for d in body.get("devices", [])} if status == 200 else {}
    ck("  ...and the villa model names and files the device as the Kiosk does",
       devices.get("light.hall", {}).get("name") == "Hallway lamp" and devices["light.hall"].get("category") == "light",
       devices.get("light.hall"))
    ck("  ...no area: the room the Kiosk shows, marked as the Kiosk's",
       devices.get("sensor.living_power", {}).get("room") == "Living"
       and devices["sensor.living_power"]["room_source"] == "kiosk", devices.get("sensor.living_power"))
    ck("  ...Home Assistant's area still wins over what a device shared",
       devices.get("light.living_ceiling", {}).get("room") == "Living"
       and devices["light.living_ceiling"]["room_source"] == "ha_area")
    ck("  ...neither: it says so rather than guessing",
       devices.get("light.hall", {}).get("room") is None and devices["light.hall"]["room_source"] is None)
    ck("  ...its group", devices.get("sensor.living_power", {}).get("group_id") == "g1")
    names = [(r["name"], r["source"]) for r in body.get("rooms", [])]
    ck("rooms: the floor plan's and the ones people added; fitted points are not rooms",
       names == [("Living", "floor_plan"), ("Rooftop", "added")], names)
    ck("ha_areas says the areas were read", body.get("ha_areas") is True)

    # ── VESTA's messages as they stand (ticket 25 of "One inbox", 2026-10-28) ────────────────────────────────────
    print("\n  VESTA's messages, kept for the tablet:")
    import base64
    cfg_file = TMP / "data" / "device-config.json"
    cfg_file.unlink(missing_ok=True)
    msgs = TMP / "data" / "vesta-messages.json"
    msgs.unlink(missing_ok=True)
    sent = {"key": "incident:90", "title": "#90-P2 (existing)", "roles": ["Owner", "FM"], "to": "Owner & FM", "lead": "Intrusion suspected",
            "body": "Turn on Siren?", "status": ["- Alert sent", "⚠️ Waiting for approval"], "stage": "existing",
            "buttons": [{"label": "Done", "kind": "i", "id": "90:done"}],
            "takes": ["RUN-A"],
            "languages": {"id": {"body": "Nyalakan sirene?", "status": ["- Peringatan terkirim"]}}}
    r = await post("/agent/v1/vesta-message", json=sent)
    ck("no token: refused, nothing kept", r.status == 401 and not msgs.exists(), r.status)
    r = await post("/agent/v1/vesta-message", headers=bearer("wrong-token"), json=sent)
    ck("  ...a wrong token too", r.status == 401, r.status)
    r = await post("/agent/v1/vesta-message", headers=cookie("owner"), json=sent)
    ck("  ...and a signed-in owner's cookie is no token", r.status == 401, r.status)
    reset_lockout()
    r = await post("/agent/v1/vesta-message", headers=bearer(), json=sent)
    answer = await r.json()
    ck("the Agent's push is kept, numbered", r.status == 200 and answer == {"ok": True, "seq": 1}, answer)
    status, body = await jget("/vesta-messages", cookie("guest"))
    got = (body or {}).get("messages", [None])[0] or {}
    ck("  ...and every profile reads it as it was pushed (a guest too)",
       status == 200 and body["last"] == 1 and {k: v for k, v in got.items() if k not in ("seq", "at")} == sent, body)
    status, _ = await jget("/vesta-messages", {})
    ck("  ...but a page with no session reads nothing", status == 401, status)
    jpeg = proxy._JPEG_MAGIC + b"snapshot"
    r = await post("/agent/v1/vesta-message", headers=bearer(),
                   json={**sent, "body": "Camera snapshot", "photo": base64.b64encode(jpeg).decode()})
    status, body = await jget("/vesta-messages", cookie("ops"))
    one = body["messages"]
    ck("a rewrite of the same key REPLACES the record (one line), numbered anew, with its photo",
       r.status == 200 and len(one) == 1 and one[0]["body"] == "Camera snapshot" and one[0]["seq"] == 2
       and (TMP / "data" / proxy.ANNOUNCEMENT_PHOTO_DIR / one[0].get("photo", "none")).read_bytes() == jpeg, body)
    r = await post("/agent/v1/vesta-message", headers=bearer(),
                   json={**sent, "status": ["- Alert sent", "- Reminder sent", "✅ Done"], "buttons": []})
    status, body = await jget("/vesta-messages", cookie("ops"))
    one = body["messages"]
    ck("  ...a later rewrite with no photo keeps the first one's; with no buttons it withdraws them",
       len(one) == 1 and one[0].get("photo") and "buttons" not in one[0] and one[0]["status"][-1] == "✅ Done", body)
    status, gbody = await jget("/vesta-messages", cookie("guest"))
    r = await get(f"/announcement-photo/{one[0]['photo']}", headers=cookie("guest"))
    ck("  ...a guest sees that photo while it is the current notification, as a ring's (owner, 2026-10-28)",
       gbody["messages"][0].get("photo") == one[0]["photo"] and r.status == 200, (r.status, gbody))
    proxy.ANNOUNCEMENT_PHOTO_GRACE_S = 0       # the sweep's grace for a copy not yet recorded: none here
    soon = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 5))
    await proxy._record_announcement(None, {"event_type": proxy.ANNOUNCEMENT_EVENT, "time_fired": soon,
                                            "data": {"message": "<b>Other</b>"}})
    ck("  ...a villa announcement's sweep leaves a message's photo alone (one folder, two feeds)",
       (TMP / "data" / proxy.ANNOUNCEMENT_PHOTO_DIR / one[0]["photo"]).is_file())
    r = await get(f"/announcement-photo/{one[0]['photo']}", headers=cookie("guest"))
    ck("  ...and a newer villa announcement takes the current place: the guest's photo is 403", r.status == 403, r.status)
    await post("/agent/v1/vesta-message", headers=bearer(), json={"key": "note:1", "title": "Morning digest", "body": "New"})
    status, gbody = await jget("/vesta-messages", cookie("guest"))
    r = await get(f"/announcement-photo/{one[0]['photo']}", headers=cookie("guest"))
    ck("  ...but not once a newer message came: the list names no photo and the file is 403",
       r.status == 403 and all("photo" not in m for m in gbody["messages"]), (r.status, gbody))
    status, body = await jget("/vesta-messages", cookie("owner"))
    ck("  ...the owner still sees it, and two keys are two lines", len(body["messages"]) == 2
       and body["messages"][0].get("photo"), body)
    for bad in ({"title": "no key"}, {"key": "k"}, {"key": "k", "buttons": "x"}, [1], "text"):
        r = await post("/agent/v1/vesta-message", headers=bearer(), json=bad)
        ck(f"a push of {str(bad)[:28]!r} is refused (400), nothing kept", r.status == 400, r.status)
    for photo in ("not base64 !!", base64.b64encode(b"not a picture").decode(), base64.b64encode(b"x" * 10).decode()):
        await post("/agent/v1/vesta-message", headers=bearer(), json={"key": "bad-photo", "title": "t", "photo": photo})
    status, body = await jget("/vesta-messages", cookie("owner"))
    bad_photo = next(m for m in body["messages"] if m["key"] == "bad-photo")
    ck("a photo that is not a picture is dropped, the message kept without it", "photo" not in bad_photo, bad_photo)
    r = await post("/agent/v1/vesta-message", headers=bearer(), json={
        "key": "k" * 500, "title": "T" * 900, "roles": ["r"] * 30, "status": ["s"] * 90,
        "buttons": [{"label": "b", "kind": "i", "id": str(n)} for n in range(20)] + [{"label": "no id"}, "x"]})
    status, body = await jget("/vesta-messages", cookie("owner"))
    cut = body["messages"][-1]
    lim = proxy.VESTA_MESSAGE_LIMITS
    ck("every field is cut at the agreement's limit (key, title, lists)",
       r.status == 200 and len(cut["key"]) == lim["key"] and len(cut["title"]) == lim["title"]
       and len(cut["roles"]) == lim["roles"] and len(cut["status"]) == lim["status"]
       and len(cut["buttons"]) == lim["buttons"], {k: len(v) for k, v in cut.items() if hasattr(v, "__len__")})
    r = await client.delete("/agent/v1/vesta-message", headers=bearer())
    r2 = await client.delete("/agent/v1/vesta-message?key=incident:90", headers=bearer())
    status, body = await jget("/vesta-messages", cookie("owner"))
    ck("the Agent has no way to remove one: no such route, every record still kept",
       r.status in (404, 405) and r2.status in (404, 405) and any(m["key"] == "incident:90" for m in body["messages"]),
       (r.status, r2.status))
    # tickets 26-27 of "One inbox": the run that announced a villa message, which VESTA's card names when it takes it over
    await proxy._record_announcement(None, {"event_type": proxy.ANNOUNCEMENT_EVENT, "context": {"id": "RUN-A"},
                                            "data": {"message": "<b>Door unlocked</b>"}})
    status, body = await jget("/announcements", cookie("guest"))
    ck("the villa's announcement names the run that announced it (the event's context), as VESTA's card names it",
       body["announcements"][-1].get("run") == "RUN-A", body["announcements"][-1])
    cfg_file.write_text(json.dumps({"recordsKeptDays": 30}))
    old = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - 40 * 86400))
    await post("/agent/v1/vesta-message", headers=bearer(), json={"key": "old-one", "title": "Old", "at": old})
    status, body = await jget("/vesta-messages", cookie("owner"))
    ck("kept for the records-kept days only: an older one is gone with the next read",
       "old-one" not in [m["key"] for m in body["messages"]] and "incident:90" in [m["key"] for m in body["messages"]], body)
    cfg_file.write_text(json.dumps({"recordsKeptDays": 0}))
    await post("/agent/v1/vesta-message", headers=bearer(), json={"key": "old-one", "title": "Old", "at": old})
    status, body = await jget("/vesta-messages", cookie("owner"))
    ck("  ...and with records kept for ever, it is kept", "old-one" in [m["key"] for m in body["messages"]], body)
    cfg_file.unlink(missing_ok=True)

    # ── a report and its page (ticket 20 of "One inbox", 2026-10-29) ─────────────────────────────────────────────
    print("\n  A report, kept with its page:")
    page = b"<!DOCTYPE html><html><body>Weekly</body></html>"
    pages = {}
    for name in ("page-en-0001", "page-fr-0001", "page-loose-01"):
        r = await post(f"/agent/v1/fm-document?id={name}", headers=bearer(), data=page)
        pages[name] = r.status
    r = await post("/agent/v1/fm-document?id=page-en-0002", data=page)
    ck("the Agent uploads a page attached to no fault (its token); without the token, refused",
       set(pages.values()) == {200} and r.status == 401, (pages, r.status))
    report = {"key": "note:weekly", "title": "Weekly report", "to": "FM", "body": "Two things to look at",
              "report": "reports:fm-weekly", "page": "page-en-0001", "language": "en",
              "languages": {"fr": {"body": "Deux choses", "page": "page-fr-0001"}}}
    r = await post("/agent/v1/vesta-message", headers=bearer(), json=report)
    status, body = await jget("/vesta-messages", cookie("ops"))
    got = next((m for m in body["messages"] if m["key"] == "note:weekly"), {})
    ck("a report is kept with its job, its page, its language and each other language's page",
       r.status == 200 and {k: v for k, v in got.items() if k not in ("seq", "at")} == report, got)
    await post("/agent/v1/vesta-message", headers=bearer(), json={"key": "note:weekly", "title": "Weekly report",
                                                                  "body": "Two things to look at, one done"})
    status, body = await jget("/vesta-messages", cookie("ops"))
    got = next((m for m in body["messages"] if m["key"] == "note:weekly"), {})
    ck("  ...a rewrite naming no job or page keeps the first one's (still a report, still its page)",
       got.get("report") == "reports:fm-weekly" and got.get("page") == "page-en-0001"
       and got.get("body") == "Two things to look at, one done", got)
    await post("/agent/v1/vesta-message", headers=bearer(), json={"key": "note:bad-page", "title": "t",
                                                                  "page": "../../etc/passwd", "report": 7})
    status, body = await jget("/vesta-messages", cookie("ops"))
    got = next((m for m in body["messages"] if m["key"] == "note:bad-page"), {})
    ck("  ...a page that is no document id, or a job that is no text, is dropped", "page" not in got
       and "report" not in got, got)
    await post("/agent/v1/vesta-message", headers=bearer(), json=report)       # the report as it was first sent
    old_grace = proxy.FM_EVIDENCE_ORPHAN_GRACE_SECONDS
    proxy.FM_EVIDENCE_ORPHAN_GRACE_SECONDS = 0
    long_ago = time.time() - 3600
    try:
        for name in pages:
            os.utime(TMP / "data" / proxy.FM_EVIDENCE_NAME / f"{name}.html", (long_ago, long_ago))
        proxy._fm_after_write([], [])
    finally:
        proxy.FM_EVIDENCE_ORPHAN_GRACE_SECONDS = old_grace
    kept_pages = {n: (TMP / "data" / proxy.FM_EVIDENCE_NAME / f"{n}.html").is_file() for n in pages}
    ck("a fault's write sweeps a page nothing names, never a page a kept report names (it no longer goes with a ticket)",
       kept_pages == {"page-en-0001": True, "page-fr-0001": True, "page-loose-01": False}, kept_pages)
    r = await get("/fm-document/page-en-0001", headers=cookie("ops"))
    ck("  ...and the facility manager opens it in the document viewer", r.status == 200
       and (await r.read()) == page, r.status)
    cfg_file.write_text(json.dumps({"recordsKeptDays": 30}))
    aged = time.time() - 40 * 86400
    os.utime(TMP / "data" / proxy.FM_EVIDENCE_NAME / "page-en-0001.html", (aged, aged))
    proxy._prune_fm_evidence()
    cfg_file.unlink(missing_ok=True)
    ck("  ...but past the records-kept days it goes, named or not (its own lifetime)",
       not (TMP / "data" / proxy.FM_EVIDENCE_NAME / "page-en-0001.html").exists())

    # ── Talking to VESTA (ticket 21 of "One inbox", 2026-10-29) ─────────────────────────────────────────────────────
    print("\n  talking to VESTA on the tablet:")
    asks, turns = TMP / "data" / "vesta-asks.json", TMP / "data" / "vesta-conversation.json"
    (TMP / "data" / "agent-presence.json").unlink(missing_ok=True)
    reset_lockout()
    r = await post("/vesta-ask", headers=cookie("owner"), json={"text": "Is the pool pump on?"})
    ck("a question while VESTA is not running: 503, nothing kept (nobody would answer)",
       r.status == 503 and not asks.exists(), r.status)
    await post("/agent/v1/heartbeat", headers=bearer())
    status, body = await jget("/vesta-conversation", cookie("guest"))
    ck("  ...its heartbeat: every profile reads that VESTA runs (a guest too, who may not see its presence)",
       status == 200 and body["vesta"] == "online" and body["turns"] == [], body)
    r = await post("/vesta-ask", json={"text": "hello"})
    ck("no session: refused, nothing kept", r.status == 401 and not asks.exists(), r.status)
    r = await post("/vesta-ask", headers=cookie("guest"), json={"text": "Open the gate", "profile": "owner"})
    ck("  ...a page naming its profile is refused: the add-on stamps it (400)", r.status == 400 and not asks.exists(),
       r.status)
    for bad in ({"text": ""}, {"text": "  "}, {"text": 3}, {"text": "x" * 2001}, {}):
        r = await post("/vesta-ask", headers=cookie("guest"), json=bad)
        ck(f"  ...a question of {str(bad)[:24]!r} is refused (400)", r.status == 400, r.status)
    r = await post("/vesta-ask", headers=cookie("guest"), json={"text": "  What is the wifi password?  "})
    ck("a guest's question is kept", r.status == 200, r.status)
    r = await post("/vesta-ask", headers=cookie("owner"), json={"text": "Is the pool pump on?"})
    status, body = await jget("/agent/v1/inbox", bearer())
    ck("the Agent collects both, each stamped with the profile that asked, in order",
       status == 200 and [(a["profile"], a["text"]) for a in body["asks"]]
       == [("guest", "What is the wifi password?"), ("owner", "Is the pool pump on?")], body)
    last = body["last"]
    status, _ = await jget("/agent/v1/inbox", {})
    reset_lockout()
    status2, _ = await jget("/agent/v1/inbox", cookie("owner"))
    ck("  ...the inbox is the Agent's only: no token, or a signed-in owner's cookie, is 401",
       status == 401 and status2 == 401, (status, status2))
    reset_lockout()
    began = time.monotonic()
    proxy.CONVERSATION["waitSeconds"] = 1
    status, body = await jget(f"/agent/v1/inbox?after={last}", bearer())
    ck("  ...a read after the last waits for the next one, then answers none",
       status == 200 and body["asks"] == [] and time.monotonic() - began >= 0.9, body)
    status, body = await jget("/vesta-conversation", cookie("guest"))
    ck("the guest reads its own question in its conversation, and not the owner's",
       [(t["from"], t["text"]) for t in body["turns"]] == [("person", "What is the wifi password?")], body)
    r = await post("/agent/v1/conversation-turn", headers=bearer(), json={"key": "turn:1", "profile": "guest",
                                                                          "text": "Being prepared"})
    ck("the Agent's answer is a turn of that profile's conversation", r.status == 200, r.status)
    r = await post("/agent/v1/conversation-turn", json={"key": "turn:x", "profile": "guest", "text": "x"})
    ck("  ...written with its token only (401)", r.status == 401, r.status)
    reset_lockout()
    for bad in ({"key": "ask:9", "profile": "guest", "text": "I am the guest"}, {"key": "t", "profile": "boss", "text": "x"},
                {"key": "t", "profile": "guest"}, {"profile": "guest", "text": "x"}):
        r = await post("/agent/v1/conversation-turn", headers=bearer(), json=bad)
        ck(f"  ...a turn {str(bad)[:40]!r} is refused (400): a person's line, an unknown profile, nothing said",
           r.status == 400, r.status)
    jpeg = proxy._JPEG_MAGIC + b"camera"
    r = await post("/agent/v1/conversation-turn", headers=bearer(), json={
        "key": "turn:1", "profile": "guest", "text": "The wifi is on the card by the door.",
        "photos": [base64.b64encode(jpeg).decode()]})
    r2 = await post("/agent/v1/conversation-turn", headers=bearer(), json={
        "key": "turn:2", "profile": "owner", "text": "The pool pump is on.", "page": "page-en-0001",
        "photos": [base64.b64encode(jpeg).decode()]})
    status, body = await jget("/vesta-conversation", cookie("guest"))
    ck("a rewrite REPLACES the turn of its key (the waiting answer becomes its result), and a guest gets no picture",
       r.status == 200 and [(t["from"], t.get("text")) for t in body["turns"]]
       == [("person", "What is the wifi password?"), ("vesta", "The wifi is on the card by the door.")]
       and all("photos" not in t for t in body["turns"]), body)
    status, body = await jget("/vesta-conversation", cookie("owner"))
    answer = body["turns"][-1]
    ck("  ...the owner's answer with its picture and its page, and nothing of the guest's",
       r2.status == 200 and len(body["turns"]) == 2 and answer.get("page") == "page-en-0001"
       and (TMP / "data" / proxy.ANNOUNCEMENT_PHOTO_DIR / answer["photos"][0]).read_bytes() == jpeg, body)
    status, body = await jget("/vesta-conversation", cookie("ops"))
    ck("  ...and the facility manager's conversation is its own (empty)", body["turns"] == [], body)
    await post("/agent/v1/conversation-turn", headers=bearer(), json={"key": "turn:2", "profile": "owner", "gone": True})
    status, body = await jget("/vesta-conversation", cookie("owner"))
    ck("a withdrawn answer is kept as withdrawn: no words, no picture", body["turns"][-1].get("gone") is True
       and "text" not in body["turns"][-1] and "photos" not in body["turns"][-1], body)
    for _ in range(proxy.ASKS_PER_MINUTE):
        await post("/vesta-ask", headers=cookie("ops"), json={"text": "again?"})
    r = await post("/vesta-ask", headers=cookie("ops"), json={"text": "and again?"})
    ck(f"  ...past {proxy.ASKS_PER_MINUTE} questions a minute a profile is told to wait (429)", r.status == 429, r.status)
    stored = json.loads(asks.read_text())
    old = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - proxy.ASK_KEPT_S - 5))
    asks.write_text(json.dumps([{**stored[0], "at": old}, *stored[1:]]))
    status, body = await jget("/agent/v1/inbox", bearer())
    ck("a question older than the agreement's askKeptSeconds is no longer collected",
       stored[0]["seq"] not in [a["seq"] for a in body["asks"]] and len(body["asks"]) == len(stored) - 1, body)
    cfg_file.write_text(json.dumps({"recordsKeptDays": 1}))
    kept = json.loads(turns.read_text())
    turns.write_text(json.dumps([{**kept[0], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 2 * 86400))},
                                 *kept[1:]]))
    status, body = await jget("/vesta-conversation", cookie("guest"))
    cfg_file.unlink(missing_ok=True)
    ck("a turn past the records-kept days goes", [t.get("text") for t in body["turns"]]
       == ["The wifi is on the card by the door."], body)

    # ── VESTA's buttons pressed on a tablet (ticket 22 of "One inbox") ───────────────────────────────────────────────
    print("\n  VESTA's buttons pressed on a tablet:")
    reset_lockout()
    asks.unlink(missing_ok=True)
    await post("/agent/v1/heartbeat", headers=bearer())
    await post("/agent/v1/vesta-message", headers=bearer(), json={
        "key": "thread:ap1", "title": "Approval request", "body": "Turn on the pool light?",
        "buttons": [{"label": "Approve", "kind": "a", "id": "ap1:y"}, {"label": "Refuse", "kind": "a", "id": "ap1:n"}]})
    await post("/agent/v1/vesta-message", headers=bearer(), json={
        "key": "incident:77", "title": "#77-P2 (new)", "body": "Door open",
        "buttons": [{"label": "Done", "kind": "i", "id": "77:done", "closes": True},
                    {"label": "Need help", "kind": "i", "id": "77:need_help"}]})
    status, body = await jget("/vesta-messages", cookie("owner"))
    card = next(m for m in body["messages"] if m["key"] == "incident:77")
    ck("an alert's buttons are kept as label, kind and id only (an older Agent's `closes` flag dropped: the tablet draws "
       "Done · Need help wherever the alert shows, owner 2026-10-29)",
       card["buttons"] == [{"label": "Done", "kind": "i", "id": "77:done"},
                           {"label": "Need help", "kind": "i", "id": "77:need_help"}], card["buttons"])
    r = await post("/vesta-press", json={"key": "thread:ap1", "command": "a:ap1:y"})
    ck("no session: refused", r.status == 401, r.status)
    r = await post("/vesta-press", headers=cookie("guest"), json={"key": "thread:ap1", "command": "a:ap1:y"})
    ck("  ...a guest's press of a button that acts is refused (403): answers only", r.status == 403, r.status)
    r = await post("/vesta-press", headers=cookie("owner"), json={"key": "thread:ap1", "command": "a:ap1:x"})
    ck("  ...a button the record does not offer is refused (409)", r.status == 409, r.status)
    r = await post("/vesta-press", headers=cookie("owner"), json={"key": "thread:ap1", "command": "a:ap1:y", "profile": "x"})
    ck("  ...a press naming more than its key and command is refused (400)", r.status == 400, r.status)
    r = await post("/vesta-press", headers=cookie("owner"), json={"key": "thread:ap1", "command": "a:ap1:y"})
    pressed = await r.json()
    status, body = await jget("/agent/v1/inbox", bearer())
    ck("an owner's press is kept for the Agent, stamped owner, with the record and the button, and answered its number",
       r.status == 200 and [(a["profile"], a.get("press")) for a in body["asks"]]
       == [("owner", {"key": "thread:ap1", "kind": "a", "id": "ap1:y"})] and pressed["press"] == body["asks"][0]["seq"],
       (pressed, body))
    await post("/agent/v1/conversation-turn", headers=bearer(), json={
        "key": "turn:9", "profile": "guest", "text": "Stopped at the limit.",
        "buttons": [{"label": "Continue", "kind": "c", "id": "k1"}]})
    r = await post("/vesta-press", headers=cookie("guest"), json={"key": "turn:9", "command": "c:k1"})
    r2 = await post("/vesta-press", headers=cookie("owner"), json={"key": "turn:9", "command": "c:k1"})
    ck("a button of a guest's own answer that does not act: pressed by that guest, by no other profile (409)",
       r.status == 200 and r2.status == 409, (r.status, r2.status))
    await post("/agent/v1/conversation-turn", headers=bearer(), json={"key": "press:1", "profile": "owner",
                                                                      "text": "Approved.", "answers": 1})
    await post("/agent/v1/conversation-turn", headers=bearer(), json={"key": "typing:owner", "profile": "owner",
                                                                      "typing": True})
    status, body = await jget("/vesta-conversation", cookie("owner"))
    ck("VESTA answering (its \"typing…\") is kept for the profile's tablet", any(
        t["key"] == "typing:owner" and t.get("typing") is True for t in body["turns"]), body)
    told = next(t for t in body["turns"] if t["key"] == "press:1")
    ck("  ...a press's short answer comes back in the presser's conversation, naming the press", told.get("answers") == 1,
       told)

    agent(enabled="false", token=TOKEN)
    r = await post("/agent/v1/conversation-turn", headers=bearer(), json={"key": "t", "profile": "guest", "text": "x"})
    r2 = await get("/agent/v1/inbox", headers=bearer())
    ck("with the Agent switched off the inbox and the turn door are 404", r.status == 404 and r2.status == 404,
       (r.status, r2.status))
    r = await post("/agent/v1/vesta-message", headers=bearer(), json=sent)
    ck("with the Agent switched off the door is 404, as every /agent/v1 route", r.status == 404, r.status)
    agent(enabled="true", token=TOKEN)

    await client.close()
    await sup.close()
    print()
    print("✅ the VESTA Agent interface holds" if FAIL == 0 else f"❌ {FAIL} agent-interface check(s) FAILED")


try:
    asyncio.run(main())
except Exception as exc:  # a crash mid-run is a failure, never a quiet stop
    FAIL += 1
    print(f"    FAIL  the run stopped early: {type(exc).__name__}: {exc}")
finally:
    shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if FAIL else 0)
