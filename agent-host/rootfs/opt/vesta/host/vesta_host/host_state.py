"""What the slot and the self-test need that is NOT part of the environment
contract — which program fills the slot, whether the stub sends heartbeats,
whether the HA MCP sidecar runs (and if not, why), the host's version.

Written once by the start script to /run/vesta/host.json and read by the
slot, the self-test and `vesta-selftest`. It was a dict with string keys at
every one of those, each supplying its own defaults.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class HostState:
    agent_mode: str = "stub"
    stub_heartbeat: bool = False
    sidecar_reason: str | None = None
    host_version: str = "dev"

    @classmethod
    def of(cls, raw: "HostState | dict | None") -> "HostState":
        """From the stored dict (unknown keys ignored, missing ones defaulted)."""
        if isinstance(raw, HostState):
            return raw
        d = raw if isinstance(raw, dict) else {}
        return cls(agent_mode=str(d.get("agent_mode") or "stub"),
                   stub_heartbeat=bool(d.get("stub_heartbeat")),
                   sidecar_reason=d.get("sidecar_reason") if isinstance(d.get("sidecar_reason"), str) else None,
                   host_version=str(d.get("host_version") or "dev"))

    @classmethod
    def read(cls, path: Path) -> "HostState":
        """Raises OSError / ValueError when the file is missing or broken."""
        return cls.of(json.loads(Path(path).read_text()))

    def write(self, path: Path) -> None:
        Path(path).write_text(json.dumps(asdict(self)))
