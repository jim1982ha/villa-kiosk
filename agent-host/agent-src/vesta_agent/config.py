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

import logging
import os
import shutil
from dataclasses import dataclass, field


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
    # a run's own folder under out/ (in_folder); "" for the engine's own work
    run_folder: str = ""
    # the web searches this run made so far (JSON list of the queries): its scripts read them (VESTA_WEB_SEARCHES) — a
    # page that used the web must name its sources, asked for or not
    web_searches: str = ""
    # "1" when this run may search the web (Toolbox.include_web): its scripts read it (VESTA_WEB_SEARCH_ON) — an
    # investigation page is refused without a search where one could be made
    web_search_on: str = ""
    # the role of the person this run answers ("owner", "fm"; "" for a job or a hook; "page" for the page's Offline
    # Test, which records nothing): its scripts read it (VESTA_ASKER) — a proposal is answered by the owner only
    asker: str = ""

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
        """Where scripts write and read their files: the run's own folder (in_folder), else out/ itself."""
        base = os.path.join(self.data_dir, "out")
        return os.path.join(base, self.run_folder) if self.run_folder else base

    def in_folder(self, name: str) -> "Settings":
        """These settings for one run, its files in out/<name> (made now).

        ⚠️ ONE FOLDER PER RUN (architecture review 14, 2026-10-10): every run wrote into out/ itself, and the reports
        skill names its files the same for both reports (facts.json, notes.json) — the weekly and the monthly report
        start together at 08:00 when the 1st is a Monday (1 June 2026, 1 February 2027), and either page could be
        built from the other's figures. A run's arguments, saved files and attachments all resolve in its folder."""
        from dataclasses import replace
        run = replace(self, run_folder=name)
        os.makedirs(run.out_dir, exist_ok=True)
        return run

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
                v = Policy.load(self.policy_path)       # a file that is not there is no rules: Policy({})
            except Exception as e:  # noqa: BLE001 — unreadable: the last good rules, never a stop
                # ⚠️ ANY READING THAT FAILS KEEPS THE LAST GOOD RULES (architecture review 17, then 18): any other error
                # stopped every message, alert and press; a YAML slip by hand (one quote left open) gave EMPTY rules —
                # nobody registered, alerts sent nowhere, the siren forgotten. The page names the slip (rules_problems).
                import logging
                logging.getLogger("vesta").error("policy.yaml could not be read (%s): the last good rules are kept",
                                                 type(e).__name__)
                v = self._policy_cache.get("value") or Policy({})
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
    for name in seed_config(s):          # said once, at the start that wrote it: the only trace a rewording leaves
        logging.getLogger("vesta").info("Settings: %s written from this version's starter", name)
    return s


#: Sentences of the starter instructions a release rewrote: (as an earlier release wrote it, as it is now). ⚠️ THE
#: VILLA'S instructions.md WAS COPIED ONCE (seed_config) and a later release never reaches it — so the owner's
#: "proceed" changed nothing on a villa already installed (rule 6, 2026-10-11). The old sentence is replaced only
#: where it still stands word for word: one the person reworded is theirs, and nothing else in the file is touched.
INSTRUCTION_REWRITES = (
    ("6. One question at most per message. Short. The reader's language.",
     "6. One question at most per message. Short for a status, a question or an action; an investigation "
     "(the investigate skill) is complete and may be long. "
     "Answer in the language the message is written in (a voice message: the language spoken); the language "
     "saved for the person only for a message that does not tell (\"ok\", a number) and for what you send on "
     "your own."),
    # rule 6 (0.12.301): "the reader's language" was read as the language SAVED for them: a French question was
    # answered in English (owner, 2026-10-20). The message's own language was said only in the concierge skill.
    ("is complete and may be long. The reader's language.",
     "is complete and may be long. "
     "Answer in the language the message is written in (a voice message: the language spoken); the language "
     "saved for the person only for a message that does not tell (\"ok\", a number) and for what you send on "
     "your own."),
    # rule 4 (0.12.160): asked what happened, the AI created a fault nobody asked for — in a chat it is now only offered
    ("A job for the facility manager is a ticket (create_ticket) in the villa's Facility records: it acts on nothing.",
     "A job for the facility manager is a ticket (create_ticket) in the villa's Facility records: it acts on nothing. "
     "In a chat it is only offered, with a button under your answer: never say a fault was created."),
    # rules 5 and 6 (0.12.201): the people never read "Home Assistant" (owner, 2026-10-15)
    ("5. A missing villa parameter: say which Home Assistant helper to create.",
     "5. A missing villa parameter: say which villa setting is missing."),
    ("say the device's name and the room.",
     "say the device's name and the room. Never name Home Assistant (or HA) to a person: say \"the villa's system\"."),
)


def seed_config(s: Settings) -> list[str]:
    """policy.yaml and instructions.md from the starter copies, when absent; then each INSTRUCTION_REWRITES sentence
    still word for word in the villa's instructions.md brought to its current wording.

    ⚠️ ONLY WHEN THE FILE IS MISSING, never merged into one that exists: a default
    spread under a person's file would bring back every line they deleted."""
    written = []
    for name, target in (("policy.example.yaml", s.policy_path), ("instructions.md", s.instructions_path)):
        src = os.path.join(STARTER_DIR, "config", name)
        if not os.path.exists(target) and os.path.exists(src):
            shutil.copyfile(src, target)
            written.append(os.path.basename(target))
    try:
        with open(s.instructions_path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return written
    new = text
    for old, now in INSTRUCTION_REWRITES:
        if now not in new:                           # once: a new wording may begin with the old one (rule 4)
            new = new.replace(old, now)
    if new != text:
        try:
            with open(s.instructions_path + ".tmp", "w", encoding="utf-8") as f:
                f.write(new)
            os.replace(s.instructions_path + ".tmp", s.instructions_path)
            written.append("instructions.md (reworded)")
        except OSError:
            pass                                     # a file that cannot be written keeps its wording: never a failed start
    return written
