"""Reconciling the HA caretaker list against this period's own events.

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
from reports.narrate.style import heading

from typing import Any, Dict, List

from reports import ledger

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
    """⚠️ THE CARETAKER LIST IS ALSO THE HOUSEHOLD'S SHOPPING LIST on the
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

def test_a_task_already_stated_from_this_periods_events_is_not_repeated() -> None:
    """⚠️ THE SAME TASK ARRIVES BY TWO ROUTES. A blueprint fires its event AND
    calls `todo.add_item` in one action, so a job raised inside the window is in
    both the collector's buffer and the todo list."""
    todo = [_parse(s) for s in (PM01, PM02, PM04)]
    reported = [{"rule_id": "PM-02", "text": "x"}, {"rule_id": "PM-04", "text": "y"}]
    assert [t["rule_id"] for t in ledger.reconcile(todo, reported)] == ["PM-01"]


def test_a_task_older_than_the_buffer_is_what_this_is_FOR() -> None:
    """The collector only knows what fired while it was listening. PM-01 is
    genuinely open on the reference deployment and its event predates the
    buffer entirely — the report could not otherwise know."""
    assert ledger.reconcile([_parse(PM01)], []) == [_parse(PM01)]


def test_matching_is_on_rule_id_not_on_text() -> None:
    """⚠️ The item's text format VARIES by blueprint, so a text comparison would
    match some rules and not others — worse than not matching at all."""
    todo = [_parse(PM02)]
    reported = [{"rule_id": "PM-02", "text": "completely different wording"}]
    assert ledger.reconcile(todo, reported) == []


def test_a_blank_rule_id_never_matches_anything() -> None:
    """It defaults to `""` in every blueprint; blank-equals-blank would collapse
    every untagged task into one."""
    todo = [{"rule_id": "", "text": "a"}, {"rule_id": "PM-01", "text": "b"}]
    carried = ledger.reconcile(todo, [{"rule_id": "", "text": "z"}])
    assert [t["rule_id"] for t in carried] == ["PM-01"]


def test_reconcile_is_read_only() -> None:
    """⚠️ `ledger.py`'s first rule. A report generator that mutates the record
    it reports on is one nobody can trust — and writing a store from outside its
    HTTP handler is the defect the proxy's own docstring records shipping once."""
    todo: List[Dict[str, str]] = [_parse(PM01)]
    reported: List[Dict[str, Any]] = [{"rule_id": "PM-04"}]
    before = ([dict(t) for t in todo], [dict(r) for r in reported])
    ledger.reconcile(todo, reported)
    assert (todo, reported) == before


# ── the rendered result ──────────────────────────────────────────────────────

def test_carried_tasks_reach_the_report_under_their_own_heading() -> None:
    """⚠️ NOT MORE BULLETS UNDER "Raised for the caretaker". These were raised
    in an EARLIER period; folding them in reports old work as this week's."""
    from reports.narrate import DeterministicNarrator, ReportContext
    context = ReportContext(
        audience="owner", cadence="weekly", period="P",
        generated_at="2026-08-21T02:00:00+08:00",
        discovery={"reachable": True, "capabilities": [],
                   "capabilities_missing": [], "capability_absent": {},
                   "preflight": []},
        carried_tasks=[_parse(PM01)])
    body = DeterministicNarrator().render(context)[1]
    assert heading("preventive", "Still open from earlier") in body
    assert "Raised for the caretaker:" not in body
    assert "sensor." not in body


def test_a_week_whose_only_news_is_an_old_open_job_is_not_empty() -> None:
    """Saying "found nothing" over the top of an outstanding task is the
    2.530.0 defect in a new place."""
    from reports.narrate import DeterministicNarrator, ReportContext
    context = ReportContext(
        audience="owner", cadence="weekly", period="P",
        generated_at="2026-08-21T02:00:00+08:00",
        discovery={"reachable": True, "capabilities": [],
                   "capabilities_missing": [], "capability_absent": {},
                   "preflight": []},
        carried_tasks=[_parse(PM01)])
    body = DeterministicNarrator().render(context)[1]
    assert "found nothing" not in body
    assert "nothing has been assessed" not in body
