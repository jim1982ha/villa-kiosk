#!/usr/bin/env python3
"""M2 checks: options, validation, environment contract, folders, redaction.

⚠️ THE REAL PROGRAMS, NOT A COPY. Each test runs rootfs/usr/bin/vesta-entrypoint
(and vesta-agent-slot) as a subprocess against a temporary VESTA_ROOT, then
reads what they printed and wrote — the same files s6 runs in the image.

Run: python3 agent-host/tests/test_host.py   (needs PyYAML)
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ROOTFS = HERE.parent / "rootfs"
ENTRY = ROOTFS / "usr/bin/vesta-entrypoint"
SLOT = ROOTFS / "usr/bin/vesta-agent-slot"
sys.path.insert(0, str(ROOTFS / "opt/vesta/host"))

from vesta_host import options as host_options  # noqa: E402
from vesta_host.redact import Redactor  # noqa: E402

SECRETS = {
    "anthropic_api_key": "sk-ant-TESTKEY-0123456789",
    "ha_token": "eyJhbGciOiJIUzI1NiJ9.TESTTOKEN",
    "kiosk_agent_token": "kiosk-TESTTOKEN-abcdef",
    "telegram_bot_token": "123456:TELEGRAM-TESTTOKEN",
}


class Host(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "data").mkdir()
        (self.root / "config").mkdir()
        tpl = self.root / "opt/vesta/host/templates"
        tpl.mkdir(parents=True)
        for f in (ROOTFS / "opt/vesta/host/templates").iterdir():
            (tpl / f.name).write_text(f.read_text())

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def env(self, **extra: str) -> dict[str, str]:
        base = {k: v for k, v in os.environ.items() if not k.startswith("VESTA_")}
        return {**base, "VESTA_ROOT": str(self.root), **extra}

    def ha_options(self, **opts: object) -> None:
        (self.root / "data/options.json").write_text(json.dumps({**host_options.DEFAULTS, **opts}))

    def start(self, **env: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(ENTRY)], env=self.env(**env),
                              capture_output=True, text=True, timeout=30)

    def contract(self) -> dict[str, str]:
        return json.loads((self.root / "run/vesta/agent-env.json").read_text())

    # ── validation ────────────────────────────────────────────────────────
    def test_stub_starts_with_nothing_configured(self) -> None:
        self.ha_options()
        r = self.start()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("anthropic_api_key is empty: the Anthropic check will be skipped", r.stdout)
        self.assertIn("start-up checks passed", r.stdout)

    def test_agent_mode_without_key_or_token_stops(self) -> None:
        self.ha_options(agent_mode="agent")
        r = self.start()
        self.assertEqual(r.returncode, 1)
        self.assertIn("agent mode needs anthropic_api_key", r.stdout)
        self.assertIn("agent mode needs ha_token", r.stdout)
        self.assertIn("not starting", r.stdout)
        self.assertFalse((self.root / "run/vesta/agent-env.json").exists())

    def test_agent_mode_with_both_starts(self) -> None:
        self.ha_options(agent_mode="agent", anthropic_api_key=SECRETS["anthropic_api_key"],
                        ha_token=SECRETS["ha_token"])
        self.assertEqual(self.start().returncode, 0)

    def test_agent_mode_external_mcp_needs_url(self) -> None:
        self.ha_options(agent_mode="agent", ha_mcp_mode="external",
                        anthropic_api_key=SECRETS["anthropic_api_key"], ha_token=SECRETS["ha_token"])
        r = self.start()
        self.assertEqual(r.returncode, 1)
        self.assertIn("agent mode needs ha_mcp_url", r.stdout)

    # ── environment contract ──────────────────────────────────────────────
    def test_contract_has_exactly_the_spec_names(self) -> None:
        from vesta_host import contract
        self.ha_options(telegram_takeover=True, telegram_bot_token=SECRETS["telegram_bot_token"])
        self.assertEqual(self.start().returncode, 0)
        env = self.contract()
        self.assertEqual(set(env) - {"PATH", "HOME", "LANG"}, set(contract.NAMES))
        self.assertEqual(env["VESTA_SKILLS_DIR"], "/config/skills")
        self.assertEqual(env["VESTA_DATA_DIR"], "/data/agent")
        self.assertEqual(env["HOME"], "/data/agent")
        self.assertEqual(env["VESTA_DEPLOYMENT"], "ha_app")

    def test_telegram_token_absent_until_takeover(self) -> None:
        self.ha_options(telegram_bot_token=SECRETS["telegram_bot_token"])
        self.assertEqual(self.start().returncode, 0)
        env = self.contract()
        self.assertEqual(env["VESTA_TELEGRAM_ENABLED"], "false")
        self.assertNotIn("VESTA_TELEGRAM_BOT_TOKEN", env)
        self.assertNotIn(SECRETS["telegram_bot_token"], json.dumps(env))

    def test_no_container_variable_leaks_to_the_agent(self) -> None:
        self.ha_options()
        self.assertEqual(self.start(SUPERVISOR_TOKEN="supervisor-SECRET-xyz").returncode, 0)
        self.assertNotIn("supervisor-SECRET-xyz", json.dumps(self.contract()))

    def test_sidecar_vs_external_mcp_url(self) -> None:
        self.ha_options()
        self.start()
        self.assertTrue(self.contract()["VESTA_HA_MCP_URL"].startswith("http://127.0.0.1:"))
        self.ha_options(ha_mcp_mode="external", ha_mcp_url="https://mcp.example.test/private_abc123",
                        ha_mcp_secret="mcp-SECRET-987654")
        self.start()
        env = self.contract()
        self.assertEqual(env["VESTA_HA_MCP_URL"], "https://mcp.example.test/private_abc123")
        self.assertEqual(env["VESTA_HA_MCP_SECRET"], "mcp-SECRET-987654")

    def test_standalone_reads_vesta_opt_variables(self) -> None:
        r = self.start(VESTA_OPT_AGENT_MODE="agent", VESTA_OPT_ANTHROPIC_API_KEY=SECRETS["anthropic_api_key"],
                       VESTA_OPT_HA_TOKEN=SECRETS["ha_token"], VESTA_OPT_TELEGRAM_TAKEOVER="false",
                       VESTA_OPT_KIOSK_URL="https://kiosk.example.test", VESTA_INSTANCE="prod")
        self.assertEqual(r.returncode, 0, r.stdout)
        env = self.contract()
        self.assertEqual(env["VESTA_DEPLOYMENT"], "standalone")
        self.assertEqual(env["VESTA_INSTANCE"], "prod")
        self.assertEqual(env["VESTA_KIOSK_URL"], "https://kiosk.example.test")
        self.assertEqual(env["ANTHROPIC_API_KEY"], SECRETS["anthropic_api_key"])

    def test_standalone_rejects_malformed_values(self) -> None:
        r = self.start(VESTA_OPT_TELEGRAM_TAKEOVER="maybe", VESTA_OPT_HA_URL="homeassistant")
        self.assertEqual(r.returncode, 1)
        self.assertIn("telegram_takeover must be true or false", r.stdout)
        self.assertIn("ha_url is not an http(s) address", r.stdout)

    # ── folders ───────────────────────────────────────────────────────────
    def test_folders_created_and_never_overwritten(self) -> None:
        self.ha_options()
        self.start()
        for d in ("data/agent", "data/host", "config/skills", "config/agent"):
            self.assertTrue((self.root / d).is_dir(), d)
        readme = self.root / "config/skills/README.md"
        self.assertIn("VESTA Skills", readme.read_text())
        readme.write_text("edited by a person")
        (self.root / "config/skills/pool").mkdir()
        self.start()
        self.assertEqual(readme.read_text(), "edited by a person")
        self.assertTrue((self.root / "config/skills/pool").is_dir())
        info = json.loads((self.root / "data/host/last_start.json").read_text())
        self.assertEqual(info["agent_mode"], "stub")

    # ── secrets ───────────────────────────────────────────────────────────
    def test_no_secret_in_the_start_log(self) -> None:
        self.ha_options(agent_mode="agent", telegram_takeover=True, **SECRETS)
        r = self.start()
        self.assertEqual(r.returncode, 0, r.stdout)
        for s in SECRETS.values():
            self.assertNotIn(s, r.stdout + r.stderr)
        self.assertIn("link Anthropic: key set", r.stdout)
        # Secret files are private to root.
        for f in ("agent-env.json", "redact.json"):
            self.assertEqual((self.root / "run/vesta" / f).stat().st_mode & 0o777, 0o600, f)

    def test_agent_output_is_redacted_and_stop_is_forwarded(self) -> None:
        self.ha_options(agent_mode="agent", **SECRETS)
        self.assertEqual(self.start().returncode, 0)
        agent = self.root / "opt/vesta/agent"
        agent.mkdir(parents=True)
        # A careless agent: prints its key, then waits to be stopped.
        (agent / "vesta-agent.yaml").write_text(yaml.safe_dump({
            "name": "leaky", "version": "0", "runtime": "python", "stop_grace_seconds": 5,
            "start": "echo \"key=$ANTHROPIC_API_KEY token=$VESTA_HA_TOKEN\"; "
                     "trap 'echo got-term; exit 0' TERM; while :; do sleep 0.1; done"}))
        p = subprocess.Popen([sys.executable, str(SLOT)], env=self.env(),
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        time.sleep(1.5)
        p.send_signal(signal.SIGTERM)
        out, _ = p.communicate(timeout=15)
        self.assertEqual(p.returncode, 0, out)
        self.assertIn("[agent] key=*** token=***", out)
        self.assertIn("got-term", out)
        for s in SECRETS.values():
            self.assertNotIn(s, out)

    def test_redactor(self) -> None:
        r = Redactor(["abcdef123", "abcdef123456", "x"])
        self.assertEqual(r("a abcdef123456 b abcdef123 c x"), "a *** b *** c x")

    # ── host defaults mirror the manifest ─────────────────────────────────
    def test_defaults_and_schema_match_config_yaml(self) -> None:
        cfg = yaml.safe_load((REPO / "vesta-agent/config.yaml").read_text())
        self.assertEqual(cfg["options"], host_options.DEFAULTS)
        manifest = {k: str(v).rstrip("?") for k, v in cfg["schema"].items()}
        host = {k: t.replace("list:", "list(") + (")" if t.startswith("list:") else "")
                for k, (t, _) in host_options.SCHEMA.items()}
        self.assertEqual(manifest, host)
        for k, (_, required) in host_options.SCHEMA.items():
            self.assertEqual(required, not str(cfg["schema"][k]).endswith("?"), k)


if __name__ == "__main__":
    unittest.main(verbosity=2)
