"""What the slot and the self-test need that is NOT part of the environment
contract — whether the HA MCP sidecar runs (and if not, why), the host's version.

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
    sidecar_reason: str | None = None
    host_version: str = "dev"
    # ⚠️ FOR THE CONTAINER TEST ONLY (VESTA_TEST_ANTHROPIC_URL, as VESTA_ROOT is for the unit tests): with no test
    # mode (0.12.46) a stand-in agent starts only once Anthropic passes, and a test never reaches the internet with
    # a fake key. The Supervisor never sets it. Carried here because an s6 service does not see the container's env.
    anthropic_url: str | None = None

    @classmethod
    def of(cls, raw: "HostState | dict | None") -> "HostState":
        """From the stored dict (unknown keys ignored, missing ones defaulted)."""
        if isinstance(raw, HostState):
            return raw
        d = raw if isinstance(raw, dict) else {}
        return cls(sidecar_reason=d.get("sidecar_reason") if isinstance(d.get("sidecar_reason"), str) else None,
                   host_version=str(d.get("host_version") or "dev"),
                   anthropic_url=d.get("anthropic_url") if isinstance(d.get("anthropic_url"), str) else None)

    @classmethod
    def read(cls, path: Path) -> "HostState":
        """Raises OSError / ValueError when the file is missing or broken."""
        return cls.of(json.loads(Path(path).read_text()))

    def write(self, path: Path) -> None:
        Path(path).write_text(json.dumps(asdict(self)))
