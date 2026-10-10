"""Shared bits of the synthetic tests."""
from __future__ import annotations

import os
import shutil

from vesta_agent import config

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STARTER_SKILLS = os.path.join(ROOT, "starter", "skills")
#: A script run by a test sees the engine's shared code AND the tests' own FixtureClient (--fixture-dir).
PYTHONPATH = ROOT + os.pathsep + os.path.join(ROOT, "tests")


def settings(tmp, **env) -> config.Settings:
    """Settings as the host's environment contract gives them, folders under tmp."""
    base = {
        "ANTHROPIC_API_KEY": "sk-ant-TEST-000000000000",
        "VESTA_HA_MCP_URL": "http://127.0.0.1:9/mcp",
        "VESTA_HA_URL": "http://127.0.0.1:9", "VESTA_HA_TOKEN": "ha-TEST-token-0000",
        "VESTA_TELEGRAM_ENABLED": "false",
        "VESTA_KIOSK_URL": "", "VESTA_KIOSK_TOKEN": "",
        "VESTA_SKILLS_DIR": os.path.join(tmp, "skills"),
        "VESTA_AGENT_CONFIG_DIR": os.path.join(tmp, "agent"),
        "VESTA_DATA_DIR": os.path.join(tmp, "data"),
        "TZ": "UTC",
    }
    base.update(env)
    old = {k: os.environ.get(k) for k in base}
    os.environ.update({k: v for k, v in base.items() if v is not None})
    try:
        return config.load()
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def copy_skill(name: str, skills_dir: str) -> str:
    dst = os.path.join(skills_dir, name)
    shutil.copytree(os.path.join(STARTER_SKILLS, name), dst)
    return dst


STATIC = os.path.join(ROOT, "vesta_agent", "ui", "static")


def page_js() -> str:
    """Every script of the VESTA Agent page (app.js and the tab modules it imports), as one text for the pins.
    A module added to the page is read here without anyone listing it."""
    import glob
    return "\n".join(open(f, encoding="utf-8").read() for f in sorted(glob.glob(os.path.join(STATIC, "*.js"))))


def body_of(js: str, name: str) -> str:
    """One top-level function of the page's scripts, from its name to the next top-level function."""
    import re
    start = re.search(rf"\n(?:export )?(?:async )?function {re.escape(name)}\b", js)
    assert start, f"no function {name} in the page's scripts"
    rest = js[start.end():]
    end = re.search(r"\n(?:export )?(?:async )?function ", rest)
    return rest[:end.start()] if end else rest


def make_agent(tmp_path, policy: dict, *, skills=(), telegram=None, reader=None, kiosk=None, telegram_on: bool = True):
    """An agent on a test villa: these rules (policy.yaml), these starter skills, the shared stand-ins.

    ⚠️ ONE WAY TO BUILD THE TEST VILLA (architecture review, 2026-10-07): seven test files each wrote the rules,
    copied the skills and built the agent by hand, so a change to the agent's constructor edited all of them.
    `telegram`, `reader` (Home Assistant), `kiosk`: tests/telegram_fake.py, ha_fake.py and the Kiosk switched off,
    unless given. `telegram_on=False`: the takeover is off and nothing is sent (no Telegram at all)."""
    import yaml
    from ha_fake import FakeHA
    from telegram_fake import FakeTelegram
    from vesta_agent.app import Vesta
    from vesta_agent.kiosk import Kiosk
    env = {"VESTA_TELEGRAM_ENABLED": "true" if telegram_on else "false", "VESTA_TELEGRAM_BOT_TOKEN": "42:TG-TEST"}
    s = settings(str(tmp_path), **env)
    with open(s.policy_path, "w") as f:
        yaml.safe_dump(policy, f)
    for name in skills:
        copy_skill(name, s.skills_dir)
    tg = telegram if telegram is not None else (FakeTelegram() if telegram_on else None)
    return Vesta(s, telegram=tg, reader=reader or FakeHA(), kiosk=kiosk or Kiosk("", ""))


def make_skill(skills_dir: str, name: str, spec: dict, scripts: dict[str, str] | None = None, md: str = "") -> str:
    """A skill folder written for a test: its skill.yaml (`spec`), SKILL.md and scripts {file name: code}."""
    import yaml
    d = os.path.join(skills_dir, name)
    os.makedirs(os.path.join(d, "scripts"), exist_ok=True)
    with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as f:
        f.write(md or f"# {name}\n")
    with open(os.path.join(d, "skill.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump(spec, f)
    for fname, code in (scripts or {}).items():
        with open(os.path.join(d, "scripts", fname), "w", encoding="utf-8") as f:
            f.write(code)
    return d


def run_kit(names=(), server=None, tools=()):
    """A run's built tools (tools.Kit) for a test that calls runner.run itself."""
    from vesta_agent.tools import Kit
    return Kit(server, set(names), list(tools))


def run_terms(who="x", profile="auto", limit_usd=1.0, tools=()):
    """A run's terms (turn.Terms) for a test that calls runner.run itself."""
    from vesta_agent.turn import Terms
    return Terms(frozenset(tools), profile, float(limit_usd), who)


def body(text: str) -> str:
    """A notice's body: what follows its heading (vesta_agent/notice.py — "For: …", the incident, "-------")."""
    from vesta_agent.notice import RULE
    return text.split(f"{RULE}\n", 1)[1] if f"{RULE}\n" in text else text
