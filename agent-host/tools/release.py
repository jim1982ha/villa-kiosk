#!/usr/bin/env python3
"""The VESTA Agent's release: `gates` and `ship`.

    python3 agent-host/tools/release.py gates              # every gate, even after a red one, then a summary (CI runs this)
    python3 agent-host/tools/release.py ship -F msg.txt    # version → quick check → commit → push → wait until published
    python3 agent-host/tools/release.py ship --dry-run     # what ship would do, changing nothing

ONE VERSION: the top `## x.y.z` of vesta-agent/CHANGELOG.md, written into vesta-agent/config.yaml (what the store
offers) and agent-src/vesta-agent.yaml (the agent reads it as its __version__, the UI's cache path).

CI is the gate: agent-host.yaml runs `gates` before the image is built, so a red gate publishes nothing. `ship` runs
only the quick checks here, then waits once for main's vesta-agent-dev/config.yaml to name the version: exit 0 when
published, 3 when pushed but not published in time (read the CI run), 2 when refused.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"

BRANCH = "agent-dev"
CHANNEL_CONFIG = "vesta-agent-dev/config.yaml"     # written on main by CI (agent-host.yaml sync-agent-dev-manifest)
CHANGELOG = "vesta-agent/CHANGELOG.md"
VERSION_SITES = ("vesta-agent/config.yaml", "agent-host/agent-src/vesta-agent.yaml")
#: Every version of each starter skill a release shipped (vesta_agent.skills.record_shipped): a skill whose
#: fingerprint is not in it is taken for one the villa edited, and never updated again.
STARTER_SKILLS = "agent-host/agent-src/starter/skills/"
SHIPPED_SKILLS = "agent-host/agent-src/starter/shipped-skills.json"
#: The agreement with the VESTA Kiosk: the Kiosk's file on its branch, and this app's copy of it.
KIOSK_AGREEMENT, KIOSK_BRANCH = "rootfs/usr/share/vesta/agent-contract.json", "dev2"
AGREEMENT_COPY = "agent-host/rootfs/opt/vesta/host/agent-contract.json"

#: Off CI, agent-host/.venv (gitignored; uv venv --python 3.13; pyyaml pytest pytest-xdist ruff
#: -r agent-src/requirements.txt). This machine has no `python` and its python3 lacks pytest.
VENV_PY = ROOT / "agent-host" / ".venv" / "bin" / "python"
PY = str(VENV_PY) if not IN_CI and VENV_PY.exists() else sys.executable
SRC = "agent-host/agent-src"

# (name, command, working directory under ROOT, run by ship too). CI also starts the built image (container_test.sh).
GATES: list[tuple[str, list[str], str, bool]] = [
    ("The VESTA Kiosk is untouched", ["bash", "agent-host/tests/check_isolation.sh", "origin/main"], ".", True),
    ("The app manifest agrees with what the Supervisor reads", [PY, "agent-host/tests/check_manifest.py"], ".", True),
    ("The code compiles and every name it uses is defined",
     [PY, "-m", "ruff", "check", "--no-cache", "--select", "E9,F", "vesta_agent", "vesta_shared", "starter"], SRC, True),
    # tests/villa/ (real data, gitignored) is collected too wherever it exists; the host's two tests ride along.
    ("The VESTA Agent's tests",
     [PY, "-m", "pytest", "tests", "../tests/test_kiosk_contract.py", "../tests/test_release.py",
      "-q", "-p", "no:cacheprovider", "-n", "auto"], SRC, False),
]


class ReleaseError(RuntimeError):
    pass


def run_gates(quick: bool = False) -> bool:
    """Run every gate (or only ship's), even after a failure; print a summary; True when all pass."""
    results = []
    for name, cmd, cwd, in_ship in GATES:
        if quick and not in_ship:
            continue
        print(f"::group::{name}" if IN_CI else f"\n═══ {name} ═══", flush=True)
        start = time.monotonic()
        p = subprocess.run(cmd, cwd=ROOT / cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        sys.stdout.write(p.stdout or "")
        if IN_CI:
            print("::endgroup::", flush=True)
            if p.returncode:
                print(f"::error title={name}::failed (see the log group above)", flush=True)
        results.append((name, p.returncode == 0, time.monotonic() - start))
    print("\n── gates ─────────────────────────────────────────")
    for name, ok, took in results:
        print(f"  {'✅ pass' if ok else '❌ FAIL'}  {name}  ({took:.0f} s)")
    failed = sum(not ok for _, ok, _ in results)
    print(f"── {failed} failed of {len(results)}" if failed else "── all gates pass")
    return not failed


# ── Versions ─────────────────────────────────────────────────────────────────

def parse_version(v: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        raise ReleaseError(f"{v!r} is not a version (x.y.z)")
    return tuple(int(x) for x in v.split("."))


def changelog_version(text: str) -> str:
    m = re.search(r"^## (\d+\.\d+\.\d+)\b", text, re.M)
    if not m:
        raise ReleaseError(f"{CHANGELOG} has no `## x.y.z` entry")
    return m.group(1)


def yaml_version(text: str) -> str | None:
    m = re.search(r'^version:\s*"?([^"\s]+)"?\s*$', text, re.M)
    return m.group(1) if m else None


def with_yaml_version(text: str, version: str) -> str:
    return re.sub(r'^(version:\s*)"?[^"\s]+"?(\s*)$', lambda m: f'{m.group(1)}"{version}"{m.group(2)}', text,
                  count=1, flags=re.M)


def git(*args: str) -> str:
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise ReleaseError(f"git {' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


def published_version() -> str | None:
    git("fetch", "-q", "origin", "main")
    p = subprocess.run(["git", "show", f"origin/main:{CHANNEL_CONFIG}"], cwd=ROOT, capture_output=True, text=True)
    return yaml_version(p.stdout) if p.returncode == 0 else None


def copy_agreement(dry_run: bool) -> None:
    """The Kiosk's agreement on its branch replaces this app's copy and ships with the release (a copy made by hand
    once held a release back a day). test_kiosk_contract.py still compares them in CI."""
    subprocess.run(["git", "fetch", "-q", "origin", KIOSK_BRANCH], cwd=ROOT, capture_output=True)
    theirs = subprocess.run(["git", "show", f"origin/{KIOSK_BRANCH}:{KIOSK_AGREEMENT}"], cwd=ROOT,
                            capture_output=True, text=True)
    mine = ROOT / AGREEMENT_COPY
    if theirs.returncode != 0 or (mine.exists() and mine.read_text() == theirs.stdout):
        return
    print(f"  the agreement copied from the Kiosk ({KIOSK_BRANCH})" + (" (dry run: not written)" if dry_run else ""))
    if not dry_run:
        mine.write_text(theirs.stdout)
        git("add", AGREEMENT_COPY)


# ── ship ─────────────────────────────────────────────────────────────────────

def ship(message: str | None, dry_run: bool, wait_minutes: float, poll_seconds: float = 15) -> int:
    git("fetch", "-q", "origin", BRANCH)
    if git("rev-parse", "--abbrev-ref", "HEAD").strip() == "main":
        raise ReleaseError("on main: the agent releases from agent-dev")
    if subprocess.run(["git", "merge-base", "--is-ancestor", f"origin/{BRANCH}", "HEAD"], cwd=ROOT).returncode:
        raise ReleaseError(f"HEAD does not contain origin/{BRANCH}: pull first")
    copy_agreement(dry_run)
    if git("diff", "--name-only").strip():
        raise ReleaseError("unstaged changes in tracked files: stage what ships (by name) or stash the rest")
    staged = git("diff", "--cached", "--name-only").split()
    if CHANGELOG not in staged:
        raise ReleaseError(f"{CHANGELOG} is not staged: its new top entry names the version")
    before = yaml_version(git("show", f"HEAD:{VERSION_SITES[0]}")) or "0.0.0"
    version = changelog_version((ROOT / CHANGELOG).read_text())
    if parse_version(version) <= parse_version(before):
        raise ReleaseError(f"{CHANGELOG}'s top entry is {version}, not above {before}: add the new entry at the TOP")
    skills = any(f.startswith(STARTER_SKILLS) for f in staged)

    print(f"VESTA Agent (dev) {before} → {version}: {len(staged)} files staged")
    if dry_run:
        print(f"  dry run: would write {version} to {', '.join(VERSION_SITES)}"
              + (f", record {SHIPPED_SKILLS}" if skills else "")
              + f"; run the quick checks; commit; push HEAD:{BRANCH}; wait ≤ {wait_minutes:g} min for main")
        return 0
    if not message:
        raise ReleaseError("a commit message is needed (-m or -F)")

    for site in VERSION_SITES:
        (ROOT / site).write_text(with_yaml_version((ROOT / site).read_text(), version))
    git("add", *VERSION_SITES)
    if skills:
        subprocess.run([PY, "-c", "from vesta_agent.skills import record_shipped; record_shipped('starter/skills')"],
                       cwd=ROOT / SRC, check=True)
        git("add", SHIPPED_SKILLS)

    if not run_gates(quick=True):
        raise ReleaseError("a quick check failed: nothing committed. Fix, stage, and ship again")

    subprocess.run(["git", "commit", "-q", "-F", "-"], cwd=ROOT, input=message, text=True, check=True)
    print(git("log", "-1", "--format=  committed %h %s").rstrip())
    git("push", "-q", "origin", f"HEAD:{BRANCH}")
    print(f"  pushed to {BRANCH}; CI runs every gate, then publishes. Waiting for main…")

    deadline = time.monotonic() + wait_minutes * 60
    while time.monotonic() < deadline:
        if published_version() == version:
            print(f"✅ PUBLISHED: the store offers VESTA Agent (dev) {version}")
            return 0
        time.sleep(poll_seconds)
    print(f"⏳ pushed, NOT published after {wait_minutes:g} min: read the CI run for this commit.")
    return 3


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(prog="release.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gates", help="run every gate (what CI runs)")
    s = sub.add_parser("ship", help="version → quick checks → commit → push → wait until published")
    s.add_argument("-m", "--message")
    s.add_argument("-F", "--file", help="read the commit message from a file")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--wait", type=float, default=40, help="minutes to wait for main (default 40)")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "gates":
            return 0 if run_gates() else 1
        return ship(Path(a.file).read_text() if a.file else a.message, a.dry_run, a.wait)
    except ReleaseError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
