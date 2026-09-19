"""The seam everything else is built and tested through."""
import pytest

from agent.health import Health, Link, LinkState, overall
from agent.world import World
from agent.fakes import FakeChannel, FakeClock, FakeHass, RefusingModel


def test_a_world_can_be_built_entirely_from_fakes(tmp_path):
    w = World.for_testing(root=tmp_path)
    assert w.hass and w.channel and w.model and w.clock
    assert w.store.root == tmp_path


@pytest.mark.asyncio
async def test_the_model_port_REFUSES_rather_than_answering_emptily():
    """⚠️ AN UNWIRED PORT MUST REFUSE. Three tools on the sibling branch
    answered as DATA about an empty villa for their whole life — not a refusal,
    so no log could show it. The stub that ships in this ticket raises."""
    with pytest.raises(NotImplementedError):
        await RefusingModel().ask("anything")


@pytest.mark.asyncio
async def test_the_channel_stub_refuses_too():
    with pytest.raises(NotImplementedError):
        await FakeChannel(wired=False).send("target", "title", "body")


@pytest.mark.asyncio
async def test_a_fake_channel_records_what_it_was_asked():
    c = FakeChannel()
    await c.send("owner", "Title", "Body")
    assert c.sent == [("owner", "Title", "Body")]


@pytest.mark.asyncio
async def test_the_stubs_are_AWAITABLE_exactly_as_the_ports_declare_them():
    """⚠️ THE PORT SAYS `async def`, SO THE FAKE MUST BE A COROUTINE. When it
    was not, `await world.channel.send(...)` raised TypeError rather than the
    refusal the stub promises — and the tests, calling it synchronously, froze
    the wrong shape. Nothing type-checks this Python in CI, so this is the
    check."""
    import inspect

    from agent.ports import Channel, Model
    assert inspect.iscoroutinefunction(FakeChannel.send)
    assert inspect.iscoroutinefunction(RefusingModel.ask)
    assert inspect.iscoroutinefunction(Channel.send)
    assert inspect.iscoroutinefunction(Model.ask)


def test_the_clock_is_a_port_so_nothing_sleeps_in_a_test():
    clock = FakeClock(start="2026-09-19T08:00:00+00:00")
    first = clock.now()
    clock.advance(3600)
    assert (clock.now() - first).total_seconds() == 3600


# ── the health rule ADR-0012 states ────────────────────────────────────────

def test_both_connections_are_reported_SEPARATELY():
    """⚠️ THE CONSEQUENCE THE ADR NAMES. ha-mcp down means questions fail while
    events still arrive. A single boolean cannot say that, and a half-working
    layer that reads healthy is worse than one that reads down."""
    h = Health(gateway=Link(LinkState.DOWN, "connection refused"),
               listener=Link(LinkState.UP))
    assert h.gateway.state is LinkState.DOWN
    assert h.listener.state is LinkState.UP
    assert overall(h) == "degraded"
    assert "gateway" in h.reason()


def test_both_up_is_the_only_healthy_reading():
    assert overall(Health(Link(LinkState.UP), Link(LinkState.UP))) == "ok"


def test_both_down_is_down_not_degraded():
    assert overall(Health(Link(LinkState.DOWN), Link(LinkState.DOWN))) == "down"


def test_the_listener_alone_being_down_is_ALSO_degraded():
    """Symmetry matters: the layer can still answer questions, but it has
    stopped being told anything, and that is not healthy either."""
    h = Health(gateway=Link(LinkState.UP), listener=Link(LinkState.DOWN))
    assert overall(h) == "degraded"
    assert "listener" in h.reason()


def test_unknown_is_not_up():
    """Before the first connection attempt completes, nothing is proven."""
    assert overall(Health(Link(LinkState.UNKNOWN), Link(LinkState.UP))) != "ok"


def test_health_renders_as_attributes_a_person_can_read():
    h = Health(gateway=Link(LinkState.DOWN, "401 from the gateway"),
               listener=Link(LinkState.UP))
    attrs = h.attributes()
    assert attrs["gateway"] == "down"
    assert attrs["gateway_detail"] == "401 from the gateway"
    assert attrs["listener"] == "up"
