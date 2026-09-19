"""The add-on's entry point: build the World from the container, then run.

⚠️ THIS FILE IS THE ONLY PLACE THAT READS THE ENVIRONMENT. Everything below it
is handed a `World` and can therefore be run against a fake villa. `python3 -m
agent` is what s6 execs.
"""
from __future__ import annotations

import asyncio
import os
import signal
import sys
from pathlib import Path

from agent import log
from agent.clock import SystemClock
from agent.fakes import FakeChannel, RefusingModel
from agent.gateway import Gateway
from agent.hass import HomeAssistant
from agent.listener import Listener
from agent.meter import Meter
from agent.options import OPTIONS_PATH, load_options
from agent.runtime import Layer
from agent.store import DATA_ROOT, Store
from agent.wire import Wire, open_session
from agent.world import World


def read_version() -> str:
    """The version Supervisor is running us as, for the status entity."""
    return os.environ.get("VESTA_AI_VERSION", "0")


async def run() -> int:
    options = load_options(Path(os.environ.get("VESTA_AI_OPTIONS", OPTIONS_PATH)))
    # ⚠️ BEFORE ANYTHING PRINTS. `log_level` and `timezone` were options the
    # manifest declared, the help text explained and `Options` read, and that
    # nothing then honoured — two settings an operator could change with no
    # observable effect. These two lines are what make them real.
    log.configure(options.log_level)
    clock = SystemClock(options.timezone)
    token = os.environ.get("SUPERVISOR_TOKEN", "")
    session = open_session()
    wire = Wire(session)
    hass = HomeAssistant(
        Gateway(options.ha_mcp_url, str(options.ha_mcp_secret), wire.rpc),
        Listener(token, wire.ws_connect, wire.post),
    )
    world = World(
        hass=hass,
        # ⚠️ BOTH STILL STUBS, AND BOTH REFUSE. Tickets 15 and 19 wire them.
        channel=FakeChannel(wired=False),
        model=RefusingModel(),
        clock=clock,
        store=Store(Path(os.environ.get("VESTA_AI_DATA", DATA_ROOT))),
        options=options,
        meter=Meter(daily_usd_limit=options.daily_usd_limit),
    )
    layer = Layer(world, version=read_version())

    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopping.set)

    log.info(f"vesta-ai {layer.version} starting; options: {options!r}")
    log.debug(f"  clock: {clock.zone_name()}; log level: {log.current_level()}")
    if options.missing():
        log.info(f"  not configured yet: {', '.join(options.missing())} — the "
                 f"layer will run and report its own health, and do nothing else")

    async with session:
        await layer.start()
        # ⚠️ ONLY THE STOP SIGNAL ENDS THIS. Both of the others are endless by
        # design: `stay_connected` reconnects rather than returning, and the
        # heartbeat re-asserts forever. Waiting on FIRST_COMPLETED across all
        # three is what made an unreachable Supervisor look like "the add-on
        # finished", and s6 restarted it several times a second.
        workers = [
            asyncio.create_task(layer.stay_connected()),
            asyncio.create_task(layer.heartbeat()),
        ]
        await stopping.wait()
        for task in workers:
            task.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        # ⚠️ THE LAST THING IT DOES. Without this the status entity keeps
        # reading `ok` after the add-on is stopped, which is exactly the
        # half-working-looks-healthy failure this layer is built to avoid.
        await layer.publish_unavailable()
    log.info("vesta-ai stopped")
    return 0


def main() -> int:
    try:
        return asyncio.run(run())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
