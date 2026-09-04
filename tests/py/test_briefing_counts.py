"""Both "what happened" sections count the same way.

⚠️ FROM THE PHONE (2026-08-29): "I don't see the number of drill message
incremented by one … can you consistently adjust the way messages is reported in
the briefing to make it consistent with how the number of automation are also
reported there". Two sections listing the same KIND of fact — something that
happened, possibly more than once — counted it two different ways: automations
grouped and said "95 times", while the agent's own rows printed one line per
event, so a drill fired twice looked like a drill fired once.

⚠️ THE LEAD IS PART OF THE SAME RULE. "N thing(s) happened during this period"
must equal the number of lines a reader can count, which is why the grouping
happens once, above, and both the lead and the body read it.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import compose  # noqa: E402

_TWICE = [
    {"source": "agent", "title": "Pipeline drill", "domain": "", "outcome": "x"},
    {"source": "agent", "title": "Pipeline drill", "domain": "", "outcome": "x"},
    {"source": "automation", "subject": "night lighting---stairs"},
    {"source": "automation", "subject": "night lighting---stairs"},
    {"source": "automation", "subject": "night lighting---stairs"},
]


def test_a_repeated_agent_row_is_counted_like_a_repeated_automation() -> None:
    text = compose.brief(record=_TWICE).text
    assert "- Pipeline drill — 2 times" in text, (
        f"the agent section still prints one line per event:\n{text}")
    assert "- night lighting---stairs — 3 times" in text
    assert text.count("Pipeline drill") == 1, "the row was listed AND counted"


def test_a_single_event_carries_no_count_on_either_side() -> None:
    """⚠️ "1 times" IS THE OBVIOUS WAY TO GET THIS WRONG, and it reads as a
    fault in the writing rather than as a count."""
    once = [{"source": "agent", "title": "Odd draw", "domain": "", "outcome": "x"},
            {"source": "automation", "subject": "entrance unlocked"}]
    text = compose.brief(record=once).text
    assert "- Odd draw\n" in text and "1 times" not in text


def test_the_lead_equals_the_number_of_lines_below_it() -> None:
    """⚠️ GROUPS, NOT ROWS. Five records render as two lines, and a lead saying
    "5 thing(s) happened" above two lines is the count-vs-body mismatch this
    file exists to stop."""
    text = compose.brief(record=_TWICE).text
    assert text.startswith("2 thing(s) happened"), text.splitlines()[0]
    assert len([l for l in text.splitlines() if l.startswith("- ")]) == 2


def test_an_uninvestigated_FLAG_is_never_merged_with_a_CONCLUDED_one() -> None:
    """⚠️ THE QUALIFIER IS PART OF THE KEY. "noticed, not investigated" is a
    different fact from a concern somebody concluded; folding them together
    would report the total under whichever happened to be first."""
    mixed = [
        {"source": "agent", "title": "Leak", "domain": "water", "outcome": "x"},
        {"source": "triage", "title": "Leak", "domain": "water"},
    ]
    text = compose.brief(record=mixed).text
    assert "- [water] Leak\n" in text
    assert "- [water] Leak — noticed, not investigated" in text
    assert text.startswith("2 thing(s) happened")


def test_the_brief_says_how_many_incidents_ended_by_timeout() -> None:
    """⚠️ "3 times" reads the same whether every incident cleared or none did,
    and the difference is whether the rule is calibrated (2026-09-04)."""
    rows = [
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "opened"}},
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "timeout"}},
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "opened"}},
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "cleared"}},
    ]
    text = compose.brief(record=rows).text
    assert "- phase overload — 2 times · 1 ended by timeout" in text, text
