#!/usr/bin/env python3
"""tools/release.py, driven through its interface — `ship` in a throwaway repository.

The release module's promise is a single exit status: 0 means Home Assistant
offers the version. These checks run a real `ship` against a temporary git
repository with its own bare "origin", a stand-in for CI that publishes the
channel manifest on main, and gates that pass or fail on demand — so the
refusals, the version sites, the gates' veto and the wait are all exercised
for real, not read from the source.

Run: python3 tests/release.py   (also one of `release.py gates`)
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release", HERE / "tools" / "release.py")
release = importlib.util.module_from_spec(spec)
sys.modules["release"] = release   # a dataclass looks its module up while it is created
spec.loader.exec_module(release)

FAIL = 0


def ck(name: str, ok: bool, detail: object = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}{'' if ok or detail == '' else f'  →  {detail}'}")
    if not ok:
        FAIL += 1


def sh(cwd: Path, *cmd: str) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout


# ── the rules, by value ──────────────────────────────────────────────────────
print("  the version rules:")
ck("the changelog's FIRST `## x.y.z` names the version",
   release.changelog_version("## 2.4.9\n\n### Changed\n- x\n\n## 2.4.8\n") == "2.4.9")
ck("versions compare as numbers (2.496.10 > 2.496.9)",
   release.parse_version("2.496.10") > release.parse_version("2.496.9"))
try:
    release.parse_version("2.496")
    ck("a malformed version is refused", False)
except release.ReleaseError:
    ck("a malformed version is refused", True)
cfg = 'name: "VESTA"\nversion: "1.2.3"\nslug: x\n'
ck("config.yaml: only the version line moves",
   release.with_config_version(cfg, "1.2.4") == 'name: "VESTA"\nversion: "1.2.4"\nslug: x\n')
pkg = '{\n  "name": "v",\n  "version": "1.2.3",\n  "dependencies": {\n    "x": {\n      "version": "9"\n    }\n  }\n}\n'
ck("package.json: only the top-level version moves, formatting kept",
   release.with_package_version(pkg, "1.2.4") == pkg.replace('"1.2.3"', '"1.2.4"'))
lock = {"name": "v", "version": "1.2.3", "packages": {"": {"version": "1.2.3"}, "node_modules/a": {"version": "1.0.0"}}}
moved = json.loads(json.dumps(lock)); moved["version"] = moved["packages"][""]["version"] = "1.2.4"
ck("lockfile: the two version fields moving is no drift", release.lockfile_drift(json.dumps(lock), json.dumps(moved), "1.2.4") == [])
moved["packages"]["node_modules/a"]["version"] = "1.0.1"
ck("lockfile: a dependency moving with it is drift, named",
   release.lockfile_drift(json.dumps(lock), json.dumps(moved), "1.2.4") == ["node_modules/a"])


# ── ship, end to end, in a throwaway repository ──────────────────────────────
def sandbox(tmp: Path) -> Path:
    origin, repo = tmp / "origin.git", tmp / "repo"
    sh(tmp, "git", "init", "-q", "--bare", "-b", "main", str(origin))
    sh(tmp, "git", "init", "-q", "-b", "main", str(repo))
    for k, v in (("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false")):
        sh(repo, "git", "config", k, v)
    (repo / "villa-kiosk").mkdir()
    (repo / "villa-kiosk/config.yaml").write_text('name: "VESTA"\nversion: "1.0.0"\n')
    (repo / "villa-kiosk/CHANGELOG.md").write_text("## 1.0.0\n\n- first\n")
    (repo / "package.json").write_text('{\n  "name": "sandbox",\n  "version": "1.0.0",\n  "private": true\n}\n')
    (repo / ".npmrc").write_text("legacy-peer-deps=false\n")
    sh(repo, "npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund")
    (repo / "villa-kiosk-dev2").mkdir()
    (repo / "villa-kiosk-dev2/config.yaml").write_text('version: "1.0.0"\n')
    sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", "start")
    sh(repo, "git", "remote", "add", "origin", str(origin))
    sh(repo, "git", "push", "-q", "origin", "main", "main:dev2")
    sh(repo, "git", "checkout", "-q", "-b", "work", "origin/dev2")
    return repo


def fake_ci(origin_repo: Path, after: str, version: str, stop: threading.Event) -> None:
    """CI's sync job: once `after` is on dev2, commit the channel manifest naming `version` to main."""
    work = origin_repo.parent / "ci"
    sh(origin_repo.parent, "git", "clone", "-q", str(origin_repo.parent / "origin.git"), str(work))
    for k, v in (("user.name", "ci"), ("user.email", "ci@ci")):
        sh(work, "git", "config", k, v)
    while not stop.is_set():
        sh(work, "git", "fetch", "-q", "origin")
        if subprocess.run(["git", "merge-base", "--is-ancestor", after, "origin/dev2"], cwd=work,
                          capture_output=True).returncode == 0:
            sh(work, "git", "checkout", "-q", "-B", "main", "origin/main")
            (work / "villa-kiosk-dev2/config.yaml").write_text(f'version: "{version}"\n')
            sh(work, "git", "commit", "-qam", f"publish {version}")
            sh(work, "git", "push", "-q", "origin", "main")
            return
        time.sleep(0.1)


def run_ship(repo: Path, message="release", gates_ok=True, wait=0.2, dry=False):
    release.ROOT = repo
    calls = []

    def gates():
        calls.append(1)
        return [release.GateResult("stub", "pass" if gates_ok else "FAIL")]
    try:
        code = release.ship(message, dry, wait_minutes=wait, poll_seconds=0.05, gates=gates)
        return code, calls, ""
    except release.ReleaseError as e:
        return None, calls, str(e)


print("\n  ship, in a throwaway repository:")
with tempfile.TemporaryDirectory() as t:
    repo = sandbox(Path(t))

    code, calls, err = run_ship(repo)
    ck("refused when the changelog is not staged", code is None and "not staged" in err, err)

    (repo / "villa-kiosk/CHANGELOG.md").write_text("## 1.0.0\n\n- again\n\n## 1.0.0\n")
    sh(repo, "git", "add", "villa-kiosk/CHANGELOG.md")
    code, calls, err = run_ship(repo)
    ck("refused when the top entry is not above the released version", code is None and "not above" in err, err)

    (repo / "villa-kiosk/CHANGELOG.md").write_text("## 1.0.1\n\n- the change\n\n## 1.0.0\n\n- first\n")
    sh(repo, "git", "add", "villa-kiosk/CHANGELOG.md")
    (repo / "villa-kiosk/config.yaml").write_text('name: "VESTA (edited)"\nversion: "1.0.0"\n')
    code, calls, err = run_ship(repo)
    ck("refused while a tracked file has unstaged changes (it would ship untested or not at all)",
       code is None and "unstaged" in err and "config.yaml" in err, err)
    sh(repo, "git", "checkout", "--", "villa-kiosk/config.yaml")

    code, calls, err = run_ship(repo, dry=True)
    ck("a dry run changes nothing and runs no gate",
       code == 0 and not calls and json.loads((repo / "package.json").read_text())["version"] == "1.0.0", err)

    code, calls, err = run_ship(repo, gates_ok=False)
    head = sh(repo, "git", "rev-parse", "HEAD")
    ck("a failing gate stops it before the commit: nothing committed, nothing pushed",
       code is None and "gate failed" in err and sh(repo, "git", "rev-parse", "origin/dev2") == head, err)
    ck("  ...and the version is already written everywhere, so a rerun resumes",
       json.loads((repo / "package.json").read_text())["version"] == "1.0.1"
       and json.loads((repo / "package-lock.json").read_text())["packages"][""]["version"] == "1.0.1"
       and 'version: "1.0.1"' in (repo / "villa-kiosk/config.yaml").read_text())

    code, calls, err = run_ship(repo, wait=0.05)
    ck("pushed but CI has not published: exit 3, never 0", code == 3, (code, err))
    pushed = sh(repo, "git", "rev-parse", "HEAD").strip()
    ck("  ...the commit holds the changelog and every version site",
       set(sh(repo, "git", "show", "--name-only", "--format=", pushed).split())
       == {"villa-kiosk/CHANGELOG.md", "villa-kiosk/config.yaml", "package.json", "package-lock.json"})
    ck("  ...and it is on origin/dev2", sh(repo, "git", "rev-parse", "origin/dev2").strip() == pushed)

    (repo / "villa-kiosk/CHANGELOG.md").write_text("## 1.0.2\n\n- next\n\n" + (repo / "villa-kiosk/CHANGELOG.md").read_text())
    sh(repo, "git", "add", "villa-kiosk/CHANGELOG.md")
    stop = threading.Event()
    ci = threading.Thread(target=lambda: None)
    def publish_when_pushed():
        while not stop.is_set():
            out = subprocess.run(["git", "--git-dir", str(Path(t) / "origin.git"), "log", "-1", "--format=%s", "dev2"],
                                 capture_output=True, text=True).stdout
            if "second" in out:
                fake_ci(repo, "origin/dev2", "1.0.2", stop); return
            time.sleep(0.05)
    ci = threading.Thread(target=publish_when_pushed); ci.start()
    code, calls, err = run_ship(repo, message="second", wait=0.5)
    stop.set(); ci.join()
    ck("published: exit 0 only once main's channel manifest names the version", code == 0 and calls, (code, err))

    sh(repo, "git", "checkout", "-q", "-B", "main", "origin/main")
    code, calls, err = run_ship(repo)
    ck("refused on main: this app releases from dev2", code is None and "on main" in err, err)

print("\n  the one gate list:")
import re
runs = [m.strip() for m in re.findall(r"^\s+run:\s*(.+)$", (HERE / ".github/workflows/ci.yaml").read_text(), re.M)]
ck("CI runs the gates through this module, and none of its own (its run: lines are setup + this)",
   runs == ["npm ci --no-audit --no-fund", "python3 -m pip install --quiet aiohttp", "python3 tools/release.py gates"], runs)
pkg_json = json.loads((HERE / "package.json").read_text())
ck("every gate's npm script exists", all(c[2] in pkg_json["scripts"] for _, c in release.GATES if c[:2] == ["npm", "run"]),
   [c for _, c in release.GATES if c[:2] == ["npm", "run"] and c[2] not in pkg_json["scripts"]])
ck("package.json's gates/ship call this module, and no script points at an untracked file",
   pkg_json["scripts"].get("gates", "").startswith("python3 tools/release.py gates")
   and pkg_json["scripts"].get("ship", "").startswith("python3 tools/release.py ship")
   and "preflight" not in pkg_json["scripts"])
ck("the module is tracked (tools/ is not ignored)",
   subprocess.run(["git", "check-ignore", "-q", "tools/release.py"], cwd=HERE).returncode == 1)

# ship says a red CI run at once (2026-10-05: it waited out the full --wait)
red = {"workflow_runs": [{"name": "Build", "status": "completed", "conclusion": "failure"},
                         {"name": "CI", "status": "in_progress", "conclusion": None},
                         {"name": "Old", "status": "completed", "conclusion": "success"}]}
ck("a failed run for the pushed commit is named; a running or green one is not",
   release.ci_failures("x", fetch=lambda: red) == ["Build"])
ck("  ...and GitHub unreachable is not a failure (the wait goes on)",
   release.ci_failures("x", fetch=lambda: (_ for _ in ()).throw(OSError("offline"))) is None)
ck("ship polls every 10 s", "poll_seconds=10)" in (HERE / "tools/release.py").read_text())

print(f"\n{'❌ ' + str(FAIL) + ' failed' if FAIL else '✅ the release is one module, and its exit status means published'}")
sys.exit(1 if FAIL else 0)
