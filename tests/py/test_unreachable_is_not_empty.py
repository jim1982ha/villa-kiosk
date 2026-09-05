"""An unreachable store must never render as a quiet villa.

⚠️ THE DEFECT (2026-09-06). `loadConcerns` ended in `if (!r.ok) return []`, and
`AgentConcerns` renders an empty list as "No alerts right now". So an add-on
that was down, a proxy returning 500, or a session that had expired all
produced the sentence a reader trusts LEAST when it is wrong: the villa is
fine. The component's own empty-state comment spends fifteen lines on exactly
this — "silence is only honest when it means nothing was raised" — and the
failure it guarded against arrived through the data layer instead, where the
comment could not see it.

⚠️ THREE STATES, AND THE MIDDLE ONE IS THE TRAP. `null` = not loaded, `[]` =
loaded and quiet, unreachable = we never got an answer. Two of those are
indistinguishable to a reader unless the screen says which.

⚠️ A CALLER MAY STILL CHOOSE `[]`, AND MUST SAY SO. `AgentTodo`,
`FlagTypesPanel` and `RecentChecks` each read the concern list as a supplement
beside a primary one, where treating unreachable as empty is right — so they
carry their own `.catch`, which a reader can see, rather than inheriting the
decision from a fetch helper three files away.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")


def _read(rel: str) -> str:
    with open(os.path.join(SRC, rel), encoding="utf-8") as handle:
        return handle.read()


def test_the_fetch_helper_does_not_swallow_an_unreachable_store() -> None:
    api = _read(os.path.join("vesta", "supervise", "agentApi.ts"))
    body = api[api.index("export async function loadConcerns"):]
    body = body[:body.index("\nexport ")] if "\nexport " in body else body
    assert "return []" not in body, (
        "loadConcerns returns an empty list for a failed read again — the "
        "alert wall renders that as 'No alerts right now'")
    assert re.search(r"throw new Error\(", body), (
        "loadConcerns no longer signals that the store was unreachable, so "
        "no caller can tell 'quiet' from 'could not ask'")


def test_the_alert_wall_answers_unreachable_before_empty() -> None:
    """⚠️ ORDER IS THE ASSERTION. Answered after the empty check, the wall
    still claims the villa is quiet; answered after the `null` check, a villa
    with no path to the add-on spins for ever."""
    whole = _read(os.path.join("vesta", "supervise", "components",
                               "AgentConcerns.tsx"))
    # ⚠️ THE COMPONENT BODY, NOT THE FILE. `rows.length === 0` also appears in
    # the `sentSummary` helper ABOVE the component, so a naive index() compared
    # the render order against a helper and failed on a correct file. Found by
    # running this test, which is the only reason it is not still wrong.
    wall = whole[whole.index("export default function AgentConcerns"):]
    assert "unreachable" in wall, "the wall cannot represent an unreachable store"
    assert "if (unreachable)" in wall, (
        "the wall has no branch for an unreachable store")
    assert wall.index("if (unreachable)") < wall.index("if (rows === null)"), (
        "the unreachable branch sits after the loading branch, so a villa "
        "that cannot reach the add-on shows a spinner for ever")
    assert wall.index("if (unreachable)") < wall.index("rows.length === 0"), (
        "the unreachable branch sits after the empty branch, so a failed read "
        "still reports a quiet villa")


def test_a_caller_that_treats_unreachable_as_empty_says_so() -> None:
    """⚠️ THE CHOICE MUST BE VISIBLE AT THE CALL SITE. These three are
    supplementary readers; blanking their whole panel because the concern store
    was unreachable would be worse. That is a decision, and a decision belongs
    where a reader meets it."""
    for rel in (("vesta", "supervise", "components", "AgentTodo.tsx"),
                ("vesta", "supervise", "components", "FlagTypesPanel.tsx"),
                ("vesta", "supervise", "components", "RecentChecks.tsx")):
        text = _read(os.path.join(*rel))
        call = text.index("loadConcerns()")
        assert ".catch(" in text[call:call + 120], (
            f"{rel[-1]} calls loadConcerns() without saying what an "
            "unreachable store means for it — it now throws")
