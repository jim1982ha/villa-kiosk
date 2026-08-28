"""A screen may dim only what has actually STOPPED.

⚠️ 2026-08-29, owner: "make sure you do a deep scan of all the UI to fix it
consistently everywhere it has to". The scan found the defect in my own release
of an hour earlier: 2.868.0 dimmed the "Your automations" section of the brief's
checks tab whenever supervision was on. Those rows are `critical` — reflexes
that fire in under a second with no add-on and no model — and `audit`, which
proves the delivery channel. Neither stops for the master switch. The families
that DID lose the argument, `maintenance` and `roi`, had already been removed
from that table, so the dim could only ever have been wrong.

`AgentModal`'s `INERT_WHEN_OFF` had written the rule down months earlier —
"greying the other two would be a lie of exactly the kind this subsystem keeps
paying for: a working tier presented as stopped" — and I greyed a working layer
on the tab next door while that comment sat three files away. Prose in one file
does not reach a decision made in another; a test does.

⚠️ WHAT THIS PINS IS THE PAIR, NOT EITHER HALF. The SPA decides which tiers go
inert; PYTHON decides which tiers actually stop. Nothing type-checks that
across the language boundary — /dry-audit Part 5 shape (a) — so the day somebody
adds an `enabled` check to `observe/cycle.py`, or removes the one in `outbox`,
the set in the browser silently starts lying in one direction or the other.
"""
from __future__ import annotations

import os
import re
from typing import Dict, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

AGENT_MODAL = os.path.join(REPO_ROOT, "src", "vesta", "supervise",
                           "components", "AgentModal.tsx")

#: tab id → the module that would have to stop for that tab to be inert.
#: ⚠️ THIS MAPPING IS THE ONE HAND-WRITTEN THING HERE and it is a fact about the
#: architecture (a tier is one module), not a list of what happens to be true
#: today. The VERDICT — does that module refuse on `enabled`? — is read from the
#: Python on every run, which is the half that drifts.
TIER_MODULE = {
    "triage": ("vesta", "supervise", "agent", "scheduler.py"),
    "reason": ("vesta", "supervise", "agent", "runtime.py"),
    "act": ("vesta", "supervise", "agent", "outbox.py"),
    "reflex": None,  # Home Assistant blueprints: no add-on in the path at all
    "observe": ("vesta", "supervise", "observe", "cycle.py"),
}


def _source(parts) -> str:
    path = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", *parts)
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _refuses_on_enabled(parts) -> bool:
    """Does this module have a guard that STOPS when supervision is off?

    ⚠️ THE GUARD, NOT THE WORD. `scheduler.py` mentions `enabled` six times —
    passing it on, logging it, reading a different config — and only one of
    those is a refusal. Matching the word would report every module as gated and
    the test would pass while measuring nothing.
    """
    return bool(re.search(r"if not [a-z_]*(?:cfg|config)[a-z_]*"
                          r"(?:\([^)]*\))?\.get\(\"enabled\"\)",
                          _source(parts)))


def _inert_set() -> Set[str]:
    with open(AGENT_MODAL, encoding="utf-8") as handle:
        source = handle.read()
    match = re.search(r"INERT_WHEN_OFF[^=]*=\s*new Set\(\[([^\]]*)\]\)", source)
    assert match, "INERT_WHEN_OFF has moved or changed shape — this test is blind"
    return set(re.findall(r'"([a-z]+)"', match.group(1)))


def test_the_dimmed_tabs_are_exactly_the_ones_that_stop() -> None:
    inert = _inert_set()

    # ⚠️ VACUOUS-PASS GUARD. An empty set on both sides compares equal and
    # reports health for ever.
    assert inert, "INERT_WHEN_OFF parsed as empty"

    stops: Dict[str, bool] = {
        tab: (parts is not None and _refuses_on_enabled(parts))
        for tab, parts in TIER_MODULE.items()
    }
    assert any(stops.values()), "no module refuses on `enabled` — the regex has rotted"
    assert not all(stops.values()), (
        "every module reads as gated, which was true of none of them when this "
        "was written — the regex is matching too broadly")

    should_dim = {tab for tab, halts in stops.items() if halts}
    assert inert == should_dim, (
        f"the dialog dims {sorted(inert)} but only {sorted(should_dim)} actually "
        "stop when supervision is off. Dimming a tier that keeps working tells "
        "the owner their villa recorded nothing while it recorded everything; "
        "leaving one undimmed hides that it stopped.")


def test_the_brief_dims_nothing_at_all_any_more() -> None:
    """⚠️ SECOND REVERSAL ON THIS SPOT IN TWO DAYS, so the history is the
    test. 2.868.0 dimmed the automations section (wrong — nothing there
    stops); 2.869.0 corrected that to dimming only a check the server
    reported as standing down; 2026-08-29 the owner's reasoning removed the
    stand-down itself — the briefing never read the automations, so a check
    that stands down leaves the briefing with no analysis at all. The checks
    now run in both modes, so there is NOTHING mode-dependent left on the
    briefing's checks tab, and this pin holds the whole tab to that.

    `.reports-standing-down` itself survives — `AutomationsTab` uses it for
    the families the owner has switched off, and `AgentActSettings` for the
    to-do field under "Alert only". Those ARE genuinely idle. This pin is
    about the checks tab only.
    """
    path = os.path.join(REPO_ROOT, "src", "vesta", "brief", "components",
                        "ModulesTab.tsx")
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    assert "reports-checks" in source, "the checks tab has moved — pin is blind"
    assert "reports-standing-down" not in source, (
        "the checks tab dims something again. The stand-down was removed with "
        "the gate arm; a dimmed check on this tab claims a mode-dependence "
        "the pipeline no longer has.")
    assert "standingDown" not in source, "the deleted wire field is read again"


def test_the_stand_down_verdict_is_gone_from_both_sides_of_the_wire() -> None:
    """⚠️ AN ABSENCE PIN, because the field crossed a language boundary. If
    `standing_down` returns on ONE side only, the client silently renders
    every check as running (the exact envelope-key failure shape) — so the
    only safe states are both-present or both-absent, and the design says
    absent."""
    with open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                           "supervisor-proxy.py"), encoding="utf-8") as handle:
        proxy = handle.read()
    with open(os.path.join(REPO_ROOT, "src", "vesta", "brief", "reportsApi.ts"),
              encoding="utf-8") as handle:
        client = handle.read()
    assert '"standing_down"' not in proxy, (
        "the proxy sends the stand-down verdict again — if that is deliberate, "
        "the client mapping and the gate arm must come back with it, together")
    assert "standingDown:" not in client, (
        "the client parses a field the proxy no longer sends")
    # the banner flag is still real and still needed by AutomationsTab:
    assert '"supervision_enabled": supervision_on' in proxy
    assert "supervisionEnabled: bool(d.supervision_enabled)" in client
