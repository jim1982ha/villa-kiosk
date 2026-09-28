#!/usr/bin/env python3
"""M3 checks: every self-test link reports pass / fail / skipped correctly.

One local fake server plays Home Assistant, the VESTA Kiosk (with the agent
interface, without it = its web page, or 404), an MCP server (JSON and SSE
replies), Anthropic and Telegram. It records every request, so "no Telegram
call while takeover is off" and "never getUpdates" are checked as requests
that did NOT happen, not as a log line that says so.

Run: python3 agent-host/tests/test_selftest.py
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
from http.server import ThreadingHTTPServer
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOTFS = HERE.parent / "rootfs"
sys.path.insert(0, str(ROOTFS / "opt/vesta/host"))
sys.path.insert(0, str(HERE))

from vesta_host import selftest  # noqa: E402
from vesta_host.selftest import FAIL, PASS, SKIPPED, Checks  # noqa: E402

from fake_remote import HA_TOKEN, KEY, KIOSK_TOKEN, TG, Fake  # noqa: E402


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls._anth, cls._tg = selftest.ANTHROPIC_MODELS, selftest.TELEGRAM_API
        selftest.ANTHROPIC_MODELS = cls.url + "/v1/models?limit=1"
        selftest.TELEGRAM_API = cls.url

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        selftest.ANTHROPIC_MODELS, selftest.TELEGRAM_API = cls._anth, cls._tg

    def setUp(self):
        Fake.kiosk, Fake.mcp, Fake.requests = "json", "json", []

    def env(self, **kw):
        base = {"VESTA_HA_URL": self.url, "VESTA_HA_TOKEN": HA_TOKEN,
                "VESTA_HA_MCP_URL": self.url + "/mcp", "VESTA_HA_MCP_SECRET": "",
                "VESTA_KIOSK_URL": self.url, "VESTA_KIOSK_TOKEN": KIOSK_TOKEN,
                "ANTHROPIC_API_KEY": KEY, "VESTA_TELEGRAM_ENABLED": "false"}
        return {**base, **kw}

    def results(self, env, **kw):
        return {r.link: r for r in selftest.run(Checks(env, **kw))}


class Links(Base):
    def test_everything_configured_passes(self):
        r = self.results(self.env(VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN=TG),
                         mcp_mode="external", stub_heartbeat=True)
        for link in ("Home Assistant", "HA MCP", "VESTA Kiosk", "Anthropic", "Telegram", "Presence"):
            self.assertEqual(r[link].result, PASS, f"{link}: {r[link].detail}")
        self.assertIn("fake-ha-mcp 8.5.0, 2 tools", r["HA MCP"].detail)
        self.assertIn("VESTA Kiosk 2.500.0", r["VESTA Kiosk"].detail)
        self.assertIn("@villa_bot", r["Telegram"].detail)

    def test_mcp_over_sse(self):
        Fake.mcp = "sse"
        r = self.results(self.env(), mcp_mode="external")
        self.assertEqual(r["HA MCP"].result, PASS, r["HA MCP"].detail)

    def test_missing_credentials_are_skipped_never_failed(self):
        r = self.results({"VESTA_HA_URL": self.url, "VESTA_HA_MCP_URL": "",
                          "VESTA_KIOSK_URL": self.url, "VESTA_TELEGRAM_ENABLED": "false"},
                         stub_heartbeat=True)
        for link, res in r.items():
            self.assertEqual(res.result, SKIPPED, f"{link}: {res.detail}")
        self.assertEqual(Fake.requests, [], "a check without credentials made a request")

    def test_kiosk_without_agent_interface_is_skipped_not_passed(self):
        for mode in ("spa", "404"):
            Fake.kiosk = mode
            r = self.results(self.env(), stub_heartbeat=True)
            self.assertEqual(r["VESTA Kiosk"].result, SKIPPED, f"{mode}: {r['VESTA Kiosk'].detail}")
            self.assertEqual(r["Presence"].result, SKIPPED, f"{mode}: {r['Presence'].detail}")

    def test_wrong_credentials_fail(self):
        r = self.results(self.env(VESTA_HA_TOKEN="wrong-token", VESTA_KIOSK_TOKEN="wrong-token",
                                  ANTHROPIC_API_KEY="wrong-key", VESTA_TELEGRAM_ENABLED="true",
                                  VESTA_TELEGRAM_BOT_TOKEN="1:wrong-token"))
        for link in ("Home Assistant", "VESTA Kiosk", "Anthropic", "Telegram"):
            self.assertEqual(r[link].result, FAIL, f"{link}: {r[link].detail}")

    def test_unreachable_fails_without_naming_the_url(self):
        r = self.results(self.env(VESTA_HA_URL="http://127.0.0.1:9", VESTA_TELEGRAM_ENABLED="true",
                                  VESTA_TELEGRAM_BOT_TOKEN=TG))
        self.assertEqual(r["Home Assistant"].result, FAIL)
        self.assertIn("unreachable", r["Home Assistant"].detail)

    def test_kiosk_contract_mismatch_fails(self):
        orig = Fake.kiosk_reply
        Fake.kiosk_reply = lambda self, body: orig(self, {**body, "contract": 2})
        try:
            r = self.results(self.env())
        finally:
            Fake.kiosk_reply = orig
        self.assertEqual(r["VESTA Kiosk"].result, FAIL)
        self.assertIn("expected 1", r["VESTA Kiosk"].detail)

    def test_sidecar_not_started_is_skipped_not_answering_fails(self):
        env = self.env(VESTA_HA_MCP_URL="http://127.0.0.1:9/mcp")
        r = self.results(env, mcp_mode="sidecar", sidecar_reason="ha_token not set")
        self.assertEqual(r["HA MCP"].result, SKIPPED)
        r = self.results(env, mcp_mode="sidecar")
        self.assertEqual(r["HA MCP"].result, FAIL)

    def test_presence_only_in_stub_mode(self):
        r = self.results(self.env(), stub_heartbeat=True, agent_mode="agent")
        self.assertEqual(r["Presence"].result, SKIPPED)
        self.assertNotIn(("POST", "/agent/v1/heartbeat"), Fake.requests)


class CloudflareAccess(Base):
    """Remote deployments: every request to the villa carries the service token."""

    def setUp(self):
        super().setUp()
        os.environ["FAKE_REQUIRE_CF"] = "1"

    def tearDown(self):
        os.environ.pop("FAKE_REQUIRE_CF", None)

    def test_with_service_token_passes(self):
        from fake_remote import CF_ID, CF_SECRET
        r = self.results(self.env(VESTA_CF_ACCESS_CLIENT_ID=CF_ID, VESTA_CF_ACCESS_CLIENT_SECRET=CF_SECRET),
                         mcp_mode="external", stub_heartbeat=True)
        for link in ("Home Assistant", "HA MCP", "VESTA Kiosk", "Presence"):
            self.assertEqual(r[link].result, PASS, f"{link}: {r[link].detail}")

    def test_without_service_token_is_refused(self):
        r = self.results(self.env(), mcp_mode="external")
        self.assertEqual(r["Home Assistant"].result, FAIL)
        self.assertIn("403", r["Home Assistant"].detail)


class Telegram(Base):
    def test_no_telegram_request_while_takeover_off(self):
        self.results(self.env(VESTA_TELEGRAM_BOT_TOKEN=TG))    # token present, takeover off
        self.assertFalse([p for _, p in Fake.requests if p.startswith("/bot")])

    def test_only_getme_ever(self):
        self.results(self.env(VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN=TG))
        bot = [p for _, p in Fake.requests if p.startswith("/bot")]
        self.assertEqual(bot, [f"/bot{TG}/getMe"])
        self.assertFalse(any("getUpdates" in p for p in bot))


class Slot(Base):
    """The slot program end to end: self-test, selftest.json, stub start."""

    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "data").mkdir()
        (self.root / "config").mkdir()
        stub = self.root / "opt/vesta/stub"
        stub.mkdir(parents=True)
        for f in (HERE.parent / "stub").iterdir():
            (stub / f.name).write_text(f.read_text())

    def tearDown(self):
        self.tmp.cleanup()

    def prepare(self, **opts):
        (self.root / "data/options.json").write_text(json.dumps({
            "agent_mode": "stub", "ha_url": self.url, "ha_mcp_mode": "external",
            "ha_mcp_url": self.url + "/mcp",
            "kiosk_url": self.url, "telegram_takeover": False, "stub_heartbeat": False,
            "log_level": "info", **opts}))
        env = {k: v for k, v in os.environ.items() if not k.startswith("VESTA_")}
        env["VESTA_ROOT"] = str(self.root)
        r = subprocess.run([sys.executable, str(ROOTFS / "usr/bin/vesta-entrypoint")],
                           env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stdout)
        return env

    def run_slot(self, env, seconds=3.0):
        # The real slot program, with Anthropic and Telegram pointed at the fake
        # server first — a test must never reach the internet with a fake key.
        boot = ("import runpy, sys; sys.path.insert(0, %r); "
                "from vesta_host import selftest; "
                "selftest.ANTHROPIC_MODELS = %r; selftest.TELEGRAM_API = %r; "
                "sys.argv = [%r]; runpy.run_path(%r, run_name='__main__')") % (
            str(ROOTFS / "opt/vesta/host"), self.url + "/v1/models?limit=1", self.url,
            str(ROOTFS / "usr/bin/vesta-agent-slot"), str(ROOTFS / "usr/bin/vesta-agent-slot"))
        p = subprocess.Popen([sys.executable, "-c", boot], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        time.sleep(seconds)
        p.send_signal(signal.SIGTERM)
        out, _ = p.communicate(timeout=20)
        return p.returncode, out

    def test_stub_mode_selftest_then_stub(self):
        env = self.prepare(ha_token=HA_TOKEN, kiosk_agent_token=KIOSK_TOKEN,
                           telegram_bot_token=TG, stub_heartbeat=True)
        code, out = self.run_slot(env)
        self.assertEqual(code, 0, out)
        for line in ("self-test Home Assistant: pass", "self-test HA MCP: pass",
                     "self-test VESTA Kiosk: pass", "self-test Anthropic: skipped",
                     "self-test Telegram: skipped", "self-test Presence: pass",
                     "starting vesta-agent-stub 1",
                     "stub: environment contract received: 17/17 variables present",
                     "stub: Telegram disabled — no token received",
                     "stub: heartbeat: HTTP 200", "stub: stopped"):
            self.assertIn(line, out)
        for secret in (HA_TOKEN, KIOSK_TOKEN, TG):
            self.assertNotIn(secret, out)
        report = json.loads((self.root / "data/host/selftest.json").read_text())
        self.assertEqual(report["summary"], {"pass": 4, "fail": 0, "skipped": 2})
        self.assertIn("at", report)
        self.assertNotIn(HA_TOKEN, json.dumps(report))
        self.assertFalse([p for _, p in Fake.requests if p.startswith("/bot")])

    def test_stub_mode_never_blocks_on_failure(self):
        env = self.prepare(ha_token="wrong-token")
        code, out = self.run_slot(env)
        self.assertIn("self-test Home Assistant: fail", out)
        self.assertIn("starting vesta-agent-stub", out)

    def test_agent_mode_without_agent_does_not_crash_loop(self):
        env = self.prepare(agent_mode="agent", ha_token=HA_TOKEN, anthropic_api_key=KEY)
        code, out = self.run_slot(env, 2.0)
        self.assertEqual(code, 0, out)
        self.assertIn("contains no VESTA Agent", out)

    def test_agent_mode_waits_for_home_assistant(self):
        agent = self.root / "opt/vesta/agent"
        agent.mkdir(parents=True)
        (agent / "vesta-agent.yaml").write_text(yaml.safe_dump(
            {"name": "fake-agent", "version": "0", "runtime": "python",
             "start": "echo agent-running; while :; do sleep 0.1; done", "stop_grace_seconds": 2}))
        env = self.prepare(agent_mode="agent", ha_token="wrong-token", anthropic_api_key=KEY)
        code, out = self.run_slot(env, 3.0)
        self.assertIn("agent start delayed: Home Assistant", out)
        self.assertNotIn("agent-running", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
