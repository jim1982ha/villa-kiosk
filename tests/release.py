#!/usr/bin/env python3
"""tools/release.py smoke test: the version rules by value, and one `ship` in a throwaway repository with its own
bare origin and a stand-in for CI that publishes the channel manifest on main.

Run: python3 tests/release.py   (also one of `release.py gates`)
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release", HERE / "tools" / "release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
FAIL = 0


def ck(name: str, ok: bool, detail: object = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}{'' if ok else f'  →  {detail}'}")
    FAIL += not ok


def sh(cwd: Path, *cmd: str) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout


print("  the version rules:")
ck("the changelog's first `## x.y.z` names the version",
   release.changelog_version("## 2.4.9\n\n- x\n\n## 2.4.8\n") == "2.4.9")
ck("versions compare as numbers", release.parse_version("2.496.10") > release.parse_version("2.496.9"))
ck("config.yaml: only the version line moves",
   release.with_config_version('name: x\nversion: "1.2.3"\n', "1.2.4") == 'name: x\nversion: "1.2.4"\n')
pkg = '{\n  "name": "v",\n  "version": "1.2.3",\n  "dependencies": {\n    "x": {\n      "version": "9"\n    }\n  }\n}\n'
ck("package.json: only the top-level version moves",
   release.with_package_version(pkg, "1.2.4") == pkg.replace('"1.2.3"', '"1.2.4"', 1))
names = lambda staged: [n for n, _ in release.ship_checks(staged)]
ck("ship builds and runs the hard rules", names([])[:2] == ["Types and bundle", "The two hard rules"])
ck("  ...and the security suite only with the proxy staged",
   not any("security" in n for n in names(["src/a.ts"]))
   and (not (HERE / release.SECURITY[0]).exists() or any("security" in n for n in names([release.PROXY]))))

print("\n  ship, end to end:")
with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    origin, repo = tmp / "origin.git", tmp / "repo"
    sh(tmp, "git", "init", "-q", "--bare", "-b", "main", str(origin))
    sh(tmp, "git", "init", "-q", "-b", "main", str(repo))
    for k, v in (("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false"), ("core.hooksPath", "/dev/null")):
        sh(repo, "git", "config", k, v)
    (repo / "villa-kiosk").mkdir()
    (repo / "villa-kiosk-dev2").mkdir()
    (repo / "villa-kiosk/config.yaml").write_text('name: "VESTA"\nversion: "1.0.0"\n')
    (repo / "villa-kiosk/CHANGELOG.md").write_text("## 1.0.0\n\n- first\n")
    (repo / "villa-kiosk-dev2/config.yaml").write_text('version: "1.0.0"\n')
    (repo / "package.json").write_text('{\n  "name": "sandbox",\n  "version": "1.0.0",\n  "private": true\n}\n')
    sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", "start")
    sh(repo, "git", "remote", "add", "origin", str(origin))
    sh(repo, "git", "push", "-q", "origin", "main", "main:dev2")
    sh(repo, "git", "checkout", "-q", "-b", "work", "origin/dev2")
    release.ROOT = repo

    def ship(**kw):
        try:
            return release.ship("release 1.0.1", kw.get("dry", False), 0.3, poll=0.05,
                                checks=lambda staged: [], ci=lambda sha: "pending")
        except release.ReleaseError as e:
            return str(e)

    ck("refused when the changelog is not staged", "is not staged" in str(ship()))
    (repo / "villa-kiosk/CHANGELOG.md").write_text("## 1.0.1\n\n- second\n\n## 1.0.0\n\n- first\n")
    sh(repo, "git", "add", "villa-kiosk/CHANGELOG.md")
    ck("a dry run changes nothing", ship(dry=True) == 0 and "1.0.0" in (repo / "package.json").read_text())

    def fake_ci():   # CI's sync job: once dev2 names 1.0.1, write the channel manifest on main
        ci = tmp / "ci"
        sh(tmp, "git", "clone", "-q", str(origin), str(ci))
        for k, v in (("user.name", "ci"), ("user.email", "ci@ci")):
            sh(ci, "git", "config", k, v)
        for _ in range(100):
            sh(ci, "git", "fetch", "-q", "origin")
            if '"1.0.1"' in sh(ci, "git", "show", "origin/dev2:villa-kiosk/config.yaml"):
                sh(ci, "git", "checkout", "-q", "-B", "main", "origin/main")
                (ci / "villa-kiosk-dev2/config.yaml").write_text('version: "1.0.1"\n')
                sh(ci, "git", "commit", "-qam", "publish"); sh(ci, "git", "push", "-q", "origin", "main")
                return
            time.sleep(0.05)

    th = threading.Thread(target=fake_ci); th.start()
    code = ship(); th.join()
    ck("ship exits 0 once the manifest on main names the version", code == 0, code)
    on_dev2 = sh(repo, "git", "show", "origin/dev2:package.json") + sh(repo, "git", "show", "origin/dev2:villa-kiosk/config.yaml")
    ck("  ...with the version in package.json and config.yaml, pushed to dev2", on_dev2.count('"1.0.1"') == 2, on_dev2)

try:
    release.backport(False, True, 0)
    ck("backport refuses without --owner-asked", False)
except release.ReleaseError as e:
    ck("backport refuses without --owner-asked", "owner asks" in str(e), e)

print(f"\n{'✅ release module: all pass' if not FAIL else f'❌ release module: {FAIL} failed'}")
sys.exit(1 if FAIL else 0)
