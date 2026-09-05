"""A screen that sends somebody somewhere must be right about where.

⚠️ WHAT THIS PAYS FOR (2026-09-06). `ReportsModal` opens on `manageFacility`,
which a facility manager holds, while every one of its tabs is `configure:
true` — owner only. So they open Briefings and there is nothing in it, and the
panel now tells them where their jobs actually are: VESTA Agent → "Act & Tell".

⚠️ THE FIRST ANSWER TO THIS WAS TO UN-GATE A TAB, AND IT WAS WRONG. The tab a
facility manager was originally admitted for — "What it asked for" — was
DELETED on purpose: it listed to-do items the villa's BLUEPRINTS raised, the
cutover retired every blueprint that called `todo.add_item`, and the tab then
quietly began showing the agent's rows under a "Safety reflex" chip.
`test_the_RETIRED_tab_is_gone_rather_than_emptied` guards that deletion and
caught the attempt to rebuild it. Nothing needs un-gating: every remaining step
IS owner configuration, and one opened up would offer a save the proxy refuses.

⚠️ SO THE PIN IS ON THE SIGNPOST'S TRUTH, NOT ON ITS WORDING. A sentence naming
a destination is a claim about the rest of the app, and it rots the moment that
destination moves — which is exactly what happened to the tab it replaced.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")


def _read(*parts: str) -> str:
    with open(os.path.join(SRC, *parts), encoding="utf-8") as handle:
        return handle.read()


def test_the_empty_panel_names_where_the_jobs_actually_are() -> None:
    modal = _read("vesta", "brief", "components", "ReportsModal.tsx")
    body = modal[modal.index("tab === null"):]
    body = body[:body.index(")}")]
    assert "Act &amp; Tell" in body or "Act & Tell" in body, (
        "the empty panel no longer says where a facility manager's jobs are, "
        "so it is a dead end again")
    assert "VESTA Agent" in body, (
        "the empty panel names a tab but not the door it is behind")


def test_that_destination_still_exists_and_is_still_called_that() -> None:
    """⚠️ THE HALF A SENTENCE CANNOT CHECK ITSELF. Renaming the tab would leave
    the signpost pointing at a label nobody can see."""
    agent = _read("vesta", "supervise", "components", "AgentModal.tsx")
    assert re.search(r'label:\s*"Act & Tell"', agent), (
        "the 'Act & Tell' tab has been renamed or removed, so the empty panel "
        "in Briefings now sends a facility manager to a label that is not on "
        "their screen")
    assert "AgentTodo" in agent, (
        "the jobs list is no longer rendered in the agent modal")


def test_a_facility_manager_can_actually_get_there() -> None:
    """⚠️ AND CAN ACT WHEN THEY ARRIVE. Sending them to a list they may read
    but not tick off would be a worse dead end than the one this replaced."""
    dash = _read("pages", "Dashboard.tsx")
    opener = dash[dash.index("{agentOpen &&"):]
    opener = opener[:opener.index(")}")]
    assert "canManageFacility" in opener, (
        "the agent modal is no longer opened on `manageFacility`, so the "
        "facility manager cannot reach the jobs the signpost promises")
    todo = _read("vesta", "supervise", "components", "AgentTodo.tsx")
    assert 'hasCapability(role, "manageFacility")' in todo, (
        "the Done button on the jobs list no longer admits a facility "
        "manager, so the signpost sends them to a list they cannot act on")
