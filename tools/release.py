#!/usr/bin/env python3
"""The VESTA Kiosk's release: `gates`, `ship` and `backport`.

    python3 tools/release.py gates                    # every check (what CI runs), then a summary
    python3 tools/release.py ship -F msg.txt          # version, build, commit, push dev2, wait until published
    python3 tools/release.py backport --owner-asked   # merge dev2 into main, wait for main's build

The top `## x.y.z` heading of villa-kiosk/CHANGELOG.md is the version; `ship` copies it into package.json,
villa-kiosk/config.yaml and the lockfile. CI is the gate: build.yaml runs `gates` before it builds and publishes the
image. Home Assistant reads manifests from main only, so `ship` exits 0 once CI has written the channel's manifest
there naming the version (3: pushed, not published yet; 2: refused, nothing pushed).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"

BRANCH = "dev2"
CHANNEL_DIR = "villa-kiosk-dev2"      # written on main by build.yaml's sync-dev2-manifest
CHANGELOG = "villa-kiosk/CHANGELOG.md"
CONFIG = "villa-kiosk/config.yaml"
PACKAGE = "package.json"
LOCKFILE = "package-lock.json"
PROXY = "rootfs/usr/bin/supervisor-proxy.py"
BUILD = ("Types and bundle", ["npm", "run", "build"])
HARD_RULES = ("The two hard rules", ["npm", "run", "test:hard-rules:ci"])
# Deliberately untracked inputs: run where they exist.
PLAINTEXT_RULES = (".scratch/forbidden-tokens.txt", ("The hard rules, plaintext list", ["npm", "run", "test:hard-rules"]))
SECURITY = (".scratch/security/security_test.py",
            ("The proxy's security suite", [sys.executable, ".scratch/security/security_test.py"]))

GATES: list[tuple[str, list[str]]] = [
    BUILD,
    ("Oracles", ["npm", "run", "test:oracles"]),
    HARD_RULES,
    ("The proxy's security rules", ["npm", "run", "test:proxy"]),
    ("The path lists agree", ["npm", "run", "test:routes"]),
    ("The add-on manifest agrees", ["npm", "run", "test:manifest"]),
    ("Home Assistant's add-on checks", ["npm", "run", "test:addon-lint"]),
    ("The crash-loop rule", ["npm", "run", "test:service-finish"]),
    ("The proxy parses", ["npm", "run", "test:proxy-parse"]),
    ("The release module", ["npm", "run", "test:release"]),
]


class ReleaseError(RuntimeError):
    pass


def local(*extras: tuple[str, tuple[str, list[str]]]) -> list[tuple[str, list[str]]]:
    return [gate for need, gate in extras if (ROOT / need).exists()]


def run_gate(name: str, cmd: list[str]) -> bool:
    """One check; its output shown when it fails (always in CI, inside a log group)."""
    print(f"::group::{name}" if IN_CI else f"── {name}", flush=True)
    p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if IN_CI or p.returncode:
        sys.stdout.write(p.stdout)
    if IN_CI:
        print("::endgroup::", flush=True)
        if p.returncode:
            print(f"::error title={name}::failed (exit {p.returncode})", flush=True)
    return p.returncode == 0


def run_all(plan: list[tuple[str, list[str]]]) -> bool:
    """Every check, even after a red one; then which failed."""
    failed = [name for name, cmd in plan if not run_gate(name, cmd)]
    print(f"❌ failed: {', '.join(failed)}" if failed else f"✅ all {len(plan)} pass")
    return not failed


def ship_checks(staged: list[str]) -> list[tuple[str, list[str]]]:
    """What ship runs before committing: the build, the hard rules (they scan what is staged), and the security suite
    when the proxy is staged. Everything else is CI's."""
    return [BUILD, HARD_RULES] + local(PLAINTEXT_RULES) + (local(SECURITY) if PROXY in staged else [])


# ── versions ─────────────────────────────────────────────────────────────────
def parse_version(v: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        raise ReleaseError(f"{v!r} is not a version (x.y.z)")
    return tuple(int(x) for x in v.split("."))


def changelog_version(text: str) -> str:
    m = re.search(r"^## (\S+)", text, re.M)
    if not m:
        raise ReleaseError(f"{CHANGELOG} has no `## x.y.z` entry")
    return m.group(1)


def config_version(text: str) -> str:
    m = re.search(r'^version:\s*"?([^"\s]+)"?\s*$', text, re.M)
    if not m:
        raise ReleaseError(f"{CONFIG} has no version line")
    return m.group(1)


def with_config_version(text: str, version: str) -> str:
    return re.sub(r'^(version:\s*)"?[^"\s]+"?', lambda m: f'{m.group(1)}"{version}"', text, count=1, flags=re.M)


def with_package_version(text: str, version: str) -> str:
    # The one line, not json.dumps: the file keeps its formatting.
    new, n = re.subn(r'^(  "version":\s*)"[^"]*"', lambda m: f'{m.group(1)}"{version}"', text, count=1, flags=re.M)
    if n != 1:
        raise ReleaseError(f'{PACKAGE} has no top-level "version"')
    return new


# ── git and GitHub ───────────────────────────────────────────────────────────
def git(*args: str, cwd: Path | None = None, check: bool = True, env: dict | None = None) -> str:
    p = subprocess.run(["git", *args], cwd=cwd or ROOT, capture_output=True, text=True, env=env)
    if check and p.returncode:
        raise ReleaseError(f"git {' '.join(args)}: {(p.stderr or p.stdout).strip()}")
    return p.stdout


def published_version() -> str | None:
    """The version Home Assistant is offered on the dev2 channel: its manifest on origin/main."""
    git("fetch", "-q", "origin", "main")
    p = subprocess.run(["git", "show", f"origin/main:{CHANNEL_DIR}/config.yaml"], cwd=ROOT, capture_output=True,
                       text=True)
    return config_version(p.stdout) if p.returncode == 0 else None


def ci_state(sha: str) -> str:
    """"success" | "failure" | "pending" | "unknown": the CI runs of `sha` (the repository is public)."""
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?$", git("remote", "get-url", "origin").strip())
    if not m:
        return "unknown"
    api = f"https://api.github.com/repos/{m.group(1)}/{m.group(2)}/actions/runs?head_sha={sha}&per_page=20"
    try:
        req = urllib.request.Request(api, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            runs = json.load(r).get("workflow_runs") or []
    except Exception:  # noqa: BLE001 — not knowing is not failing
        return "unknown"
    if any(r.get("conclusion") == "failure" for r in runs):
        return "failure"
    return "success" if runs and all(r.get("status") == "completed" for r in runs) else "pending"


def wait_for(state, what: str, minutes: float, poll: float) -> int:
    """Poll `state()` ("published", "failure" or anything else) until published, failed or out of time."""
    deadline = time.monotonic() + minutes * 60
    while time.monotonic() < deadline:
        s = state()
        if s == "published":
            print(f"✅ PUBLISHED: {what}")
            return 0
        if s == "failure":
            print("❌ pushed, NOT published: CI failed. Read the run, fix, ship again.")
            return 3
        time.sleep(poll)
    print(f"⏳ pushed, NOT published after {minutes:g} min: read the CI run.")
    return 3


# ── ship ─────────────────────────────────────────────────────────────────────
def ship(message: str | None, dry_run: bool, wait_minutes: float, poll: float = 15,
         checks=ship_checks, ci=ci_state) -> int:
    git("fetch", "-q", "origin", BRANCH)
    if git("rev-parse", "--abbrev-ref", "HEAD").strip() == "main":
        raise ReleaseError("on main: releases go from dev2 (main changes only by the owner's backport)")
    if subprocess.run(["git", "merge-base", "--is-ancestor", f"origin/{BRANCH}", "HEAD"], cwd=ROOT).returncode:
        raise ReleaseError(f"HEAD does not contain origin/{BRANCH}: pull first")
    if git("diff", "--name-only").strip():
        raise ReleaseError("unstaged changes in tracked files: stage what ships (by name) or stash the rest")
    staged = git("diff", "--cached", "--name-only").split()
    if CHANGELOG not in staged:
        raise ReleaseError(f"{CHANGELOG} is not staged: its new top entry names the version")
    current = config_version(git("show", f"HEAD:{CONFIG}"))
    version = changelog_version((ROOT / CHANGELOG).read_text())
    if parse_version(version) <= parse_version(current):
        raise ReleaseError(f"the changelog's top entry is {version}, not above {current}: add the entry at the TOP")
    plan = checks(staged)
    print(f"VESTA (dev2): {current} → {version}; ships {', '.join(staged)}")
    if dry_run:
        print(f"  dry run: write the version, run {', '.join(n for n, _ in plan)}, commit, push {BRANCH}, "
              f"wait ≤ {wait_minutes:g} min for {CHANNEL_DIR}/ on main")
        return 0
    if not message:
        raise ReleaseError("a commit message is needed (-m or -F)")

    (ROOT / PACKAGE).write_text(with_package_version((ROOT / PACKAGE).read_text(), version))
    (ROOT / CONFIG).write_text(with_config_version((ROOT / CONFIG).read_text(), version))
    if (ROOT / LOCKFILE).exists():
        p = subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
                           cwd=ROOT, capture_output=True, text=True)
        if p.returncode:
            raise ReleaseError("npm install --package-lock-only failed:\n" + p.stderr[-1500:])
        git("add", LOCKFILE)
    git("add", PACKAGE, CONFIG)

    if not run_all(plan):
        raise ReleaseError("a check failed: nothing committed (the version is written; fix, stage, ship again)")
    subprocess.run(["git", "commit", "-q", "-F", "-"], cwd=ROOT, input=message, text=True, check=True)
    print(git("log", "-1", "--format=  committed %h %s").rstrip())
    git("push", "-q", "origin", f"HEAD:{BRANCH}")
    sha = git("rev-parse", "HEAD").strip()
    print(f"  pushed; CI checks, builds and publishes {CHANNEL_DIR}/ on main…")
    polls = [0]

    def state() -> str:
        if published_version() == version:
            return "published"
        polls[0] += 1
        return ci(sha) if polls[0] % 4 == 0 else "pending"   # the API allows 60 calls an hour

    return wait_for(state, f"Home Assistant offers VESTA (dev2) {version}", wait_minutes, poll)


# ── backport ─────────────────────────────────────────────────────────────────
def backport(owner_asked: bool, dry_run: bool, wait_minutes: float, poll: float = 30, ci=ci_state) -> int:
    """Merge origin/dev2 into origin/main in a temporary worktree. main's own folders (the channels CI writes there:
    on main, not on dev2) are kept; every other path must equal dev2's, which dev2's green CI already checked."""
    if not owner_asked:
        raise ReleaseError("main changes only when the owner asks: run with --owner-asked")
    git("fetch", "-q", "origin", BRANCH, "main")
    want = config_version(git("show", f"origin/{BRANCH}:{CONFIG}"))
    head = git("rev-parse", f"origin/{BRANCH}").strip()
    state = ci(head)
    print(f"backport {BRANCH} {want} ({head[:8]}, its CI: {state}) into main")
    if dry_run:
        return 0
    if state != "success":
        raise ReleaseError(f"{BRANCH}'s CI for {head[:8]} is {state}, not green: nothing merged")
    on = lambda ref: set(git("ls-tree", "--name-only", ref).split())
    keep = on("origin/main") - on(f"origin/{BRANCH}")
    wt = Path(tempfile.mkdtemp(prefix="backport-")) / "main"
    env = {**os.environ, "VK_ALLOW_MAIN": "1"}           # main's hooks: this child only
    git("worktree", "add", "-q", "--detach", str(wt), "origin/main")
    try:
        if subprocess.run(["git", "merge", "--no-ff", "--no-commit", f"origin/{BRANCH}"], cwd=wt,
                          capture_output=True).returncode:
            raise ReleaseError("the merge does not apply cleanly")
        stray = [f for f in git("diff", "--cached", "--name-only", f"origin/{BRANCH}", cwd=wt).split()
                 if f.split("/", 1)[0] not in keep]
        if stray:
            raise ReleaseError("the merged tree differs from dev2: " + ", ".join(stray[:10]))
        # build.yaml skips the gates for a commit whose subject starts "Backport dev2": keep the two in step.
        msg = f"Backport {BRANCH} {want} into main\n\nmain keeps its own {', '.join(sorted(keep)) or 'nothing'}.\n"
        subprocess.run(["git", "commit", "-q", "-F", "-"], cwd=wt, input=msg, text=True, env=env, check=True,
                       capture_output=True)
        sha = git("rev-parse", "HEAD", cwd=wt).strip()
        git("push", "-q", "origin", "HEAD:main", cwd=wt, env=env)
    finally:
        git("worktree", "remove", "--force", str(wt), check=False)
        shutil.rmtree(wt.parent, ignore_errors=True)
    print(f"  pushed {sha[:8]} to main; waiting for its build…")
    return wait_for(lambda: "published" if (s := ci(sha)) == "success" else s,
                    f"main is {want}, its image built", wait_minutes, poll)


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(prog="release.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gates", help="every check: what CI runs (off CI, also the untracked local ones)")
    s = sub.add_parser("ship", help="version, build, commit, push dev2, wait until published")
    s.add_argument("-m", "--message")
    s.add_argument("-F", "--file", help="read the commit message from a file")
    b = sub.add_parser("backport", help="merge dev2 into main (only when the owner asks)")
    b.add_argument("--owner-asked", action="store_true")
    for p in (s, b):
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--wait", type=float, default=30, help="minutes to wait (default 30)")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "gates":
            return 0 if run_all(GATES + ([] if IN_CI else local(PLAINTEXT_RULES, SECURITY))) else 1
        if a.cmd == "backport":
            return backport(a.owner_asked, a.dry_run, a.wait)
        return ship(Path(a.file).read_text() if a.file else a.message, a.dry_run, a.wait)
    except ReleaseError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
