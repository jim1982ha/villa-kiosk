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
    options(agent_token=TOKEN)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("a valid token with the switch OFF: still 404 — the switch decides", status == 404, status)
    status, body = await jget("/agent-status", INGRESS)
    ck("  ...and the Kiosk still sees no agent (no robot, no menu entry)", body == {"state": "not_configured"}, body)
    options(agent_enabled="true", agent_token=TOKEN)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("  ...only a real `true` switches it on (a hand-edited string does not)", status == 404, status)
    print("\n  switched on without a usable token:")
    options(agent_enabled=True)
    status, _ = await jget("/agent/v1/info", bearer())
    ck("no token: 404, the agent stays off", status == 404, status)
    ck("  ...and the start-up log says why", "switched on but its token is empty" in (proxy._agent_config_warning() or ""))
    options(agent_enabled=True, agent_token="short")
    status, _ = await jget("/agent/v1/info", bearer("short"))
    ck("a token shorter than 16 characters counts as not configured", status == 404, status)
    options()
    ck("switched off: no warning at all (an empty token is then correct)", proxy._agent_config_warning() is None)

    # ── the token, and only the token (PLAN A3) ──────────────────────────
    print("\n  the bearer gate:")
    options(agent_enabled=True, agent_token=TOKEN, agent_offline_after_minutes=5, agent_message_retention_days=90)
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
    new_doc["completions"].append({"id": "c1", "scheduleId": "", "at": "2026-09-28T01:00:00Z",
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
    options(agent_enabled=True, agent_token=TOKEN, agent_offline_after_minutes=10)
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
