"""The environment contract, read from both sides: what the host sends is what the agent reads.

contract.NAMES (the host) and vesta_agent/config.py (the agent's reader) are
two lists of one agreement, and only the stub's copy was compared with the
host's (test_kiosk_contract.py). A name renamed on one side alone left the
agent reading an empty value — a missing token reads exactly like "not
configured". The agent stays its own package (it may leave this repository,
agent-host/CLAUDE.md), so this compares the agent's SOURCE rather than
importing one list into both.
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rootfs" / "opt" / "vesta" / "host"))
from vesta_host import contract, kiosk_contract, paths  # noqa: E402

AGENT = HERE.parent / "agent-src"
CONFIG = (AGENT / "vesta_agent" / "config.py").read_text()


def agent_reads() -> set[str]:
    """Every contract-shaped name the agent's code reads from its environment."""
    names = set()
    for f in list((AGENT / "vesta_agent").rglob("*.py")) + list((AGENT / "vesta_shared").rglob("*.py")):
        text = f.read_text()
        names |= set(re.findall(r'_env\("([A-Z_]+)"', text))
        names |= set(re.findall(r'os\.environ(?:\.get)?\(?\[?"([A-Z_]+)"', text))
    return names


class TheContract(unittest.TestCase):
    def test_every_name_the_agents_reader_asks_for_is_sent_by_the_host(self):
        asked = set(re.findall(r'_env\("([A-Z_]+)"', CONFIG))
        self.assertTrue(asked, "config.py reads nothing through _env: the pattern no longer matches it")
        self.assertEqual(sorted(asked - set(contract.NAMES)), [],
                         "vesta_agent/config.py reads a name the host never sends (renamed on one side?)")

    def test_every_name_the_host_sends_is_read_by_the_agent(self):
        self.assertEqual(sorted(set(contract.NAMES) - agent_reads()), [],
                         "the host sends a name no agent code reads (renamed on one side?)")

    def test_the_agents_folder_fallbacks_are_the_hosts_folders(self):
        for name, folder in (("VESTA_SKILLS_DIR", paths.CONTRACT_SKILLS_DIR),
                             ("VESTA_AGENT_CONFIG_DIR", paths.CONTRACT_AGENT_CONFIG_DIR),
                             ("VESTA_DATA_DIR", paths.CONTRACT_DATA_DIR)):
            m = re.search(rf'_env\("{name}", "([^"]*)"\)', CONFIG)
            self.assertIsNotNone(m, f"config.py has no fallback for {name}")
            self.assertEqual(m.group(1), folder, f"{name}: the agent falls back to a folder the host does not use")


    def test_the_engine_speaks_the_kiosk_agreement_version_the_host_reads(self):
        # vesta_agent/kiosk.py's CONTRACT was typed from memory; the host's comes
        # from the Kiosk's own agent-contract.json (test_kiosk_contract.py).
        m = re.search(r"^CONTRACT = (\d+)$", (AGENT / "vesta_agent" / "kiosk.py").read_text(), re.M)
        self.assertIsNotNone(m, "vesta_agent/kiosk.py has no CONTRACT = <n>")
        self.assertEqual(int(m.group(1)), kiosk_contract.VERSION,
                         "the engine speaks a different Kiosk agreement version than the host's copy names")


if __name__ == "__main__":
    unittest.main(verbosity=1)
