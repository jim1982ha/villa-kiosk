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
