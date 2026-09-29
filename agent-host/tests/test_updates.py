#!/usr/bin/env python3
"""The hourly update check (agent-host/tools/check_updates.py), driven with
fake PyPI and GitHub answers: only ever forward, one app release per change,
and the three files it writes agree. No request leaves the runner."""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check_updates", HERE.parent / "tools" / "check_updates.py")
cu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cu)


class Updates(unittest.TestCase):
    def test_only_forward(self) -> None:
        self.assertTrue(cu.newer("8.6.0", "8.5.0"))
        self.assertTrue(cu.newer("8.10.0", "8.9.1"), "compared as numbers, not text")
        self.assertFalse(cu.newer("8.5.0", "8.5.0"))
        self.assertFalse(cu.newer("8.4.9", "8.5.0"), "a release that moved back is not an update")
        self.assertFalse(cu.newer("", "8.5.0"))
        self.assertTrue(cu.newer("v1.0.0", ""), "the agent's first release")
        self.assertTrue(cu.newer("v1.1.0", "v1.0.0"))

    def test_latest_versions_from_the_sources(self) -> None:
        pypi = lambda url, token="": {"info": {"version": "8.6.0"}}
        self.assertEqual(cu.latest_ha_mcp(pypi), "8.6.0")
        seen = []
        def gh(url, token=""):
            seen.append((url, token))
            return {"tag_name": "v1.2.0"}
        self.assertEqual(cu.latest_agent("fabien/vesta-agent", "tok", gh), "v1.2.0")
        self.assertEqual(seen, [("https://api.github.com/repos/fabien/vesta-agent/releases/latest", "tok")])
        self.assertEqual(cu.latest_agent("", "tok", gh), "", "no repository yet: nothing asked")
        def none(url, token=""):
            raise urllib.error.HTTPError(url, 404, "no release", {}, None)
        self.assertEqual(cu.latest_agent("fabien/vesta-agent", "", none), "", "no release yet is not an error")

    def test_plan(self) -> None:
        v = {"ha_mcp": "8.5.0", "agent_repo": "fabien/vesta-agent", "agent_ref": "v1.0.0"}
        same, lines = cu.plan(v, "8.5.0", "v1.0.0")
        self.assertEqual((same, lines), (v, []), "nothing new: nothing to release")
        new, lines = cu.plan(v, "8.6.0", "v1.1.0")
        self.assertEqual(new, {"ha_mcp": "8.6.0", "agent_repo": "fabien/vesta-agent", "agent_ref": "v1.1.0"})
        self.assertEqual(len(lines), 2)
        self.assertIn("HA MCP 8.6.0", lines[0])
        self.assertIn("VESTA Agent v1.1.0", lines[1])

    def test_apply_writes_three_files_that_agree(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "agent-host").mkdir()
            (root / "vesta-agent").mkdir()
            (root / "agent-host/versions.json").write_text(json.dumps({"ha_mcp": "8.5.0", "agent_repo": "", "agent_ref": ""}))
            (root / "vesta-agent/config.yaml").write_text('name: "VESTA Agent"\nversion: "0.7.0"\nslug: vesta_agent\n')
            (root / "vesta-agent/CHANGELOG.md").write_text("## 0.7.0\n\n- before\n")
            cu.VERSIONS, cu.CONFIG, cu.CHANGELOG = (root / "agent-host/versions.json",
                                                    root / "vesta-agent/config.yaml", root / "vesta-agent/CHANGELOG.md")
            version = cu.apply({"ha_mcp": "8.6.0", "agent_repo": "", "agent_ref": ""}, ["HA MCP 8.6.0"])
            self.assertEqual(version, "0.7.1")
            self.assertIn('version: "0.7.1"', cu.CONFIG.read_text())
            self.assertEqual(json.loads(cu.VERSIONS.read_text())["ha_mcp"], "8.6.0")
            cl = cu.CHANGELOG.read_text()
            self.assertTrue(cl.startswith("## 0.7.1\n"), "the Update dialog shows the new entry first")
            self.assertIn("- HA MCP 8.6.0", cl)
            self.assertIn("## 0.7.0", cl)


class Wiring(unittest.TestCase):
    def test_the_dockerfile_has_no_version_of_its_own(self) -> None:
        df = (HERE.parent / "Dockerfile").read_text()
        self.assertNotIn("HA_MCP_VERSION=8", df, "the version lives in versions.json only")
        self.assertIn('test -n "${HA_MCP_VERSION}"', df)
        self.assertIn("COPY agent-src /opt/vesta/agent", df)

    def test_ci_builds_from_versions_json(self) -> None:
        wf = (HERE.parents[1] / ".github/workflows/agent-host.yaml").read_text()
        self.assertIn("HA_MCP_VERSION=${{ steps.versions.outputs.ha_mcp }}", wf)
        self.assertIn("path: agent-host/agent-src", wf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
