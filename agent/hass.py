"""The `Hass` port, built from the two connections ADR-0012 allows.

One port, two wires. Callers ask this for "the villa" and never choose a wire —
which is what keeps the rule enforceable: there is no method here that would let
a caller ask a QUESTION over the listening connection, so the boundary cannot be
crossed by accident later.
"""
from __future__ import annotations

from typing import Any, Callable

from agent.gateway import Gateway, GatewayError
from agent.health import Health, Link, LinkState
from agent.listener import Listener

#: The object_id the layer publishes its own health under. One constant, one
#: place — see the note in `listener.py` on why these are composed rather than
#: written as an entity id.
STATUS_OBJECT = "vesta_ai_status"


class HomeAssistant:
    """The `Hass` port. Gateway for asking; listener for being told and seen."""

    def __init__(self, gateway: Gateway, listener: Listener) -> None:
        self._gateway = gateway
        self._listener = listener

    async def entity_count(self) -> int:
        return await self._gateway.entity_count()

    async def publish(self, object_id: str, state: str,
                      attributes: dict[str, Any]) -> None:
        await self._listener.publish(object_id, state, attributes)

    def health(self) -> Health:
        return Health(gateway=self._gateway.link, listener=self._listener.link)

    # ── lifecycle ──────────────────────────────────────────────────────────
    def reconfigure(self, url: str, secret: str) -> bool:
        """Point the gateway at a newly saved address. Returns whether it moved."""
        return self._gateway.reconfigure(url, secret)

    async def connect_gateway(self) -> Link:
        return await self._gateway.connect()

    async def listen(self, on_event: Callable[[dict[str, Any]], Any],
                     stop_after: int | None = None,
                     on_ready: Callable[[], Any] | None = None) -> Link:
        return await self._listener.listen(on_event, stop_after=stop_after,
                                           on_ready=on_ready)
