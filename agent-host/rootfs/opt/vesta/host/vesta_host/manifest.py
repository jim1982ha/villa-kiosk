"""The agent's manifest, vesta-agent.yaml — read in ONE place (SPEC H2).

It used to be read three times, each picking different fields: the slot
(start, stop grace, name, version), the start script (name, version, runtime)
and the image build (install, an inline python one-liner). Now:

  load(path)     → (Manifest, None) or (None, why not)
  identity(path) → "name version (runtime)" for the start-up banner
  python3 -m vesta_host.manifest build-inputs <path> <src> <dst>   (the image build)

⚠️ build-inputs IS WHAT KEEPS UPDATES SMALL. The image build installs the
agent's libraries from dst/install/ (the `install` command and ONLY the
`install_files`) and its apt packages from dst/packages.txt. Docker reuses a
layer whose inputs did not change, so a release that changes only the agent's
code rebuilds — and the Yellow downloads — only the code. Without
`install_files` the whole source is the input and every release reinstalls.
"""
from __future__ import annotations

import re
import shutil
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
    install_files: list[str] | None = None
    ui: str = ""
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
    files, bad = install_files(m)
    if bad:
        return None, f"{path}: install_files holds {bad!r}, not a file of the agent's folder"
    return Manifest(name=str(m.get("name", "agent")), version=str(m.get("version", "")),
                    runtime=str(m.get("runtime", "?")), start=str(start),
                    install=str(m.get("install") or ""), stop_grace=max(1, grace),
                    system_packages=pkgs, install_files=files, ui=str(m.get("ui") or ""),
                    warnings=warnings), None


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


#: A path inside the agent's folder: relative, and no part starts with a dot (so no `..`) or a dash.
INSTALL_FILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$")


def install_files(m: dict) -> tuple[list[str] | None, str | None]:
    """(the files `install` needs, or None when not declared; the first bad entry or None)."""
    raw = m.get("install_files")
    if raw is None:
        return None, None
    if not isinstance(raw, list):
        return None, str(raw)
    for p in raw:
        if not isinstance(p, str) or not INSTALL_FILE.match(p):
            return None, str(p)
    return list(raw), None


def build_inputs(path: Path, src: Path, dst: Path) -> None:
    """dst/install/ (install.sh + the install files) and dst/packages.txt, for the image build."""
    m, problem = load(path)
    if problem:
        raise ValueError(problem)
    inst = Path(dst) / "install"
    inst.mkdir(parents=True, exist_ok=True)
    if m.install_files is None:
        shutil.copytree(src, inst, dirs_exist_ok=True, ignore=shutil.ignore_patterns("tests", "__pycache__"))
    else:
        for rel in m.install_files:
            (inst / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(src) / rel, inst / rel)
    (inst / "install.sh").write_text(m.install + "\n" if m.install else "")
    (Path(dst) / "packages.txt").write_text(" ".join(m.system_packages) + "\n")


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
    if len(sys.argv) == 5 and sys.argv[1] == "build-inputs":
        try:
            build_inputs(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
        except Exception as exc:
            print(f"vesta_host.manifest: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        print("usage: python3 -m vesta_host.manifest build-inputs <vesta-agent.yaml> <src> <dst>", file=sys.stderr)
        sys.exit(2)
