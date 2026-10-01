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
       len(stores) >= 7 and all(p.startswith(str(TMP / "data") + "/") for p in stores.values())
       and proxy._data("options.json") == str(TMP / "data" / "options.json"), stores)
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
    pre218 = {"owner_pin": "1234", "sh3d_path": "x", "agent_enabled": True, "agent_token": TOKEN,
              "agent_offline_after_minutes": 7, "agent_message_retention_days": 30,
              "vesta_agent": {"token": "", "offline_after_minutes": 5, "message_retention_days": 90}}
    moved = proxy.migrate_options(pre218)
    ck("from before 2.496.218: the three settings move into the group, the switch stays on top",
       moved == {"owner_pin": "1234", "agent_enabled": True, "vesta_agent": {"token": TOKEN,
                 "offline_after_minutes": 7, "message_retention_days": 30}}, moved)
    from218 = {"owner_pin": "1234", "agent_enabled": False,
               "vesta_agent": {"enabled": True, "token": TOKEN, "offline_after_minutes": 7, "message_retention_days": 90}}
    moved218 = proxy.migrate_options(from218)
    ck("from 2.496.218: the switch moves OUT of the group, on as it was",
       moved218 == {"owner_pin": "1234", "agent_enabled": True, "vesta_agent": {"token": TOKEN,
                    "offline_after_minutes": 7, "message_retention_days": 90}}, moved218)
    ck("  ...and there is nothing to do on an install already moved",
       proxy.migrate_options(moved218) is None)
    options(**moved218)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("after the move the top-level switch and the group open the door", status == 200 and proxy._agent_offline_minutes() == 7, status)
    reset_lockout()

    # ── the token, and only the token (PLAN A3) ──────────────────────────
    print("\n  the bearer gate:")
    agent(enabled=True, token=TOKEN, offline_after_minutes=5, message_retention_days=90)
    reset_lockout()
    status, body = await jget("/agent/v1/info", bearer())
    ck("the right token reads /agent/v1/info", status == 200, status)
    ck("  ...contract 1, the Kiosk's own version, the agent's capabilities",
       body and body["contract"] == 1 and body["version"] == "9.9.9"
       and body["capabilities"] == ["agentMessage", "agentRead", "agentWrite"], body)
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

    # ── messages and choices (PLAN A4, A6) ───────────────────────────────
    print("\n  messages and choices:")
    r = await post("/agent/v1/messages", headers=bearer(), json={"title": ""})
    ck("an invalid message: 400", r.status == 400, r.status)
    r = await post("/agent/v1/messages", headers=bearer(), json={
        "kind": "recommendation", "title": "Pool pump runs at night", "body": "**Why**: ...",
        "severity": "warning", "entities": ["switch.pool_pump"],
        "buttons": [{"id": "approve", "label": "Approve"}, {"id": "reject", "label": "Reject"}]})
    body = await r.json()
    ck("a message with buttons: 201 and its id", r.status == 201 and body["id"].startswith("msg_"), body)
    mid = body["id"]
    r = await post("/agent/v1/messages", headers=bearer(), json={
        "title": "Owner only", "buttons": [{"id": "ok", "label": "OK"}], "allowed_profiles": ["owner"]})
    owner_only = (await r.json())["id"]
    r = await post("/agent/v1/messages", headers=bearer(), json={
        "title": "Too late", "buttons": [{"id": "ok", "label": "OK"}], "expires_at": "2020-01-01T00:00:00Z"})
    expired = (await r.json())["id"]

    status, body = await jget("/agent-messages", cookie("ops"))
    msgs = {m["id"]: m for m in body["data"]["messages"]} if status == 200 else {}
    ck("a facility manager reads the messages, newest first",
       status == 200 and body["data"]["messages"][0]["id"] == expired, (status, body))
    ck("  ...open, answerable by ops", msgs.get(mid, {}).get("state") == "open" and msgs[mid]["can_answer"])
    ck("  ...an owner-only message is not answerable by ops", msgs.get(owner_only, {}).get("can_answer") is False)
    ck("  ...an expired one shows expired, buttons off",
       msgs.get(expired, {}).get("state") == "expired" and not msgs[expired]["can_answer"])
    # ── the agreement's samples, through the real proxy (2.496.234) ──────
    # rootfs/usr/share/vesta/agent-contract.json holds what an agent posts
    # and what the Kiosk app reads; the agent host's tests replay the same
    # file. If the proxy changes either shape, this fails on the Kiosk side.
    contract = json.loads((ROOT / "rootfs" / "usr" / "share" / "vesta" / "agent-contract.json").read_text())
    ck("the proxy speaks the agreement's version", proxy.AGENT_CONTRACT == contract["version"] >= 1)
    r = await post("/agent/v1/messages", headers=bearer(), json=contract["samples"]["postMessage"])
    sample_id = (await r.json()).get("id") if r.status in (200, 201) else None
    ck("the agreement's sample message is accepted", sample_id is not None, r.status)
    status, body = await jget("/agent-messages", cookie("owner"))
    got = next((m for m in body["data"]["messages"] if m["id"] == sample_id), {}) if status == 200 else {}
    want = contract["samples"]["messagesView"]["messages"][0]
    ck("  ...and the Kiosk reads it back in exactly the agreement's shape (every field, no other)",
       set(got) == set(want), sorted(set(got) ^ set(want)))
    ck("  ...with the agreement's values", all(got.get(k) == want[k] for k in
       ("kind", "title", "body", "severity", "entities", "buttons", "allowed_profiles", "state", "answer", "can_answer")),
       {k: (got.get(k), want[k]) for k in want if got.get(k) != want[k] and k not in ("id", "created_at")})
    ck("who may answer is every profile holding the agreement's capability in roles.json (never a guest)",
       list(proxy.AGENT_ANSWER_PROFILES) == [r for r, row in proxy.ROLES_TABLE["profiles"].items()
                                             if contract["answeringCapability"] in row["capabilities"]]
       and "guest" not in proxy.AGENT_ANSWER_PROFILES and proxy.AGENT_ANSWER_PROFILES)

    status, _ = await jget("/agent-messages", cookie("guest"))
    ck("a guest reads none of it: 403", status == 403, status)
    status, _ = await jget("/agent-status", cookie("guest"))
    ck("  ...nor the agent's status", status == 403, status)

    async def press(role_headers, message_id, button):
        r = await put("/agent-choices", headers=role_headers,
                      json={"data": {"choices": [{"message_id": message_id, "button_id": button}]}})
        return r.status, await r.json()

    status, _ = await press(cookie("ops"), mid, "nope")
    ck("a button the message does not have: 400", status == 400, status)
    status, _ = await press(cookie("ops"), owner_only, "ok")
    ck("a profile the message does not allow: 403", status == 403, status)
    status, _ = await press(cookie("ops"), expired, "ok")
    ck("an expired message: 409", status == 409, status)
    status, _ = await press(cookie("guest"), mid, "approve")
    ck("a guest cannot press: 403", status == 403, status)
    status, _ = await press(cookie("ops"), mid, "approve")
    ck("the first press is accepted", status == 200, status)
    status, body = await press(INGRESS, mid, "reject")
    ck("a second press: 409, naming who answered",
       status == 409 and body.get("answer", {}).get("profile") == "ops"
       and body["answer"]["button_id"] == "approve", (status, body))
    status, body = await jget("/agent-messages", cookie("owner"))
    answered = next(m for m in body["data"]["messages"] if m["id"] == mid)
    ck("the message now reads answered, by ops", answered["state"] == "answered"
       and answered["answer"]["profile"] == "ops" and not answered["can_answer"], answered)

    status, body = await jget("/agent/v1/choices?since=0", bearer())
    ck("the agent reads the press through its cursor",
       status == 200 and len(body["choices"]) == 1 and body["choices"][0]["seq"] == 1
       and body["choices"][0]["button_id"] == "approve" and body["choices"][0]["profile"] == "ops", body)
    status, body = await jget("/agent/v1/choices?since=1", bearer())
    ck("  ...and nothing after it", status == 200 and body["choices"] == [], body)
    r = await put("/agent-choices", headers=cookie("owner"), json={"data": {"choices": [
        {"seq": 1, "message_id": mid, "button_id": "reject", "profile": "owner", "at": "x"}]}})
    stored_choices = json.loads((TMP / "data" / "agent-choices.json").read_text())["choices"]
    ck("a client cannot rewrite an earlier answer", r.status == 400
       and stored_choices[0]["button_id"] == "approve", (r.status, stored_choices))

    # ── a person clears messages (2.496.239) ─────────────────────────────
    print("\n  clearing messages:")

    async def clear(headers, payload):
        r = await post("/agent-messages/clear", headers=headers, json=payload)
        return r.status, await r.json()

    def stored_ids():
        return [m["id"] for m in json.loads((TMP / "data" / "agent-messages.json").read_text())["messages"]]

    before = stored_ids()
    status, _ = await clear(cookie("guest"), {"ids": [mid]})
    ck("a guest cannot clear: 403", status == 403, status)
    status, _ = await clear({**cookie("ops"), "Sec-Fetch-Site": "cross-site"}, {"ids": [mid]})
    ck("  ...nor another site riding a session: 403", status == 403, status)
    status, _ = await clear({}, {"ids": [mid]})
    ck("  ...nor no session at all: 401", status == 401, status)
    for bad in ({"ids": ["../agent-choices"]}, {"ids": [7]}, {"ids": []}, {"ids": mid}, {},
                {"ids": ["msg_" + "0" * 15]}, {"ids": ["msg_" + "0" * 16] * (proxy.AGENT_MAX_MESSAGES + 1)}):
        status, _ = await clear(cookie("ops"), bad)
        ck(f"  ...an id list that is not msg_ ids: 400 ({json.dumps(bad)[:40]})", status == 400, status)
    ck("  ...and none of that removed anything", stored_ids() == before)
    status, body = await clear(cookie("ops"), {"ids": [mid, "msg_ffffffffffffffff"]})
    ck("ops clears an answered message; an unknown id is ignored, not refused",
       status == 200 and body.get("cleared") == [mid], (status, body))
    ck("  ...gone from the store, every other message kept",
       stored_ids() == [i for i in before if i != mid], stored_ids())
    status, body = await jget("/agent-messages", cookie("owner"))
    ck("  ...and from what the Kiosk reads", mid not in {m["id"] for m in body["data"]["messages"]})
    choices_now = json.loads((TMP / "data" / "agent-choices.json").read_text())["choices"]
    ck("  ...while its ANSWER stays in the agent's cursor", any(c["message_id"] == mid for c in choices_now))
    status, body = await jget("/agent/v1/choices?since=0", bearer())
    ck("  ...which the agent still reads", status == 200 and any(c["message_id"] == mid for c in body["choices"]))
    status, body = await clear(INGRESS, {"ids": [mid]})
    ck("clearing it again (another device): 200, nothing cleared", status == 200 and body.get("cleared") == [], (status, body))
    status, body = await clear(cookie("owner"), {"ids": [owner_only, expired]})
    ck("the owner clears an open question and an expired one together",
       status == 200 and sorted(body.get("cleared", [])) == sorted([owner_only, expired]), (status, body))

    # ── presence (PLAN A7) ───────────────────────────────────────────────
    print("\n  presence:")
    status, body = await jget("/agent-status", cookie("ops"))
    ck("before any heartbeat: offline", body.get("state") == "offline", body)
    r = await post("/agent/v1/heartbeat", headers=bearer(), json={"status": "all quiet"})
    ck("a heartbeat: 200", r.status == 200, r.status)
    status, body = await jget("/agent-status", cookie("ops"))
    ck("  ...online, with its status text", body.get("state") == "online" and body.get("status") == "all quiet", body)
    presence = TMP / "data" / "agent-presence.json"
    presence.write_text(json.dumps({"last_seen": time.time() - 6 * 60, "status": None}))
    status, body = await jget("/agent-status", cookie("ops"))
    ck("six minutes of silence (window 5): offline — computed, so a restart cannot lie",
       body.get("state") == "offline", body)
    agent(enabled=True, token=TOKEN, offline_after_minutes=10)
    status, body = await jget("/agent-status", cookie("ops"))
    ck("  ...and the window is the option's", body.get("state") == "online", body)

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
