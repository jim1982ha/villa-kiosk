#!/usr/bin/env python3
"""Look for a newer HA MCP release and a newer VESTA Agent release, and when
there is one, make the release that ships it (docs/agent-host/SPEC.md 4.3).

What it changes, and only this:
  * agent-host/versions.json   — the versions the image is built from;
  * vesta-agent/config.yaml    — the app version, one patch step up, so Home
                                 Assistant offers the update;
  * vesta-agent/CHANGELOG.md   — what the owner reads in the Update dialog.

It decides nothing about safety: the build that follows starts the new HA MCP
server and the agent slot exactly as the Supervisor would, and a version that
fails there is never published (agent-host.yaml, container_test.sh).

Run by .github/workflows/agent-updates.yaml. Prints `changed=true|false` for
the workflow. `--dry-run` fetches and reports without writing.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSIONS = ROOT / "agent-host" / "versions.json"
CONFIG = ROOT / "vesta-agent" / "config.yaml"
CHANGELOG = ROOT / "vesta-agent" / "CHANGELOG.md"


def _get_json(url: str, token: str = "") -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "vesta-agent-updates"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def latest_ha_mcp(get=_get_json) -> str:
    """The newest STABLE ha-mcp release on PyPI (PyPI's `info.version`)."""
    return str(get("https://pypi.org/pypi/ha-mcp/json")["info"]["version"])


def latest_agent(repo: str, token: str, get=_get_json) -> str:
    """The tag of the agent repository's latest published release ("" when it
    has none yet). A draft or a pre-release is never "latest" on GitHub."""
    if not repo:
        return ""
    try:
        return str(get(f"https://api.github.com/repos/{repo}/releases/latest", token)["tag_name"])
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return ""
        raise


def _numbers(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v))


def newer(candidate: str, current: str) -> bool:
    """Only ever FORWARD: a release that moved back (a yanked version, a tag
    re-pointed) is not an update."""
    if not candidate or candidate == current:
        return False
    if not current:
        return True
    return _numbers(candidate) > _numbers(current)


def bump_patch(version: str) -> str:
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def plan(versions: dict, ha_mcp: str, agent: str) -> tuple[dict, list[str]]:
    """The versions to build with, and one changelog line per change."""
    out, lines = dict(versions), []
    if newer(ha_mcp, versions.get("ha_mcp", "")):
        lines.append(f"The agent's Home Assistant MCP server moves to **HA MCP {ha_mcp}** "
                     f"(from {versions.get('ha_mcp')}). The build checked that it starts and "
                     f"lists its tools before this update was offered.")
        out["ha_mcp"] = ha_mcp
    if newer(agent, versions.get("agent_ref", "")):
        before = versions.get("agent_ref") or "none"
        lines.append(f"**VESTA Agent {agent}** (from {before}), from {versions['agent_repo']}.")
        out["agent_ref"] = agent
    return out, lines


def apply(new_versions: dict, lines: list[str]) -> str:
    """Write the three files; returns the new app version."""
    VERSIONS.write_text(json.dumps(new_versions, indent=2) + "\n")
    cfg = CONFIG.read_text()
    current = re.search(r'^version:\s*"([^"]+)"', cfg, re.M).group(1)
    version = bump_patch(current)
    CONFIG.write_text(re.sub(r'^version:\s*"[^"]+"', f'version: "{version}"', cfg, count=1, flags=re.M))
    entry = f"## {version}\n\n### Updated automatically\n" + "".join(f"- {l}\n" for l in lines) + "\n"
    CHANGELOG.write_text(entry + CHANGELOG.read_text())
    return version


def main() -> int:
    dry = "--dry-run" in sys.argv
    versions = json.loads(VERSIONS.read_text())
    ha_mcp = latest_ha_mcp()
    agent = latest_agent(versions.get("agent_repo", ""), os.environ.get("AGENT_REPO_TOKEN", ""))
    new_versions, lines = plan(versions, ha_mcp, agent)
    print(f"HA MCP: in use {versions.get('ha_mcp')}, latest {ha_mcp}")
    print(f"VESTA Agent: repo {versions.get('agent_repo') or '(not set yet)'}, "
          f"in use {versions.get('agent_ref') or '(none)'}, latest {agent or '(none)'}")
    if not lines or dry:
        print("changed=false" if not lines else "changed=would")
        return 0
    version = apply(new_versions, lines)
    print(f"app version {version}")
    print("changed=true")
    return 0


if __name__ == "__main__":
    sys.exit(main())
