"""A true line the reader cannot act on is still a defect.

⚠️ SIX QUESTIONS ABOUT ONE DELIVERED BRIEF, ALL FAIR, NONE ANSWERABLE FROM IT.
The owner read a report on 2026-08-21 and asked, in order: what does 2,146 stand
for; which alerts; what does "Re-enable, or document as a deliberate decision"
mean and how is it relevant; are you sure about the older alert format; are you
sure these automations are off — "I am worried there is a more serious issue
here, as I doubt this recommendation is legit."

Every finding was TRUE. Checked against the live instance one by one: the amount
was Indonesian Rupiah at the villa's own configured tariff of 1700/kWh; the
three alerts were the three listed with their durations two sections above; a
guarded P1/P2 automation genuinely was switched off; the drift was real. The
report had earned none of that trust, because in each case it named the rule
FAMILY and dropped the SUBJECT — and a reader who cannot verify a line has to
choose between believing it and ignoring it.

⚠️ AND THE DATA WAS ALWAYS THERE. `Group.entities` had been exposing the entity
ids since the module was written and nothing called it; `open_tasks` dropped
them; `get_config` returned the currency beside the version and it was thrown
away. Not one of these fixes needed a new source.

⚠️ THE NAMES COME FROM `labels`, NOT THE IDS. The automation behind the loudest
of those questions is `automation.outdoor_unified_doorbell_call_and_unlock` and
displays as `critical_doorbell---parking_gate`. The id is a stale slug from
before it was renamed, so it is the ONE form in which the word "critical" is
invisible — which is exactly how I answered the question by hand, and why the
answer did not land.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import aggregate as agg                              # noqa: E402
from reports.narrate import DeterministicNarrator, ReportContext  # noqa: E402
from reports.narrate.deterministic import _amount                 # noqa: E402
from reports.narrate.style import name_of                         # noqa: E402

#: Verbatim from `ha_get_automation_traces` on the reference villa, 08:00 scan.
AUDIT_EVENT = {
    "type": "vesta_audit_event", "at": "2026-08-21T08:00:00+08:00",
    "data": {
        "blueprint": "audit_config_integrity", "rule_id": "DQ-02/DQ-03",
        "report_bucket": "Critical automation health",
        "entities": ["automation.outdoor_unified_doorbell_call_and_unlock"],
        "finding": "critical_automation_off",
        "task_text": "Re-enable, or document as a deliberate, intentional decision.",
        "timestamp": "2026-08-21T08:00:00+08:00"},
}
#: A `critical_*` payload with no `blueprint` field — the drift, as it arrives.
LEGACY_CRITICAL = {
    "type": "vesta_critical_event", "at": "2026-08-21T09:00:00+08:00",
    "data": {"report_bucket": "Pool pump schedule", "severity": "P1",
             "label": "Critical schedule — pool pump", "phase": "raised",
             "entity_id": "sensor.pool_pump_power"},
}
DISPLAY_NAME = "critical_doorbell---parking_gate"
LABELS = {"automation.outdoor_unified_doorbell_call_and_unlock": DISPLAY_NAME}

#: What the READER sees, which is not what Home Assistant supplied (v2.601.0).
#:
#: ⚠️ THESE ASSERTIONS USED TO PIN THE DEFECT. They searched for DISPLAY_NAME
#: itself, and `test_the_quotes_survive_the_markup_pass` went further and
#: asserted the exact string `'critical doorbell---parking gate'` — underscores
#: spaced, hyphens intact — which is not a name anybody would write. That is
#: `inert()`'s output, not a rendering decision: the markup pass spaces the
#: underscores because they open an italic, and has no opinion about hyphens.
#: So a half-converted identifier had a test defending it, and the owner
#: reported it from a delivered brief instead.
#:
#: The two are kept separate rather than the constant being rewritten, because
#: the INPUT genuinely is an identifier — that is the whole case under test —
#: and collapsing them would lose the distinction that makes it meaningful.
SHOWN_NAME = "Critical doorbell — parking gate"


def _render(events: List[Dict[str, Any]], **kw: Any) -> str:
    context = ReportContext(
        audience="owner", cadence="daily", period="2026-08-21",
        generated_at="2026-08-21T18:20:00+08:00",
        discovery={"reachable": True, "capabilities": [], "capabilities_missing": [],
                   "capability_absent": {}, "preflight": []},
        aggregated=agg.aggregate(events), **kw)
    return DeterministicNarrator().render(context)[1]


# ── "what does 2,146 stand for?" ─────────────────────────────────────────────

def test_an_amount_carries_the_currency_home_assistant_knows() -> None:
    assert _amount(2146.0, currency="IDR") == "2,146 IDR"


def test_an_unset_currency_still_prints_bare() -> None:
    """⚠️ THE ONLY HONEST FALLBACK. Inventing a symbol from a locale is the
    thing the original decision was right to refuse; this adds a code the
    OPERATOR set, and where they have set none, nothing changes."""
    assert _amount(2146.0) == "2,146"
    assert _amount(2146.0, currency="") == "2,146"


def test_the_code_is_appended_not_turned_into_a_symbol() -> None:
    """`get_config` returns an ISO code, not a glyph. `Rp` and `IDR` are not
    interchangeable to every reader, and a wrong symbol is worse than none."""
    assert _amount(50.0, currency="IDR") == "50.00 IDR"
    assert "Rp" not in _amount(50.0, currency="IDR")


# ── "which automation?" ──────────────────────────────────────────────────────

def test_an_audit_finding_names_the_thing_it_is_about() -> None:
    body = _render([AUDIT_EVENT], labels=LABELS)
    assert "critical automation off" in body, "the finding itself is gone"
    assert SHOWN_NAME in body, (
        "the brief still says a critical automation is off without saying "
        "which — the event named it and the renderer dropped it")


def test_it_names_the_display_name_and_not_the_entity_id() -> None:
    """⚠️ THE ID IS THE ONE NAME THAT HIDES THE POINT. `automation.outdoor_
    unified_doorbell_call_and_unlock` carries no evidence that it is a critical
    rule; `critical_doorbell---parking_gate` is the same automation and says so.
    """
    body = _render([AUDIT_EVENT], labels=LABELS)
    assert "outdoor_unified_doorbell" not in body


def test_a_caretaker_task_says_what_it_is_about() -> None:
    body = _render([AUDIT_EVENT], labels=LABELS)
    line = next(l for l in body.splitlines() if "Re-enable" in l)
    assert SHOWN_NAME in line, (
        f"'Re-enable, or document...' with nothing to re-enable: {line!r}")


def test_an_unlabelled_entity_still_gets_a_readable_name() -> None:
    """No `labels` (Home Assistant unreachable) must degrade to a humanised id,
    never to silence — the finding is the same, only the name is poorer."""
    body = _render([AUDIT_EVENT])
    assert "Outdoor Unified Doorbell Call And Unlock" in body, (
        "the fallback must drop the domain and title-case the rest, the way "
        "`display_label` does when HA has no friendly name either")


def test_a_long_list_of_subjects_is_capped_and_counted() -> None:
    """A sweep can name twenty; a notification listing twenty is one nobody
    finishes."""
    event = {**AUDIT_EVENT, "data": {**AUDIT_EVENT["data"],
             "entities": [f"automation.rule_{i}" for i in range(9)]}}
    body = _render([event])
    assert "and 6 more" in body


# ── "which alerts?" ──────────────────────────────────────────────────────────

def test_self_resolved_alerts_are_named_not_counted() -> None:
    """⚠️ THE COUNT RESTATED THE SECTION ABOVE IT. "3 alerts resolved without
    intervention." sat under a recap that had just listed those three with
    their durations."""
    raised = {"type": "vesta_critical_event", "at": "2026-08-20T12:00:00+08:00",
              "data": {"blueprint": "critical_water_leak", "report_bucket": "Water leak",
                       "label": "Water leak", "severity": "P1", "phase": "raised",
                       "entities": ["binary_sensor.laundry_leak"],
                       "timestamp": "2026-08-20T12:00:00+08:00"}}
    cleared = {**raised, "at": "2026-08-20T12:30:00+08:00",
               "data": {**raised["data"], "phase": "cleared",
                        "timestamp": "2026-08-20T12:30:00+08:00"}}
    body = _render([raised, cleared])
    assert "resolved without intervention" not in body
    closed = body.split("Closed by itself")[1]
    assert "Water leak" in closed


# ── "are you sure about the older alert format?" ─────────────────────────────

def test_the_drift_line_names_the_rule_not_only_its_family() -> None:
    """⚠️ "(critical) uses an older alert format" NAMES ONE OF THIRTEEN RULES
    AND IDENTIFIES NONE. The parenthesised category IS the drift — a payload
    with no `blueprint` field cannot name itself — but `report_bucket` survives
    and is the operator's own words for what the rule is."""
    body = _render([LEGACY_CRITICAL])
    line = next(l for l in body.splitlines() if "older alert format" in l)
    assert "Pool pump schedule" in line, f"unactionable: {line!r}"
    assert "(critical)" in line, "the category still qualifies it"
    assert line.index("Pool pump schedule") < line.index("(critical)"), (
        "the rule is the subject of the sentence; written the other way it "
        "parses as a category doing the using")


def test_a_blueprint_that_names_itself_is_not_qualified_twice() -> None:
    """The bucket is a fallback for a payload that cannot identify itself, not
    decoration on one that can."""
    named = {"type": "vesta_roi_event", "at": "2026-08-21T12:00:00+08:00",
             "data": {"blueprint": "roi_vacancy_waste",
                      "report_bucket": "Vacancy waste - whole villa",
                      "label": "Vacancy waste", "entities": ["sensor.x"]}}
    body = _render([named])
    line = next((l for l in body.splitlines() if "older alert format" in l), "")
    assert line, "this payload is missing `timestamp`, so it should drift"
    assert "Vacancy waste - whole villa" not in line


# ── the data was always there ────────────────────────────────────────────────

def test_the_group_exposes_the_entities_its_events_named() -> None:
    """⚠️ NOT A NEW SOURCE. `Group.entities` predates every fix above; the
    renderer simply never called it. Pinned so a refactor cannot quietly take
    the subject away again."""
    groups = agg.aggregate([AUDIT_EVENT]).get("groups") or []
    assert groups
    assert groups[0].entities == [
        "automation.outdoor_unified_doorbell_call_and_unlock"]


def test_open_tasks_carry_their_subject() -> None:
    groups = agg.aggregate([AUDIT_EVENT]).get("groups") or []
    tasks = agg.open_tasks(groups)
    assert tasks and tasks[0]["entities"] == [
        "automation.outdoor_unified_doorbell_call_and_unlock"]


# ── one rule, one line (2.576.0) ─────────────────────────────────────────────

def _presence(shape: str, phase: str, at: str, minutes: float = 0.0) -> Dict[str, Any]:
    """The same rule, in the two payload shapes one period can contain."""
    bucket = "Entrance unlocked while vacant"
    data: Dict[str, Any] = {"report_bucket": bucket, "label": bucket,
                            "severity": "P1", "phase": phase}
    if minutes:
        data["duration_minutes"] = minutes
    if shape == "new":
        data.update(blueprint="critical_presence_guard", entities=["lock.front"],
                    timestamp=at)
    else:                       # predates the convention: names neither itself
        data.update(entity_id="lock.front")     # nor its entities
    return {"type": "vesta_critical_event", "at": at, "data": data}


MIXED = [
    _presence("old", "raised", "2026-08-21T00:10:00+08:00"),
    _presence("old", "cleared", "2026-08-21T00:20:00+08:00", 10.0),
    _presence("new", "raised", "2026-08-21T09:35:00+08:00"),
    _presence("new", "cleared", "2026-08-21T09:46:00+08:00", 10.0),
]


def test_one_rule_is_one_line_whatever_shape_its_payload_arrived_in() -> None:
    """⚠️ REPORTED AS "why do I see 2 times the same automation?". `Item.key()`
    falls back `rule_id or blueprint or category`, so a rule whose blueprint was
    updated mid-period emitted BOTH keys — `("critical_presence_guard", bucket)`
    for the new events and `("critical", bucket)` for the old — and the brief
    listed one incident twice, resolved after two different durations."""
    body = _render(MIXED)
    recap = body.split("What went wrong")[1].split("\n\n")[0]
    assert recap.count("Entrance unlocked while vacant") == 1, (
        f"the same rule is listed more than once:\n{recap}")
    assert "(2 times)" in recap


def test_closed_by_itself_counts_the_way_the_recap_does() -> None:
    """⚠️ TWO CONVENTIONS FOR ONE FACT, FOUR LINES APART. The recap collapsed
    repeats into "(6 times)" while this section printed the name once per
    occurrence — reported alongside the split above."""
    closed = _render(MIXED).split("Closed by itself")[1].split("\n\n")[0]
    assert closed.count("Entrance unlocked while vacant") == 1
    assert "(2 times)" in closed


def test_two_named_rules_on_one_bucket_are_still_kept_apart() -> None:
    """⚠️ THE FALLBACK CHAIN EXISTS TO PROTECT THIS, so the merge is narrow: it
    folds ONLY a group keyed on the bare category — the signature of a payload
    that could not name itself — and only when exactly one named group shares
    the bucket."""
    bucket = "Shared bucket"
    def named(blueprint: str) -> Dict[str, Any]:
        return {"type": "vesta_critical_event", "at": "2026-08-21T09:00:00+08:00",
                "data": {"blueprint": blueprint, "report_bucket": bucket,
                         "label": blueprint, "severity": "P1", "phase": "raised",
                         "entities": ["x.y"], "timestamp": "2026-08-21T09:00:00+08:00"}}
    groups = agg.aggregate([named("critical_a"), named("critical_b")]).get("groups")
    assert len(groups) == 2, "two self-naming rules on one bucket were merged"


def test_an_unnamed_group_with_two_candidates_is_left_alone() -> None:
    """Guessing which of two rules an anonymous payload belongs to would be
    worse than the duplicate line it is trying to remove."""
    bucket = "Shared bucket"
    def event(blueprint: str = "") -> Dict[str, Any]:
        data: Dict[str, Any] = {"report_bucket": bucket, "label": bucket,
                                "severity": "P1", "phase": "raised"}
        if blueprint:
            data.update(blueprint=blueprint, entities=["x.y"],
                        timestamp="2026-08-21T09:00:00+08:00")
        return {"type": "vesta_critical_event", "at": "2026-08-21T09:00:00+08:00",
                "data": data}
    groups = agg.aggregate([event("critical_a"), event("critical_b"), event()])
    assert len(groups.get("groups")) == 3


# ── the headline reads like the rest of the brief ────────────────────────────

#: A period with something to say in the headline: a priced finding and an
#: unresolved incident. MIXED has neither, which is why it cannot serve here —
#: the first version of this test sliced four lines off a brief whose headline
#: was one line long and asserted about the section underneath it.
HEADLINE_EVENTS = [
    {"type": "vesta_roi_event", "at": "2026-08-21T12:00:00+08:00",
     "data": {"blueprint": "roi_vacancy_waste", "report_bucket": "Vacancy waste",
              "label": "Vacancy waste", "entities": ["sensor.x"], "kwh": 0.93,
              "cost_local": 1581.0, "timestamp": "2026-08-21T12:00:00+08:00"}},
    _presence("new", "raised", "2026-08-21T09:35:00+08:00"),
]


def _headline_block(body: str) -> List[str]:
    """Everything before the first blank line — the headline, by construction."""
    return body.split("\n\n")[0].splitlines()


def test_the_headline_facts_are_bullets() -> None:
    """⚠️ THE TWO MOST IMPORTANT NUMBERS IN THE MESSAGE were the only lines a
    reader could not pick out by scanning — every section below marked its lines
    and the headline did not. Asked for directly."""
    from reports.narrate.style import BULLET
    lines = _headline_block(_render(HEADLINE_EVENTS, currency="IDR"))
    # ⚠️ A FACT IS A BULLETED LINE — anchored on the MARK, not on the dateline's
    # first word. This read `not startswith("Prepared")`, so when the dateline
    # gained a second, deliberately unbulleted line (the window sentence, added
    # after the owner asked when the numbers reset) that line counted as a fact
    # and the test failed for a change that was correct. The property is "the
    # headline's facts carry the mark that means finding"; the bullet IS that.
    facts = [l for l in lines if l.startswith(BULLET)]
    assert len(facts) == 2, f"expected a cost line and an unresolved line: {facts}"
    dateline = [l for l in lines if not l.startswith(BULLET)]
    assert dateline and not any(l.startswith(BULLET) for l in dateline), (
        "the dateline is not a finding and must not wear a bullet")
    assert all(l.startswith(BULLET) for l in facts), facts
    assert any("Avoidable cost" in l for l in facts)
    assert any("still unresolved" in l for l in facts)


def test_the_dateline_is_not_a_bullet() -> None:
    """It is the dateline, not a finding."""
    from reports.narrate.style import BULLET
    block = _headline_block(_render(HEADLINE_EVENTS))
    # ⚠️ A LEAD SENTENCE NOW SITS ABOVE IT. A push notification shows about two
    # lines, and spending the first on "Prepared Saturday…" tells the reader
    # nothing — so the loudest fact leads and the dateline follows. Both are
    # unbulleted for the same reason: neither is a finding.
    dateline = next(l for l in block if l.startswith("Prepared"))
    assert not dateline.startswith(BULLET)
    for line in block[:block.index(dateline)]:
        assert not line.startswith(BULLET), (
            f"the lead is a sentence, not a finding: {line!r}")


# ── a number without its unit is useless (2.577.0) ───────────────────────────

def _measured(**data: Any) -> Dict[str, Any]:
    return {"type": "vesta_maintenance_event", "at": "2026-08-21T10:00:00+08:00",
            "data": {"blueprint": "maintenance_signature_drift",
                     "report_bucket": "Pump signature drift",
                     "label": "Pump signature drift",
                     "entities": ["sensor.house_pump_power"],
                     "timestamp": "2026-08-21T10:00:00+08:00", **data}}


def test_a_measured_value_carries_the_sensors_own_unit() -> None:
    """⚠️ THE UNIT BELONGS TO THE SENSOR. A brief read "current value 1694.7,
    baseline value 750.0" and was asked what those were. Only Home Assistant
    knows they are watts on a pump and degrees on the meter cabinet."""
    body = _render([_measured(current_value=1694.7, baseline_value=750.0)],
                   units={"sensor.house_pump_power": "W"})
    assert "current 1694.7 W" in body and "baseline 750.0 W" in body


def test_a_count_carries_the_noun_it_counts() -> None:
    """"max transitions 6" reads as a field dump; six of WHAT was the question.

    ⚠️ ANSWERING THAT LEFT A SECOND, SUBTLER ONE. "7 transitions, max 6
    transitions" names the noun and still reads as two measurements — the owner
    asked what it meant. A `max_`/`min_` field is a BOUND, and it now attaches
    to what it bounds instead of standing beside it.
    """
    body = _render([_measured(transition_count=7, max_transitions=6)])
    assert "7 transitions (limit 6)" in body
    assert "max transitions 6" not in body and "max 6 transitions" not in body


def test_an_ambiguous_unit_prints_none_rather_than_the_wrong_one() -> None:
    """⚠️ A GROUP CAN COVER TWO SENSORS WITH TWO UNITS — a pump's power and its
    power factor. Picking the first would label every number with one of them.
    Silence is the old behaviour and is honest; a wrong unit is worse."""
    event = _measured(current_value=1.0)
    event["data"]["entities"] = ["sensor.house_pump_power", "sensor.house_pump_pf"]
    body = _render([event], units={"sensor.house_pump_power": "W",
                                   "sensor.house_pump_pf": "%"})
    # ⚠️ AND IT KEEPS THE FIELD NAME. Without a unit, "current 1.0" says less
    # than "current value 1.0" — dropping the noun is only safe once something
    # replaces it, so the fallback is the old, stiff, true dump.
    assert "current value 1.0" in body
    assert "1.0 W" not in body and "1.0 %" not in body


def test_a_percentage_still_prints_as_one() -> None:
    body = _render([_measured(deviation_pct=126.0)], units={"sensor.house_pump_power": "W"})
    assert "deviation 126.0%" in body


# ── a named rule is bracketed, so the sentence parses ────────────────────────

def test_a_named_rule_is_quoted() -> None:
    """⚠️ ASKED FOR DIRECTLY. "Critical automation health: critical automation
    off — critical doorbell---parking gate" runs a rule NAME into the prose
    around it with nothing marking where one stops.

    ⚠️ APOSTROPHES, NOT BRACKETS. 2.577.0 used brackets and the DELIVERED
    message came back with every one stripped — Telegram's Markdown parser
    consumes them as link syntax — while the units and headings from the same
    release arrived intact. See `style.name_of`."""
    body = _render([AUDIT_EVENT], labels=LABELS)
    # ⚠️ CHECKED ON EACH LINE THAT NAMES A RULE, NOT ON THE BODY. The first
    # version searched the whole message and survived a mutation that removed
    # the brackets from `_subjects`, because the caretaker-task line builds its
    # own and still had them. Two code paths, one assertion.
    audit = next(l for l in body.splitlines() if "critical automation off" in l)
    task = next(l for l in body.splitlines() if "Re-enable" in l)
    for line in (audit, task):
        assert name_of(SHOWN_NAME) in line, f"unquoted rule name: {line!r}"


def test_the_quotes_survive_the_markup_pass() -> None:
    """⚠️ THE TWO REQUIREMENTS MEET HERE. `style.inert` neutralises anything a
    notify platform can parse; an apostrophe is not markup in any dialect, which
    is why it is the quoting that reaches the reader."""
    from reports.narrate.style import inert
    body = inert(_render([AUDIT_EVENT], labels=LABELS))
    assert name_of(SHOWN_NAME) in body


# ── three headings, three marks ──────────────────────────────────────────────

def test_the_three_fixed_headings_do_not_share_a_glyph() -> None:
    """⚠️ REPORTED: "the icon you use is the same for Closed by itself and For
    the facility manager". A marker whose job is to be findable without reading
    cannot be shared by the things it distinguishes."""
    from reports.narrate.style import SECTION_MARK
    marks = [SECTION_MARK[k] for k in ("verified", "selfclear", "fixed")]
    assert len(set(marks)) == 3, marks


def test_the_brief_says_facility_manager_not_caretaker() -> None:
    """⚠️ ONE WORD FOR ONE PERSON. The kiosk calls them the Facility Manager
    everywhere — workspace, role, permission — and the brief was the only
    surface using a second word."""
    body = _render([AUDIT_EVENT], labels=LABELS)
    assert "For the facility manager" in body
    assert "caretaker" not in body.lower()


# ── the sub-category (2.578.0) ───────────────────────────────────────────────

SILENT_SKIPS = [
    {"module": "level_anomaly", "title": "Unusual consumption for the day of week",
     "reason": "Roi baseline deviation", "detail": "Roi baseline deviation",
     "code": "superseded"},
    {"module": "sensor_health", "title": "Meters that stopped reporting",
     "reason": "Maintenance silence", "detail": "Maintenance silence",
     "code": "superseded"},
    {"module": "standby_creep", "title": "Equipment drawing more at rest",
     "reason": "your own automations already cover this",
     "detail": "your own automations already cover this",
     "code": "missing_capability"},
]


def test_silent_cover_skips_are_gathered_under_one_heading() -> None:
    """⚠️ THE SENTENCE WAS REPEATED VERBATIM ON EVERY LINE BUT THE RULE NAME,
    three of them scattered among unrelated skips. Asked for: one sub-heading,
    one bullet each, the explanation written once."""
    body = _render([AUDIT_EVENT], skipped=SILENT_SKIPS)
    block = body.split("never reported")[1]
    assert "Unusual consumption for the day of week" in block
    assert "Meters that stopped reporting" in block
    assert name_of("Roi baseline deviation") in block
    # The unrelated skip stays where it was.
    assert "Equipment drawing more at rest" not in block


def test_the_shared_sentence_is_written_once() -> None:
    """⚠️ ONE EXPLANATION FOR THE WHOLE GROUP, NOT ONE PER LINE. The note used
    to be anchored on `BLUEPRINT_GRACE_DAYS` because the number was the one
    thing it had to state exactly once. That number is gone — 2.755.0 deleted
    the grace window, and with it a promise the gate could never keep ("after
    45 days the check runs anyway", behind a return that always fired first).
    What must still hold is that the group explains itself ONCE."""
    body = _render([AUDIT_EVENT], skipped=SILENT_SKIPS)
    assert body.count("supervision is off") == 1
    assert "days" not in body.split("never reported")[1], (
        "the note is promising a waiting period again; there is none")


def test_the_grouping_reads_the_code_not_the_sentence() -> None:
    """⚠️ GROUPING ON PROSE BREAKS THE DAY THE PROSE IS REWORDED, which this
    report has now done twice on owner feedback. `covered_but_silent` is a
    SKIP_REASON value and is pinned across both artefacts by
    `test_contract_parity`."""
    from reports.contracts import SKIP_REASON
    assert "superseded" in SKIP_REASON
    reworded = [{**s, "detail": "totally different words", "reason": "x"}
                if s["code"] == "covered_but_silent" else s for s in SILENT_SKIPS]
    body = _render([AUDIT_EVENT], skipped=reworded)
    assert "Unusual consumption for the day of week" in body.split("never reported")[1]


def test_the_sub_heading_has_its_own_glyph() -> None:
    """⚠️ THE 2.577.0 RULE, BROKEN IN THE RELEASE THAT WROTE IT DOWN. It first
    rendered under the stethoscope — the same glyph as the section containing
    it — because "one glyph per heading" was read as "per section"."""
    from reports.narrate.style import SECTION_MARK
    assert SECTION_MARK["waiting"] != SECTION_MARK["health"]
    body = _render([AUDIT_EVENT], skipped=SILENT_SKIPS)
    line = next(l for l in body.splitlines() if "never reported" in l)
    assert line.startswith(SECTION_MARK["waiting"])


def test_the_group_note_is_not_a_bullet() -> None:
    """⚠️ A BULLET MEANS "AN ITEM IN THIS LIST". The explanation under the
    sub-heading wore one, so a reader counting the checks that stood down got
    three where there are two — reported as "there should not have a bullet on
    this line". The dateline sets the precedent: a line that is not a finding
    does not carry the mark that means finding.
    """
    from reports.narrate.style import BULLET, SECTION_MARK
    body = _render([AUDIT_EVENT], skipped=SILENT_SKIPS)
    block = [l for l in body.split("never reported")[1].splitlines() if l.strip()]
    bullets = [l for l in block if l.startswith(BULLET)]
    assert len(bullets) == 2, (
        f"expected one bullet per stood-down check, got {len(bullets)}:\n"
        + "\n".join(block))
    # Found STRUCTURALLY — the block is a heading, its bullets, and exactly
    # one explanation — so rewording the note cannot make this test blind.
    note = next(l for l in block if not l.startswith(BULLET)
                and not l.startswith(SECTION_MARK["waiting"]))
    assert not note.startswith(BULLET)
    assert "supervision" in note.lower(), (
        "the note must name the one thing that decides, or the reader cannot "
        f"tell what to do: {note!r}")
