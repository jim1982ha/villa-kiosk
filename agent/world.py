"""What the layer is handed at construction, and everything it is allowed to use.

⚠️ THE ONE SEAM. Ticket 14 lays it before any behaviour exists on purpose: a
module that reaches around this — importing `aiohttp`, calling `datetime.now()`,
opening `/data` by path — is a module no later ticket can test without a live
villa, and this project has already paid for that twice (a fixture invented to
fit the code; a metric that measured nothing). Build a `World.for_testing()` and
the whole layer runs on a fake property.

Four PORTS (`Hass`, `Channel`, `Model`, `Clock`) plus the three things the layer
owns outright: its options, its store and its meter.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from agent.meter import Meter
from agent.options import Options
from agent.ports import Channel, Clock, Hass, Model
from agent.store import Store


@dataclass(frozen=True)
class World:
    hass: Hass
    channel: Channel
    model: Model
    clock: Clock
    store: Store
    options: Options
    meter: Meter

    @classmethod
    def for_testing(cls, root: Path | str, *, options: Options | None = None,
                    hass: Hass | None = None, channel: Channel | None = None,
                    model: Model | None = None, clock: Clock | None = None,
                    meter: Meter | None = None) -> "World":
        """A World with every port faked. The default way to test this layer."""
        from agent.fakes import FakeChannel, FakeClock, FakeHass, RefusingModel

        opts = options or Options()
        return cls(
            hass=hass or FakeHass(),
            channel=channel or FakeChannel(),
            model=model or RefusingModel(),
            clock=clock or FakeClock(),
            store=Store(root),
            options=opts,
            meter=meter or Meter(daily_usd_limit=opts.daily_usd_limit),
        )
