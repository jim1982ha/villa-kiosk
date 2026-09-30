"""The agent's manifest (vesta_host.manifest) and the host state
(vesta_host.host_state) — by value, no process started.

Before, the stop-grace cap and the empty-slot rules were reachable only by
starting the slot as a real process and sleeping."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST = HERE.parent / "rootfs" / "opt" / "vesta" / "host"
sys.path.insert(0, str(HOST))

from vesta_host import manifest  # noqa: E402
from vesta_host.host_state import HostState  # noqa: E402


class Manifests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def write(self, text: str) -> Path:
        p = self.dir / "vesta-agent.yaml"
        p.write_text(text)
        return p

    def test_a_good_manifest(self):
        m, problem = manifest.load(self.write(
            "name: helper\nversion: '1.2'\nruntime: python\nstart: python -m helper\ninstall: pip install .\nstop_grace_seconds: 5\n"))
        self.assertIsNone(problem)
        self.assertEqual((m.label, m.start, m.install, m.stop_grace), ("helper 1.2", "python -m helper", "pip install .", 5))

    def test_the_grace_is_capped_to_fit_the_apps_30_s(self):
        m, _ = manifest.load(self.write("start: run\nstop_grace_seconds: 120\n"))
        self.assertEqual(m.stop_grace, manifest.MAX_GRACE)
        self.assertTrue(any("capped to 22" in w for w in m.warnings))

    def test_no_grace_is_the_default_and_junk_is_too(self):
        self.assertEqual(manifest.load(self.write("start: run\n"))[0].stop_grace, manifest.DEFAULT_GRACE)
        m, _ = manifest.load(self.write("start: run\nstop_grace_seconds: soon\n"))
        self.assertEqual(m.stop_grace, manifest.DEFAULT_GRACE)
        self.assertTrue(m.warnings)

    def test_no_start_is_a_reason_not_a_crash(self):
        m, problem = manifest.load(self.write("name: x\n"))
        self.assertIsNone(m)
        self.assertIn("no `start` command", problem)

    def test_broken_yaml_is_a_reason(self):
        m, problem = manifest.load(self.write("start: [unclosed\n"))
        self.assertIsNone(m)
        self.assertTrue(problem)

    def test_identity(self):
        self.assertEqual(manifest.identity(self.dir / "missing.yaml"), "none installed")
        self.assertEqual(manifest.identity(self.write("name: helper\nversion: 2\nruntime: node\nstart: x\n")), "helper 2 (node)")

    def test_the_build_reads_install_through_it(self):
        p = self.write("start: x\ninstall: npm ci\n")
        r = subprocess.run([sys.executable, "-m", "vesta_host.manifest", "install", str(p)],
                           capture_output=True, text=True, env={"PYTHONPATH": str(HOST)})
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "npm ci"))
        self.assertIn("vesta_host.manifest install", (HERE.parent / "Dockerfile").read_text())


class HostStates(unittest.TestCase):
    def test_round_trip(self):
        p = Path(tempfile.mkdtemp()) / "host.json"
        h = HostState(agent_mode="agent", stub_heartbeat=True, ha_mcp_mode="external", sidecar_reason="off", host_version="0.8.0")
        h.write(p)
        self.assertEqual(HostState.read(p), h)

    def test_missing_keys_are_defaulted_and_junk_ignored(self):
        h = HostState.of({"agent_mode": None, "sidecar_reason": 3, "extra": 1})
        self.assertEqual(h, HostState())

    def test_a_missing_file_raises(self):
        with self.assertRaises(OSError):
            HostState.read(Path(tempfile.mkdtemp()) / "none.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
