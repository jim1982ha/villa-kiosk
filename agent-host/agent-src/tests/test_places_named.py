"""Every sentence that sends a reader to the VESTA Agent page names the place through places.py (owner, 2026-10-08: one
name per place). Architecture review scan 4 (2026-10-19): four sentences in ai_jobs, app and skills wrote
"VESTA Agent page → Rules → AI jobs" by hand — one named a card that no longer exists ("AI jobs" is "AI brains and
limits"). The tracked engine files are read; an arrow after "page" outside places.py fails, naming file and line."""
from __future__ import annotations

import os
import re
import subprocess

ROOT = os.path.join(os.path.dirname(__file__), "..")
BY_HAND = re.compile(r"page (→|›)")


def test_no_sentence_names_a_place_by_hand():
    files = subprocess.run(["git", "ls-files", "vesta_agent"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    assert files, "git ls-files found nothing: run from the checkout"
    hits = []
    for f in files:
        if not f.endswith(".py") or f.endswith("places.py"):
            continue
        with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
            hits += [f"{f}:{i}: {line.strip()[:80]}" for i, line in enumerate(fh, 1) if BY_HAND.search(line)]
    assert hits == [], hits


def test_the_sentences_name_the_places_as_the_page_does():
    from vesta_agent import tool_access
    from vesta_agent.ai_jobs import not_set
    from vesta_agent.places import tab, where
    assert not_set("fm-weekly") == f"The fm-weekly report is not set up yet ({where('ai')}), so it cannot run."
    assert where("ai") == "Rules › AI brains and limits" and tab("skills") == "VESTA Agent page › Skills"
    assert where("tool_roles") in tool_access.start_job_off() and "this person" in tool_access.start_job_off("this person")
