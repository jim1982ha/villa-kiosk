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


def test_the_brief_does_not_dim_a_layer_that_keeps_working() -> None:
    """⚠️ THE REGRESSION I SHIPPED IN 2.868.0, PINNED IN THE TAB IT HAPPENED IN.

    `critical` reflexes and the `audit` channel test do not stop for the
    supervision switch, so the section listing them may not be dimmed by it. The
    rows that MAY dim are the built-in checks, and only on the server's own
    `standingDown` verdict.
    """
    path = os.path.join(REPO_ROOT, "src", "vesta", "brief", "components",
                        "ModulesTab.tsx")
    with open(path, encoding="utf-8") as handle:
        source = handle.read()

    assert "reports-standing-down" in source, (
        "the tab no longer dims anything at all — if that is deliberate, this "
        "pin and its companion in the CSS should go with it")

    for match in re.finditer(r"reports-standing-down", source):
        window = source[max(0, match.start() - 260):match.start()]
        assert "supervisionEnabled" not in window, (
            "the tab dims something directly from the supervision switch again. "
            "The only layer that stops is a check the SERVER reports as standing "
            "down (`standingDown`); `critical` and `audit` keep working.")


def test_the_servers_verdict_reaches_the_browser() -> None:
    """⚠️ A snake_case KEY ONE SIDE, camelCase THE OTHER, AND NOTHING BETWEEN
    THEM — the shape that made every reports save 400 and both reads degrade
    silently to defaults. `standing_down` renders a sentence, so a mismatch here
    shows as "this check is fine" on a check that is standing down."""
    with open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                           "supervisor-proxy.py"), encoding="utf-8") as handle:
        proxy = handle.read()
    with open(os.path.join(REPO_ROOT, "src", "vesta", "brief", "reportsApi.ts"),
              encoding="utf-8") as handle:
        client = handle.read()

    assert '"standing_down"' in proxy, "the endpoint no longer sends the verdict"
    assert "standingDown: str(mod.standing_down)" in client, (
        "the client no longer maps standing_down → standingDown, so every check "
        "renders as running")
    assert '"supervision_enabled": supervision_on' in proxy
    assert "supervisionEnabled: bool(d.supervision_enabled)" in client
