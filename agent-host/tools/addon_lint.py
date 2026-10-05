#!/usr/bin/env python3
"""Home Assistant's own checks on this add-on's packaging — the three the
community example app runs in its CI (hassio-addons/app-example, v14.0.1):

  · the add-on linter (frenck/action-addon-linter) — config.yaml against the
    schema the Supervisor accepts, and keys that only repeat a default;
  · hadolint on the Dockerfile;
  · shellcheck on every shell script s6 runs.

Our gates checked the app, its rules and its own manifest conventions, but
nothing checked the manifest against HOME ASSISTANT's: a key the Supervisor
rejects, or a broken line in an s6 script, was first seen on the wall.

Each tool is pinned (a commit, or an image digest) so CI and a laptop run the
same thing. Docker is required: a machine without it fails here, loudly —
this is a CI gate, never a silent pass.

Run: python3 agent-host/tools/addon_lint.py vesta-agent agent-host/Dockerfile agent-host/rootfs
(The VESTA Kiosk runs the same file as tools/addon_lint.py on dev2.)
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

# frenck/action-addon-linter v2.21.1. The action is a Dockerfile under src/;
# Docker builds it straight from the commit and caches it by this tag.
LINTER_COMMIT = "b9cfd1bc62ba60d2c4fc96317b5f7ada5923f4a7"
LINTER_IMAGE = f"vesta-addon-linter:{LINTER_COMMIT[:12]}"
LINTER_SOURCE = f"https://github.com/frenck/action-addon-linter.git#{LINTER_COMMIT}:src"
HADOLINT = "hadolint/hadolint@sha256:30a8fd2e785ab6176eed53f74769e04f125afb2f74a6c52aef7d463583b6d45e"      # v2.12.0
SHELLCHECK = "koalaman/shellcheck@sha256:2097951f02e735b613f4a34de20c40f937a6c8f18ecb170612c88c34517221fb"  # v0.10.0

FAIL = 0


def step(name: str, cmd: list[str], stdin: str | None = None) -> None:
    global FAIL
    proc = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out = (proc.stdout or "").strip()
    print(f"    {'PASS' if proc.returncode == 0 else 'FAIL'}  {name}")
    if out:
        print("\n".join(f"          {l}" for l in out.splitlines()))
    if proc.returncode != 0:
        FAIL += 1


def shell_scripts(rootfs: Path) -> list[Path]:
    """Every file under rootfs whose first line runs a shell — found by SHAPE,
    so a new s6 script is linted without anyone adding it to a list."""
    out = []
    for p in sorted(rootfs.rglob("*")):
        if not p.is_file():
            continue
        try:
            first = p.read_text(errors="replace").split("\n", 1)[0]
        except OSError:
            continue
        if first.startswith("#!") and any(s in first for s in ("/sh", "bash", "with-contenv sh")):
            out.append(p)
    return out


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    manifest, dockerfile, rootfs = (Path(a).resolve() for a in sys.argv[1:])
    if not shutil.which("docker"):
        print("❌ docker is not on this machine — these checks need it (CI has it)")
        return 1

    have = subprocess.run(["docker", "image", "inspect", LINTER_IMAGE], capture_output=True).returncode == 0
    if not have:
        build = subprocess.run(["docker", "build", "-q", "-t", LINTER_IMAGE, LINTER_SOURCE],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if build.returncode != 0:
            print(f"❌ could not build the add-on linter from {LINTER_SOURCE}\n{build.stdout}")
            return 1

    step(f"the add-on linter accepts {manifest.name}/config.yaml",
         ["docker", "run", "--rm", "-e", "INPUT_PATH=/a", "-e", "INPUT_COMMUNITY=false",
          "-v", f"{manifest}:/a:ro", LINTER_IMAGE])

    # The repo's .hadolint.yaml (beside the Dockerfile or at the root) says
    # which rules are waived and why; it is mounted so the container reads it.
    cfg = next((c for c in (dockerfile.parent / ".hadolint.yaml", Path.cwd() / ".hadolint.yaml") if c.exists()), None)
    hcmd = ["docker", "run", "--rm", "-i"] + (["-v", f"{cfg}:/cfg.yaml:ro"] if cfg else []) + [HADOLINT, "hadolint", "--no-color"]
    step(f"hadolint accepts {dockerfile.relative_to(Path.cwd())}", hcmd + (["--config", "/cfg.yaml"] if cfg else []) + ["-"],
         stdin=dockerfile.read_text())

    scripts = shell_scripts(rootfs)
    if not scripts:
        print("    FAIL  shellcheck found no shell scripts under rootfs (a wrong path checks nothing)")
        return 1
    rel = [str(s.relative_to(rootfs)) for s in scripts]
    step(f"shellcheck accepts the {len(scripts)} shell scripts s6 runs",
         ["docker", "run", "--rm", "-v", f"{rootfs}:/r:ro", "-w", "/r", SHELLCHECK, *rel])

    print("\n✅ Home Assistant's checks pass" if FAIL == 0 else f"\n❌ {FAIL} of Home Assistant's checks failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
