"""The agreement with the VESTA Kiosk, and this host's copy of it.

vesta_host/kiosk_contract.py reads /opt/vesta/host/agent-contract.json — a
COPY of the Kiosk's rootfs/usr/share/vesta/agent-contract.json. These fail the
moment the copy and the Kiosk's file differ (CI reads the Kiosk's from its dev2
branch; KIOSK_CONTRACT_REF overrides), and hold the stub's demo message and the
Kiosk's own sample to the rules the Kiosk enforces.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Importing the stub must leave nothing behind in its folder: the self-test's
# slot test copies that folder file by file, and a __pycache__ broke it.
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE.parent / "rootfs" / "opt" / "vesta" / "host"))
sys.path.insert(0, str(HERE.parent / "stub"))

from vesta_host import contract, kiosk_contract  # noqa: E402

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


class MessageRules(unittest.TestCase):
    def test_the_kiosks_own_sample_is_accepted(self):
        self.assertIsNone(kiosk_contract.message_problem(kiosk_contract.TABLE["samples"]["postMessage"]))

    def test_the_stubs_demo_message_is_accepted(self):
        import stub
        self.assertIsNone(kiosk_contract.message_problem(stub.DEMO_MESSAGE))

    def test_what_the_kiosk_refuses_is_refused(self):
        ok = kiosk_contract.TABLE["samples"]["postMessage"]
        limits = kiosk_contract.TABLE["message"]["limits"]
        for bad in (
            {**ok, "kind": "shout"},
            {**ok, "severity": "doom"},
            {**ok, "title": ""},
            {**ok, "title": "x" * (limits["title"] + 1)},
            {**ok, "buttons": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]},
            {**ok, "buttons": [{"id": "has space", "label": "A"}]},
            {**ok, "buttons": [{"id": f"b{i}", "label": "B"} for i in range(limits["buttons"] + 1)]},
            {**ok, "entities": ["Not An Entity"]},
            "not an object",
        ):
            self.assertIsNotNone(kiosk_contract.message_problem(bad), bad)


class TheStubsEnvironment(unittest.TestCase):
    def test_the_stub_checks_every_contract_variable(self):
        # The stub keeps its own list on purpose (it must look only at its
        # environment, as a real agent does) — so hold the copy to the source.
        import stub
        self.assertEqual(set(stub.CONTRACT), set(contract.NAMES) - {"VESTA_TELEGRAM_BOT_TOKEN"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
