"""The add-on starts, stays running, and says what is true while it does."""
import pytest

from agent.fakes import FakeClock, FakeHass
from agent.hass import STATUS_OBJECT
from agent.health import Health, Link, LinkState
from agent.meter import Meter, Usage
from agent.options import Options
from agent.runtime import UNAVAILABLE, Layer
from agent.world import World


class StartableHass(FakeHass):
    async def connect_gateway(self):
        return self._health.gateway

    async def listen(self, on_event, stop_after=None, on_ready=None):
        if on_ready is not None:
            await on_ready()
        return self._health.listener


def layer(tmp_path, health=None, options=None, meter=None):
    hass = StartableHass(health=health)
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock(),
                              options=options, meter=meter)
    return Layer(world, version="0.1.0"), hass


def test_starting_publishes_the_health_entity(tmp_path):
    import asyncio
    l, hass = layer(tmp_path)
    asyncio.run(l.start())
    object_id, state, attrs = hass.published[-1]
    assert object_id == STATUS_OBJECT
    assert state == "ok"
    assert attrs["gateway"] == "up" and attrs["listener"] == "up"


def test_a_half_connected_layer_publishes_DEGRADED_not_ok(tmp_path):
    import asyncio
    half = Health(gateway=Link(LinkState.DOWN, "connection refused"),
                  listener=Link(LinkState.UP))
    l, hass = layer(tmp_path, health=half)
    asyncio.run(l.start())
    _, state, attrs = hass.published[-1]
    assert state == "degraded"
    assert "connection refused" in attrs["reason"]


def test_it_starts_even_when_NOTHING_connects(tmp_path):
    """⚠️ AN ADD-ON THAT EXITS CANNOT TELL ANYONE WHY. Coming up and saying
    'down' is the job; crash-looping is a silent failure on a wall."""
    import asyncio
    dead = Health(gateway=Link(LinkState.DOWN, "no"), listener=Link(LinkState.DOWN, "no"))
    l, hass = layer(tmp_path, health=dead)
    asyncio.run(l.start())
    assert hass.published[-1][1] == "down"


def test_stopping_marks_the_entity_unavailable(tmp_path):
    import asyncio
    l, hass = layer(tmp_path)
    asyncio.run(l.publish_unavailable())
    assert hass.published[-1][1] == UNAVAILABLE


def test_an_unconfigured_layer_says_what_it_needs(tmp_path):
    import asyncio
    l, hass = layer(tmp_path, options=Options())
    asyncio.run(l.start())
    attrs = hass.published[-1][2]
    assert "ha_mcp_url" in attrs["needs_configuring"]


def test_a_configured_layer_does_not_nag(tmp_path):
    import asyncio
    l, hass = layer(tmp_path, options=Options(ha_mcp_url="u", anthropic_api_key="k"))
    asyncio.run(l.start())
    assert "needs_configuring" not in hass.published[-1][2]


def test_the_meter_line_is_printed_at_START_not_only_on_a_heartbeat(tmp_path, capsys):
    """A fresh add-on must show its cost figure to whoever is watching it come
    up, not five minutes later when nobody is."""
    import asyncio
    l, _ = layer(tmp_path)
    asyncio.run(l.start())
    assert "meter: calls=0" in capsys.readouterr().out


def test_the_meter_reads_ZERO_in_this_release(tmp_path):
    """The ticket's own words: nothing calls a model yet, so the number the
    layer prints and publishes must be zero — and must be a MEASUREMENT of
    zero, not an absent field."""
    import asyncio
    l, hass = layer(tmp_path)
    asyncio.run(l.start())
    attrs = hass.published[-1][2]
    assert attrs["calls"] == 0
    assert attrs["usd_today"] == 0
    assert attrs["input_tokens"] == 0 and attrs["output_tokens"] == 0
    assert attrs["unpriced_calls"] == 0


def test_events_are_counted_so_a_stale_reading_is_visibly_stale(tmp_path):
    l, _ = layer(tmp_path)
    l.on_event({"event_type": "state_changed"})
    l.on_event({"event_type": "state_changed"})
    assert l.status_attributes()["events_seen"] == 2


def test_the_heartbeat_re_asserts_and_prints_the_meter(tmp_path, capsys):
    import asyncio
    l, hass = layer(tmp_path)
    asyncio.run(l.heartbeat(beats=3))
    assert len(hass.published) == 3
    printed = capsys.readouterr().out
    assert printed.count("meter:") == 3
    assert "usd=0.0000" in printed


def test_a_spend_shows_up_in_the_published_attributes(tmp_path):
    """Nothing spends in this release — but the wiring from meter to entity must
    be real now, or the first release that does spend publishes zeros."""
    import asyncio
    meter = Meter()
    meter.record(Usage(model="claude-haiku-4-5", input_tokens=1000,
                       cache_read_tokens=10, output_tokens=2000))
    l, hass = layer(tmp_path, meter=meter)
    asyncio.run(l.start())
    attrs = hass.published[-1][2]
    assert attrs["calls"] == 1
    assert attrs["input_tokens"] == 1000 and attrs["output_tokens"] == 2000
    assert attrs["cached_tokens"] == 10
    assert attrs["usd_today"] > 0


class UnreachableHass(StartableHass):
    """A villa the layer cannot publish to — no token, no DNS, no Supervisor.

    ⚠️ THIS FAKE EXISTS BECAUSE THE OTHER ONE COULD NOT FAIL. Every start test
    above passed against a `publish` that always worked, while the real add-on
    raised out of `start()` and crash-looped. A fake that cannot fail tests the
    happy path twice."""

    async def publish(self, object_id, state, attributes):
        raise RuntimeError("Cannot connect to host supervisor:80")


def test_a_layer_that_cannot_PUBLISH_still_starts(tmp_path, capsys):
    import asyncio
    hass = UnreachableHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    l = Layer(world, version="0.1.0")
    asyncio.run(l.start())          # must not raise
    assert "could not publish" in capsys.readouterr().out
    assert l.last_publish_error


def test_the_heartbeat_survives_a_publish_that_keeps_failing(tmp_path):
    import asyncio
    hass = UnreachableHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    l = Layer(world)
    asyncio.run(l.heartbeat(beats=3))   # must not raise


def test_stopping_is_best_effort_too(tmp_path):
    import asyncio
    hass = UnreachableHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    asyncio.run(Layer(world).publish_unavailable())   # must not raise


def test_a_publish_that_works_clears_the_recorded_failure(tmp_path):
    import asyncio
    l, hass = layer(tmp_path)
    l.last_publish_error = "something earlier"
    asyncio.run(l.publish_status())
    assert l.last_publish_error == ""


class FlakyHass(StartableHass):
    """A villa whose socket keeps dropping, as a real one does."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.listens = 0
        self.connects = 0

    async def connect_gateway(self):
        self.connects += 1
        return self._health.gateway

    async def listen(self, on_event, stop_after=None, on_ready=None):
        self.listens += 1
        if on_ready is not None:
            await on_ready()
        return self._health.listener


def test_a_dropped_connection_is_RETRIED_not_the_end_of_the_add_on(tmp_path):
    """⚠️ THE DEFECT THE BUILT IMAGE SHOWED AND THE UNIT TESTS COULD NOT.
    `listen()` returning DOWN is a correct return value; the caller treating it
    as 'this add-on is finished' made s6 restart-loop the container."""
    import asyncio
    hass = FlakyHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    asyncio.run(Layer(world).stay_connected(attempts=3))
    assert hass.listens == 3, "the layer gave up after one dropped connection"


def test_reconnecting_RE_READS_the_gateway_too(tmp_path):
    """ADR-0012: ha-mcp's tool catalogue must never be cached for the process's
    life — it auto-updates and moves its tool set in minor releases."""
    import asyncio
    hass = FlakyHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    asyncio.run(Layer(world).stay_connected(attempts=2))
    assert hass.connects == 2


def test_each_retry_publishes_what_is_now_true(tmp_path):
    """Twice per attempt, on purpose: once the moment the subscription goes
    live, and once when it drops. Both are changes an operator should see."""
    import asyncio
    hass = FlakyHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    asyncio.run(Layer(world).stay_connected(attempts=2))
    assert len(hass.published) == 4


def test_it_waits_between_attempts_rather_than_spinning(tmp_path):
    """A tight reconnect loop is the same failure as the restart loop, one level
    down: it hammers the Supervisor and fills the log."""
    import asyncio
    from agent.runtime import RECONNECT_SECONDS
    clock = FakeClock()
    hass = FlakyHass()
    world = World.for_testing(tmp_path, hass=hass, clock=clock)
    asyncio.run(Layer(world).stay_connected(attempts=3))
    assert clock.slept == [RECONNECT_SECONDS] * 3


def test_starting_writes_one_row_to_the_add_ons_own_volume(tmp_path):
    """⚠️ A STORE WITH NO WRITER IS AN UNPROVEN STORE. Constructed, injected and
    never called is the shape of every silent subsystem this project has
    shipped. One row per start proves /data is writable where it matters — in
    the container — rather than the first feature that needs it finding out."""
    import asyncio
    l, _ = layer(tmp_path)
    asyncio.run(l.start())
    rows = l.world.store.get("starts")
    assert len(rows) == 1
    assert rows[0]["version"] == "0.1.0" and rows[0]["health"] == "ok"
    assert rows[0]["at"].startswith("2026-01-01")


def test_the_boot_journal_is_bounded(tmp_path):
    import asyncio
    from agent.runtime import STARTS_KEPT
    l, _ = layer(tmp_path)
    for _ in range(STARTS_KEPT + 5):
        l.record_start()
    assert len(l.world.store.get("starts")) == STARTS_KEPT


def test_an_unwritable_volume_does_not_stop_the_add_on(tmp_path):
    import asyncio
    from agent.store import Store
    l, _ = layer(tmp_path)
    object.__setattr__(l.world, "store", Store("/proc/nonexistent-and-unwritable"))
    asyncio.run(l.start())      # must not raise


def test_a_failure_of_the_ONLY_output_channel_survives_a_quiet_log(tmp_path, capsys):
    """⚠️ TWO SILENCES AT ONCE. The status entity is the layer's only output; if
    publishing it fails while the operator has the log at `error`, a broken
    add-on says nothing anywhere. This one line has to outrank the setting."""
    import asyncio

    from agent import log
    before = log.current_level()
    try:
        log.configure("error")
        hass = UnreachableHass()
        world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
        asyncio.run(Layer(world).start())
        out = capsys.readouterr().out
        assert "could not publish the status entity" in out
        # ...and the ordinary chatter is still correctly silenced.
        assert "meter:" not in out
    finally:
        log.configure(before)


class VillaHass(StartableHass):
    """A property with entities in it, or a gateway that cannot be asked."""

    def __init__(self, rows=None, raises=None, **kw):
        super().__init__(entities=rows or [], **kw)
        self.raises = raises

    async def entities(self):
        if self.raises:
            raise self.raises
        return await super().entities()


def test_starting_ENUMERATES_the_property_and_says_how_many(tmp_path, capsys):
    """⚠️ THE S0 ACCEPTANCE TEST NEEDS AN ARTEFACT SOMEBODY CAN SEE.
    `Gateway.entities()` was written and tested and then called by nothing in
    the running add-on, so 'it can enumerate entities read-only' was true of the
    code and invisible in the product."""
    import asyncio
    rows = [{"entity_id": "a.b"}, {"entity_id": "c.d"}, {"entity_id": "e.f"}]
    hass = VillaHass(rows)
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    l = Layer(world, version="0.1.0")
    asyncio.run(l.start())
    assert "entities" in hass.asked
    assert l.entities_seen == 3
    assert "3 entities" in capsys.readouterr().out
    assert hass.published[-1][2]["entities_seen"] == 3


def test_a_gateway_that_cannot_be_asked_reports_NONE_not_zero(tmp_path):
    """⚠️ 'I COULD NOT ASK' AND 'THE PROPERTY IS EMPTY' ARE DIFFERENT ANSWERS,
    and only one of them is a reason to raise an alarm. The same rule as the
    meter's UNPRICED and ticket 26's 'cannot measure'."""
    import asyncio
    hass = VillaHass(raises=RuntimeError("the gateway offers no enumeration tool"))
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    l = Layer(world)
    asyncio.run(l.start())
    assert l.entities_seen is None
    assert hass.published[-1][2]["entities_seen"] is None


def test_an_actually_empty_property_reports_ZERO(tmp_path):
    """The other side of it: zero is a real answer when it was really asked."""
    import asyncio
    hass = VillaHass([])
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    l = Layer(world)
    asyncio.run(l.start())
    assert l.entities_seen == 0


def test_the_boot_journal_records_what_the_gateway_answered(tmp_path):
    import asyncio
    hass = VillaHass([{"entity_id": "a.b"}])
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    l = Layer(world, version="0.1.0")
    asyncio.run(l.start())
    assert l.world.store.get("starts")[0]["entities_seen"] == 1


def test_the_status_entity_is_published_as_soon_as_the_listener_is_live(tmp_path):
    """The runtime's half of it: `stay_connected` must hand `publish_status` in
    as the readiness callback, or the fix above reaches nothing."""
    import asyncio
    hass = FlakyHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock())
    asyncio.run(Layer(world).stay_connected(attempts=1))
    # once on becoming ready, once after the connection dropped
    assert len(hass.published) == 2


def test_a_setting_saved_in_the_kiosk_reaches_the_layer_without_a_restart(tmp_path):
    """⚠️ THE SCREEN'S SAVE HAS TO MEAN SOMETHING. The kiosk writes the settings
    file; nothing tells the layer. Without a re-read the operator pastes an API
    key, sees "Saved", and the layer goes on reporting that it is missing — which
    reads as a broken screen, not as a restart-required design."""
    import asyncio
    from agent.options import Options

    l, hass = layer(tmp_path, options=Options())
    saved = [Options(ha_mcp_url="http://gateway:9583", anthropic_api_key="k")]
    l.reload = lambda: saved[0]
    asyncio.run(l.start())
    assert "ha_mcp_url" in hass.published[-1][2]["needs_configuring"]

    asyncio.run(l.heartbeat(beats=1))
    assert l.world.options.gateway_url == "http://gateway:9583"
    assert "needs_configuring" not in hass.published[-1][2]


def test_the_spend_limit_follows_the_setting_too(tmp_path):
    """The meter is constructed from the limit; a changed limit that the meter
    never hears about is a budget the operator cannot actually move."""
    import asyncio
    from agent.options import Options

    l, _ = layer(tmp_path, options=Options(daily_usd_limit=1.0))
    l.reload = lambda: Options(daily_usd_limit=7.5)
    asyncio.run(l.heartbeat(beats=1))
    assert l.world.meter.daily_usd_limit == 7.5


def test_an_unchanged_settings_file_is_not_announced_every_beat(tmp_path, capsys):
    """A heartbeat that logs 'settings changed' every five minutes is noise that
    makes a real change invisible."""
    import asyncio
    from agent.options import Options

    l, _ = layer(tmp_path, options=Options())
    l.reload = lambda: Options()
    asyncio.run(l.heartbeat(beats=3))
    assert "settings changed" not in capsys.readouterr().out


class ReconfigurableHass(StartableHass):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.addresses: list[tuple[str, str]] = []
        self.connects = 0

    def reconfigure(self, url, secret):
        self.addresses.append((url, secret))
        return bool(url)

    async def connect_gateway(self):
        self.connects += 1
        return self._health.gateway


def test_a_saved_address_is_APPLIED_not_merely_stored(tmp_path):
    """⚠️ THE OWNER SAW A SAVED ADDRESS BESIDE 'no ha-mcp address is
    configured'. Re-reading the settings is not the same as applying them: the
    gateway was built once at startup and nothing ever told it."""
    import asyncio
    from agent.options import Options

    hass = ReconfigurableHass()
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock(), options=Options())
    l = Layer(world)
    l.reload = lambda: Options(ha_mcp_url="http://gateway:9583", ha_mcp_secret="s")
    asyncio.run(l.heartbeat(beats=1))
    assert hass.addresses == [("http://gateway:9583", "s")]
    assert hass.connects == 1, "the gateway was re-pointed but never reconnected"


def test_an_unchanged_address_does_not_reconnect_every_beat(tmp_path):
    import asyncio
    from agent.options import Options

    hass = ReconfigurableHass()
    hass.reconfigure = lambda url, secret: False
    world = World.for_testing(tmp_path, hass=hass, clock=FakeClock(),
                              options=Options(ha_mcp_url="http://g"))
    l = Layer(world)
    l.reload = lambda: Options(ha_mcp_url="http://g")
    asyncio.run(l.heartbeat(beats=3))
    assert hass.connects == 0
