"""The engine's version is written in three places; they are one version.

vesta-agent.yaml (what the host reads), vesta_agent.__version__ (what the page
shows, and the static files' cache path) and the top entry of CHANGELOG.md
(what a release names: agent-host/tools/release.py copies it into the other
two). Nothing compared them before 0.6.18.
"""
from __future__ import annotations

import os
import re

from helpers import ROOT

import vesta_agent


def _read(name: str) -> str:
    return open(os.path.join(ROOT, name), encoding="utf-8").read()


def test_the_manifest_the_package_and_the_changelog_name_one_version():
    manifest = re.search(r'^version:\s*"?([^"\s]+)"?', _read("vesta-agent.yaml"), re.M).group(1)
    changelog = re.search(r"^## (\d+\.\d+\.\d+)\b", _read("CHANGELOG.md"), re.M).group(1)
    assert manifest == vesta_agent.__version__ == changelog, (manifest, vesta_agent.__version__, changelog)
