"""The two connections stay two, and the health reading never rounds up."""
import pytest

from agent.gateway import Gateway, GatewayError
from agent.hass import HomeAssistant, STATUS_OBJECT
from agent.health import LinkState, overall
from agent.listener import Listener
from agent.tests.test_gateway import OK, TOOLS, transport_for
from agent.tests.test_listener import FakeWs, HANDSHAKE, connector, poster


def build(gateway_replies=None, ws=None, post_status=200, log=None):
    gw = Gateway("http://h", "s", transport_for(gateway_replies or {}))
    listener = Listener("TOKEN", connector(ws or FakeWs(list(HANDSHAKE))),
                        poster(post_status, log))
    return HomeAssistant(gw, listener), gw, listener


@pytest.mark.asyncio
async def test_a_gateway_that_is_down_does_not_stop_events_arriving():
    """⚠️ THE EXACT STATE ADR-0012 SAYS MUST BE VISIBLE: questions fail while
    events still arrive. A single boolean cannot say it."""
    async def refused(url, body):
        raise ConnectionRefusedError("gateway is not running")
    ha = HomeAssistant(Gateway("http://h", "s", refused),
                       Listener("TOKEN", connector(FakeWs(list(HANDSHAKE))), poster()))
    await ha.connect_gateway()
    seen = []
    await ha.listen(seen.append, stop_after=0)
    health = ha.health()
    assert health.gateway.state is LinkState.DOWN
    assert health.listener.state is LinkState.UP
    assert overall(health) == "degraded"


@pytest.mark.asyncio
async def test_the_reverse_is_also_degraded_not_healthy():
    ha, gw, _ = build({"initialize": OK, "tools/list": TOOLS},
                      ws=FakeWs([{"type": "auth_required"},
                                 {"type": "auth_invalid", "message": "no"}]))
    await ha.connect_gateway()
    await ha.listen(lambda e: None)
    assert overall(ha.health()) == "degraded"


@pytest.mark.asyncio
async def test_before_anything_connects_nothing_is_claimed():
    ha, _, _ = build()
    health = ha.health()
    assert health.gateway.state is LinkState.UNKNOWN
    assert health.listener.state is LinkState.UNKNOWN
    assert overall(health) != "ok"


@pytest.mark.asyncio
async def test_reading_the_villa_goes_over_the_gateway_and_only_the_gateway():
    asked = []
    rows = [{"entity_id": "a.b"}]
    ws = FakeWs(list(HANDSHAKE))
    ha, _, _ = build({"initialize": OK, "tools/list": TOOLS,
                      "tools/call": {"result": {"entities": rows}}}, ws=ws)
    await ha.connect_gateway()
    assert await ha.entities() == rows
    # Not one question went out over the listening socket.
    assert ws.sent == []


@pytest.mark.asyncio
async def test_publishing_goes_over_the_listener_and_only_the_listener():
    log = []
    ha, _, _ = build({"initialize": OK, "tools/list": TOOLS}, log=log)
    await ha.publish(STATUS_OBJECT, "ok", {"gateway": "up"})
    assert len(log) == 1 and STATUS_OBJECT in log[0][0]


@pytest.mark.asyncio
async def test_a_gateway_refusal_reaches_the_caller_rather_than_an_empty_villa():
    ha, _, _ = build({"initialize": OK, "tools/list": TOOLS,
                      "tools/call": {"result": {"surprise": 1}}})
    await ha.connect_gateway()
    with pytest.raises(GatewayError):
        await ha.entities()
