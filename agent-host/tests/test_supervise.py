#!/usr/bin/env python3
"""M4 + M5 checks: the HA MCP sidecar's settings and supervision, the restart
policy, the crash-loop stop and the stop grace.

The policy's real numbers (5 s → 5 min, 5 crashes in 10 min) would make a
crash-loop test take minutes, so each test scales them down — by patching the
module the real programs import, never by testing a copy of the loop.

Run: python3 agent-host/tests/test_supervise.py
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOTFS = HERE.parent / "rootfs"
HOSTLIB = ROOTFS / "opt/vesta/host"
sys.path.insert(0, str(HOSTLIB))

from vesta_host import supervise  # noqa: E402
from vesta_host.redact import Redactor  # noqa: E402

TOKEN = "eyJ-SUPERVISE-TEST-TOKEN-123"


class Policy(unittest.TestCase):
    """keep_running / run_once, in process, with the numbers scaled down."""

    def setUp(self):
        self.saved = {k: getattr(supervise, k) for k in
                      ("BACKOFF_START", "BACKOFF_MAX", "CRASH_LIMIT", "CRASH_WINDOW", "STABLE_AFTER")}
        supervise.BACKOFF_START, supervise.BACKOFF_MAX = 0.05, 0.2
        supervise.CRASH_WINDOW, supervise.STABLE_AFTER = 60, 60
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(supervise, k, v)
        self.tmp.cleanup()

    def test_backoff_doubles_up_to_the_cap(self):
        waits, stop = [], threading.Event()
        real_wait = stop.wait

        def spy(t=None):
            if t is not None and t >= supervise.BACKOFF_START:
                waits.append(t)
                if len(waits) == 5:
                    stop.set()
            return real_wait(0)
        stop.wait = spy
        supervise.keep_running(lambda: 1, "x", stop)
        self.assertEqual(waits, [0.05, 0.1, 0.2, 0.2, 0.2])

    def test_crash_loop_stops_restarting_but_keeps_running(self):
        stop, calls = threading.Event(), []
        log_path = Path(self.tmp.name) / "crashes.json"
        done = threading.Event()

        def run():
            supervise.keep_running(lambda: calls.append(1) or 7, "agent", stop,
                                   supervise.CrashLog(log_path))
            done.set()
        threading.Thread(target=run, daemon=True).start()
        time.sleep(2.0)
        self.assertEqual(len(calls), supervise.CRASH_LIMIT)     # no sixth start
        self.assertFalse(done.is_set(), "gave up by returning — s6 would restart it")
        info = json.loads(log_path.read_text())
        self.assertEqual(info["crashes_in_window"], 5)
        self.assertEqual(info["last_exit"], 7)
        stop.set()
        self.assertTrue(done.wait(2))

    def test_crashes_outside_the_window_do_not_count(self):
        cl = supervise.CrashLog(None)
        supervise.CRASH_WINDOW = 10
        for t in (0, 20, 40, 60, 80, 100):
            n = cl.add(t, 1)
        self.assertEqual(n, 1)

    def test_clean_stop_and_grace_kill(self):
        red, stop = Redactor(), threading.Event()
        # Honours SIGTERM:
        t = threading.Timer(0.5, stop.set); t.start()
        code = supervise.run_once(["/bin/sh", "-c", "trap 'exit 0' TERM; while :; do sleep 0.05; done"],
                                  "/", dict(os.environ), "t", 5, stop, red)
        self.assertIsNone(code)
        # Ignores SIGTERM: killed once the grace runs out, not before.
        stop = threading.Event()
        t = threading.Timer(0.3, stop.set); t.start()
        began = time.monotonic()
        code = supervise.run_once(["/bin/sh", "-c", "trap '' TERM; while :; do sleep 0.05; done"],
                                  "/", dict(os.environ), "t", 1, stop, red)
        took = time.monotonic() - began
        self.assertIsNone(code)
        self.assertGreaterEqual(took, 1.2)
        self.assertLess(took, 4)

    def test_exit_code_reported(self):
        self.assertEqual(supervise.run_once(["/bin/sh", "-c", "exit 3"], "/", dict(os.environ),
                                            "t", 1, threading.Event(), Redactor()), 3)


class Programs(unittest.TestCase):
    """The real entrypoint, slot and sidecar programs on a temporary root."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for d in ("data", "config", "opt/vesta/stub", "opt/vesta/ha-mcp/bin"):
            (self.root / d).mkdir(parents=True)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("VESTA_")}
        self.env["VESTA_ROOT"] = str(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def prepare(self, **opts):
        (self.root / "data/options.json").write_text(json.dumps({
            "agent_mode": "stub", "ha_url": "http://127.0.0.1:9",
            "kiosk_url": "http://127.0.0.1:9", "telegram_takeover": False,
            "stub_heartbeat": False, "log_level": "info", **opts}))
        r = subprocess.run([sys.executable, str(ROOTFS / "usr/bin/vesta-entrypoint")],
                           env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stdout)
        return r.stdout

    def boot(self, program, **patch):
        """Run a real program with supervise's numbers scaled down."""
        sets = "".join(f"supervise.{k} = {v!r}; " for k, v in patch.items())
        slot = str(ROOTFS / "usr/bin" / program)
        return [sys.executable, "-c",
                f"import runpy, sys; sys.path.insert(0, {str(HOSTLIB)!r}); "
                f"from vesta_host import supervise; {sets}"
                f"sys.argv = [{slot!r}]; runpy.run_path({slot!r}, run_name='__main__')"]

    def run_for(self, cmd, seconds):
        p = subprocess.Popen(cmd, env=self.env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True)
        time.sleep(seconds)
        alive = p.poll() is None
        p.send_signal(signal.SIGTERM)
        out, _ = p.communicate(timeout=30)
        return alive, p.returncode, out

    # ── sidecar settings ──────────────────────────────────────────────────
    def sidecar_cfg(self):
        return json.loads((self.root / "run/vesta/sidecar.json").read_text())

    def test_sidecar_enabled_with_token_on_loopback(self):
        self.prepare(ha_token=TOKEN)
        cfg = self.sidecar_cfg()
        self.assertTrue(cfg["enabled"])
        env = cfg["env"]
        self.assertEqual(env["MCP_HOST"], "127.0.0.1")
        self.assertEqual(env["HOMEASSISTANT_TOKEN"], TOKEN)
        self.assertEqual(env["HA_MCP_DISABLE_UPDATE_CHECK"], "1")
        self.assertNotIn("SUPERVISOR_TOKEN", env)
        self.assertEqual((self.root / "run/vesta/sidecar.json").stat().st_mode & 0o777, 0o600)
        host = json.loads((self.root / "run/vesta/host.json").read_text())
        self.assertIsNone(host["sidecar_reason"])

    def test_sidecar_disabled_without_token(self):
        self.prepare()
        cfg = self.sidecar_cfg()
        self.assertFalse(cfg["enabled"])
        self.assertEqual(cfg["reason"], "ha_token not set")
        self.assertNotIn("env", cfg)
        # the options the 0.8.x external mode left behind change nothing (decision D2)
        self.prepare(ha_token=TOKEN, ha_mcp_mode="external", ha_mcp_url="https://mcp.example.test/x")
        self.assertTrue(self.sidecar_cfg()["enabled"])

    def test_sidecar_output_redacted_and_restarted(self):
        self.prepare(ha_token=TOKEN)
        fake = self.root / "opt/vesta/ha-mcp/bin/ha-mcp-web"
        fake.write_text("#!/bin/sh\necho \"token=$HOMEASSISTANT_TOKEN host=$MCP_HOST\"\nexit 1\n")
        fake.chmod(0o755)
        alive, code, out = self.run_for(self.boot("vesta-sidecar", BACKOFF_START=0.1, BACKOFF_MAX=0.2), 1.5)
        self.assertTrue(alive, out)
        self.assertIn("[ha-mcp] token=*** host=127.0.0.1", out)
        self.assertIn("HA MCP sidecar exited with code 1 — restarting in 0.1 s", out)
        self.assertNotIn(TOKEN, out)

    def test_sidecar_idles_when_disabled(self):
        self.prepare()
        alive, code, out = self.run_for(self.boot("vesta-sidecar"), 1.0)
        self.assertTrue(alive)
        self.assertEqual(code, 0)
        self.assertIn("HA MCP sidecar not started: ha_token not set", out)

    # ── agent slot supervision ────────────────────────────────────────────
    def stub(self, start, grace=5):
        (self.root / "opt/vesta/stub/vesta-agent.yaml").write_text(yaml.safe_dump(
            {"name": "test-stub", "version": "0", "runtime": "python",
             "start": start, "stop_grace_seconds": grace}))

    def test_slot_crash_loop(self):
        self.prepare()
        self.stub("echo boom; exit 3")
        alive, code, out = self.run_for(self.boot("vesta-agent-slot", BACKOFF_START=0.1,
                                                  BACKOFF_MAX=0.2), 4.0)
        self.assertTrue(alive, "the slot exited — s6 would restart it outside the policy")
        self.assertEqual(out.count("starting test-stub 0"), 5, out)
        self.assertIn("crash 1 of 5 allowed in 10 min", out)
        self.assertIn("crashed 5 times within 10 min — not restarting it", out)
        self.assertEqual(json.loads((self.root / "data/host/crashes.json").read_text())["crashes_in_window"], 5)

    def test_slot_honours_the_manifest_grace(self):
        self.prepare()
        self.stub("trap 'sleep 1.5; echo saved; exit 0' TERM; while :; do sleep 0.1; done", grace=5)
        alive, code, out = self.run_for(self.boot("vesta-agent-slot"), 2.0)
        self.assertIn("[agent] saved", out)
        self.assertIn("agent stopped cleanly", out)

    def test_slot_caps_an_oversized_grace(self):
        self.prepare()
        self.stub("while :; do sleep 0.1; done", grace=120)
        _, _, out = self.run_for(self.boot("vesta-agent-slot"), 1.5)
        self.assertIn("stop_grace_seconds 120 capped to 22", out)

    def test_selftest_reports_a_dead_sidecar_as_failed(self):
        from vesta_host.selftest import FAIL, SKIPPED, Checks
        env = {"VESTA_HA_MCP_URL": "http://127.0.0.1:9/mcp"}
        self.assertEqual(Checks(env, sidecar_reason=None).ha_mcp().result, FAIL)
        self.assertEqual(Checks(env, sidecar_reason="ha_token not set").ha_mcp().result, SKIPPED)


if __name__ == "__main__":
    unittest.main(verbosity=2)
