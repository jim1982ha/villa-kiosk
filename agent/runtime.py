"""The add-on's own life: start, stay up, say what is true, stop cleanly.

Everything here runs against the four ports, so the whole lifecycle is testable
on a fake villa with a fake clock and nothing sleeps.
"""
from __future__ import annotations

import asyncio
from typing import Any

from agent import log
from agent.hass import STATUS_OBJECT
from agent.health import LinkState, overall
from agent.world import World

#: What Home Assistant shows when the add-on is not running.
UNAVAILABLE = "unavailable"

#: How often the layer re-asserts its status entity. A state set over the REST
#: API does not survive a Core restart, so re-asserting is how the entity comes
#: back without anyone restarting the add-on.
HEARTBEAT_SECONDS = 300

#: How long to wait before trying both connections again.
#:
#: ⚠️ THE LAYER RECONNECTS ITSELF; IT DOES NOT EXIT AND LET s6 DO IT. The first
#: cut ran the listener once and shut down when it returned — so on a container
#: with no Supervisor reachable the add-on started, failed, exited and was
#: restarted by s6 in a tight loop, several times a second. Nothing in the unit
#: tests could see it: `listen()` returning DOWN is the correct return value,
#: and it was the CALLER that treated "this connection is down" as "this add-on
#: is finished". Running the built image found it in one line of log.
RECONNECT_SECONDS = 30

#: How many starts to keep in the boot journal.
#:
#: ⚠️ THE STORE HAS A WRITER FROM ITS FIRST RELEASE, ON PURPOSE. A module that
#: is constructed, injected and never called is the shape of every silent
#: subsystem this project has shipped — three Home Assistant tools answered as
#: DATA about an empty villa for their entire lives because nothing had wired
#: them, and no log could show it. One row per start proves the /data volume is
#: actually writable inside the container, which is a real permission risk that
#: would otherwise be found by the first feature that needs it, and it makes a
#: restart loop visible to whoever opens the file.
STARTS_KEPT = 50


class Layer:
    """The running add-on."""

    def __init__(self, world: World, version: str = "0") -> None:
        self.world = world
        self.version = version
        self.events_seen = 0
        self.last_publish_error = ""
        #: None until the villa has been enumerated once — which is NOT the same
        #: as zero, and must never be published as zero.
        self.entities_seen: int | None = None

    # ── what an operator sees ──────────────────────────────────────────────
    def status_attributes(self) -> dict[str, Any]:
        health = self.world.hass.health()
        meter = self.world.meter
        attrs = health.attributes()
        attrs.update({
            "friendly_name": "VESTA AI Layer",
            "version": self.version,
            "events_seen": self.events_seen,
            "entities_seen": self.entities_seen,
            "calls": meter.calls,
            "input_tokens": meter.input_tokens,
            "cached_tokens": meter.cache_read_tokens,
            "output_tokens": meter.output_tokens,
            "usd_today": round(meter.spent_usd, 4),
            "unpriced_calls": meter.unpriced_calls,
        })
        missing = self.world.options.missing()
        if missing:
            attrs["needs_configuring"] = ", ".join(missing)
        return attrs

    async def publish_status(self) -> bool:
        """Assert the status entity. Returns whether it landed.

        ⚠️ A FAILED PUBLISH MUST NOT TAKE THE LAYER DOWN, AND A TEST DID NOT
        CATCH THIS. `test_it_starts_even_when_NOTHING_connects` passed against a
        fake whose `publish` cannot fail, while the real add-on — no token, no
        `supervisor` to resolve — raised out of `start()` and crash-looped
        before printing anything an operator could read. Running the artefact
        found it; the fixture had been built to fit the code.

        Not being able to say "I am alive" is itself only a health fact. It is
        logged every time and retried on the next heartbeat.
        """
        try:
            await self.world.hass.publish(
                STATUS_OBJECT, overall(self.world.hass.health()),
                self.status_attributes())
            self.last_publish_error = ""
            return True
        except Exception as exc:
            self.last_publish_error = f"{type(exc).__name__}: {exc}"
            # ⚠️ ERROR, NOT WARNING, AND THE LEVEL IS THE POINT. The status
            # entity is this layer's ONLY output. If publishing it fails and the
            # operator has turned the log down, a broken add-on is completely
            # silent in both places at once. A failure of the reporting channel
            # itself survives every level an operator can reasonably choose.
            log.error(f"  could not publish the status entity: "
                      f"{self.last_publish_error}")
            return False

    async def publish_unavailable(self) -> None:
        """⚠️ ON THE WAY OUT, BECAUSE NOTHING ELSE WILL DO IT. A state written
        over the REST API persists after the process that wrote it is gone, so
        an add-on that simply exits leaves its own health entity reading `ok`
        forever. s6 sends SIGTERM on stop; this is what that hook is for.

        A hard kill (SIGKILL, power loss) has no such hook, and the entity keeps
        its last reading until the layer starts again and re-asserts it. That
        residual is real and is why `events_seen` and the heartbeat exist: a
        stale `ok` is visibly stale to anyone who looks at the attributes.
        """
        try:
            await self.world.hass.publish(STATUS_OBJECT, UNAVAILABLE,
                                          {"friendly_name": "VESTA AI Layer",
                                           "version": self.version})
        except Exception as exc:
            log.error(f"  could not mark the status entity unavailable: {exc}")

    # ── the loop ───────────────────────────────────────────────────────────
    def on_event(self, event: dict[str, Any]) -> None:
        self.events_seen += 1

    async def heartbeat(self, beats: int | None = None) -> None:
        """Re-assert the status entity, and print the meter's line."""
        # ⚠️ SLEEPS FIRST. `start()` has already asserted the entity, so
        # publishing again immediately doubled every start — including doubling
        # the failure line an operator reads when it cannot publish, which reads
        # as a retry loop rather than as one problem.
        n = 0
        while beats is None or n < beats:
            await self.world.clock.sleep(HEARTBEAT_SECONDS)
            await self.publish_status()
            log.info(self.world.meter.line())
            n += 1

    async def stay_connected(self, attempts: int | None = None) -> None:
        """Listen, and keep listening — reconnecting both wires on the way.

        `listen` returns whenever the socket closes or never opened. That is a
        health fact, not a reason to stop: the add-on's job on a wall is to keep
        running and keep saying what is wrong, so this records it, publishes it,
        waits, and tries again.

        The gateway is re-connected on the same cadence rather than separately,
        because ADR-0012 requires its tool catalogue to be RE-READ on reconnect:
        ha-mcp auto-updates and moves its tool set in minor releases, so a
        long-lived client that keeps the catalogue it first saw is bitten
        silently.
        """
        n = 0
        while attempts is None or n < attempts:
            # `on_ready` fires the instant the subscription is live, which is
            # the only chance to publish a working listener before this call
            # blocks for as long as the socket stays up.
            await self.world.hass.listen(self.on_event,
                                         on_ready=self.publish_status)
            await self.publish_status()
            await self.world.clock.sleep(RECONNECT_SECONDS)
            await self.world.hass.connect_gateway()
            n += 1

    async def start(self) -> None:
        """Connect what can be connected, then say what is true either way.

        ⚠️ IT STARTS EVEN WHEN NOTHING CONNECTS. An add-on that exits because
        its gateway is unreachable is an add-on whose Configuration page nobody
        can read the problem on. Coming up degraded and SAYING so is the whole
        job of this ticket.
        """
        await self.world.hass.connect_gateway()
        await self.count_entities()
        await self.publish_status()
        # ⚠️ PRINTED AT START, NOT ONLY ON A HEARTBEAT. With the meter line
        # emitted only by the heartbeat — which sleeps first — a fresh add-on
        # printed no cost figure for its first five minutes, and the one figure
        # this project is allowed to quote was missing from exactly the moment
        # someone is watching the log.
        log.info(self.world.meter.line())
        self.record_start()

    async def count_entities(self) -> int | None:
        """Read the villa once, through the gateway. The S0 acceptance test.

        ⚠️ AND IT MUST LEAVE AN ARTEFACT SOMEBODY CAN SEE. `Gateway.entities()`
        was written, tested and then called by nothing in the running add-on —
        so "it can enumerate entities read-only" was true of the code and
        unobservable in the product. The count goes in the log and in the status
        entity's attributes, where an operator can check it.

        A failure leaves `entities_seen` as None rather than 0: "I could not
        ask" and "the property has nothing in it" are different answers, and
        only one of them is a reason to raise an alarm.
        """
        try:
            rows = await self.world.hass.entities()
        except Exception as exc:
            self.entities_seen = None
            log.warning(f"  could not enumerate the property through the gateway: "
                        f"{exc}")
            return None
        self.entities_seen = len(rows)
        log.info(f"  the gateway answered with {len(rows)} entities")
        return self.entities_seen

    def record_start(self) -> None:
        """One row per start, in the add-on's own backed-up volume."""
        try:
            self.world.store.append("starts", {
                "at": self.world.clock.now().isoformat(),
                "version": self.version,
                "health": overall(self.world.hass.health()),
                "entities_seen": self.entities_seen,
            }, keep=STARTS_KEPT)
        except OSError as exc:
            # A read-only or missing volume is worth saying out loud, and is not
            # worth refusing to start over.
            log.warning(f"  could not write to the add-on's own store: {exc}")
