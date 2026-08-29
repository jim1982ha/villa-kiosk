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
#: ⚠️ THE PAIRING IS THE HAND-WRITTEN FACT (a header means one thing); the
#: ORDER on the page is read from the source, so re-ordering whole sections
#: stays free — only separating a header from its body fails.
BODY_OF = {
    "watched": "ModulesTab",
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
        elif match.group(2) not in ("AutomationsTab",):
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
