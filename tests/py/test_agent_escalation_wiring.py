"""Tier 2 → Tier 3: the wire that was never connected. TASK-052.

⚠️ THIS FILE IS ALMOST ENTIRELY ABOUT A CALL SITE, WHICH IS THE THIRD TIME IN
ONE SESSION THAT IS WHERE THE DEFECT WAS. `triage.run` produced escalations and
was tested; `runtime.investigate` consumed a subject and was tested;
`concerns.raise_concern` stored a concern and was tested. Nothing joined them,
and every unit stayed green through it. `feedback_pin-the-caller`: when the bug
is "nobody passed the arguments", a test of the helper cannot see it.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Mapping, Optional

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vesta.supervise.agent import audit
from vesta.supervise.agent import budget
from vesta.supervise.agent import concerns
from vesta.supervise.agent import config as agent_config
from vesta.supervise.agent import reason
from vesta.supervise.agent import registry as reg_mod
from vesta.supervise.agent import runtime
from vesta.supervise.agent import scheduler
from vesta.supervise.agent import triage
from vesta.supervise.agent.refs import RefTable
from vesta.supervise.agent.registry import Registry
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import data
from fake_provider import FakeProvider, asks, says  # noqa: E402
from vesta.adapters import usage as usage_mod

DEVICE = "sensor.example_pump_power"

ON: Dict[str, Any] = {"enabled": True, "mode": "live", "model_triage": "t",
                      "model_reason": "r", "triggers": {"scheduled": True}}


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))
    monkeypatch.setattr(budget, "BUDGET_FILE", str(tmp_path / "b.json"))
    monkeypatch.setattr(audit, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(usage_mod, "USAGE_PATH", str(tmp_path / "u.json"))
    monkeypatch.setattr(budget, "_BREAKER", None)

    # ⚠️ BOTH REGISTRY BUILDERS, because `triage` and `runtime` each imported
    # `build_registry` BY NAME at module load, so patching one leaves the other
    # reaching the real journal on disk.
    monkeypatch.setattr(triage, "build_registry", _registry)
    monkeypatch.setattr(runtime, "build_registry",
                        lambda **kwargs: _registry())


class _Reader(BaseTool):
    """Stands in for every read tool, with allow-listed keys (see redact)."""

    name = "read_villa"
    description = "The villa, as a document."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [data({"ref": "d1", "state": "340", "unit": "W"})]


def _registry(*args: Any, **kwargs: Any) -> Registry:
    table = RefTable()
    table.ref_for(DEVICE, "Pool pump")
    return Registry([_Reader()], refs=table)


class _Provider(FakeProvider):
    """The fake, plus `configured()` — `scheduler._run_once` gates on it."""


def _escalating(n: int) -> str:
    return "\n".join(f"ESCALATE: Subject {i + 1} — it looks wrong"
                     for i in range(n))


def _concern_call(title: str = "Pump drawing more than usual") -> Any:
    return asks("raise_concern", {
        "title": title, "body": "It has been at 340 W.",
        "severity": "warning", "ref": "d1"}, "tu_c")


def _run(config: Dict[str, Any], provider: Any, trigger: str = "scheduled") -> str:
    return asyncio.run(scheduler.run_once(
        None, config=config, provider=provider, document="the villa",
        trigger=trigger))


def _rows(verdict: str) -> List[Dict[str, Any]]:
    """Audit rows about RUNS with this verdict.

    ⚠️ THE `tool` FILTER IS LOAD-BEARING AND ITS ABSENCE MADE THREE ASSERTIONS
    OFF BY ONE. `record_pass` writes the PASS row with `verdict="escalated"`
    too — the same word for "this pass escalated something" and "this subject
    was escalated to an investigation" — so a filter on the verdict alone counts
    the pass as a fourth subject.
    """
    return [r for r in audit.rows(500) if str(r.get("verdict")) == verdict
            and str(r.get("tool", "")).startswith("run:")]


# ── the wire ────────────────────────────────────────────────────────────────
def test_an_escalated_subject_produces_an_investigation_and_a_concern() -> None:
    """⚠️ THE ASSERTION THAT WAS FALSE ON THE OWNER'S VILLA. A pass escalated two
    real subjects at 12:18 and produced no Concern, because `_run_once` formatted
    the escalations into a string and returned."""
    provider = _Provider([
        says(_escalating(1)),          # triage
        asks("read_villa", {}, "tu_1"),  # investigation: read
        _concern_call(),                 # investigation: write
        says("done"),
    ])
    outcome = _run(dict(ON), provider)

    rows = concerns.read()
    assert len(rows) == 1, f"no concern was produced: {outcome}"
    assert rows[0]["severity"] == "warning"
    assert "investigated 1" in outcome and "1 concern" in outcome


def test_a_quiet_pass_investigates_nothing() -> None:
    provider = _Provider([says("NOTHING")])
    assert _run(dict(ON), provider) == "nothing to escalate"
    assert not concerns.read()
    assert not _rows("escalated")


def test_one_investigation_per_subject_never_one_per_pass() -> None:
    """⚠️ THREE SUBJECTS IN ONE RUN PRODUCE EVIDENCE ATTRIBUTABLE TO NOTHING,
    and `raise_concern` keys on ONE subject, so a conflated run would have to
    pick which of the three it was about."""
    provider = _Provider([says(_escalating(3))]
                         + [says("nothing found")] * 3)
    # ⚠️ THE CAP IS NAMED, NOT INHERITED — this test is about ONE RUN PER
    # SUBJECT, and the shipped per-pass cap (2 since 2.752.0) would clip the
    # third subject for an unrelated reason and leave the property untested.
    _run({**ON, "max_investigations_per_pass": 3}, provider)

    links = _rows("escalated")
    assert len(links) == 3, links
    assert len({r["run_id"] for r in links}) == 3, "the run ids collided"
    # ⚠️ `subject`, NOT `detail`. The subject became a structural audit field
    # in TASK-105 so the approval queue can hand it back to the loop without
    # splitting a sentence; `detail` now carries triage's REASON.
    assert [r["subject"] for r in links] == [
        "Subject 1", "Subject 2", "Subject 3"]
    assert links[0]["detail"] == "it looks wrong"


def test_the_audit_follows_one_subject_from_escalation_to_run() -> None:
    """The link row carries the subject AND the id every later row carries."""
    provider = _Provider([says(_escalating(1)), says("nothing found")])
    _run(dict(ON), provider)

    link = _rows("escalated")[0]
    assert link["subject"] == "Subject 1"
    followed = [r for r in audit.rows(500)
                if r.get("run_id") == link["run_id"]]
    assert {str(r.get("verdict")) for r in followed} >= {"escalated", "started"}


# ── the two dials the owner chose (ADR-021) ─────────────────────────────────
def test_the_cap_bounds_how_many_are_followed_not_how_many_are_recorded() -> None:
    provider = _Provider([says(_escalating(5))] + [says("nothing found")] * 5)
    outcome = _run({**ON, "max_investigations_per_pass": 2}, provider)

    assert len(_rows("escalated")) == 2
    assert "escalated 5 " in outcome, outcome
    assert "3 left for next pass" in outcome


def test_the_ones_the_CAP_left_are_RECORDED_with_their_subjects() -> None:
    """⚠️ THE COUNT EXISTED AND THE SUBJECTS DID NOT (2026-08-28, owner: "3
    items are waiting for the next check, but i don't see them in the card").
    `follow_up` used to `break` at the cap and write nothing for the remainder,
    so the pass reported "3 left for next pass" and the Triage tab printed that
    sentence above two cards, naming three things it had no way to list.

    ⚠️ THE APPROVE PATH ALREADY DID THIS, which is what made it a defect rather
    than a design: an escalation waiting for a PERSON gets an `AWAITING` row
    carrying its subject; one waiting for the CAP got nothing. One mode recorded
    the fact, the other forgot it.

    ⚠️ AND THE ROW MUST CARRY THE SUBJECT AND THE REASON, not just exist — the
    card renders both, and `loadCheckFlags` refuses to start a flag from a
    subject-less row, so a bare marker would be silently dropped."""
    provider = _Provider([says(_escalating(5))] + [says("nothing found")] * 5)
    _run({**ON, "max_investigations_per_pass": 2}, provider)

    deferred = _rows(audit.DEFERRED)
    assert len(deferred) == 3, (
        f"{len(deferred)} deferred row(s) for 5 escalations at a cap of 2 — the "
        f"remainder is counted in the pass line and must also be recorded")
    assert [r["subject"] for r in deferred] == [
        "Subject 3", "Subject 4", "Subject 5"], (
        "the deferred rows do not name the subjects that were actually left")
    assert all(str(r.get("detail") or "") for r in deferred), (
        "a deferred row carries no reason, so its card would show a bare name")

    # ⚠️ AND NOT CONFUSED WITH THE ONES THAT RAN. Two verdicts, two meanings:
    # `escalated` is "a model looked at this", `deferred` is "nobody has".
    assert audit.DEFERRED != "escalated" and audit.DEFERRED != audit.AWAITING
    assert len(_rows("escalated")) == 2


def test_a_DEFERRED_row_is_not_a_pending_APPROVAL() -> None:
    """⚠️ THEY LOOK ALIKE AND MEAN OPPOSITE THINGS. `AWAITING` is a request for
    a person to decide and drives the Investigate/Cancel buttons; `DEFERRED` is
    a record that this pass ran out of budget and asks nobody for anything. If
    the queue ever picked these up, a villa on the automatic mode would grow an
    approval list it never asked for."""
    provider = _Provider([says(_escalating(5))] + [says("nothing found")] * 5)
    _run({**ON, "max_investigations_per_pass": 2}, provider)
    pending = {p["runId"] if "runId" in p else p.get("run_id")
               for p in audit.pending_escalations()}
    deferred = {r["run_id"] for r in _rows(audit.DEFERRED)}
    assert not (pending & deferred), (
        "a deferred escalation is queued for approval; nobody was asked")


def test_the_default_cap_matches_the_shipped_config() -> None:
    """⚠️ ONE NUMBER, TWO FILES. A second default is the drift this repo has
    paid for at every layer it has one."""
    assert reason.DEFAULT_CAP == agent_config.DEFAULTS[
        "max_investigations_per_pass"]
    assert reason.cap_of({}) == reason.DEFAULT_CAP


@pytest.mark.parametrize("bad", [None, "three", float("inf"), object()])
def test_an_unreadable_cap_falls_back_rather_than_crashing_the_clock(
        bad: Any) -> None:
    """⚠️ `float('inf')` RAISES `OverflowError`, NOT `ValueError` — the trap
    `policy._positive` records, found there by a test rather than by review."""
    assert reason.cap_of({"max_investigations_per_pass": bad}) >= 0


def test_approve_mode_records_the_escalations_and_spends_nothing() -> None:
    provider = _Provider([says(_escalating(2))])
    outcome = _run({**ON, "mode": "ask"}, provider)

    assert "2 queued for approval" in outcome
    assert not concerns.read()
    queued = _rows("awaiting-approval")
    assert [r["subject"] for r in queued] == ["Subject 1", "Subject 2"]
    # ⚠️ NOTHING WAS INVESTIGATED, so the fake's script is untouched past triage.
    assert len(provider.calls) == 1


def test_observe_STILL_investigates_because_it_is_delivery_that_is_held() -> None:
    assert reason.auto({}) is True
    assert reason.auto({"mode": "ask"}) is False
    # ⚠️ "observe" INVESTIGATES. Running everything and delivering nothing is
    # the whole point of the mode; refusing to investigate would make an
    # observe period a record of nothing having been looked at.
    assert reason.auto({"mode": "observe"}) is True
    assert agent_config.DEFAULTS["mode"] == "observe"


# ── the bounds ──────────────────────────────────────────────────────────────
def test_the_budget_is_asked_before_every_investigation_not_once_per_pass() -> None:
    """⚠️ THIS IS WHERE COST MOVES FROM PER-PASS TO PER-FINDING. The triage gate
    already passed for one cheap call; three frontier runs behind it are a
    different order of spend, and a ceiling asked once binds a pass late.

    ⚠️ AND THE FIRST VERSION OF THIS TEST COUNTED `budget.check` CALLS AND
    MEASURED NOTHING. `registry.run` asks the same question once per TURN, so
    three investigations produce three calls whether or not this module asks at
    all — the assertion passed with the per-investigation check deleted. What
    separates the two is WHERE THE PASS STOPS: with a ceiling of three requests
    the triage call takes one and each investigation takes one, so the third
    must never be STARTED. Asked once, all three start and merely decline.
    """
    provider = _Provider([says(_escalating(3))] + [says("nothing")] * 3)
    # ⚠️ THE CAP IS NAMED HERE, NOT INHERITED. This test is about the BUDGET
    # binding per investigation; with the shipped cap (2 since 2.752.0) the
    # pass stops for a different reason and the property goes unmeasured while
    # the test still passes on the word "stopped". Deriving from the default
    # would be the same trap one level down.
    outcome = _run({**ON, "monthly_limit": 3,
                    "max_investigations_per_pass": 3}, provider)

    assert len(_rows("escalated")) == 2, (
        "an investigation was started with the budget already spent; the "
        f"ceiling was asked once for the pass instead of once each: {outcome}")
    assert "stopped" in outcome, outcome


def test_a_spent_budget_stops_the_pass_and_says_so() -> None:
    provider = _Provider([says(_escalating(3))] + [says("nothing")] * 3)
    outcome = _run({**ON, "monthly_limit": 1}, provider)
    # The triage call itself spends the one request allowed.
    assert len(_rows("escalated")) == 0
    assert "stopped" in outcome, outcome


def test_an_investigation_that_raises_cannot_stop_the_clock() -> None:
    """⚠️ `scheduler.run_forever` IS A BACKGROUND TASK NOBODY WATCHES. An
    exception escaping here takes out supervision for the life of the process,
    and the symptom is a villa that quietly stopped watching itself."""
    original = runtime.investigate

    async def explode(**kwargs: Any) -> Any:
        # ⚠️ TIER-SCOPED, because `reason.runtime` IS the `agent.runtime` module
        # — patching it also patches the call `triage.run` makes, and a triage
        # pass that raises never reaches the code under test.
        if kwargs.get("tier") == "triage":
            return await original(**kwargs)
        raise RuntimeError("provider melted")

    runtime.investigate = explode                 # type: ignore[assignment]
    try:
        provider = _Provider([says(_escalating(2))])
        outcome = _run(dict(ON), provider)
    finally:
        runtime.investigate = original            # type: ignore[assignment]
    assert "escalated 2" in outcome
    assert len(_rows("escalated")) == 2, "the intent rows survive the crash"


def test_the_clause_can_never_break_the_pass_row() -> None:
    """⚠️ `run_once` SPLITS THE REASON ON THE FIRST `": "` to recover the count
    and the subjects. A colon inside the clause would file part of this sentence
    as the escalated subjects — the audit lying about what was escalated, in the
    record the cutover is read from."""
    for follow in (reason.Followup(escalated=3, started=3, concerns=2),
                   reason.Followup(escalated=3, queued=3),
                   # ⚠️ A REFUSAL WRITTEN IN ANOTHER MODULE, colon and all —
                   # `budget.check` composes its own reasons and this clause
                   # quotes them verbatim.
                   reason.Followup(escalated=3, started=1,
                                   stopped="stopped, budget: 4000 reached"),
                   reason.Followup(escalated=5, started=2,
                                   stopped="3 left for next pass")):
        assert ": " not in follow.clause(), follow.clause()


def test_the_pass_row_still_reports_the_count_and_the_subjects() -> None:
    provider = _Provider([says(_escalating(2))] + [says("nothing")] * 2)
    _run(dict(ON), provider)
    row = audit.passes(5)[-1]
    assert row["escalated"] == "2", row
    assert "escalated 2 (investigated 2): Subject 1, Subject 2" in row["detail"]
    # ⚠️ AND THE SUBJECTS FIELD IS STILL THE SUBJECTS. `record_pass` recovers it
    # from everything after the first ": ", which is what the clause's no-colon
    # rule protects.
    assert "| Subject 1, Subject 2 |" in row["detail"], row


# ── observe mode, and what the trigger is filed as ──────────────────────────
def test_in_observe_mode_the_concern_is_LIVE_and_informational() -> None:
    """⚠️ THE SHADOW STORE IS GONE FROM THIS PATH (2026-08-28, owner's ruling).
    An observe-mode concern lands in the ONE live store — visible on the
    Reason tab — stamped `informational` so the outbox tells people once and
    asks nothing. This is the end-to-end wiring pin: mode → writer → store."""
    provider = _Provider([
        says(_escalating(1)), asks("read_villa", {}, "tu_1"),
        _concern_call(), says("done")])
    _run({**ON, "mode": "observe"}, provider)

    rows = concerns.read()
    assert len(rows) == 1, "the concern must reach the LIVE store"
    assert rows[0]["informational"] is True

    concerns._write([])
    _run({**ON, "mode": "live"}, _Provider([
        says(_escalating(1)), asks("read_villa", {}, "tu_1"),
        _concern_call(), says("done")]))
    assert concerns.read()[0]["informational"] is False


def test_the_trigger_survives_into_the_investigation_and_its_spend() -> None:
    """⚠️ THE SAME DEFECT ONE LINK FURTHER ALONG. v2.686.0 fixed the trigger
    reaching `triage.run`; this is the next wire, and a literal here would file
    an owner's manual test as the villa acting on its own."""
    provider = _Provider([says(_escalating(1)), says("nothing")])
    _run(dict(ON), provider, trigger="manual")

    link = _rows("escalated")[0]
    assert link["run_id"].startswith("manual"), link
    assert link["tool"] == "run:manual", link
    sources = {str(r.get("source")) for r in usage_mod.rows()}
    assert sources == {"manual"}, sources
