"""Settings of one VESTA Agent install.

Three sources, never mixed:
  the environment      the VESTA Agent host's contract (connections and secrets), set once
                       by the host from its own options; nothing here reads /data/options.json,
                       which holds the HOST's options, not the agent's
  VESTA_AGENT_CONFIG_DIR/policy.yaml
                       the villa's people and lists, plus a `settings:` block (brain, limit per
                       reply, web search, conversation reset); edited by people, reloaded live
  VESTA_AGENT_CONFIG_DIR/instructions.md
                       the system prompt, edited by people, reloaded live

Secrets stay in this object. The model process (the Claude CLI) inherits only the
Anthropic key it needs to think (runner.py builds its environment).
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field

import yaml

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STARTER_DIR = os.path.join(APP_DIR, "starter")

# The settings block is policy.yaml's, read by vesta_agent.policy (one reader of the file).
from .policy import PROFILES, Policy  # noqa: E402


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


@dataclass
class Settings:
    anthropic_api_key: str = ""
    ha_mcp_url: str = ""
    ha_url: str = ""
    ha_token: str = ""
    telegram_enabled: bool = False
    telegram_bot_token: str = ""
    kiosk_url: str = ""
    kiosk_token: str = ""
    cf_access_id: str = ""
    cf_access_secret: str = ""
    timezone: str = "UTC"
    log_level: str = "info"
    instance: str = "dev"
    data_dir: str = "/data/agent"
    config_dir: str = "/config/agent"
    skills_dir: str = "/config/skills"
    app_dir: str = APP_DIR
    _policy_cache: dict = field(default_factory=dict, repr=False)

    # ------------------------------------------------------------------ paths
    @property
    def policy_path(self) -> str:
        return os.path.join(self.config_dir, "policy.yaml")

    @property
    def instructions_path(self) -> str:
        return os.path.join(self.config_dir, "instructions.md")

    @property
    def store_path(self) -> str:
        return os.path.join(self.data_dir, "vesta_store.sqlite")

    @property
    def state_path(self) -> str:
        return os.path.join(self.data_dir, "vesta_agent.sqlite")

    @property
    def history_path(self) -> str:
        """The VESTA Agent page's changes, each undoable (history.py)."""
        return os.path.join(self.data_dir, "page_history.sqlite")

    @property
    def pack_path(self) -> str:
        return os.path.join(self.data_dir, "pack.json")

    @property
    def out_dir(self) -> str:
        return os.path.join(self.data_dir, "out")

    @property
    def work_dir(self) -> str:
        """The model process's working directory: empty, holds nothing."""
        return os.path.join(self.data_dir, "work")

    @property
    def claude_dir(self) -> str:
        """The Claude CLI's own folder: sessions, so a conversation survives a restart."""
        return os.path.join(self.data_dir, "claude")

    @property
    def shared_dir(self) -> str:
        """Where `vesta_shared` lives: the engine, never a skill folder a person can edit."""
        return self.app_dir

    # ------------------------------------------------------------------ behaviour (policy.yaml `settings:`)
    def policy(self) -> Policy:
        """policy.yaml, read again whenever the file changes — the ONE cache of it (the engine and these
        settings each kept their own until 0.6.42). A value it does not understand falls back to its default
        (not an error: a typo in a hand-edited file must not stop the agent; the UI refuses it before it is saved)."""
        try:
            m = os.path.getmtime(self.policy_path)
        except OSError:
            m = None
        if self._policy_cache.get("mtime") != m or "value" not in self._policy_cache:
            try:
                v = Policy.load(self.policy_path)
            except (OSError, yaml.YAMLError):
                v = Policy({})
            self._policy_cache.update(mtime=m, value=v)
        return self._policy_cache["value"]

    def behaviour(self) -> dict:
        """The `settings:` block of policy.yaml (brain, limit per reply, web search, conversation reset)."""
        return self.policy().behaviour

    @property
    def profile(self) -> str:
        return self.behaviour()["profile"]

    @property
    def reply_limit_usd(self) -> float:
        return self.behaviour()["reply_limit_usd"]

    @property
    def web_search(self) -> bool:
        return self.behaviour()["web_search"]

    @property
    def conversation_reset(self) -> str:
        return self.behaviour()["conversation_reset"]

    @property
    def model(self) -> str:
        return PROFILES[self.profile][0]

    @property
    def effort(self) -> str:
        return PROFILES[self.profile][1]

    def instructions(self) -> str:
        try:
            with open(self.instructions_path, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def problems(self) -> list[tuple[str, bool]]:
        """(what is missing, blocking). Said in the log at start, never the values."""
        out = []
        if not self.anthropic_api_key:
            out.append(("ANTHROPIC_API_KEY is empty (the host's anthropic_api_key option)", True))
        if not self.ha_mcp_url:
            out.append(("VESTA_HA_MCP_URL is empty: the host's HA MCP sidecar is not running", True))
        if not (self.ha_url and self.ha_token):
            out.append(("VESTA_HA_URL or VESTA_HA_TOKEN is empty: no critical alerts and no Telegram messages", False))
        if self.telegram_enabled and not self.telegram_bot_token:
            out.append(("Telegram is enabled but VESTA_TELEGRAM_BOT_TOKEN is empty: nothing can be sent", False))
        if not (self.kiosk_url and self.kiosk_token):
            out.append(("VESTA_KIOSK_URL or VESTA_KIOSK_TOKEN is empty: no heartbeat and no Facility tickets", False))
        return out

    def secrets(self) -> list[str]:
        """Every secret value this install holds, for the scrubbing of what the model reads."""
        return [v for v in (self.ha_mcp_url, self.anthropic_api_key, self.telegram_bot_token, self.ha_token,
                            self.kiosk_token, self.cf_access_secret) if v]


def load() -> Settings:
    tg = _env("VESTA_TELEGRAM_ENABLED").lower() == "true"
    s = Settings(
        anthropic_api_key=_env("ANTHROPIC_API_KEY"),
        ha_mcp_url=_env("VESTA_HA_MCP_URL"),
        ha_url=_env("VESTA_HA_URL").rstrip("/"),
        ha_token=_env("VESTA_HA_TOKEN"),
        telegram_enabled=tg,
        telegram_bot_token=_env("VESTA_TELEGRAM_BOT_TOKEN") if tg else "",
        kiosk_url=_env("VESTA_KIOSK_URL").rstrip("/"),
        kiosk_token=_env("VESTA_KIOSK_TOKEN"),
        cf_access_id=_env("VESTA_CF_ACCESS_CLIENT_ID"),
        cf_access_secret=_env("VESTA_CF_ACCESS_CLIENT_SECRET"),
        timezone=_env("TZ", "UTC"),
        log_level=_env("VESTA_LOG_LEVEL", "info").lower(),
        instance=_env("VESTA_INSTANCE", "dev"),
        data_dir=_env("VESTA_DATA_DIR", "/data/agent"),
        config_dir=_env("VESTA_AGENT_CONFIG_DIR", "/config/agent"),
        skills_dir=_env("VESTA_SKILLS_DIR", "/config/skills"),
    )
    for d in (s.data_dir, s.config_dir, s.out_dir, s.work_dir, s.claude_dir):
        os.makedirs(d, exist_ok=True)
    seed_config(s)
    return s


def seed_config(s: Settings) -> list[str]:
    """policy.yaml and instructions.md from the starter copies, when absent.

    ⚠️ ONLY WHEN THE FILE IS MISSING, never merged into one that exists: a default
    spread under a person's file would bring back every line they deleted."""
    written = []
    for name, target in (("policy.example.yaml", s.policy_path), ("instructions.md", s.instructions_path)):
        src = os.path.join(STARTER_DIR, "config", name)
        if not os.path.exists(target) and os.path.exists(src):
            shutil.copyfile(src, target)
            written.append(os.path.basename(target))
    return written
