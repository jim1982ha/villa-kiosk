#!/usr/bin/env python3
"""The VESTA Agent's release, as one module: `gates` and `ship`.

    python3 agent-host/tools/release.py gates              # every gate CI runs, all of them, then a summary
    python3 agent-host/tools/release.py ship -F msg.txt    # versions → gates → commit → push → published
    python3 agent-host/tools/release.py ship --dry-run     # what ship would do, changing nothing

The same shape as the VESTA Kiosk's tools/release.py, which lives on its own
branch: each app's release knows only its own files (the isolation rule,
agent-host/CLAUDE.md), so the two are siblings, not one module.

TWO VERSIONS, EACH NAMED BY ITS CHANGELOG. The app (what Home Assistant offers)
is the top `## x.y.z` of vesta-agent/CHANGELOG.md, copied into
vesta-agent/config.yaml. The engine (agent-src) is the top `## x.y.z (date)` of
agent-host/agent-src/CHANGELOG.md, copied into vesta-agent.yaml and
vesta_agent/__init__.__version__ — and asked for only when the release changes
agent-src. Nothing compared those three sites before this module; an
agent-src test now does (tests/test_engine_version.py).

"SHIPPED" MEANS PUBLISHED: exit 0 only once main's vesta-agent-dev/config.yaml
names the version. GATES ARE LISTED HERE ONCE: agent-host.yaml runs `gates`.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"

APP = "VESTA Agent (dev)"
BRANCH = "agent-dev"
CHANNEL_DIR = "vesta-agent-dev"        # what CI writes on main for BRANCH (agent-host.yaml sync-agent-dev-manifest)
APP_CHANGELOG = "vesta-agent/CHANGELOG.md"
APP_CONFIG = "vesta-agent/config.yaml"
ENGINE_DIR = "agent-host/agent-src/"
ENGINE_CHANGELOG = "agent-host/agent-src/CHANGELOG.md"
ENGINE_MANIFEST = "agent-host/agent-src/vesta-agent.yaml"
ENGINE_INIT = "agent-host/agent-src/vesta_agent/__init__.py"

PY = sys.executable
GATES: list[tuple[str, list[str], str]] = [   # (name, command, working directory under ROOT)
    ("The VESTA Kiosk is untouched", ["bash", "agent-host/tests/check_isolation.sh", "origin/main"], "."),
    ("The app manifest agrees with what the Supervisor reads", [PY, "agent-host/tests/check_manifest.py"], "."),
    # Home Assistant's own checks — the community example app's CI: the add-on
    # linter, hadolint, shellcheck (agent-host/tools/addon_lint.py; needs Docker).
    ("Home Assistant's add-on checks",
     [PY, "agent-host/tools/addon_lint.py", "vesta-agent", "agent-host/Dockerfile", "agent-host/rootfs"], "."),
    ("The host's start-up, contract, folders and redaction", [PY, "agent-host/tests/test_host.py"], "."),
    ("The self-test reports each link correctly", [PY, "agent-host/tests/test_selftest.py"], "."),
    ("The sidecar, the restart policy and the stop grace", [PY, "agent-host/tests/test_supervise.py"], "."),
    ("The update check moves only forward", [PY, "agent-host/tests/test_updates.py"], "."),
    ("The agreement with the VESTA Kiosk is the Kiosk's own", [PY, "agent-host/tests/test_kiosk_contract.py"], "."),
    ("What the host sends is what the agent reads", [PY, "agent-host/tests/test_env_contract.py"], "."),
    ("The agent's manifest and the host state", [PY, "agent-host/tests/test_manifest.py"], "."),
    ("The release module", [PY, "agent-host/tests/test_release.py"], "."),
    # The synthetic tests. tests/villa/ (real data, gitignored) is collected too wherever it exists.
    ("The VESTA Agent's own tests", [PY, "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider"], "agent-host/agent-src"),
]


@dataclass
class GateResult:
    name: str
    status: str            # "pass" | "FAIL"
    seconds: float = 0.0
    note: str = ""


# ⚠️ THREE LANES SIDE BY SIDE (2026-10-05): one gate at a time was 77 s, 38 of them the agent's own tests.
# A lane runs its gates in order; lanes run at once. Gates that bind the fixed sidecar port
# (contract.SIDECAR_PORT) share the "sidecar" lane, so two never bind it together. Output is still printed
# in GATES order, whole, with its group — only the waiting is shared.
LANES = {"The host's start-up, contract, folders and redaction": "sidecar",
         "The self-test reports each link correctly": "sidecar",
         "The VESTA Agent's own tests": "agent"}


def _run_one(cmd: list[str], cwd: str) -> tuple[int, str, float]:
    start = time.monotonic()
    proc = subprocess.run(cmd, cwd=ROOT / cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return proc.returncode, proc.stdout or "", time.monotonic() - start


def run_gates() -> list[GateResult]:
    """Run every gate, even after a failure; return what each did."""
    from concurrent.futures import ThreadPoolExecutor
    lanes: dict[str, list[int]] = {}
    for i, (name, _cmd, _cwd) in enumerate(GATES):
        lanes.setdefault(LANES.get(name, "rest"), []).append(i)
    done: dict[int, tuple[int, str, float]] = {}

    def lane(indices: list[int]) -> None:
        for i in indices:
            done[i] = _run_one(GATES[i][1], GATES[i][2])
    with ThreadPoolExecutor(max_workers=len(lanes)) as pool:
        list(pool.map(lane, lanes.values()))
    results: list[GateResult] = []
    for i, (name, _cmd, _cwd) in enumerate(GATES):
        print(f"::group::{name}" if IN_CI else f"\n═══ {name} ═══", flush=True)
        returncode, out, took = done[i]
        sys.stdout.write(out)
        if IN_CI:
            print("::endgroup::", flush=True)
        if returncode == 0:
            results.append(GateResult(name, "pass", took))
            continue
        results.append(GateResult(name, "FAIL", took, f"exit {returncode}"))
        if IN_CI:
            # The job log needs a signed-in account; an annotation does not (was tests/ci_run.sh).
            for line in _failure_lines(out):
                print(f"::error title={name}::{line}", flush=True)
    return results


def _failure_lines(out: str) -> list[str]:
    pick = [l.strip() for l in out.splitlines() if re.search(r"^(FAIL|ERROR):|Error:|assert|    FAIL|^  FAIL|FAILED", l)]
    return [l[:300] for l in pick[:8]] or ["failed (see the log group above)"]


def print_summary(results: list[GateResult]) -> bool:
    print("\n── gates ─────────────────────────────────────────")
    for r in results:
        mark = "✅" if r.status == "pass" else "❌"
        print(f"  {mark} {r.status:<5} {r.name}{f'  ({r.seconds:.0f} s)' if r.seconds else ''}{'  ' + r.note if r.note else ''}")
    failed = [r for r in results if r.status == "FAIL"]
    print(f"── {len(failed)} failed of {len(results)}" if failed else "── all gates pass")
    return not failed


# ── Versions ─────────────────────────────────────────────────────────────────
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


class ReleaseError(RuntimeError):
    pass


def parse_version(v: str) -> tuple[int, int, int]:
    if not VERSION.match(v):
        raise ReleaseError(f"{v!r} is not a version (x.y.z)")
    a, b, c = (int(x) for x in v.split("."))
    return a, b, c


def changelog_version(text: str, where: str) -> str:
    """The first `## x.y.z` heading (a date after it, as agent-src writes, is allowed)."""
    m = re.search(r"^## (\d+\.\d+\.\d+)\b", text, re.M)
    if not m:
        raise ReleaseError(f"{where} has no `## x.y.z` entry")
    return m.group(1)


def yaml_version(text: str, where: str) -> str:
    m = re.search(r'^version:\s*"?([^"\s]+)"?\s*$', text, re.M)
    if not m:
        raise ReleaseError(f"{where} has no version line")
    return m.group(1)


def with_yaml_version(text: str, version: str) -> str:
    return re.sub(r'^(version:\s*)"?[^"\s]+"?(\s*)$', lambda m: f'{m.group(1)}"{version}"{m.group(2)}', text, count=1, flags=re.M)


def init_version(text: str) -> str:
    m = re.search(r'^__version__ = "([^"]+)"', text, re.M)
    if not m:
        raise ReleaseError(f"{ENGINE_INIT} has no __version__")
    return m.group(1)


def with_init_version(text: str, version: str) -> str:
    return re.sub(r'^__version__ = "[^"]+"', f'__version__ = "{version}"', text, count=1, flags=re.M)


def git(*args: str, check: bool = True) -> str:
    for attempt in range(4):
        p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
        # Worktrees share one set of remote refs: a fetch running in another (the Kiosk's own ship)
        # holds their lock for a moment. Wait it out rather than fail the release.
        if not (args[0] == "fetch" and "cannot lock ref" in p.stderr) or attempt == 3:
            break
        time.sleep(2 + attempt * 3)
    if check and p.returncode != 0:
        raise ReleaseError(f"git {' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


def published_version() -> str | None:
    git("fetch", "-q", "origin", "main")
    p = subprocess.run(["git", "show", f"origin/main:{CHANNEL_DIR}/config.yaml"], cwd=ROOT, capture_output=True, text=True)
    return yaml_version(p.stdout, CHANNEL_DIR) if p.returncode == 0 else None


def _newer(changelog: str, released: str, label: str) -> str:
    version = changelog_version((ROOT / changelog).read_text(), changelog)
    if parse_version(version) <= parse_version(released):
        raise ReleaseError(f"{changelog}'s top entry is {version}, not above the released {label} {released}: "
                           "add the new entry at the TOP")
    return version


# ── ship ─────────────────────────────────────────────────────────────────────

def ci_failures(sha: str, fetch=None) -> list[str] | None:
    """The CI runs for `sha` that ended in failure, by name — [] when none has (yet), None when GitHub could
    not be asked (offline, rate-limited: the wait simply goes on, as before).

    ⚠️ ship USED TO WAIT OUT A RED RUN (2026-10-05): it only watched main for the published version, so a
    failed CI run kept it waiting the full --wait (30-40 min) before saying "not published". The repository
    is public: its Actions runs are readable without a token."""
    import json as _json
    import urllib.request
    if fetch is None:
        url = git("remote", "get-url", "origin").strip()
        m = re.search(r"github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?$", url)
        if not m:
            return None
        api = f"https://api.github.com/repos/{m.group(1)}/{m.group(2)}/actions/runs?head_sha={sha}&per_page=20"

        def fetch():
            with urllib.request.urlopen(urllib.request.Request(api, headers={"Accept": "application/vnd.github+json"}),
                                        timeout=10) as r:
                return _json.load(r)
    try:
        runs = fetch().get("workflow_runs") or []
    except Exception:  # noqa: BLE001 — not knowing is not failing
        return None
    return [str(r.get("name") or r.get("id")) for r in runs if r.get("status") == "completed" and r.get("conclusion") == "failure"]

def ship(message: str | None, dry_run: bool, wait_minutes: float, poll_seconds: float, gates=run_gates) -> int:
    git("fetch", "-q", "origin", BRANCH, "main")
    if git("rev-parse", "--abbrev-ref", "HEAD").strip() == "main":
        raise ReleaseError("on main: the agent releases from agent-dev (main is written only by CI's channel sync)")
    if subprocess.run(["git", "merge-base", "--is-ancestor", f"origin/{BRANCH}", "HEAD"], cwd=ROOT).returncode != 0:
        raise ReleaseError(f"HEAD does not contain origin/{BRANCH}: pull it first, a push would not fast-forward")
    unstaged = git("diff", "--name-only").strip()
    if unstaged:
        raise ReleaseError("unstaged changes in tracked files: stage what ships (by name) or stash the rest\n  "
                           + unstaged.replace("\n", "\n  "))
    staged = git("diff", "--cached", "--name-only").split()
    if APP_CHANGELOG not in staged:
        raise ReleaseError(f"{APP_CHANGELOG} is not staged: its new top entry is what names the version")
    app_now = yaml_version(git("show", f"HEAD:{APP_CONFIG}"), APP_CONFIG)
    app = _newer(APP_CHANGELOG, app_now, "app")
    engine_changed = any(f.startswith(ENGINE_DIR) and f != ENGINE_CHANGELOG for f in staged)
    engine = None
    if engine_changed:
        if ENGINE_CHANGELOG not in staged:
            raise ReleaseError(f"this release changes {ENGINE_DIR} but {ENGINE_CHANGELOG} is not staged: "
                               "the engine's own entry names its version")
        engine = _newer(ENGINE_CHANGELOG, yaml_version(git("show", f"HEAD:{ENGINE_MANIFEST}"), ENGINE_MANIFEST), "engine")
    if published_version() == app:
        raise ReleaseError(f"{app} is already published")

    print(f"{APP}: app {app_now} → {app}" + (f", engine → {engine}" if engine else ", engine unchanged")
          + f"  (branch {BRANCH}, channel {CHANNEL_DIR}/ on main)")
    print("  ships: " + ", ".join(staged))
    if dry_run:
        sites = [APP_CONFIG] + ([ENGINE_MANIFEST, ENGINE_INIT] if engine else [])
        print(f"  dry run: would write versions to {', '.join(sites)}; run {len(GATES)} gates; "
              f"commit; push HEAD:{BRANCH}; wait ≤ {wait_minutes:g} min for main")
        return 0
    if not message:
        raise ReleaseError("a commit message is needed (-m or -F)")

    # 1. The versions, everywhere they are written.
    (ROOT / APP_CONFIG).write_text(with_yaml_version((ROOT / APP_CONFIG).read_text(), app))
    git("add", APP_CONFIG)
    if engine:
        (ROOT / ENGINE_MANIFEST).write_text(with_yaml_version((ROOT / ENGINE_MANIFEST).read_text(), engine))
        (ROOT / ENGINE_INIT).write_text(with_init_version((ROOT / ENGINE_INIT).read_text(), engine))
        git("add", ENGINE_MANIFEST, ENGINE_INIT)

    # 2. Every gate, on exactly what will be committed.
    if not print_summary(gates()):
        raise ReleaseError("a gate failed: nothing committed. Fix, stage, and run ship again (the versions are already written)")

    # 3. Commit and push.
    subprocess.run(["git", "commit", "-q", "-F", "-"], cwd=ROOT, input=message, text=True, check=True)
    print(git("log", "-1", "--format=  committed %h %s").rstrip())
    git("push", "-q", "origin", f"HEAD:{BRANCH}")
    print(f"  pushed to {BRANCH}; waiting for CI to publish {CHANNEL_DIR}/ on main…")

    # 4. Published, or say plainly that it is not.
    deadline = time.monotonic() + wait_minutes * 60
    sha = git("rev-parse", "HEAD").strip()
    polls = 0
    while time.monotonic() < deadline:
        if published_version() == app:
            print(f"✅ PUBLISHED: Home Assistant offers {APP} {app}")
            return 0
        # a red run is said at once, not waited out (every third poll: the API allows 60 calls an hour)
        polls += 1
        failed = ci_failures(sha) if polls % 3 == 0 else None
        if failed:
            print(f"❌ pushed, NOT published: CI failed ({', '.join(failed)}) for {sha[:8]}. Read that run, fix, ship again.")
            return 3
        time.sleep(poll_seconds)
    print(f"⏳ pushed, NOT published after {wait_minutes:g} min: main's {CHANNEL_DIR}/ is still "
          f"{published_version()}. Read the CI run for this commit before calling it shipped.")
    return 3


def main(argv: list[str] | None = None) -> int:
    # Line by line even into a file or a pipe: a release watched through its log must show where it is.
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(prog="release.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gates", help="run every gate CI runs")
    s = sub.add_parser("ship", help="versions → gates → commit → push → wait until published")
    s.add_argument("-m", "--message")
    s.add_argument("-F", "--file", help="read the commit message from a file")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--wait", type=float, default=40, help="minutes to wait for main (default 40: a multi-arch image)")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "gates":
            return 0 if print_summary(run_gates()) else 1
        message = Path(a.file).read_text() if a.file else a.message
        return ship(message, a.dry_run, a.wait, poll_seconds=10)
    except ReleaseError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
