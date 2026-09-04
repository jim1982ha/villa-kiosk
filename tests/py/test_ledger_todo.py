"""Reconciling the HA facility manager list against this period's own events.

⚠️ EVERY FIXTURE IS A VERBATIM ITEM FROM THE REFERENCE DEPLOYMENT, read over MCP
on 2026-08-21. Two shapes are in use across the nine blueprints that call
`todo.add_item`, and a parser written against only the documented one
(`[id] entities - task`) silently mishandles the other. That is the mistake
2.511.0 was made of, and the reason these are copied rather than invented.

⚠️ AND THE ITEMS CARRY ENTITY IDS. `sensor.house_pump_power_factor` names a
device in somebody's home; entity ids routinely name rooms and people, and this
text is destined for prose a person reads and for a Phase 6 payload. Stripping
them is the point of `clean_summary`, not a nicety.
"""

from __future__ import annotations

# ⚠️ THE HEADING COMES FROM THE VOCABULARY — see `style.py`. Asserting the
# rendered string pinned PRESENTATION while claiming to pin structure.

from typing import Any, Dict, List

from vesta.adapters import ledger

# Verbatim from `todo.shopping_list` on the reference deployment.
PM01 = ("[PM-01] sensor.house_pump_power has drifted -99.9% from baseline. "
        "Check the house pump for bearing wear, clogged suction, or impeller "
        "damage.")
PM02 = ("[PM-02] sensor.house_pump_power has flapped 7 times recently "
        "(threshold 6). Check for a stuck check valve, pressure switch fault, "
        "or air in the line.")
PM04 = ("[PM-04] sensor.house_pump_power_factor, sensor.pool_pump_power_factor, "
        "sensor.jacuzzi_pump_power_factor, "
        "sensor.swimming_pool_massage_jet_pump_power_factor - Check the pump "
        "for a failing capacitor, worn bearing, or partial blockage causing "
        "reactive load.")


def _parse(summary: str) -> Dict[str, str]:
    match = ledger.TASK_PREFIX.match(summary)
    assert match is not None, summary
    return {"rule_id": match.group(1), "text": ledger.clean_summary(match.group(2))}


# ── what is ours ─────────────────────────────────────────────────────────────

def test_both_blueprint_item_shapes_are_recognised() -> None:
    assert [_parse(s)["rule_id"] for s in (PM01, PM02, PM04)] == \
        ["PM-01", "PM-02", "PM-04"]


def test_an_ordinary_shopping_item_is_not_claimed() -> None:
    """⚠️ THE FACILITY MANAGER LIST IS ALSO THE HOUSEHOLD'S SHOPPING LIST on the
    reference deployment — the blueprints are pointed at `todo.shopping_list`.
    An unclaimed item is never parsed, counted or carried anywhere."""
    for grocery in ("milk", "2x bread", "call the plumber", ""):
        assert ledger.TASK_PREFIX.match(grocery) is None


def test_an_untagged_task_is_not_claimed_either() -> None:
    """`rule_id` defaults to `""` in every blueprint, so an operator who left
    it blank writes "[] ..." — which must not be read as a rule called nothing."""
    assert ledger.TASK_PREFIX.match("[] Check the pump") is None


# ── what must not travel ─────────────────────────────────────────────────────

def test_no_entity_id_survives_cleaning() -> None:
    for summary in (PM01, PM02, PM04):
        text = _parse(summary)["text"]
        assert "sensor." not in text, text
        assert "_power" not in text or "pump" in text.lower()


def test_the_measurement_survives_cleaning() -> None:
    """⚠️ DROPPING THE CLAUSE WOULD BE TIDIER AND WOULD THROW AWAY THE NUMBER,
    which is the most useful thing on the line."""
    assert "-99.9%" in _parse(PM01)["text"]
    assert "7 times" in _parse(PM02)["text"]


def test_a_sentence_that_lost_its_subject_gets_a_generic_one() -> None:
    """Stripping "sensor.x has drifted" leaves a dangling verb. The subject
    restored invents nothing — the thing that drifted genuinely was a monitored
    device, and which one is exactly what must not travel."""
    assert _parse(PM01)["text"].startswith("A monitored device has drifted")
    assert _parse(PM04)["text"].startswith("Check the pump"), \
        "this shape had a real subject and must not acquire a second one"


def test_cleaning_leaves_no_punctuation_rubble() -> None:
    text = _parse(PM04)["text"]
    assert not text.startswith(("-", ",", ".")) and ",," not in text
    assert "  " not in text


# ── the reconciliation ───────────────────────────────────────────────────────

def test_the_event_dedupe_is_gone_and_every_open_task_is_carried() -> None:
    """⚠️ FIVE PINS OF `ledger.reconcile` STOOD HERE, AND THE FUNCTION IS
    DELETED (2026-08-29). It deduplicated to-do items against "tasks this
    period's blueprint events already stated" — and had been called with a
    hard-coded EMPTY second argument since TASK-074, an identity function
    wearing its old name. The owner's rule made the name itself the defect:
    "automations only generate alerts and are never read by the briefing", so
    an API implying an event route into the brief is an invitation to rebuild
    one. `collect.events_since` went with it, so the rule holds by absence.
    """
    assert not hasattr(ledger, "reconcile"), (
        "ledger.reconcile is back — with it comes the implication that the "
        "briefing deduplicates against automation events, which the owner's "
        "rule forbids")
    import inspect
    import os as _os
    import sys as _sys
    pipeline_path = _os.path.join(
        _os.path.dirname(inspect.getfile(ledger)), "..", "brief", "pipeline.py")
    with open(_os.path.abspath(pipeline_path), encoding="utf-8") as handle:
        code = "\n".join(line for line in handle.read().split("\n")
                         if not line.lstrip().startswith("#"))
    assert "carried = list(todo)" in code, (
        "the pipeline no longer carries every open task directly")
    assert "reconcile(" not in code, "the pipeline calls a dedupe again"
def test_carried_tasks_reach_the_report_under_their_own_heading() -> None:
    """⚠️ RE-POINTED AT THE BRIEF'S NEW AUTHOR (TASK-073). The property: an
    open job raised in an EARLIER period reaches the page, under a heading
    that says it is still open rather than new — and no entity id travels."""
    from vesta.supervise.agent import compose as agent_compose
    body = agent_compose.brief(carried=[_parse(PM01)]).text
    assert "Jobs still open with the facility manager:" in body
    assert "sensor." not in body


def test_a_week_whose_only_news_is_an_old_open_job_is_not_empty() -> None:
    """Saying "found nothing" over the top of an outstanding task is the
    2.530.0 defect in a new place — re-pinned against `compose.brief`."""
    from vesta.supervise.agent import compose as agent_compose
    body = agent_compose.brief(carried=[_parse(PM01)]).text
    assert "Nothing needs your attention" not in body
    assert "found nothing" not in body
