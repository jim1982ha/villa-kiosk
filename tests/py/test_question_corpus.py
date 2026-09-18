"""Forty questions a person actually asks a villa, and who answers each.

⚠️ THIS FILE EXISTS BECAUSE FIVE RELEASES GUESSED AND THE OWNER'S VILLA WAS THE
TEST RIG. Between 2.979.0 and 2.992.0 the same question — "how much electricity
since 5pm" — was answered wrongly six times, and every diagnosis came from
reading the property's recorder by hand after a wrong number had already
reached somebody's phone. The owner's instruction, twice: validate before
finalising, and make it universal rather than fixing the instance.

⚠️ WHAT THIS DOES AND DOES NOT PROVE, STATED PLAINLY BECAUSE AN INSTRUMENT THAT
OVERSTATES ITS REACH IS WORSE THAN NONE. It does NOT run a model and therefore
cannot prove the model will CHOOSE the right tool — that needs a live call, it
costs money, and it is not deterministic, so it cannot be a gate. What it does
prove, on every commit and with no network:

  1. every shape of question has SOMEBODY to answer it (a tool that exists),
  2. no question in the corpus needs the model to do arithmetic, and
  3. the arithmetic the villa does is RIGHT, driven against the payload shapes
     Home Assistant really returns.

(3) is the half that was missing. Every wrong figure was arithmetic, and none
of it was ever executed outside the villa.

⚠️ THE SHAPES ARE REAL, THE IDS ARE INVENTED. `recorder/statistics_during_period`
and `history/period` payloads were read off a running Home Assistant; every
entity id here is an `example_` placeholder, because the first hard rule says no
property's ids reach tracked source.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.adapters import automations as automations_mod  # noqa: E402
from vesta.adapters import hass as hass_mod  # noqa: E402
from vesta.supervise.agent import registry as registry_mod  # noqa: E402
from vesta.supervise.agent import sources  # noqa: E402
from vesta.supervise.agent.tools import ha as ha_tools  # noqa: E402

# ── the corpus ──────────────────────────────────────────────────────────────
#: (question, the tool that must be able to answer it, the reduction or "").
#:
#: ⚠️ THE TOOL COLUMN IS A DESIGN CLAIM, NOT A MEASUREMENT. It says "the surface
#: is meant to cover this shape of question". It is useful precisely because it
#: is written down: a question with no owner is visible here instead of being
#: discovered by a person not getting an answer.
CORPUS = (
    # ── how much, over a period ─────────────────────────────────────────────
    ("How much electricity has the villa used since 5pm?", "measure", "total"),
    ("Combien d'électricité depuis 13h ?", "measure", "total"),
    ("How much power did we use yesterday?", "measure", "total"),
    ("How much water have we used today?", "measure", "total"),
    ("How much gas since the start of the month?", "measure", "total"),
    ("How much rain fell overnight?", "measure", "total"),
    ("How much did the pool pump consume this week?", "measure", "total"),
    ("Quelle est la consommation depuis ce matin ?", "measure", "total"),
    ("How much energy did the air conditioning use last night?",
     "measure", "total"),
    # ── averages and extremes ───────────────────────────────────────────────
    ("What was the average temperature in the bedroom today?", "measure", "mean"),
    ("Quelle température moyenne ce matin ?", "measure", "mean"),
    ("What was the highest temperature today?", "measure", "max"),
    ("What was the coldest it got last night?", "measure", "min"),
    ("What was the peak power draw this afternoon?", "measure", "max"),
    ("What has the average humidity been this week?", "measure", "mean"),
    ("What was the lowest battery level today?", "measure", "min"),
    # ── how long, how many times ────────────────────────────────────────────
    ("How long was the pool pump running today?", "measure", "time_in_state"),
    ("Combien de temps la pompe a tourné hier ?", "measure", "time_in_state"),
    ("How long was the front door unlocked?", "measure", "time_in_state"),
    ("How long has the air conditioning been on?", "measure", "time_in_state"),
    ("How many times did the gate open today?", "measure", "count_changes"),
    ("How many times did the pump start this week?", "measure", "count_changes"),
    ("Combien de fois la porte s'est ouverte ?", "measure", "count_changes"),
    # ── what is true right now ──────────────────────────────────────────────
    ("How many lights are on?", "ha_search", ""),
    ("Combien de lumières sont allumées en ce moment ?", "ha_search", ""),
    ("Is the pool pump running?", "read_state", ""),
    ("What is the temperature in the bedroom?", "read_state", ""),
    ("Which doors are unlocked?", "ha_search", ""),
    ("What rooms are on the first floor?", "ha_list_floors_areas", ""),
    ("Is anything offline?", "read_salient", ""),
    # ── shape over time, rather than one number ─────────────────────────────
    ("Has the fridge temperature been drifting up?", "read_history", ""),
    ("Show me how the humidity moved overnight.", "read_history", ""),
    # ── how the property is set up ──────────────────────────────────────────
    ("Which meter does the energy dashboard treat as the main supply?",
     "read_configuration", ""),
    ("What is on the schedule for the cleaner?", "read_schedule", ""),
    ("What does the villa look like — how many devices are there?",
     "read_villa", ""),
    # ── why something happened ──────────────────────────────────────────────
    ("Why did the gate open at 3am?", "read_automation_trace", ""),
    ("Did the irrigation run this morning?", "read_automation_trace", ""),
    ("Is there anything I should be worried about?", "read_concerns", ""),
    ("What went wrong with the doorbell yesterday?", "read_logs", ""),
    ("What is the forecast?", "call_read_only_service", ""),
)

#: Words that mean a figure has to be worked out from a series.
#: ⚠️ THE PIN THAT WOULD HAVE BEEN RED ALL EVENING. Before `measure` existed,
#: every one of these questions was answered by the model reading rows and
#: adding them up — which is where all six wrong figures came from.
ARITHMETIC_WORDS = (
    "how much", "how long", "how many times", "average", "moyenne",
    "highest", "lowest", "peak", "coldest", "combien de temps",
    "combien de fois", "combien d'", "consommation",
)


def _known_tool_names():
    names = {cls.name for cls in registry_mod.ALL_TOOLS if getattr(cls, "name", "")}
    return names | set(registry_mod.CHAT_UPSTREAM)


def test_the_corpus_is_the_size_it_claims_to_be():
    """A corpus that quietly shrinks is a gate that quietly narrows."""
    assert len(CORPUS) >= 40, f"only {len(CORPUS)} questions"
    assert len({q for q, _, _ in CORPUS}) == len(CORPUS), "a question is duplicated"


@pytest.mark.parametrize("question,tool,reduce", CORPUS,
                         ids=[q[:40] for q, _, _ in CORPUS])
def test_every_question_has_a_tool_that_exists(question, tool, reduce):
    """⚠️ THE GAP THIS CATCHES IS AN ABSENCE, WHICH IS WHY IT IS MECHANICAL.
    "How much since 1pm" had no owner for eleven releases; nothing failed,
    because nothing was missing — the model simply improvised with the tools
    that were there, and improvising meant doing the sum itself."""
    assert tool in _known_tool_names(), (
        f"no tool named {tool!r} can answer: {question}")


@pytest.mark.parametrize("question,tool,reduce", CORPUS,
                         ids=[q[:40] for q, _, _ in CORPUS])
def test_no_question_asks_the_model_to_do_the_arithmetic(question, tool, reduce):
    """⚠️ THE RULE THE WHOLE EVENING PAID FOR. If a question contains a word
    that means "work a figure out of a series", the villa must own that
    arithmetic — which means `measure`, with a named reduction."""
    lowered = question.lower()
    if not any(word in lowered for word in ARITHMETIC_WORDS):
        return
    assert tool == "measure", (
        f"{question!r} needs a figure worked out of a series and is assigned "
        f"to {tool!r} — whatever that tool returns, the model would have to do "
        f"the sum, which is where every wrong number came from")
    assert reduce in ha_tools.MEASURE_REDUCTIONS, (
        f"{question!r} names reduction {reduce!r}, which measure does not offer")


def test_the_published_reductions_are_all_exercised():
    """⚠️ A CORPUS THAT NEVER USES A CAPABILITY DOES NOT TEST IT. Every
    reduction the tool advertises must appear against a real question, or the
    advertisement is untested — which is exactly how `call_read_only_service`
    came to offer a statistics summary it could not produce."""
    used = {reduce for _, _, reduce in CORPUS if reduce}
    missing = set(ha_tools.MEASURE_REDUCTIONS) - used
    assert not missing, f"no question in the corpus exercises: {sorted(missing)}"


def test_the_tool_and_its_source_offer_the_same_reductions():
    """⚠️ TWO CORRECT HALVES, PINNED. The tool publishes the set to the model;
    `sources` implements it. A reduction offered and not implemented is refused
    at run time with nothing failing here — the defect this repository has
    produced thirteen times, in both directions."""
    assert set(ha_tools.MEASURE_REDUCTIONS) == set(sources._REDUCTIONS)


# ── the arithmetic, driven against real payload shapes ──────────────────────
METER = "sensor.example_main_supply_energy"
ROOM = "sensor.example_bedroom_temperature"
PUMP = "switch.example_pool_pump"

#: `recorder/statistics_during_period`, period "5minute". Four buckets that sum
#: to exactly 3.06 — the figure the villa's own recorder gave for 17:00->21:20
#: on the evening the model answered 6.67.
ENERGY_BUCKETS = [
    {"start": 1789736400000, "change": 0.75},
    {"start": 1789736700000, "change": 0.81},
    {"start": 1789737000000, "change": 0.90},
    {"start": 1789737300000, "change": 0.60},
]
ENERGY_TOTAL = 3.06

TEMP_BUCKETS = [
    {"start": 1789736400000, "mean": 24.0, "min": 22.5, "max": 25.5},
    {"start": 1789736700000, "mean": 26.0, "min": 23.5, "max": 28.5},
]

PUMP_HISTORY = [
    {"at": "2026-09-18T17:00:00+00:00", "state": "off"},
    {"at": "2026-09-18T18:00:00+00:00", "state": "on"},
    {"at": "2026-09-18T19:30:00+00:00", "state": "off"},
    {"at": "2026-09-18T20:00:00+00:00", "state": "on"},
]
WINDOW = ("2026-09-18T17:00:00+00:00", "2026-09-18T21:00:00+00:00")


class _FakeHass:
    """Home Assistant answering `recorder/statistics_during_period`."""

    rows: dict = {}

    def __init__(self, session):  # noqa: D107
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def command(self, name, **payload):
        assert name == "recorder/statistics_during_period", name
        # ⚠️ ASSERTED, BECAUSE THE KEY IS `types` AND I HAVE GUESSED A FIELD
        # NAME WRONG IN THIS REPOSITORY BEFORE. Core's websocket schema calls
        # it `types`; the MCP tool's argument is `statistic_types`, and the two
        # are one letter of plausibility apart.
        assert "types" in payload, payload
        wanted = list(payload.get("statistic_ids") or [])
        return {key: rows for key, rows in _FakeHass.rows.items() if key in wanted}


def _measure(entity, reduce, *, stats=None, history=None, unit="kWh",
             state=None, since=WINDOW[0], until=WINDOW[1]):
    _FakeHass.rows = dict(stats or {})

    async def fake_rest_get(session, path):
        return {"attributes": {"unit_of_measurement": unit}}

    async def fake_fetch_history(session, entity_id, start_iso):
        return list(history or [])

    originals = (hass_mod.HassClient, hass_mod.rest_get,
                 automations_mod.fetch_history)
    hass_mod.HassClient = _FakeHass                      # type: ignore[misc]
    hass_mod.rest_get = fake_rest_get                    # type: ignore[assignment]
    automations_mod.fetch_history = fake_fetch_history   # type: ignore[assignment]
    try:
        read = sources.measure_reader(object())
        return asyncio.run(read(entity, reduce, since, until, state))
    finally:
        (hass_mod.HassClient, hass_mod.rest_get,
         automations_mod.fetch_history) = originals      # type: ignore[misc]


def test_a_total_is_the_sum_of_the_recorders_own_buckets():
    """⚠️ THE QUESTION THAT COST SIX RELEASES, COMPUTED OFFLINE AT LAST."""
    out = _measure(METER, "total", stats={METER: ENERGY_BUCKETS})
    assert out["value"] == pytest.approx(ENERGY_TOTAL)
    assert out["unit"] == "kWh", "a figure without its unit is a number to guess at"
    assert out["source"] == "statistics"
    assert out["rows"] == 4


def test_a_recent_window_asks_for_five_minute_buckets():
    """⚠️ THE 20 MINUTES THAT WENT MISSING. Hourly buckets tile whole hours, so
    "since 5pm" asked at 21:20 covers 17:00-21:00 and drops the rest — 2.83 kWh
    against a true 3.06. The finer bucket is the answer, not a refinement."""
    seen = {}
    real = _FakeHass.command

    async def spy(self, name, **payload):
        seen.update(payload)
        return await real(self, name, **payload)

    _FakeHass.command = spy                              # type: ignore[assignment]
    try:
        _measure(METER, "total", stats={METER: ENERGY_BUCKETS})
    finally:
        _FakeHass.command = real                         # type: ignore[assignment]
    assert seen["period"] == "5minute", seen


@pytest.mark.parametrize("reduce,expected", [
    ("mean", 25.0), ("min", 22.5), ("max", 28.5)])
def test_the_moving_reductions_read_the_right_column(reduce, expected):
    out = _measure(ROOM, reduce, stats={ROOM: TEMP_BUCKETS}, unit="°C")
    assert out["value"] == pytest.approx(expected)
    assert out["unit"] == "°C"


def test_time_in_state_adds_up_every_stretch_including_the_open_one():
    """90 minutes, then a stretch still running when the window ends: 150."""
    out = _measure(PUMP, "time_in_state", history=PUMP_HISTORY, state="on",
                   unit="")
    assert out["value"] == pytest.approx(150.0)
    assert out["unit"] == "minutes"


def test_count_changes_counts_entries_into_the_named_state():
    out = _measure(PUMP, "count_changes", history=PUMP_HISTORY, state="on")
    assert out["value"] == 2
    assert out["unit"] == "times"


def test_count_changes_without_a_state_counts_every_change():
    out = _measure(PUMP, "count_changes", history=PUMP_HISTORY)
    assert out["value"] == 3


def test_a_device_the_recorder_does_not_aggregate_still_gets_an_answer():
    """⚠️ NO STATISTICS IS NOT NO DATA. A sensor without `state_class` is never
    aggregated and is perfectly readable from its raw history; refusing here
    would make this tool answer only for the devices that happen to be metered,
    which is the anticipation trap wearing a different hat."""
    raw = [{"at": "2026-09-18T17:00:00+00:00", "state": "100.0"},
           {"at": "2026-09-18T20:00:00+00:00", "state": "103.06"}]
    out = _measure(METER, "total", stats={}, history=raw)
    assert out["value"] == pytest.approx(3.06)
    assert out["source"] == "history"
    assert "no statistics" in out["note"]


def test_an_empty_window_is_NULL_and_says_so_rather_than_reading_zero():
    """⚠️ ZERO IS NOT MISSING, AND THE DIFFERENCE ONCE REACHED THE OWNER AS A
    FAULT REPORT ABOUT WORKING HARDWARE. A duty-cycled device reads zero most
    of the day; "the recorder holds nothing for this window" is a different
    finding and must not be rendered as a measurement."""
    out = _measure(METER, "total", stats={}, history=[])
    assert out["value"] is None, "absence was reported as a reading of zero"
    assert "not a reading of zero" in out["note"]


def test_a_window_that_runs_backwards_is_refused():
    out = _measure(METER, "total", stats={METER: ENERGY_BUCKETS},
                   since=WINDOW[1], until=WINDOW[0])
    assert "error" in out


def test_a_reduction_the_villa_cannot_do_is_refused_by_name():
    out = _measure(METER, "median", stats={METER: ENERGY_BUCKETS})
    assert "error" in out and "median" in out["error"]


def test_a_naive_time_means_the_villas_clock_not_utc():
    """⚠️ EIGHT HOURS OF THE WRONG DAY. `instants.as_utc` reads a naive stamp as
    UTC, which is right for values that come FROM Home Assistant and wrong for
    one a model wrote: the model is handed the villa's own local time and will
    answer "since 5pm" with the villa's 5pm."""
    from datetime import timezone, timedelta
    zone = timezone(timedelta(hours=8))
    aware = sources._instant("2026-09-18T17:00:00+08:00", zone)
    naive = sources._instant("2026-09-18T17:00:00", zone)
    assert naive == aware, "a naive stamp was not read as the villa's wall clock"


# ── one tool per job ────────────────────────────────────────────────────────
#: Upstream tools whose job this add-on already does, and what does it instead.
#:
#: ⚠️ WRITTEN DOWN BECAUSE THE DUPLICATION WAS INVISIBLE WHILE BOTH WORKED. The
#: villa's own trace shows the model using both surfaces inside one answer —
#: `ha_get_historyx2 ha_get_statex2 ... read_statex1` — and neither tool was
#: broken, so nothing failed. What it cost was 8,829 characters of schema on
#: every turn and a choice the model had to make correctly each time, between
#: two tools whose descriptions could not say which was better without becoming
#: a catalogue of anticipated cases.
SUPERSEDED = {
    "ha_get_state": "read_state",
    "ha_get_history": "read_history for a shape, measure for a figure",
}


@pytest.mark.parametrize("duplicate,ours", sorted(SUPERSEDED.items()))
def test_chat_publishes_one_tool_per_job(duplicate, ours):
    assert duplicate not in registry_mod.CHAT_UPSTREAM, (
        f"{duplicate} is published beside {ours}, which does the same job")


def test_the_superseded_table_is_not_empty():
    """⚠️ OR THE TEST ABOVE PASSES BY HAVING NOTHING TO CHECK. A parametrised
    test over an empty table is green and measures nothing — the shape of
    instrument this repository keeps being caught by."""
    assert SUPERSEDED


def test_what_upstream_still_publishes_is_what_we_genuinely_lack():
    """Entity search, Home Assistant's template engine and the floor/area tree.
    ⚠️ IF ONE OF THESE EVER GAINS A VESTA COUNTERPART it belongs in SUPERSEDED,
    not beside it."""
    for name in registry_mod.CHAT_UPSTREAM:
        assert name not in SUPERSEDED, (
            f"{name} has a VESTA counterpart and is still published")
