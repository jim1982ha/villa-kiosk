"""Every step header on the Briefing tab sits directly over its OWN body.

⚠️ 2026-08-29, found during the owner's revamp of this tab: the 2.874.0 merge
of four tabs into one re-tagged every body to `tab === "briefing"` WITHOUT
re-ordering them, so the composed brief rendered under "What is watched" and
the checks under "What it can see". Nothing pinned a header to its body — the
headers and the bodies were declared in two lists that happened to agree while
they were separate tabs, and stopped agreeing the moment they shared a page.

The pin derives both sequences from the modal's source and asserts the pairing,
so a future re-order that forgets one half goes red rather than shipping a page
whose headings describe the wrong sections.
"""
from __future__ import annotations

import os
import re
from typing import List, Tuple

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODAL = os.path.join(REPO_ROOT, "src", "vesta", "brief", "components",
                     "ReportsModal.tsx")

#: header step id → the component that must be the NEXT body after it.
#:
#: ⚠️ `RecordTab` WAS EXCLUDED HERE AND IS NOW A STEP (2026-08-30). It rendered
#: as a section under the watched step; the owner asked for one tab per step,
#: so it has its own header and its own body like every other. The exclusion
#: had a second effect worth remembering: excluding it from the SEQUENCE also
#: excluded it from being REQUIRED, and deleting its mount left every test
#: green until a mutation said otherwise.
#: ⚠️ THE PAIRING IS THE HAND-WRITTEN FACT (a header means one thing); the
#: ORDER on the page is read from the source, so re-ordering whole sections
#: stays free — only separating a header from its body fails.
BODY_OF = {
    "watched": "ModulesTab",
    "happened": "RecordTab",
    "visible": "CoverageTab",
    "brief": "PreviewTab",
}


def _sequence() -> List[Tuple[str, str]]:
    """Every TierIntro step and tab body inside the briefing tab, in order."""
    with open(MODAL, encoding="utf-8") as handle:
        source = handle.read()
    out: List[Tuple[str, str]] = []
    for match in re.finditer(
            r"TierIntro tier=\{STEPS\.(\w+)\}|<(\w+Tab)\b", source):
        if match.group(1):
            out.append(("step", match.group(1)))
        else:
            out.append(("body", match.group(2)))
    return out


def test_each_step_header_is_followed_by_its_own_body() -> None:
    seq = _sequence()
    steps = [(i, name) for i, (kind, name) in enumerate(seq) if kind == "step"]

    # ⚠️ VACUOUS-PASS GUARDS: the regex must still find the page.
    assert len(steps) >= 3, f"only {len(steps)} step headers parsed: {seq}"
    assert any(kind == "body" for kind, _ in seq), "no tab bodies parsed"

    for i, name in steps:
        expected = BODY_OF.get(name)
        assert expected is not None, (
            f"a new step '{name}' has no declared body — add it to BODY_OF "
            "with the component its header describes")
        following = [n for kind, n in seq[i + 1:] if kind == "body"]
        assert following and following[0] == expected, (
            f"the '{name}' header is followed by "
            f"{following[0] if following else 'nothing'}, not {expected} — "
            "a heading over somebody else's section is the 2.874.0 scramble "
            "again")


def test_the_record_section_is_on_the_page() -> None:
    """⚠️ NOTHING PINNED THIS UNTIL A MUTATION SAID SO (2026-08-30). The record
    is what the briefing reads and what the owner asked to be able to see; the
    layout pin excluded it (correctly — it is a section, not a step body) and
    excluding it from the SEQUENCE quietly excluded it from being REQUIRED. A
    mutation that deleted the mount left every test green.

    It renders BEFORE the coverage step, so a reader meets what happened before
    being asked whether the property can measure it.
    """
    with open(MODAL, encoding="utf-8") as handle:
        source = handle.read()
    assert "<RecordTab" in source, (
        "the record is not mounted — the briefing reads it, and the owner "
        "asked to be able to see what it will summarise")
    assert source.index("STEPS.happened") < source.index("STEPS.visible"), (
        "the record's step renders after the coverage step; what happened "
        "comes before whether the property could have measured it")


def test_the_composing_and_sending_section_is_one_story() -> None:
    """⚠️ THE OWNER'S MERGE: compose, schedule and the delivery record read as
    one section under one header. A second header between them re-splits what
    was deliberately joined."""
    seq = _sequence()
    names = [n for _, n in seq]
    for name in ("PreviewTab", "ScheduleTab", "HistoryTab"):
        assert name in names, f"{name} left the page"
    a, b = names.index("PreviewTab"), names.index("HistoryTab")
    between = [n for kind, n in seq[a:b] if kind == "step"]
    assert not [s for s in between if s != "brief"], (
        f"step header(s) {between} split the composing-and-sending story")
