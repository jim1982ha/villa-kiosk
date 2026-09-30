"""The two outward links, against in-process fakes: the Kiosk (heartbeat, tickets)
and the listen-only Home Assistant websocket (decision D1)."""
from __future__ import annotations

import asyncio
import json

from aiohttp import WSMsgType, web

from vesta_agent.ha_events import EVENT_TYPES, HaEvents
from vesta_agent.kiosk import Kiosk, KioskError

TOKEN = "kiosk-TEST-token"


# ---------------------------------------------------------------------- a fake Kiosk
class FakeKiosk:
    def __init__(self):
        self.doc = {"tickets": [{"id": "person-1", "title": "Raised by a person", "status": "open",
                                 "openedAt": "2026-10-01T00:00:00Z", "photoIds": []}],
                    "schedules": [], "completions": [], "costs": [], "savedDocuments": []}
        self.rev = "r1"
        self.heartbeats = 0
        self.conflict_once = False

    def app(self):
        a = web.Application()

        def authed(req):
            return req.headers.get("Authorization") == f"Bearer {TOKEN}"

        async def info(req):
            return web.json_response({"contract": 1, "version": "2.500.0"} if authed(req) else {}, status=200 if authed(req) else 401)

        async def heartbeat(req):
            self.heartbeats += 1
            return web.json_response({"ok": True})

        async def get(req):
            return web.json_response({"data": self.doc, "rev": self.rev})

        async def put(req):
            body = await req.json()
            if body.get("rev") != self.rev:
                return web.json_response({"error": "stale"}, status=409)
            if self.conflict_once:                      # a person saved in between
                self.conflict_once = False
                self.doc["tickets"].append({"id": "person-2", "title": "Saved meanwhile", "status": "open",
                                            "openedAt": "t", "photoIds": []})
                self.rev = "r-between"
                return web.json_response({"error": "stale"}, status=409)
            old_ids = {t["id"] for t in self.doc["tickets"]}
            new_ids = {t["id"] for t in body["data"]["tickets"]}
            if old_ids - new_ids:                        # the Kiosk refuses a removal (A5)
                return web.json_response({"error": "may not delete"}, status=403)
            self.doc, self.rev = body["data"], self.rev + "+"
            return web.json_response({"ok": True})

        a.router.add_get("/agent/v1/info", info)
        a.router.add_post("/agent/v1/heartbeat", heartbeat)
        a.router.add_get("/agent/v1/fm-data", get)
        a.router.add_put("/agent/v1/fm-data", put)
        return a


async def _serve(app):
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, f"http://127.0.0.1:{port}"


def test_kiosk_agreement_heartbeat_and_tickets():
    async def go():
        fake = FakeKiosk()
        runner, url = await _serve(fake.app())
        try:
            k = Kiosk(url, TOKEN)
            assert await k.check() is True
            await k.heartbeat()
            assert fake.heartbeats == 1
            tid = await k.add_ticket("Pump runs short", entity_id="sensor.example_pump_power", note="Check the timer")
            t = next(t for t in fake.doc["tickets"] if t["id"] == tid)
            assert (t["status"], t["entityId"], t["photoIds"]) == ("open", "sensor.example_pump_power", [])
            assert any(x["id"] == "person-1" for x in fake.doc["tickets"])       # nothing removed
            fake.conflict_once = True
            tid2 = await k.add_ticket("Battery low")                            # 409 once: read again, apply again
            ids = {t["id"] for t in fake.doc["tickets"]}
            assert {"person-1", "person-2", tid, tid2} <= ids                   # their save kept, ours on top
            assert await k.resolve_ticket(tid, note="Done") is True
            t = next(t for t in fake.doc["tickets"] if t["id"] == tid)
            assert t["status"] == "resolved" and t["resolvedAt"] and t["updates"][-1]["status"] == "resolved"
            assert await k.resolve_ticket(tid) is False                          # already closed
            bad = Kiosk(url, "wrong")
            try:
                await bad.check()
                raise AssertionError("a refused token must raise")
            except KioskError:
                pass
        finally:
            await runner.cleanup()
    asyncio.run(go())


def test_kiosk_off_without_url_or_token():
    assert Kiosk("", TOKEN).enabled is False and Kiosk("http://x", "").enabled is False


# ---------------------------------------------------------------------- a fake Home Assistant websocket
def test_the_websocket_listens_to_four_event_types_and_sends_nothing_else():
    async def go():
        sent_by_agent: list[dict] = []
        got: list[tuple[str, dict]] = []
        beats = []
        ready = asyncio.Event()

        async def ws_handler(req):
            ws = web.WebSocketResponse()
            await ws.prepare(req)
            await ws.send_json({"type": "auth_required"})
            msg = await ws.receive_json()
            sent_by_agent.append(msg)
            if msg.get("access_token") != "ha-TEST":
                await ws.send_json({"type": "auth_invalid"})
                await ws.close()
                return ws
            await ws.send_json({"type": "auth_ok"})
            subs = {}
            for _ in EVENT_TYPES:
                m = await ws.receive_json()
                sent_by_agent.append(m)
                subs[m["event_type"]] = m["id"]
                await ws.send_json({"id": m["id"], "type": "result", "success": True})
            await ws.send_json({"id": subs["vesta_critical_event"], "type": "event", "event": {
                "event_type": "vesta_critical_event", "data": {"phase": "opened", "rule_id": "automation.x"}}})
            await ws.send_json({"id": subs["telegram_text"], "type": "event", "event": {
                "event_type": "telegram_text", "data": {"chat_id": 1, "text": "hi"}}})
            await ws.send_json({"id": 99, "type": "event", "event": {"event_type": "state_changed", "data": {}}})
            ready.set()
            async for m in ws:                           # anything more the agent sends is recorded
                if m.type == WSMsgType.TEXT:
                    sent_by_agent.append(json.loads(m.data))
            return ws

        app = web.Application()
        app.router.add_get("/api/websocket", ws_handler)
        runner, url = await _serve(app)
        stop = asyncio.Event()

        async def handler(et, data):
            got.append((et, data))

        ev = HaEvents(url, "ha-TEST", handler, lambda: beats.append(1))
        task = asyncio.create_task(ev.run(stop))
        await asyncio.wait_for(ready.wait(), 10)
        for _ in range(50):
            if len(got) >= 2:
                break
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.3)                         # time for anything else the agent would send
        stop.set()
        await asyncio.wait_for(task, 10)
        await runner.cleanup()
        assert [m["type"] for m in sent_by_agent] == ["auth"] + ["subscribe_events"] * 4
        assert sorted(m["event_type"] for m in sent_by_agent[1:]) == sorted(EVENT_TYPES)
        assert [e for e, _ in got] == ["vesta_critical_event", "telegram_text"]      # state_changed ignored
        assert beats                                                               # the villa-silent watch
    asyncio.run(go())


def test_a_refused_token_is_said_plainly_retried_and_stops_on_request(caplog):
    async def go():
        async def ws_handler(req):
            ws = web.WebSocketResponse()
            await ws.prepare(req)
            await ws.send_json({"type": "auth_required"})
            await ws.receive_json()
            await ws.send_json({"type": "auth_invalid"})
            await ws.close()
            return ws
        app = web.Application()
        app.router.add_get("/api/websocket", ws_handler)
        runner, url = await _serve(app)
        stop = asyncio.Event()
        ev = HaEvents(url, "wrong", lambda *_: None, lambda: None)
        task = asyncio.create_task(ev.run(stop))
        await asyncio.sleep(0.5)
        assert not ev.connected.is_set()
        stop.set()
        await asyncio.wait_for(task, 10)                # stops during its backoff, not after it
        await runner.cleanup()
    asyncio.run(go())
    assert any("refused the VESTA Agent token" in r.message for r in caplog.records)
    assert not any("wrong" in r.message for r in caplog.records)
