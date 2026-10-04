#!/usr/bin/env python3
"""The VESTA Kiosk's release, as one module: `gates` and `ship`.

    python3 tools/release.py gates              # every gate CI runs, all of them, then a summary
    python3 tools/release.py ship -F msg.txt    # version → gates → commit → push → published
    python3 tools/release.py ship --dry-run     # what ship would do, changing nothing

⚠️ THE RELEASE WAS A PROCEDURE, NOT A MODULE (2.496.249). Its knowledge lived in
CLAUDE.md, in an assistant's memory and in a `preflight` script package.json
pointed at but git never tracked: five version sites edited by hand, a lockfile
moved by `npm install`, the CI gate chain retyped (`&&`-joined, or a failing
gate let the commit through), and "published" judged by polling main for a
folder name remembered from last time. A local `tests/ship.sh` once did the
push-and-wait half; it was gitignored, and lost.

THE CHANGELOG NAMES THE VERSION. The one thing a release needs a person for is
saying what changed; the top `## x.y.z` heading of villa-kiosk/CHANGELOG.md is
therefore the only place a version is written by hand. `ship` copies it into
package.json, villa-kiosk/config.yaml and the lockfile.

"SHIPPED" MEANS PUBLISHED. Home Assistant reads add-on manifests from the
DEFAULT branch only; a green push is not a release until CI has committed the
channel's manifest to main naming the version. `ship` exits 0 only then.

GATES ARE LISTED HERE ONCE. .github/workflows/ci.yaml runs `gates`; so does
`ship`; so does a developer. Every gate runs even after one fails (a red wall
hid failures behind the first, three releases running), and the summary names
each. Under GitHub Actions each gate is a log group and a failure an annotation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"

# ── What this app is ──────────────────────────────────────────────────────────
APP = "VESTA (dev2)"
BRANCH = "dev2"                       # the only branch this app releases from
CHANNEL_DIR = "villa-kiosk-dev2"      # what CI writes on main for BRANCH (build.yaml sync-dev2-manifest)
CHANGELOG = "villa-kiosk/CHANGELOG.md"
CONFIG = "villa-kiosk/config.yaml"
PACKAGE = "package.json"
LOCKFILE = "package-lock.json"

# ── The gates: CI's list, in CI's order ───────────────────────────────────────
GATES: list[tuple[str, list[str]]] = [
    ("Types and bundle", ["npm", "run", "build"]),
    ("Oracles", ["npm", "run", "test:oracles"]),
    # The hash path: the only one a checkout has (the plaintext list is gitignored).
    ("The two hard rules", ["npm", "run", "test:hard-rules:ci"]),
    ("The proxy's security rules", ["npm", "run", "test:proxy"]),
    ("The path lists agree", ["npm", "run", "test:routes"]),
    ("The add-on manifest agrees", ["npm", "run", "test:manifest"]),
    ("The proxy parses", ["npm", "run", "test:proxy-parse"]),
    ("The release module", ["npm", "run", "test:release"]),
]

# Gates whose input is deliberately NOT in git: run where it exists, and SAID
# when it does not — never a silent pass.
LOCAL_GATES: list[tuple[str, list[str], str]] = [
    ("The two hard rules, plaintext list", ["npm", "run", "test:hard-rules"], ".scratch/forbidden-tokens.txt"),
    ("The proxy's security suite", [sys.executable, ".scratch/security/security_test.py"], ".scratch/security/security_test.py"),
]


@dataclass
class GateResult:
    name: str
    status: str            # "pass" | "FAIL" | "not here"
    seconds: float = 0.0
    note: str = ""


def run_gates(only_ci: bool = IN_CI) -> list[GateResult]:
    """Run every gate, even after a failure; return what each did."""
    plan = [(n, c, None) for n, c in GATES]
    if not only_ci:
        plan += [(n, c, need) for n, c, need in LOCAL_GATES]
    results: list[GateResult] = []
    for name, cmd, need in plan:
        if need and not (ROOT / need).exists():
            results.append(GateResult(name, "not here", note=f"{need} is not on this machine"))
            continue
        if IN_CI:
            print(f"::group::{name}", flush=True)
        else:
            print(f"\n═══ {name} ═══", flush=True)
        start = time.monotonic()
        proc = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        out = proc.stdout or ""
        sys.stdout.write(out)
        took = time.monotonic() - start
        if IN_CI:
            print("::endgroup::", flush=True)
        if proc.returncode == 0:
            results.append(GateResult(name, "pass", took))
        else:
            results.append(GateResult(name, "FAIL", took, f"exit {proc.returncode}"))
            if IN_CI:
                # The job log needs a signed-in account; an annotation does not.
                for line in _failure_lines(out):
                    print(f"::error title={name}::{line}", flush=True)
    return results


def _failure_lines(out: str) -> list[str]:
    pick = [l.strip() for l in out.splitlines()
            if re.search(r"FAIL|Error:|error TS\d+|AssertionError|Traceback|❌", l)]
    return [l[:300] for l in pick[:8]] or ["failed (see the log group above)"]


def print_summary(results: list[GateResult]) -> bool:
    print("\n── gates ─────────────────────────────────────────")
    for r in results:
        mark = {"pass": "✅", "FAIL": "❌", "not here": "⚪"}[r.status]
        extra = f"  {r.note}" if r.note else ""
        print(f"  {mark} {r.status:<8} {r.name}{f'  ({r.seconds:.0f} s)' if r.seconds else ''}{extra}")
    failed = [r for r in results if r.status == "FAIL"]
    print(f"── {len(failed)} failed of {len(results)}" if failed else "── all gates pass")
    return not failed


# ── Versions ─────────────────────────────────────────────────────────────────
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def parse_version(v: str) -> tuple[int, int, int]:
    if not VERSION.match(v):
        raise ReleaseError(f"{v!r} is not a version (x.y.z)")
    a, b, c = (int(x) for x in v.split("."))
    return a, b, c


def changelog_version(text: str) -> str:
    """The version the changelog's top entry names: its first `## x.y.z` heading."""
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
    return re.sub(r'^(version:\s*)"?[^"\s]+"?(\s*)$', lambda m: f'{m.group(1)}"{version}"{m.group(2)}', text, count=1, flags=re.M)


def with_package_version(text: str, version: str) -> str:
    # Rewrite the one line, not the document: json.dumps would reformat the file.
    new, n = re.subn(r'^(  "version":\s*)"[^"]*"', lambda m: f'{m.group(1)}"{version}"', text, count=1, flags=re.M)
    if n != 1:
        raise ReleaseError(f"{PACKAGE} has no top-level \"version\"")
    return new


def lockfile_drift(before: str, after: str, version: str) -> list[str]:
    """What `npm install --package-lock-only` changed BESIDES the two version fields.

    ⚠️ A developer machine's ~/.npmrc once rewrote every lockfile (legacy-peer-deps),
    and `npm ci` failed only on the runner for 185 releases. A version bump must
    move exactly the root version and packages[""].version."""
    a, b = json.loads(before), json.loads(after)
    if b.get("version") != version or b.get("packages", {}).get("", {}).get("version") != version:
        return ["the lockfile's own version did not move to " + version]
    a["version"] = b["version"]
    a.setdefault("packages", {}).setdefault("", {})["version"] = version
    if a == b:
        return []
    changed = sorted(k for k in set(a.get("packages", {})) | set(b.get("packages", {}))
                     if a.get("packages", {}).get(k) != b.get("packages", {}).get(k))
    return changed[:10] or ["the lockfile changed outside its packages"]


# ── git ──────────────────────────────────────────────────────────────────────
class ReleaseError(RuntimeError):
    pass


def git(*args: str, check: bool = True) -> str:
    for attempt in range(4):
        p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
        # Worktrees share one set of remote refs: a fetch running in another (the Agent's own ship)
        # holds their lock for a moment. Wait it out rather than fail the release (seen 2026-10-02).
        if not (args[0] == "fetch" and "cannot lock ref" in p.stderr) or attempt == 3:
            break
        time.sleep(2 + attempt * 3)
    if check and p.returncode != 0:
        raise ReleaseError(f"git {' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


def published_version() -> str | None:
    """The version Home Assistant is offered: the channel manifest on origin/main."""
    git("fetch", "-q", "origin", "main")
    p = subprocess.run(["git", "show", f"origin/main:{CHANNEL_DIR}/config.yaml"], cwd=ROOT, capture_output=True, text=True)
    return config_version(p.stdout) if p.returncode == 0 else None


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

def ship(message: str | None, dry_run: bool, wait_minutes: float, poll_seconds: float,
         gates=run_gates) -> int:
    git("fetch", "-q", "origin", BRANCH, "main")
    if git("rev-parse", "--abbrev-ref", "HEAD").strip() == "main":
        raise ReleaseError("on main: this app releases from dev2 (main advances only by the owner's backport)")
    if subprocess.run(["git", "merge-base", "--is-ancestor", f"origin/{BRANCH}", "HEAD"], cwd=ROOT).returncode != 0:
        raise ReleaseError(f"HEAD does not contain origin/{BRANCH}: pull it first, a push would not fast-forward")
    if git("diff", "--name-only").strip():
        raise ReleaseError("unstaged changes in tracked files: stage what ships (by name) or stash the rest\n  "
                           + git("diff", "--name-only").strip().replace("\n", "\n  "))
    staged = git("diff", "--cached", "--name-only").split()
    if CHANGELOG not in staged:
        raise ReleaseError(f"{CHANGELOG} is not staged: its new top entry is what names the version")

    current = config_version(git("show", f"HEAD:{CONFIG}"))
    version = changelog_version((ROOT / CHANGELOG).read_text())
    if parse_version(version) <= parse_version(current):
        raise ReleaseError(f"the changelog's top entry is {version}, not above the released {current}: "
                           "add the new entry at the TOP")
    if published_version() == version:
        raise ReleaseError(f"{version} is already published")
    untracked = [f for f in git("ls-files", "--others", "--exclude-standard", "src", "rootfs", "public").split()]

    print(f"{APP}: {current} → {version}  (branch {BRANCH}, channel {CHANNEL_DIR}/ on main)")
    print("  ships: " + ", ".join(staged))
    if untracked:
        print("  ⚠️ NOT staged, so NOT shipped (and invisible to the hard-rules scan): " + ", ".join(untracked))
    if dry_run:
        print(f"  dry run: would write {version} to {PACKAGE}, {CONFIG}, {LOCKFILE}; run {len(GATES)} gates; "
              f"commit; push HEAD:{BRANCH}; wait ≤ {wait_minutes:g} min for main")
        return 0
    if not message:
        raise ReleaseError("a commit message is needed (-m or -F)")

    # 1. The version, everywhere it is written.
    (ROOT / PACKAGE).write_text(with_package_version((ROOT / PACKAGE).read_text(), version))
    (ROOT / CONFIG).write_text(with_config_version((ROOT / CONFIG).read_text(), version))
    lock_before = git("show", f"HEAD:{LOCKFILE}")
    p = subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise ReleaseError("npm install --package-lock-only failed:\n" + p.stderr[-1500:])
    drift = lockfile_drift(lock_before, (ROOT / LOCKFILE).read_text(), version)
    if drift:
        raise ReleaseError("the lockfile moved more than its version (check ~/.npmrc and .npmrc): " + ", ".join(drift))
    git("add", PACKAGE, CONFIG, LOCKFILE)

    # 2. Every gate, on exactly what will be committed (nothing unstaged, checked above).
    if not print_summary(gates()):
        raise ReleaseError("a gate failed: nothing committed. Fix, stage, and run ship again (the version is already written)")

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
        if published_version() == version:
            print(f"✅ PUBLISHED: Home Assistant offers {APP} {version}")
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
    # Line by line even into a file or a pipe: 2.496.249's own ship, logged to a file, showed
    # nothing between the last gate and "PUBLISHED" — the summary sat in Python's buffer.
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(prog="release.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gates", help="run every gate CI runs (plus the local-only ones off CI)")
    g.add_argument("--ci-only", action="store_true", help="only CI's list, even off CI")
    s = sub.add_parser("ship", help="version → gates → commit → push → wait until published")
    s.add_argument("-m", "--message")
    s.add_argument("-F", "--file", help="read the commit message from a file")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--wait", type=float, default=30, help="minutes to wait for main (default 30)")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "gates":
            return 0 if print_summary(run_gates(only_ci=IN_CI or a.ci_only)) else 1
        message = Path(a.file).read_text() if a.file else a.message
        return ship(message, a.dry_run, a.wait, poll_seconds=10)
    except ReleaseError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
