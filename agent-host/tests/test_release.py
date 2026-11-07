"""agent-host/tools/release.py: a smoke test. CI is the release's gate; this only proves the module reads a version,
writes it, and names gates that exist."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("agent_release", HERE.parent / "tools" / "release.py")
release = importlib.util.module_from_spec(spec)
sys.modules["agent_release"] = release
spec.loader.exec_module(release)


class Smoke(unittest.TestCase):
    def test_the_version_is_the_changelogs_top_entry_written_into_yaml(self):
        self.assertEqual(release.changelog_version("# x\n\n## 0.12.10\n\n## 0.12.9\n"), "0.12.10")
        self.assertGreater(release.parse_version("0.12.10"), release.parse_version("0.12.9"))
        self.assertEqual(release.with_yaml_version('n: x\nversion: "1.0.0"\n', "1.0.1"), 'n: x\nversion: "1.0.1"\n')

    def test_every_gate_names_a_file_that_exists_and_ci_runs_them_through_this_module(self):
        root = HERE.parent.parent
        for name, cmd, cwd, _ in release.GATES:
            for arg in cmd:
                if arg.endswith((".py", ".sh")) and "/" in arg:
                    self.assertTrue((root / cwd / arg).exists(), (name, arg))
        for site in release.VERSION_SITES:
            self.assertIsNotNone(release.yaml_version((root / site).read_text()), site)
        self.assertIn("python3 agent-host/tools/release.py gates", (root / ".github/workflows/agent-host.yaml").read_text())


if __name__ == "__main__":
    unittest.main()
