"""Numbers a reader can judge, and the zones that decide what leads.

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
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import trend  # noqa: E402
from reports.narrate import DeterministicNarrator, ReportContext  # noqa: E402
from reports.narrate.deterministic import (  # noqa: E402
    ALL_SECTIONS, SECTIONS_FOR, ZONE_OF_SECTION, ZONE_ORDER, zone_heading)
from reports.narrate.style import inert  # noqa: E402


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

def test_every_block_character_survives_the_sanitiser() -> None:
    """⚠️ CHECKED, NOT ASSUMED. A brief is plain text because that is the
    intersection of what notify platforms accept, and `inert()` strips every
    markup-active character from the whole message. A chart built from anything
    it removes would arrive as gaps — the same way an ingress path arrived as
    "hassio ingress". This is the assertion that made block elements the choice
    over asterisks or backticks."""
    assert inert(trend.BLOCKS) == trend.BLOCKS
    chart = trend.sparkline([1, 5, 2, 9, 4])
    assert chart and inert(chart) == chart


def test_a_sparkline_is_scaled_to_its_own_range() -> None:
    """⚠️ NOT TO ZERO. A cost moving between 58 and 74 is eight identical full
    blocks on a zero-based scale — a chart that draws a flat line over a 28%
    swing. The shape is the question; the absolute numbers are on the line."""
    chart = trend.sparkline([58, 61, 74])
    assert chart[0] == trend.BLOCKS[0] and chart[-1] == trend.BLOCKS[-1]


def test_a_flat_series_draws_a_flat_line_not_an_empty_one() -> None:
    """An all-lowest chart reads as "everything collapsed to zero" when it
    means "nothing changed"."""
    chart = trend.sparkline([60, 60, 60])
    assert set(chart) == {trend.BLOCKS[len(trend.BLOCKS) // 2]}


def test_no_series_no_chart() -> None:
    assert trend.sparkline([]) == "" and trend.sparkline(["x", None]) == ""


# ── the comparison ──────────────────────────────────────────────────────────

def test_direction_is_measured_against_the_mean_not_the_last_period() -> None:
    """⚠️ "WORSE THAN YESTERDAY" IS A COIN FLIP on any noisy series and would put
    an arrow on half of all briefs. "Worse than a normal day" is the claim a
    reader can act on."""
    noisy = [10, 90, 10, 90, 10, 90]           # mean 50
    # 53 is +6% on the MEAN and would be -41% on the LAST value; the mean is
    # what makes it unremarkable. (55 sits exactly on the 10% band edge — a
    # fixture on a boundary tests the comparison operator, not the rule.)
    assert trend.direction(53, noisy)[0] == "flat", "within the noise band"
    assert trend.direction(95, noisy)[0] == "up"


def test_a_small_move_is_flat_rather_than_a_finding() -> None:
    way, pct = trend.direction(103, [100, 100, 100])
    assert way == "flat" and 0 < pct < trend.FLAT_BAND_PCT


def test_a_first_report_claims_no_comparison() -> None:
    """⚠️ NOTHING TO COMPARE AGAINST MUST NOT IMPLY SOMETHING. A fresh install
    has no history, and "about usual" on the first brief would be an invented
    baseline."""
    assert trend.direction(74, [])[0] == "flat"
    assert trend.phrase(74, [], "IDR", "daily") == ""


def test_the_phrase_names_the_baseline_and_its_window() -> None:
    """⚠️ "up 21%" INVITES "FROM WHAT?" — the unit rule one level up. And an
    unstated span is a comparison the reader cannot check."""
    said = trend.phrase(74, [61, 58, 66, 64, 59, 71], "IDR", "daily")
    assert "↑" in said and "%" in said
    assert "6-day average" in said and "IDR" in said


def test_the_period_noun_follows_the_cadence() -> None:
    for cadence, noun in (("daily", "day"), ("weekly", "week"),
                          ("monthly", "month")):
        assert f"-{noun} average" in trend.phrase(74, [10], "IDR", cadence)


def test_history_is_filtered_to_the_same_cadence() -> None:
    """⚠️ A DAILY BRIEF COMPARED AGAINST WEEKLY TOTALS reports a catastrophe
    every time a weekly report happens to precede it."""
    entries = [{"cadence": "weekly", "avoidableCost": 700.0},
               {"cadence": "daily", "avoidableCost": 61.0},
               {"cadence": "daily", "avoidableCost": 58.0}]
    assert trend.series_from_history(entries, "avoidableCost", "daily") == [61.0, 58.0]


# ── zones ───────────────────────────────────────────────────────────────────

def test_every_section_belongs_to_exactly_one_zone() -> None:
    """⚠️ A SECTION MISSING FROM THE TABLE WOULD RENDER IN NO ZONE — the silent
    disappearance `SECTION_FOR_KIND` guards against, one layer up. Derived from
    the section list so a tenth section is covered the day it is added."""
    missing = [s for s in ALL_SECTIONS if s not in ZONE_OF_SECTION]
    assert not missing, f"these sections have no zone: {missing}"
    for audience, sections in SECTIONS_FOR.items():
        unzoned = [s for s in sections if s not in ZONE_OF_SECTION]
        assert not unzoned, f"{audience}: {unzoned}"
    assert set(ZONE_OF_SECTION.values()) <= set(ZONE_ORDER)


def test_zones_render_in_their_declared_order() -> None:
    body = DeterministicNarrator().render(_ctx(
        standing=[{"kind": "unavailable", "title": "A device",
                   "detail": "Unavailable", "room": ""}],
        findings=[{"kind": "ANOMALY", "label": "AC", "severity": "warning",
                   "detail": "odd", "window_days": 3}]))[1]
    seen = [body.index(zone_heading(z)) for z in ZONE_ORDER
            if zone_heading(z) in body]
    assert len(seen) >= 2 and seen == sorted(seen)


def test_an_empty_zone_prints_nothing_at_all() -> None:
    """⚠️ "NEEDS YOU" OVER SILENCE IS THE LOUDEST WAY TO SAY NOTHING IS WRONG,
    and it would train the reader to skip the one banner that must never be
    skipped."""
    body = DeterministicNarrator().render(_ctx(
        findings=[{"kind": "ANOMALY", "label": "AC", "severity": "warning",
                   "detail": "odd", "window_days": 3}]))[1]
    assert zone_heading("needs_you") not in body
    assert zone_heading("this_period") in body


def test_a_zone_rule_survives_the_sanitiser() -> None:
    for zone in ZONE_ORDER:
        rule = zone_heading(zone)
        assert inert(rule) == rule, rule


# ── the narration slot ──────────────────────────────────────────────────────

def test_the_lead_falls_back_to_the_deterministic_sentence() -> None:
    """⚠️ THE SAFETY PROPERTY, UNCHANGED IN KIND AND STRONGER IN DEGREE. Before
    v2.592.0 a provider REPLACED the body, and "degrade on any failure" was
    whatever happened when that block did nothing. Now it fills one slot, so the
    fallback is per-slot: no provider, a declined answer or an unusable one all
    leave the same sentence the renderer wrote."""
    body = DeterministicNarrator().render(_ctx(
        standing=[{"kind": "unavailable", "title": "A device",
                   "detail": "Unavailable", "room": ""}]))[1]
    assert body.splitlines()[0].endswith("right now.")


def test_a_provider_sentence_replaces_only_the_lead() -> None:
    """The document is the renderer's. A provider contributes prose, and every
    number, chart, column and heading around it is untouched."""
    rows = [{"kind": "unavailable", "title": "A device", "detail": "Unavailable",
             "room": ""}]
    plain = DeterministicNarrator().render(_ctx(standing=rows))[1]
    narrated = DeterministicNarrator().render(_ctx(
        standing=rows, slots={"lead": "One device stopped reporting overnight."}))[1]
    assert narrated.splitlines()[0] == "One device stopped reporting overnight."
    # Everything from the dateline down is byte-identical.
    assert plain.split("Prepared", 1)[1] == narrated.split("Prepared", 1)[1]


def test_the_lead_never_leads_with_the_monitoring_system() -> None:
    """⚠️ `about_report` MUST NEVER LEAD. A notification whose one visible line
    is about the reporting system, while a device is offline, is the report
    talking about itself instead of the villa."""
    body = DeterministicNarrator().render(_ctx(
        standing=[{"kind": "unavailable", "title": "A device",
                   "detail": "Unavailable", "room": ""}],
        skipped=[{"module": "standby_creep", "reason": "no data",
                  "code": "missing_capability"}]))[1]
    first = body.splitlines()[0]
    assert "right now" in first and "did not run" not in first


def test_the_pipeline_rejects_a_paragraph_where_a_sentence_belongs() -> None:
    """⚠️ A MODEL ASKED FOR A LINE SOMETIMES RETURNS A PARAGRAPH, and pasting one
    where the lead goes pushes the dateline out of the notification preview —
    the exact thing the slot protects. Checked in `pipeline`; asserted here on
    the source so the guard cannot be dropped as redundant."""
    from reports.pipeline import MAX_LEAD_CHARS, usable_lead

    assert usable_lead("One device stopped reporting overnight.") == (
        "One device stopped reporting overnight.")
    # ⚠️ ASSERTED AS BEHAVIOUR, NOT AS SOURCE SHAPE. This used to grep pipeline
    # for "len(lead) <=" — which stayed true when a mutation raised the bound to
    # 100000, so the test passed while the guard was gone. A guard that can only
    # be checked by reading it is a guard nothing checks.
    # ⚠️ A LITERAL BOUND AS WELL AS THE RELATIVE ONE. Asserting only
    # `usable_lead("x" * (MAX_LEAD_CHARS + 1)) == ""` is self-referential: a
    # mutation raising the constant to 100000 raises the test's own threshold
    # with it, and the guard is gone while the suite stays green. That happened.
    # The REQUIREMENT is "fits a notification preview", which is a fixed number
    # of characters no matter what the constant says.
    assert MAX_LEAD_CHARS <= 280, (
        "the lead must fit a push preview; this bound no longer does")
    assert usable_lead("A sentence. " * 60) == "", "a paragraph is refused"
    assert usable_lead("x" * (MAX_LEAD_CHARS + 1)) == ""
    assert usable_lead("Two sentences.\nOn two lines.") == ""
    for junk in ("", "   ", None, "\n\n"):
        assert usable_lead(junk) == ""
    # Whitespace is normalised rather than refused — a wrapped single sentence
    # is still a single sentence.
    assert usable_lead("  One   device   stopped.  ") == "One device stopped."


def test_the_payload_carries_the_zone_from_the_renderers_own_table() -> None:
    """⚠️ DERIVED, NOT RESTATED. Computing the zone separately in the payload
    would let the model's idea of "needs you" drift from the document's — the
    divergence this whole subsystem exists to prevent."""
    from reports.narrate import payload

    class Ctx:
        discovery = {"capability_absent": {}, "capabilities_missing": []}
        collector: Dict[str, Any] = {}
        findings = [{"kind": "DATA_QUALITY", "label": "Hall sensor",
                     "severity": "warning", "detail": "must not travel",
                     "entity_id": "sensor.x"}]
        aggregated: Dict[str, Any] = {}
        audience, cadence, period = "owner", "daily", "2026-08-22"

    out = payload.from_context(Ctx())
    sent = out["findings"][0]
    assert sent["zone"] == ZONE_OF_SECTION["health"], (
        "DATA_QUALITY routes to `health`, which is `about_report`")
    assert "detail" not in sent and "entity_id" not in sent
    assert payload.audit(out) == []


def test_an_unknown_zone_or_direction_is_dropped_not_forwarded() -> None:
    """⚠️ THE NEW ENUMS GET THE SAME OUTBOUND VALIDATION as severity and kind.
    An unvalidated enum is a free-text field with a short name, and these reach
    a third party."""
    from reports.narrate import payload
    built = payload.build(
        [{"label": "X", "zone": "../etc", "trend_direction": "sideways",
          "occurrences": 3}],
        audience="owner", cadence="daily", period="p")
    sent = built["findings"][0]
    assert "zone" not in sent and "trend_direction" not in sent
    assert sent["occurrences"] == 3
