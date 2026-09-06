"""⚠️ NINE TESTS WERE DELETED WITH THEIR SUBJECTS (2.953.0). `sparkline`,
`direction` and `phrase` had no production caller — this file was their only
reader, which is the "pure function extracted for testability while nothing
calls it" shape, and the tests were the thing keeping them alive. What remains
covers `series_from_history`, the one live entry point.

Numbers a reader can judge, and the zones that decide what leads.

The owner's diagnosis of a delivered brief, in their words: the report should
present "insight" that is "always relevant to this time period", and a headline
number should be understandable "from the single source of the current report".
"74 IDR" satisfies neither — 74 against what?

Two things follow: a comparison had to be COMPUTED (it never was), and the
document had to be reordered so what needs a person is not interleaved with what
the monitoring system has to say about itself.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.brief import trend
from vesta.brief.narrate import ReportContext
from vesta.shared.style import inert  # noqa: E402


def _ctx(**kw: Any) -> ReportContext:
    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "daily", "period": "2026-08-22",
        "generated_at": "2026-08-22T02:11:00+08:00",
        "discovery": {"reachable": True, "capabilities": [],
                      "capabilities_missing": [], "capability_absent": {},
                      "preflight": []},
    }
    base.update(kw)
    return ReportContext(**base)


# ── the chart has to survive delivery ───────────────────────────────────────

def test_history_is_filtered_to_the_same_cadence() -> None:
    """⚠️ A DAILY BRIEF COMPARED AGAINST WEEKLY TOTALS reports a catastrophe
    every time a weekly report happens to precede it."""
    entries = [{"cadence": "weekly", "avoidableCost": 700.0},
               {"cadence": "daily", "avoidableCost": 61.0},
               {"cadence": "daily", "avoidableCost": 58.0}]
    assert trend.series_from_history(entries, "avoidableCost", "daily") == [61.0, 58.0]


# ── zones ───────────────────────────────────────────────────────────────────





# ── the narration slot ──────────────────────────────────────────────────────



