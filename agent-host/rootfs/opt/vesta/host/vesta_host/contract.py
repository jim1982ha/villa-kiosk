"""The environment contract: the ONLY interface from host to agent (SPEC 7).

⚠️ THE AGENT GETS THIS AND NOTHING ELSE. The slot starts the agent with a
cleared environment plus these variables — so SUPERVISOR_TOKEN, VESTA_OPT_*
and any other container variable never reach agent code, and the same names
mean the same thing in every deployment (HA app, standalone, Paperclip).
"""
from __future__ import annotations

import os

from . import paths
from .options import Options

#: Where the HA MCP sidecar listens. Loopback only — nothing outside the
#: container can reach it (SPEC 12).
SIDECAR_HOST = "127.0.0.1"
SIDECAR_PORT = 9583
SIDECAR_PATH = "/mcp"

NAMES = (
    "ANTHROPIC_API_KEY",
    "VESTA_HA_URL", "VESTA_HA_TOKEN",
    "VESTA_HA_MCP_URL",
    "VESTA_KIOSK_URL", "VESTA_KIOSK_TOKEN",
    "VESTA_CF_ACCESS_CLIENT_ID", "VESTA_CF_ACCESS_CLIENT_SECRET",
    "VESTA_TELEGRAM_ENABLED", "VESTA_TELEGRAM_BOT_TOKEN",
    "VESTA_SKILLS_DIR", "VESTA_AGENT_CONFIG_DIR", "VESTA_DATA_DIR",
    "VESTA_LOG_LEVEL", "TZ",
    "VESTA_DEPLOYMENT", "VESTA_INSTANCE",
)


def instance() -> str:
    # Baked in by CI per channel (main → prod, anything else → dev); a
    # standalone run may override it.
    return os.environ.get("VESTA_INSTANCE") or os.environ.get("VESTA_BUILD_INSTANCE", "dev")


def build(o: Options) -> dict[str, str]:
    def opt(name: str) -> str:
        v = o.get(name)
        return "" if v is None else str(v)

    telegram = bool(o.get("telegram_takeover"))
    env = {
        "ANTHROPIC_API_KEY": opt("anthropic_api_key"),
        "VESTA_HA_URL": opt("ha_url"),
        "VESTA_HA_TOKEN": opt("ha_token"),
        "VESTA_HA_MCP_URL": f"http://{SIDECAR_HOST}:{SIDECAR_PORT}{SIDECAR_PATH}",
        "VESTA_KIOSK_URL": opt("kiosk_url"),
        "VESTA_KIOSK_TOKEN": opt("kiosk_agent_token"),
        # Empty on the Yellow; a remote deployment sets them in its environment.
        "VESTA_CF_ACCESS_CLIENT_ID": os.environ.get("VESTA_CF_ACCESS_CLIENT_ID", ""),
        "VESTA_CF_ACCESS_CLIENT_SECRET": os.environ.get("VESTA_CF_ACCESS_CLIENT_SECRET", ""),
        "VESTA_TELEGRAM_ENABLED": "true" if telegram else "false",
        "VESTA_SKILLS_DIR": paths.CONTRACT_SKILLS_DIR,
        "VESTA_AGENT_CONFIG_DIR": paths.CONTRACT_AGENT_CONFIG_DIR,
        "VESTA_DATA_DIR": paths.CONTRACT_DATA_DIR,
        "VESTA_LOG_LEVEL": opt("log_level"),
        # The Supervisor sets TZ in every app container; standalone sets its own.
        "TZ": os.environ.get("TZ", "UTC"),
        "VESTA_DEPLOYMENT": o.deployment,
        "VESTA_INSTANCE": instance(),
    }
    # ⚠️ PRESENT ONLY WHEN ENABLED (SPEC H5). Not an empty string: absent. Until
    # the Telegram switch-over the agent must not even be able to find a token,
    # because one getUpdates call would take the bot's buttons away from Home
    # Assistant and break the facility-manager job flow.
    if telegram:
        env["VESTA_TELEGRAM_BOT_TOKEN"] = opt("telegram_bot_token")
    return env


def process_env(contract: dict[str, str]) -> dict[str, str]:
    """The contract plus the few variables any process needs to run at all.
    HOME sits under VESTA_DATA_DIR: the agent may write only there (SPEC 8)."""
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": paths.CONTRACT_DATA_DIR,
        "LANG": "C.UTF-8",
        **contract,
    }


# ------------------------------------------------------------------ the agent's UI
#: The port Home Assistant's Ingress reaches the UI on (vesta-agent/config.yaml
#: `ingress_port`). Nothing else listens on it; no port is published.
UI_PORT = 8095
#: ⚠️ THE UI GETS NO SECRET. It edits files (policy.yaml, the skills) and reads the
#: agent's own records; it never talks to Home Assistant, Anthropic, the Kiosk or
#: Telegram, so it is given the folders and its port, and nothing that opens them.
UI_NAMES = ("VESTA_SKILLS_DIR", "VESTA_AGENT_CONFIG_DIR", "VESTA_DATA_DIR",
            "VESTA_LOG_LEVEL", "TZ", "VESTA_DEPLOYMENT", "VESTA_INSTANCE")


def ui_env(contract: dict[str, str]) -> dict[str, str]:
    """The UI process's whole environment: the contract's folders and settings, its port."""
    return {**{k: v for k, v in process_env(contract).items() if k not in NAMES or k in UI_NAMES},
            "VESTA_UI_PORT": str(UI_PORT),
            # the app's own version, for the page's header ("app 0.12.3 · agent 0.6.3")
            "VESTA_APP_VERSION": os.environ.get("VESTA_HOST_VERSION", "")}
