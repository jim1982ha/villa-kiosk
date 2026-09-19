"""Whether the layer is working, said in a way that cannot hide a half-failure.

⚠️ TWO CONNECTIONS, TWO FAILURE MODES, AND A SINGLE BOOLEAN CANNOT CARRY THEM.
ADR-0012 splits the layer's contact with Home Assistant in two: ha-mcp is the
GATEWAY for everything the layer asks, and one direct connection LISTENS and
publishes status because those are the two things ha-mcp structurally cannot do.
They fail independently — the gateway can be down while events still arrive —
and the ADR names the consequence in its own words: "Both states must be visible
in the layer's own health entity, or a half-working layer looks healthy."
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class LinkState(str, Enum):
    UP = "up"
    DOWN = "down"
    #: Nothing has been proven yet — before the first attempt completes. It is
    #: deliberately NOT a synonym for up: "we have not looked" and "we looked
    #: and it worked" are different answers.
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Link:
    state: LinkState = LinkState.UNKNOWN
    detail: str = ""


@dataclass(frozen=True)
class Health:
    gateway: Link = Link()
    listener: Link = Link()

    def reason(self) -> str:
        """Which half is unwell, in words, for the entity's own attributes."""
        bad = [name for name, link in (("gateway", self.gateway),
                                       ("listener", self.listener))
               if link.state is not LinkState.UP]
        if not bad:
            return ""
        parts = []
        for name in bad:
            link: Link = getattr(self, name)
            parts.append(f"{name} {link.state.value}"
                         + (f" ({link.detail})" if link.detail else ""))
        return "; ".join(parts)

    def attributes(self) -> dict[str, str]:
        return {
            "gateway": self.gateway.state.value,
            "gateway_detail": self.gateway.detail,
            "listener": self.listener.state.value,
            "listener_detail": self.listener.detail,
            "reason": self.reason(),
        }


def overall(health: Health) -> str:
    """One word for two links, which never rounds a half-failure up to `ok`."""
    up = [link.state is LinkState.UP for link in (health.gateway, health.listener)]
    if all(up):
        return "ok"
    if not any(up):
        return "down"
    return "degraded"
