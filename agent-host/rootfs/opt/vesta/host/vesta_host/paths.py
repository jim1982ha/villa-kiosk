"""Every path the host touches (SPEC 9), in one place.

⚠️ `VESTA_ROOT` EXISTS FOR THE TESTS ONLY. It prefixes every path so the unit
tests can run the real start-up code against a temporary directory instead of
a copy of it. In the image it is unset and the paths are the absolute ones.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("VESTA_ROOT", "/"))

OPTIONS_JSON = ROOT / "data/options.json"      # written by the Supervisor
DATA_AGENT = ROOT / "data/agent"               # agent state (VESTA_DATA_DIR)
DATA_HOST = ROOT / "data/host"                 # selftest.json, start info
CONFIG_SKILLS = ROOT / "config/skills"         # VESTA Skills (VESTA_SKILLS_DIR)
CONFIG_AGENT = ROOT / "config/agent"           # agent-owned editable settings
AGENT_DIR = ROOT / "opt/vesta/agent"           # the VESTA Agent (built with AGENT_REF)
STUB_DIR = ROOT / "opt/vesta/stub"             # the self-test stub, always present
MANIFEST = "vesta-agent.yaml"
AGENT_MANIFEST = AGENT_DIR / MANIFEST
TEMPLATES = ROOT / "opt/vesta/host/templates"
# /run is a tmpfs: the prepared environment and the redaction list never touch
# a disk that is backed up or visible from Home Assistant (SPEC H8).
RUN = ROOT / "run/vesta"
AGENT_ENV = RUN / "agent-env.json"
REDACT = RUN / "redact.json"
HOST_STATE = RUN / "host.json"                 # host-only flags, never given to the agent
SELFTEST = DATA_HOST / "selftest.json"
CRASHES = DATA_HOST / "crashes.json"
UI_CRASHES = DATA_HOST / "ui-crashes.json"
SIDECAR_ENV = RUN / "sidecar.json"             # the sidecar's settings (holds the HA token)
SIDECAR_HOME = DATA_HOST / "ha-mcp"            # anything the HA MCP server writes
# The pinned HA MCP server, in its own virtualenv (agent-host/Dockerfile).
SIDECAR_BIN = str(ROOT / "opt/vesta/ha-mcp/bin/ha-mcp-web")

# The in-container paths the AGENT sees. Always the real ones: they are part of
# the environment contract (SPEC 7), not of this container's test layout.
CONTRACT_SKILLS_DIR = "/config/skills"
CONTRACT_AGENT_CONFIG_DIR = "/config/agent"
CONTRACT_DATA_DIR = "/data/agent"
