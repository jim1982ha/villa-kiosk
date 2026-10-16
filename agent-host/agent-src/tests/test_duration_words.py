"""How long something lasted, ONE rule on both apps (architecture review round 2, 2026-10-16): the agreement's
`duration.cases` (agent-contract.json, the Kiosk's file copied) are the words; the Kiosk's oracle duration_words.mjs
holds its chartUtils.fmtDuration to the same cases. Before: the Kiosk said "1 min" for 89 s and this agent "89 s";
1 h 29 min 30 s read "1 h 30 min" there and "1 h 29 min" here. The weekly report's own rule is in test_reports."""
from __future__ import annotations

import json
import os

from vesta_shared.timeutil import lasting

CONTRACT = os.path.join(os.path.dirname(__file__), "..", "..", "rootfs", "opt", "vesta", "host", "agent-contract.json")
CASES = json.load(open(CONTRACT))["duration"]["cases"]


def test_the_agreement_holds_the_cases_both_apps_read():
    assert len(CASES) >= 20 and all({"seconds", "words"} <= set(c) for c in CASES)


def test_every_agreed_duration_is_said_as_the_kiosk_says_it():
    wrong = [(c["seconds"], c["words"], lasting(c["seconds"])) for c in CASES if lasting(c["seconds"]) != c["words"]]
    assert not wrong, wrong
