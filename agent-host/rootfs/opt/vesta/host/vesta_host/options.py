"""Reads the options and decides whether the host may start (SPEC 6, 10).

Two sources, one result (SPEC H1): `/data/options.json` when the Supervisor
runs the app, otherwise `VESTA_OPT_<NAME>` environment variables (standalone).

⚠️ DEFAULTS AND SCHEMA MIRROR vesta-agent/config.yaml. The Supervisor fills
defaults itself, but a standalone container has no Supervisor, so the host must
know them too. agent-host/tests/test_host.py fails when the two disagree.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from . import paths

DEFAULTS: dict[str, object] = {
    "agent_mode": "stub",
    "ha_url": "http://homeassistant:8123",
    "ha_mcp_mode": "sidecar",
    "kiosk_url": "http://e66a2348-villa-kiosk:8099",
    "telegram_takeover": False,
    "stub_heartbeat": False,
    "log_level": "info",
}

#: name → (type, required). `list:` carries its allowed values.
SCHEMA: dict[str, tuple[str, bool]] = {
    "agent_mode": ("list:stub|agent", True),
    "anthropic_api_key": ("password", False),
    "ha_url": ("url", True),
    "ha_token": ("password", False),
    "ha_mcp_mode": ("list:sidecar|external", True),
    "ha_mcp_url": ("url", False),
    "ha_mcp_secret": ("password", False),
    "kiosk_url": ("url", True),
    "kiosk_agent_token": ("password", False),
    "telegram_takeover": ("bool", True),
    "telegram_bot_token": ("password", False),
    "stub_heartbeat": ("bool", True),
    "log_level": ("list:debug|info|warning|error", True),
}

#: Values the redaction filter masks. `ha_mcp_url` is one: an MCP endpoint's
#: path is commonly its secret (the HA MCP app serves on /private_<random>).
SECRET_OPTIONS = ("anthropic_api_key", "ha_token", "ha_mcp_secret",
                  "kiosk_agent_token", "telegram_bot_token", "ha_mcp_url")


@dataclass
class Options:
    values: dict[str, object]
    deployment: str                      # ha_app | standalone
    errors: list[str] = field(default_factory=list)    # stop the start
    notes: list[str] = field(default_factory=list)     # logged, start goes on

    def get(self, name: str) -> object:
        return self.values.get(name)

    def has(self, name: str) -> bool:
        return bool(self.values.get(name))

    def secrets(self) -> list[str]:
        out = [str(self.values[k]) for k in SECRET_OPTIONS if self.values.get(k)]
        # Remote deployments carry a Cloudflare Access secret in the environment.
        cf = os.environ.get("VESTA_CF_ACCESS_CLIENT_SECRET")
        return out + ([cf] if cf else [])


def _from_env() -> dict[str, object]:
    raw: dict[str, object] = {}
    for name in SCHEMA:
        val = os.environ.get(f"VESTA_OPT_{name.upper()}")
        if val is not None and val != "":
            raw[name] = val
    return raw


def _coerce(name: str, val: object, errors: list[str]) -> object:
    kind, _ = SCHEMA[name]
    if kind == "bool":
        if isinstance(val, bool):
            return val
        s = str(val).strip().lower()
        if s in ("true", "1", "yes", "on"):
            return True
        if s in ("false", "0", "no", "off"):
            return False
        errors.append(f"{name} must be true or false, got {val!r}")
        return DEFAULTS.get(name, False)
    s = str(val).strip()
    if kind.startswith("list:"):
        allowed = kind[5:].split("|")
        if s not in allowed:
            errors.append(f"{name} must be one of {', '.join(allowed)}, got {s!r}")
        return s
    if kind == "url":
        u = urlsplit(s)
        if u.scheme not in ("http", "https") or not u.hostname:
            # Name the option, never echo the value: a URL may carry a secret.
            errors.append(f"{name} is not an http(s) address")
    return s


def load() -> Options:
    if paths.OPTIONS_JSON.exists():
        deployment = "ha_app"
        try:
            raw = json.loads(paths.OPTIONS_JSON.read_text())
        except ValueError:
            return Options({}, deployment, errors=["/data/options.json is not valid JSON"])
    else:
        deployment = "standalone"
        raw = _from_env()

    errors: list[str] = []
    values: dict[str, object] = dict(DEFAULTS)
    for name, val in raw.items():
        if name not in SCHEMA:
            continue                  # an unknown key is the Supervisor's business
        if val is None or val == "":
            continue
        values[name] = _coerce(name, val, errors)
    return validate(Options(values, deployment, errors=errors))


def validate(o: Options) -> Options:
    """SPEC 6: agent mode refuses to start without what the agent cannot work
    without; stub mode starts regardless and only skips the related checks."""
    agent = o.get("agent_mode") == "agent"
    need = [("anthropic_api_key", "Anthropic"), ("ha_token", "Home Assistant and HA MCP")]
    if o.get("ha_mcp_mode") == "external":
        need.append(("ha_mcp_url", "HA MCP"))
    for name, check in need:
        if o.has(name):
            continue
        if agent:
            o.errors.append(f"agent mode needs {name} — set it on the Configuration page")
        else:
            o.notes.append(f"{name} is empty: the {check} check will be skipped")
    if not o.has("kiosk_agent_token"):
        o.notes.append("kiosk_agent_token is empty: the VESTA Kiosk check will be skipped")
    if o.get("telegram_takeover") and not o.has("telegram_bot_token"):
        msg = "telegram_takeover is on but telegram_bot_token is empty"
        (o.errors if agent else o.notes).append(msg)
    if o.get("ha_mcp_mode") == "sidecar" and o.has("ha_mcp_url"):
        o.notes.append("ha_mcp_url is ignored in sidecar mode")
    return o
