"""The agent's manifest, vesta-agent.yaml — read in ONE place (SPEC H2).

It used to be read three times, each picking different fields: the slot
(start, stop grace, name, version), the start script (name, version, runtime)
and the image build (install, an inline python one-liner). Now:

  load(path)     → (Manifest, None) or (None, why not)
  identity(path) → "name version (runtime)" for the start-up banner
  python3 -m vesta_host.manifest install <path>          (the image build)
  python3 -m vesta_host.manifest system-packages <path>  (the image build)
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_GRACE = 20
#: The whole stop must fit in the app's 30 s timeout.
MAX_GRACE = 22


@dataclass(frozen=True)
class Manifest:
    name: str
    version: str
    runtime: str
    start: str
    install: str
    stop_grace: int
    system_packages: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.name} {self.version}".rstrip()


def _read(path: Path) -> dict:
    import yaml
    data = yaml.safe_load(Path(path).read_text()) or {}
    return data if isinstance(data, dict) else {}


def load(path: Path) -> tuple[Manifest | None, str | None]:
    """The manifest, checked — or why it cannot run."""
    try:
        m = _read(path)
    except (OSError, ValueError) as exc:
        return None, f"{path} is unreadable ({type(exc).__name__})"
    except Exception as exc:  # yaml's own errors
        return None, f"{path} is not valid YAML ({type(exc).__name__})"
    start = m.get("start")
    if not start:
        return None, f"{path} has no `start` command"
    warnings = []
    try:
        grace = int(m.get("stop_grace_seconds") or DEFAULT_GRACE)
    except (TypeError, ValueError):
        grace = DEFAULT_GRACE
        warnings.append(f"stop_grace_seconds is not a number — {DEFAULT_GRACE} used")
    if grace > MAX_GRACE:
        warnings.append(f"stop_grace_seconds {grace} capped to {MAX_GRACE}: the whole stop "
                        "must fit in the app's 30 s timeout")
        grace = MAX_GRACE
    pkgs, bad = system_packages(m)
    if bad:
        return None, f"{path}: system_packages holds {bad!r}, not a Debian package name"
    return Manifest(name=str(m.get("name", "agent")), version=str(m.get("version", "")),
                    runtime=str(m.get("runtime", "?")), start=str(start),
                    install=str(m.get("install") or ""), stop_grace=max(1, grace),
                    system_packages=pkgs, warnings=warnings), None


#: A Debian package name (Debian Policy 5.6.1). The list reaches `apt-get install`
#: in the image build unquoted, so anything else is refused, not passed on.
PACKAGE = re.compile(r"^[a-z0-9][a-z0-9+.-]+$")


def system_packages(m: dict) -> tuple[list[str], str | None]:
    """(the packages, the first bad entry or None)."""
    raw = m.get("system_packages") or []
    if not isinstance(raw, list):
        return [], str(raw)
    out = []
    for p in raw:
        if not isinstance(p, str) or not PACKAGE.match(p):
            return [], str(p)
        out.append(p)
    return out, None


def identity(path: Path) -> str:
    """What the start-up banner says runs in the slot."""
    if not Path(path).exists():
        return "none installed"
    try:
        m = _read(path)
    except Exception as exc:  # a broken manifest is reported, not fatal here
        return f"unreadable manifest ({type(exc).__name__})"
    return f"{m.get('name', '?')} {m.get('version', '?')} ({m.get('runtime', '?')})"


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in ("install", "system-packages"):
        try:
            m = _read(Path(sys.argv[2]))
            if sys.argv[1] == "install":
                print(m.get("install") or "")
            else:
                pkgs, bad = system_packages(m)
                if bad:
                    raise ValueError(f"system_packages holds {bad!r}, not a Debian package name")
                print(" ".join(pkgs))
        except Exception as exc:
            print(f"vesta_host.manifest: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        print("usage: python3 -m vesta_host.manifest install|system-packages <vesta-agent.yaml>", file=sys.stderr)
        sys.exit(2)
