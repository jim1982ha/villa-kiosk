"""The agreement with the VESTA Kiosk, and this host's copy of it.

vesta_host/kiosk_contract.py reads /opt/vesta/host/agent-contract.json — a
COPY of the Kiosk's rootfs/usr/share/vesta/agent-contract.json. These fail the
moment the copy and the Kiosk's file differ (CI reads the Kiosk's from its dev2
branch; KIOSK_CONTRACT_REF overrides).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rootfs" / "opt" / "vesta" / "host"))

from vesta_host import kiosk_contract  # noqa: E402

KIOSK_FILE = "rootfs/usr/share/vesta/agent-contract.json"


def kiosk_copy() -> dict:
    """The Kiosk's own file, from git — never skipped: a check that cannot
    read what it compares must fail, not pass."""
    for ref in [os.environ.get("KIOSK_CONTRACT_REF"), "origin/dev2", "dev2"]:
        if not ref:
            continue
        r = subprocess.run(["git", "show", f"{ref}:{KIOSK_FILE}"], cwd=HERE, capture_output=True, text=True)
        if r.returncode == 0:
            return json.loads(r.stdout)
    raise AssertionError(f"the Kiosk's {KIOSK_FILE} could not be read from git (fetch dev2)")


class TheCopy(unittest.TestCase):
    def test_is_the_kiosks_file(self):
        self.assertEqual(kiosk_contract.TABLE, kiosk_copy(),
                         "agent-host/rootfs/opt/vesta/host/agent-contract.json differs from the Kiosk's — "
                         "copy the Kiosk's file (and bump the host) instead of editing one side")

    def test_version_is_a_positive_number(self):
        self.assertGreaterEqual(kiosk_contract.VERSION, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
