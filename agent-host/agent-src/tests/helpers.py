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
