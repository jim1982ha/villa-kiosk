"""The direct connection: told things, visible, asks nothing."""
import pytest

from agent.health import LinkState
from agent.listener import CORE_API, Listener


class FakeWs:
    """A scripted Home Assistant websocket."""

    def __init__(self, script):
        self.script = list(script)
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def send_json(self, obj):
        self.sent.append(obj)

    async def receive_json(self):
        return self.script.pop(0) if self.script else None


def connector(ws):
    def connect(url):
        ws.url = url
        return ws
    return connect


def poster(status=200, log=None):
    async def post(url, body, headers):
        if log is not None:
            log.append((url, body, headers))
        return status
    return post


HANDSHAKE = [{"type": "auth_required"}, {"type": "auth_ok"},
             {"id": 1, "type": "result", "success": True}]


@pytest.mark.asyncio
async def test_it_authenticates_then_subscribes_and_asks_nothing_else():
    ws = FakeWs(HANDSHAKE)
    listener = Listener("TOKEN", connector(ws), poster())
    link = await listener.listen(lambda e: None, stop_after=0)
    assert link.state is LinkState.UP
    kinds = [m.get("type") for m in ws.sent]
    assert kinds == ["auth", "subscribe_events"]
    # ⚠️ ADR-0012's rule, as a test: this connection issues no question.
    assert all(m.get("type") != "get_states" for m in ws.sent)
    assert ws.sent[1]["event_type"] == "state_changed"


@pytest.mark.asyncio
async def test_events_reach_the_handler():
    seen = []
    ws = FakeWs(HANDSHAKE + [
        {"type": "event", "event": {"event_type": "state_changed", "data": {"x": 1}}},
        {"type": "event", "event": {"event_type": "state_changed", "data": {"x": 2}}},
    ])
    listener = Listener("TOKEN", connector(ws), poster())
    await listener.listen(seen.append, stop_after=2)
    assert [e["data"]["x"] for e in seen] == [1, 2]


@pytest.mark.asyncio
async def test_a_refused_token_is_DOWN_with_the_reason_a_person_needs():
    ws = FakeWs([{"type": "auth_required"},
                 {"type": "auth_invalid", "message": "Invalid access token"}])
    listener = Listener("WRONG", connector(ws), poster())
    link = await listener.listen(lambda e: None)
    assert link.state is LinkState.DOWN
    assert "Invalid access token" in link.detail


@pytest.mark.asyncio
async def test_no_token_at_all_is_DOWN_before_any_socket_is_opened():
    opened = []
    listener = Listener("", lambda url: opened.append(url), poster())
    link = await listener.listen(lambda e: None)
    assert link.state is LinkState.DOWN and "SUPERVISOR_TOKEN" in link.detail
    assert opened == []


@pytest.mark.asyncio
async def test_a_refused_subscription_is_DOWN_not_quietly_up():
    ws = FakeWs([{"type": "auth_required"}, {"type": "auth_ok"},
                 {"id": 1, "type": "result", "success": False,
                  "error": {"message": "not allowed"}}])
    listener = Listener("TOKEN", connector(ws), poster())
    link = await listener.listen(lambda e: None)
    assert link.state is LinkState.DOWN and "not allowed" in link.detail


@pytest.mark.asyncio
async def test_a_socket_that_closes_is_DOWN_even_though_nothing_raised():
    """⚠️ A CLEAN CLOSE IS STILL NOT BEING TOLD ANYTHING. Silence is the failure
    mode this whole connection exists to avoid, so it must not read as healthy."""
    ws = FakeWs(HANDSHAKE)
    listener = Listener("TOKEN", connector(ws), poster())
    link = await listener.listen(lambda e: None, stop_after=None)
    assert link.state is LinkState.DOWN and "closed" in link.detail


@pytest.mark.asyncio
async def test_publishing_goes_to_core_with_the_supervisor_token():
    log = []
    listener = Listener("TOKEN", connector(FakeWs([])), poster(200, log))
    await listener.publish("vesta_ai_status", "ok", {"gateway": "up"})
    url, body, headers = log[0]
    assert url == f"{CORE_API}/states/sensor.vesta_ai_status"
    assert body == {"state": "ok", "attributes": {"gateway": "up"}}
    assert headers["Authorization"] == "Bearer TOKEN"


@pytest.mark.asyncio
async def test_a_refused_publish_RAISES_rather_than_being_assumed_to_have_worked():
    listener = Listener("TOKEN", connector(FakeWs([])), poster(403))
    with pytest.raises(RuntimeError, match="403"):
        await listener.publish("vesta_ai_status", "ok", {})
