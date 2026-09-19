"""The four ports. Everything the layer does, it does through one of these.

⚠️ THE LAYER NEVER REACHES AROUND THEM. That is the whole value of the seam:
every later ticket is testable with a fake villa, a fake phone and a fake model,
so behaviour can be pinned by what the layer ASKED rather than by what a live
property happened to answer. A module that imports `aiohttp` directly, or reads
the clock with `datetime.now()`, has quietly re-created the untestable thing.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from agent.health import Health


class Hass(Protocol):
    """Home Assistant, through BOTH of the connections ADR-0012 allows.

    One port, two connections, on purpose: every caller wants "the villa", and
    which wire an answer came over is this port's business, not theirs. What
    callers must not be able to do is ask a QUESTION over the listening
    connection — so there is no `request` here, only named reads that the
    gateway serves.
    """

    async def entity_count(self) -> int:
        """How many entities Home Assistant knows about, via the gateway.

        ⚠️ A COUNT, BECAUSE THAT IS WHAT THE GATEWAY ACTUALLY OFFERS. The
        summary tool reports a total and truncated per-domain samples; it does
        not enumerate. A port promising a list would be a promise nothing
        behind it can keep.
        """

    async def publish(self, object_id: str, state: str,
                      attributes: dict[str, Any]) -> None:
        """Assert one of the layer's OWN status entities, over the direct
        connection. This is the only write the layer makes anywhere."""

    def reconfigure(self, url: str, secret: str) -> bool:
        """Point the gateway at a newly saved address. True if it moved.

        ⚠️ ON THE PORT, BECAUSE APPLYING A SETTING IS NOT OPTIONAL. The layer
        re-reads its settings on every heartbeat, and for one release that
        updated the options object and nothing else — so a saved gateway
        address never reached the thing that connects, and the screen showed a
        configured address beside a connection insisting there was none.
        """

    def health(self) -> Health:
        """Both connections' states, separately."""


class Channel(Protocol):
    """How a message reaches a person. A stub until ticket 15."""

    async def send(self, target: str, title: str, body: str) -> None: ...


class Model(Protocol):
    """How the layer reasons. A stub until ticket 19."""

    async def ask(self, prompt: str, **kwargs: Any) -> Any: ...


class Clock(Protocol):
    """Now, and waiting. A port so that no test ever sleeps."""

    def now(self) -> datetime: ...

    async def sleep(self, seconds: float) -> None: ...
