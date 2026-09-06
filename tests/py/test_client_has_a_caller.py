"""An exported API client that nothing calls is a capability nobody can reach.

⚠️ THE LEVEL ABOVE `test_route_has_a_client`, AND THE GAP IS EXACTLY ONE HOP.
That file asks whether anything in `src/` FETCHES a route. This asks whether
anything CALLS the function that fetches it. `fetchTasks` and `completeTask`
fetch `/reports-tasks` and `/reports-tasks-complete`, so the route check has
always been satisfied — and no screen has called either of them since the tab
that did was deleted. A route with a client and the client with no caller is
still a feature the owner cannot use, and nothing could see it.

⚠️ IT REPORTS QUESTIONS, NOT FAILURES, AND THAT IS THE WHOLE DESIGN. On the day
this was written the orphan it found was `fetchTasks` — which looked exactly
like a surface lost in a refactor, and was a DELIBERATE RETIREMENT: the tab it
served listed to-do items the villa's blueprints raised, the blueprints were
retired at the cutover, and the tab was deleted on purpose
(`test_the_RETIRED_tab_is_gone_rather_than_emptied` guards that). A check that
called that a defect would have been wrong on its first finding and would have
been suppressed by its second. So an orphan must be CLASSIFIED — wired up, or
recorded here as deliberate with the reason — and only an UNCLASSIFIED one
fails.

⚠️ SAME DISCIPLINE AS `test_hard_rules`: freeze the set, make the next one a
deliberate act. "We forgot" and "we decided" look identical from here, and the
map is what separates them.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")

#: The API client modules — the files whose whole job is to reach the add-on.
CLIENTS = (
    os.path.join("vesta", "supervise", "agentApi.ts"),
    os.path.join("vesta", "brief", "reportsApi.ts"),
)

#: Exported clients with no caller in `src/`, and WHY that is not a defect.
#: ⚠️ AN ENTRY IS A DECISION WITH A REASON, NOT A SUPPRESSION. A stale one
#: fails below, so an entry cannot outlive the situation it describes.
DELIBERATELY_UNCALLED: Dict[str, str] = {
    "fetchTasks":
        "The 'What it asked for' tab was deleted on purpose when the "
        "blueprints that raised those to-do items were retired at the "
        "cutover; the agent's own jobs list on Act & Tell replaced it. Kept "
        "because the proxy route is still served and still read by nothing "
        "else — see test_the_RETIRED_tab_is_gone_rather_than_emptied.",
    "completeTask":
        "The pair of `fetchTasks`, retired with it and for the same reason.",
    "acknowledgeConcern":
        "The eye icon it backed was removed on the owner's instruction "
        "(2026-08-28: a thumb up or down already proves a person read the "
        "card, so a separate 'I have seen this' was a second click for a fact "
        "the first one proved). Acknowledgement is now written SERVER-SIDE "
        "inside `/agent-feedback`, so the verdict and the receipt cannot "
        "disagree. `/agent-acknowledge` is still a live route because Telegram "
        "uses it; only the browser client is spare.",
    "loadAgentRuns":
        "⚠️ OPEN, NOT SETTLED (2026-09-06). Nothing surfaces the agent's runs: "
        "`RecentChecks` shows CHECKS through `loadCheckFlags`, which is a "
        "different list. This is the first thing this check found that nobody "
        "has decided about — either a run list deserves a surface or this "
        "client and its route should go. Recorded here rather than deleted, "
        "because deleting the client is what would hide the question.",
}


def _text(rel: str) -> str:
    with open(os.path.join(SRC, rel), encoding="utf-8") as handle:
        return handle.read()


def _exported(rel: str) -> Set[str]:
    return set(re.findall(r"^export (?:async )?function (\w+)", _text(rel), re.M))


def _all_source() -> List[tuple]:
    out = []
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".ts", ".tsx")):
                rel = os.path.relpath(os.path.join(root, name), SRC)
                out.append((rel, _text(rel)))
    return out


def _orphans() -> Set[str]:
    sources = _all_source()
    orphans: Set[str] = set()
    for client in CLIENTS:
        for name in _exported(client):
            # ⚠️ ANY MENTION IN ANOTHER FILE, NOT A CALL SITE, AND `tsc` IS
            # WHAT MAKES THAT SOUND. The first version required `name(` and
            # reported `loadReviewDrafts` as an orphan — it is passed to
            # `useRemoteList` BY REFERENCE, which is a use with no parentheses,
            # and a callback is the normal way this codebase wires a fetcher.
            # `noUnusedLocals` is on, so an import that is not used fails the
            # build: the identifier appearing in another file cannot be dead.
            called = any(
                re.search(rf"\b{re.escape(name)}\b", text)
                for rel, text in sources if rel != client)
            if not called:
                # ⚠️ A CLIENT USED ONLY INSIDE ITS OWN MODULE IS REACHABLE, and
                # the first version called `fromWire` and `parseReportsConfig`
                # uncallable on the strength of a file boundary. Both are
                # helpers another exported client calls, so the capability is
                # reachable; what is redundant is the `export`, which is a
                # different and much smaller complaint than the one this file
                # exists for. Count internal uses, ignoring the definition.
                body = re.sub(rf"^export (?:async )?function {re.escape(name)}\b.*$",
                              "", _text(client), flags=re.M)
                called = bool(re.search(rf"\b{re.escape(name)}\s*\(", body))
            if not called:
                orphans.add(name)
    return orphans


def test_no_unclassified_client_is_uncallable() -> None:
    unexplained = sorted(_orphans() - set(DELIBERATELY_UNCALLED))
    assert not unexplained, (
        "API client function(s) that nothing in src/ calls, so the capability "
        "cannot be reached from any screen:\n  " + "\n  ".join(unexplained)
        + "\n\nWire one up, or add it to DELIBERATELY_UNCALLED with the reason "
          "it is uncalled on purpose. A retired surface and a forgotten one "
          "look identical from here.")


def test_the_exemption_map_does_not_rot() -> None:
    """⚠️ AN ENTRY THAT HAS BEEN WIRED UP MUST COME OUT. Otherwise the map
    slowly becomes a list of things that were once true, which is the failure
    `test_route_has_a_client`'s own exemptions were written against."""
    orphans = _orphans()
    stale = sorted(set(DELIBERATELY_UNCALLED) - orphans)
    assert not stale, (
        "DELIBERATELY_UNCALLED names function(s) that DO have a caller now — "
        "delete the entry, the situation it describes is over: "
        + ", ".join(stale))


def test_this_check_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING. Both assertions pass on an empty export set, and
    one bad regex is all it takes — the export pattern is anchored to a line
    shape that a formatter could change."""
    exported = set().union(*(_exported(c) for c in CLIENTS))
    assert len(exported) >= 20, (
        f"only {len(exported)} exported client function(s) found across "
        f"{len(CLIENTS)} modules — the export scan has stopped matching")
    assert "runTriageNow" in exported, "the scan is missing a known client"
    assert len(_all_source()) >= 100, "the source walk found almost nothing"
