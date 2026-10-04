"""agent-host/tools/release.py, driven through its interface — `ship` in a throwaway repository.

0 means Home Assistant offers the version: a real `ship` runs against a
temporary git repository with a bare "origin", a stand-in for CI that publishes
the channel manifest on main, and gates that pass or fail on demand.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("agent_release", HERE.parent / "tools" / "release.py")
release = importlib.util.module_from_spec(spec)
sys.modules["agent_release"] = release   # a dataclass looks its module up while it is created
spec.loader.exec_module(release)


def sh(cwd: Path, *cmd: str) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout


class Sandbox:
    def __init__(self, tmp: Path):
        self.tmp, self.origin, self.repo = tmp, tmp / "origin.git", tmp / "repo"
        sh(tmp, "git", "init", "-q", "--bare", "-b", "main", str(self.origin))
        sh(tmp, "git", "init", "-q", "-b", "main", str(self.repo))
        for k, v in (("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false")):
            sh(self.repo, "git", "config", k, v)
        self.write("vesta-agent/config.yaml", 'name: "VESTA Agent"\nversion: "1.0.0"\n')
        self.write("vesta-agent/CHANGELOG.md", "## 1.0.0\n\n- first\n")
        self.write("agent-host/agent-src/vesta-agent.yaml", 'name: vesta-agent\nversion: "0.5.0"\n')
        self.write("agent-host/agent-src/vesta_agent/__init__.py", '"""engine"""\n__version__ = "0.5.0"\n')
        self.write("agent-host/agent-src/CHANGELOG.md", "# Changelog\n\n## 0.5.0 (1 October 2026)\n\n- first\n")
        self.write("agent-host/agent-src/vesta_agent/app.py", "x = 1\n")
        self.write("vesta-agent-dev/config.yaml", 'version: "1.0.0"\n')
        sh(self.repo, "git", "add", "-A"); sh(self.repo, "git", "commit", "-q", "-m", "start")
        sh(self.repo, "git", "remote", "add", "origin", str(self.origin))
        sh(self.repo, "git", "push", "-q", "origin", "main", "main:agent-dev")
        sh(self.repo, "git", "checkout", "-q", "-b", "work", "origin/agent-dev")

    def write(self, rel: str, text: str) -> None:
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def read(self, rel: str) -> str:
        return (self.repo / rel).read_text()

    def stage(self, *rel: str) -> None:
        sh(self.repo, "git", "add", *rel)

    def ship(self, message="release", gates_ok=True, wait=0.05, dry=False):
        release.ROOT = self.repo
        calls = []

        def gates():
            calls.append(1)
            return [release.GateResult("stub", "pass" if gates_ok else "FAIL")]
        try:
            return release.ship(message, dry, wait_minutes=wait, poll_seconds=0.05, gates=gates), calls, ""
        except release.ReleaseError as e:
            return None, calls, str(e)

    def publish_when(self, subject: str, version: str, stop: threading.Event) -> None:
        """CI's sync job: once a commit with `subject` is on agent-dev, publish `version` on main."""
        work = self.tmp / "ci"
        sh(self.tmp, "git", "clone", "-q", str(self.origin), str(work))
        for k, v in (("user.name", "ci"), ("user.email", "ci@ci")):
            sh(work, "git", "config", k, v)
        while not stop.is_set():
            sh(work, "git", "fetch", "-q", "origin")
            if subject in sh(work, "git", "log", "-1", "--format=%s", "origin/agent-dev"):
                sh(work, "git", "checkout", "-q", "-B", "main", "origin/main")
                (work / "vesta-agent-dev/config.yaml").write_text(f'version: "{version}"\n')
                sh(work, "git", "commit", "-qam", f"publish {version}")
                sh(work, "git", "push", "-q", "origin", "main")
                return
            time.sleep(0.05)


class ReleaseRules(unittest.TestCase):
    def test_versions_are_named_by_the_changelogs_top_entry(self):
        self.assertEqual(release.changelog_version("# Changelog\n\n## 0.6.18 (2 Oct)\n\n## 0.6.17\n", "x"), "0.6.18")
        self.assertGreater(release.parse_version("0.12.10"), release.parse_version("0.12.9"))
        self.assertEqual(release.with_init_version('a\n__version__ = "0.1.0"\n', "0.2.0"), 'a\n__version__ = "0.2.0"\n')
        self.assertEqual(release.with_yaml_version('n: x\nversion: "1.0.0"\n', "1.0.1"), 'n: x\nversion: "1.0.1"\n')

    def test_ci_runs_the_gates_through_this_module_and_lists_none_of_its_own(self):
        import re
        wf = (HERE.parent.parent / ".github/workflows/agent-host.yaml").read_text()
        job = wf[wf.index("\n  tests:"):wf.index("\n  build:")]
        runs = [r.strip() for r in re.findall(r"^\s+run:\s*\|?\s*(.*)$", job, re.M)]
        self.assertIn("python3 agent-host/tools/release.py gates", job)
        self.assertFalse([r for r in runs if re.search(r"tests/(test_|check_)|pytest tests", r)], runs)
        self.assertFalse((HERE / "ci_run.sh").exists(), "ci_run.sh's job is the module's annotations now")


class Ship(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.s = Sandbox(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_refusals(self):
        code, _, err = self.s.ship()
        self.assertIsNone(code); self.assertIn("not staged", err)
        self.s.write("vesta-agent/CHANGELOG.md", "## 1.0.0\n\n- again\n")
        self.s.stage("vesta-agent/CHANGELOG.md")
        code, _, err = self.s.ship()
        self.assertIsNone(code); self.assertIn("not above", err)
        self.s.write("vesta-agent/CHANGELOG.md", "## 1.0.1\n\n- the change\n\n## 1.0.0\n")
        self.s.stage("vesta-agent/CHANGELOG.md")
        self.s.write("agent-host/agent-src/vesta_agent/app.py", "x = 2\n")
        code, _, err = self.s.ship()
        self.assertIsNone(code); self.assertIn("unstaged", err)
        self.s.stage("agent-host/agent-src/vesta_agent/app.py")
        code, _, err = self.s.ship()
        self.assertIsNone(code); self.assertIn("agent-src/CHANGELOG.md is not staged", err)

    def test_an_app_only_release_leaves_the_engine_alone(self):
        self.s.write("vesta-agent/CHANGELOG.md", "## 1.0.1\n\n- docs\n\n## 1.0.0\n")
        self.s.stage("vesta-agent/CHANGELOG.md")
        code, calls, err = self.s.ship()
        self.assertEqual(code, 3, err)   # pushed, CI never published: never 0
        files = set(sh(self.s.repo, "git", "show", "--name-only", "--format=", "HEAD").split())
        self.assertEqual(files, {"vesta-agent/CHANGELOG.md", "vesta-agent/config.yaml"})
        self.assertIn('"0.5.0"', self.s.read("agent-host/agent-src/vesta-agent.yaml"))

    def test_a_failing_gate_commits_nothing(self):
        self.s.write("vesta-agent/CHANGELOG.md", "## 1.0.1\n\n- x\n\n## 1.0.0\n")
        self.s.stage("vesta-agent/CHANGELOG.md")
        head = sh(self.s.repo, "git", "rev-parse", "HEAD")
        code, calls, err = self.s.ship(gates_ok=False)
        self.assertIsNone(code); self.assertIn("gate failed", err)
        self.assertEqual(sh(self.s.repo, "git", "rev-parse", "HEAD"), head)
        self.assertEqual(sh(self.s.repo, "git", "rev-parse", "origin/agent-dev"), head)

    def test_an_engine_release_writes_all_three_engine_sites_and_waits_until_published(self):
        self.s.write("vesta-agent/CHANGELOG.md", "## 1.0.1\n\n- engine\n\n## 1.0.0\n")
        self.s.write("agent-host/agent-src/CHANGELOG.md", "# Changelog\n\n## 0.5.1 (2 October 2026)\n\n- y\n\n## 0.5.0\n")
        self.s.write("agent-host/agent-src/vesta_agent/app.py", "x = 3\n")
        self.s.stage("vesta-agent/CHANGELOG.md", "agent-host/agent-src/CHANGELOG.md", "agent-host/agent-src/vesta_agent/app.py")
        code, calls, err = self.s.ship(dry=True)
        self.assertEqual((code, calls), (0, []), err)
        self.assertIn('"0.5.0"', self.s.read("agent-host/agent-src/vesta-agent.yaml"))   # dry run wrote nothing
        stop = threading.Event()
        ci = threading.Thread(target=self.s.publish_when, args=("engine release", "1.0.1", stop))
        ci.start()
        try:
            code, calls, err = self.s.ship(message="engine release", wait=0.5)
        finally:
            stop.set(); ci.join()
        self.assertEqual(code, 0, err)
        self.assertIn('version: "0.5.1"', self.s.read("agent-host/agent-src/vesta-agent.yaml"))
        self.assertIn('__version__ = "0.5.1"', self.s.read("agent-host/agent-src/vesta_agent/__init__.py"))
        self.assertIn('version: "1.0.1"', self.s.read("vesta-agent/config.yaml"))

    def test_refused_on_main(self):
        sh(self.s.repo, "git", "checkout", "-q", "main")
        code, _, err = self.s.ship()
        self.assertIsNone(code); self.assertIn("on main", err)



class CiFailures(unittest.TestCase):
    """ship says a red CI run at once (2026-10-05: it waited out the full --wait)."""

    def test_a_failed_run_is_named_and_a_running_one_is_not(self):
        red = {"workflow_runs": [{"name": "Build", "status": "completed", "conclusion": "failure"},
                                 {"name": "Tests", "status": "in_progress", "conclusion": None}]}
        self.assertEqual(release.ci_failures("x", fetch=lambda: red), ["Build"])

    def test_github_unreachable_is_not_a_failure(self):
        def down():
            raise OSError("offline")
        self.assertIsNone(release.ci_failures("x", fetch=down))


if __name__ == "__main__":
    unittest.main(verbosity=1)
