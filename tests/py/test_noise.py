"""The acknowledgement loop's add-on half: count, judge, report.

The workbook's rule, in one sentence (`Severity & Routing`): an alert that is
never followed by a clear event is a rule with a BUG, not a villa with a
permanent problem. `Coverage Gaps` RPT-05 had it as OPEN, blocked on DQ-04,
because "no acknowledgement mechanism anywhere, so no rule can be judged noisy".

⚠️ THE SIGNAL IS A COMPLETED TODO ITEM (the owner's choice, 2026-08-22). The
alternative was action buttons on the push, which needs a `data` block in
`deliver.py` — forbidden there in terms, because one platform branch is how a
report that reads well everywhere becomes one that reads well on Telegram.
"""

from __future__ import annotations

import os
import pathlib
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import noise  # noqa: E402
from reports.narrate import DeterministicNarrator, ReportContext  # noqa: E402


class _Item:
    def __init__(self, rule_id: str, label: str = "", when: str = "") -> None:
        self.rule_id, self.label, self.when = rule_id, label, when


def _fires(*pairs: Any) -> List[_Item]:
    out: List[_Item] = []
    for rule, label, count in pairs:
        out.extend(_Item(rule, label) for _ in range(count))
    return out


# ── counting ────────────────────────────────────────────────────────────────

def test_a_rule_over_the_threshold_with_no_ack_is_noisy() -> None:
    rows = noise.noisy(
        noise.fires_by_rule(_fires(("PM-04", "Pump power factor", 23))),
        acked=set(), threshold=20)
    assert [r["rule_id"] for r in rows] == ["PM-04"]
    assert rows[0]["fires"] == 23
    assert rows[0]["label"] == "Pump power factor", (
        "the reader needs the NAME; `PM-04` is a join key, not prose")


def test_one_acknowledgement_clears_a_rule_however_often_it_fired() -> None:
    """⚠️ "AT LEAST ONE", NOT PARITY WITH THE FIRE COUNT. A caretaker who fixes
    the cause once for a rule that fired forty times has acknowledged it. Asking
    for parity would flag every rule whose fix outlasts a single firing, which
    is most of them, and the catalog's target is the rule nobody EVER answers."""
    fires = noise.fires_by_rule(_fires(("PM-04", "Pump", 40)))
    assert noise.noisy(fires, acked={"PM-04"}, threshold=20) == []


def test_a_blank_rule_id_is_never_counted() -> None:
    """⚠️ IT DEFAULTS TO EMPTY IN EVERY BLUEPRINT, so bucketing blanks together
    would fuse every untagged rule into one imaginary very-noisy rule — the
    same trap `ledger.reconcile` names for the join."""
    fires = noise.fires_by_rule(_fires(("", "", 50), ("  ", "", 50)))
    assert fires == {}


def test_the_threshold_is_inclusive_and_below_it_is_quiet() -> None:
    fires = noise.fires_by_rule(_fires(("A", "A", 20), ("B", "B", 19)))
    assert [r["rule_id"] for r in noise.noisy(fires, set(), 20)] == ["A"]


def test_noisiest_first() -> None:
    fires = noise.fires_by_rule(
        _fires(("A", "A", 21), ("B", "B", 99), ("C", "C", 40)))
    assert [r["rule_id"] for r in noise.noisy(fires, set(), 20)] == ["B", "C", "A"]


def test_acknowledged_reads_the_rule_id_the_join_uses() -> None:
    assert noise.acknowledged([
        {"rule_id": "PM-04", "text": "done"},
        {"rule_id": "  ", "text": "untagged"},
        {"text": "no id at all"},
    ]) == {"PM-04"}


# ── the honest third answer ─────────────────────────────────────────────────

def test_an_uncovered_window_reports_nothing_rather_than_a_floor() -> None:
    """⚠️ THE COUNTER THAT WOULD HAVE LIED. `collect.MAX_EVENTS` bounds the
    ring, so a busy property can retain less than `window_days` of events. Every
    count is then a FLOOR, and a floor compared against a threshold reports the
    NOISIEST rules as fine — a counter reading low for exactly the case it
    exists to measure, which this project has shipped four times."""
    summary = noise.summarise(
        _fires(("PM-04", "Pump", 99)), done=[], threshold=20, covered=False)
    assert summary["known"] is False
    assert summary["rules"] == [], (
        "an uncovered window must not answer, not even with what it can see")


def test_asked_and_found_none_is_not_the_same_as_could_not_ask() -> None:
    clean = noise.summarise(_fires(("PM-04", "Pump", 3)), done=[], threshold=20)
    assert clean["known"] is True and clean["rules"] == []


# ── the line a person reads ─────────────────────────────────────────────────

def _ctx(**kw: Any) -> ReportContext:
    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "daily", "period": "2026-08-22",
        "generated_at": "2026-08-22T07:00:00+08:00",
        "discovery": {"reachable": True, "capabilities": [],
                      "capabilities_missing": [], "capability_absent": {},
                      "preflight": []},
    }
    base.update(kw)
    return ReportContext(**base)


def test_the_brief_names_the_rule_and_both_numbers_carry_units() -> None:
    body = DeterministicNarrator().render(_ctx(noise={
        "rules": [{"rule_id": "PM-04", "label": "Pump power factor",
                   "fires": 23}],
        "threshold": 20, "window_days": 30, "known": True, "counted": 1,
    }))[1]
    assert "'Pump power factor'" in body, "quoted through `name_of`"
    # ⚠️ THE WHOLE PHRASE, NOT A SUBSTRING. This asserted `"23 times" in body`
    # and passed against "fired 23 23 times", because `_plural` already carries
    # the count. A substring assertion cannot see a doubled one.
    assert "fired 23 times in 30 days" in body, body
    assert "23 23" not in body
    assert "never acknowledged" in body
    assert "PM-04" not in body, "a join key is not prose"


def test_the_brief_says_when_it_could_not_assess_noise() -> None:
    body = DeterministicNarrator().render(_ctx(noise={
        "rules": [], "threshold": 20, "window_days": 30,
        "known": False, "counted": 7,
    }))[1]
    assert "could not be assessed" in body and "30 days" in body


def test_a_clean_villa_says_nothing_about_noise() -> None:
    """⚠️ SILENCE IS RIGHT HERE AND WRONG ONE LINE UP. "No noisy rules" every
    week is itself alert fatigue; "could not assess" is a fault and must speak.
    The two must not be collapsed into one branch."""
    body = DeterministicNarrator().render(_ctx(noise={
        "rules": [], "threshold": 20, "window_days": 30,
        "known": True, "counted": 4,
    }))[1]
    assert "never acknowledged" not in body
    assert "could not be assessed" not in body


def test_an_absent_slice_renders_nothing_and_does_not_raise() -> None:
    """A report composed before this feature existed, or one whose noise pass
    threw, has no slice at all. It must render exactly as it did before."""
    assert "acknowledged" not in DeterministicNarrator().render(_ctx())[1]


# ── the wiring, which is where this class of bug lives ──────────────────────

def test_both_thresholds_are_configuration_not_constants() -> None:
    """⚠️ CLAUDE.md's FIRST HARD RULE. "20 fires a month" is the workbook's
    number for ONE property; baked into a redistributable add-on it is a
    per-site tuning constant, which is the thing that must never ship."""
    from reports.store import CONFIG_DEFAULTS
    assert CONFIG_DEFAULTS["noise_threshold_fires"] == noise.DEFAULT_THRESHOLD
    assert CONFIG_DEFAULTS["noise_window_days"] == noise.DEFAULT_WINDOW_DAYS


def test_escalation_lives_in_the_blueprints_not_here() -> None:
    """⚠️ THE OWNER'S DECISION (2026-08-22), AND `Params` r71/r72 ALREADY SAID SO.
    The 15-minute resend and 45-minute owner escalation belong to `critical_*`,
    where the occupancy context is. A timer here would move urgency out of the
    detection layer — the same error as computing badge grouping in the
    renderer. Pinned because "we decided not to" is invisible in a diff.

    ⚠️ CHECKED ON THE AST, NOT THE TEXT. The first cut grepped the source and
    matched this module's own DOCSTRING, which explains at length why it does
    not deliver — so the test failed on the prose that proves it correct. A
    claim about what code DOES must be asked of the code.
    """
    import ast
    tree = ast.parse(pathlib.Path(
        os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports", "noise.py")
    ).read_text(encoding="utf-8"))
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(tree) if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        (node.module or "").split(".")[-1]
        for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
    }
    forbidden = imported & {"asyncio", "deliver", "hass", "schedule", "pipeline"}
    assert not forbidden, (
        f"this module records and reports; importing {sorted(forbidden)} is how "
        f"it starts notifying")
    calls = {node.func.attr for node in ast.walk(tree)
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
    assert not calls & {"post", "send", "sleep", "command"}, (
        "no I/O belongs here — it counts two lists that are already in memory")
