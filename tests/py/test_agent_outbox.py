"""A Concern reaching a phone. TASK-106, REQ-031/033/034.

⚠️ THE ROUTING LAYER WAS COMPLETE, TESTED, AND IMPORTED BY NOTHING. Every
assertion in `test_agent_route` passed throughout, because each one calls
`route.plan` directly — which is precisely the shape `feedback_pin-the-caller`
records. So most of this file is about the SWEEP: which concerns are owed a
delivery, what happens to one that is held, and what is written down afterwards.
"""

from __future__ import annotations

import asyncio
import time
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vesta.supervise.agent import concerns
from vesta.supervise.agent import outbox
from vesta.supervise.agent import route
from vesta.supervise.agent.concerns import Concern

ON: Dict[str, Any] = {
    "enabled": True, "shadow": False,
    "people": [{"role": "owner", "telegram": "123", "targets": ["notify.owner"]}],
}
EVIDENCE = [{"tool": "read_state", "summary": "340 W"}]


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))


class _Sender:
    """Stands in for `reports.deliver`, recording what it was asked to send."""

    def __init__(self, ok: bool = True) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.ok = ok

    async def deliver(self, session: Any, targets: Any, title: str,
                      message: str, known: Any = ()) -> List[Dict[str, Any]]:
        self.calls.append({"targets": list(targets), "title": title,
                           "message": message})
        return [{"target": t, "status": "sent" if self.ok else "failed"}
                for t in targets]


def _wire(monkeypatch: pytest.MonkeyPatch, sender: _Sender,
          *, targets: Any = ("notify.owner",), occupied: Any = None) -> None:
    from vesta.adapters import deliver as deliver_mod
    from vesta.adapters import people as people_mod

    monkeypatch.setattr(deliver_mod, "deliver", sender.deliver)
    monkeypatch.setattr(people_mod, "targets_for_role",
                        lambda cfg, role: list(targets))

    async def occ(session: Any) -> Any:
        return occupied

    monkeypatch.setattr(outbox, "occupancy_now", occ)


def _raise(severity: str = "warning", **kw: Any) -> str:
    stored, why = concerns.raise_concern(Concern(
        subject_key=kw.pop("subject_key", "a1b2c3d4a1b2c3d4"),
        title=kw.pop("title", "Cooling unit short-cycling"),
        body="It has been at 340 W.", severity=severity,
        audience=kw.pop("audience", "owner"), evidence=list(EVIDENCE), **kw))
    assert stored is not None, why
    return stored.id


# ── which concerns are owed a delivery ──────────────────────────────────────
def test_an_open_undelivered_concern_is_owed_one() -> None:
    _raise()
    assert len(outbox.undelivered()) == 1


def test_a_delivered_concern_is_not_owed_another() -> None:
    """⚠️ THE FIELD IS ON THE CONCERN, NOT IN A QUEUE. A queue beside the store
    is a second thing to keep in step, and the first disagreement means somebody
    is spammed or told nothing."""
    cid = _raise()
    outbox._mark_delivered(cid, now=1.0)
    assert outbox.undelivered() == []


def test_a_settled_concern_is_never_delivered() -> None:
    """⚠️ SOMEBODY HAS ALREADY DEALT WITH IT. Sending afterwards is
    alert fatigue in its purest form."""
    cid = _raise()
    concerns.transition(cid, "closed", outcome="fixed")
    assert outbox.undelivered() == []


# ── the sweep ───────────────────────────────────────────────────────────────
def test_a_concern_reaches_a_target(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE ASSERTION THAT WAS FALSE FOR THE WHOLE OF THIS SUBSYSTEM'S LIFE.
    `route.py` was complete and nothing called it."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    _raise()
    result = asyncio.run(outbox.sweep(None, config=dict(ON)))

    assert result.sent == 1, result.line()
    assert sender.calls[0]["targets"] == ["notify.owner"]
    assert "short-cycling" in sender.calls[0]["title"].lower()
    assert concerns.read()[0]["delivered_at"], "nothing was stamped"


def test_an_INFORMATIONAL_concern_is_sent_once_and_raises_no_job(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE STAMP DECIDES, NOT TODAY'S MODE (2026-08-28, owner's ruling —
    this replaced `test_shadow_mode_sends_nothing`). An observe-mode concern
    is DELIVERED, as an FYI whose copy says nothing is asked; what the stamp
    withholds is the to-do job and the chase. Both directions are pinned here
    because the job call is a caller-wiring fact a test of `task.raise_for`
    alone stays green through — `feedback_pin-the-caller`, again."""
    from vesta.supervise.agent import task as task_mod
    jobs: List[Any] = []

    async def _record_job(session: Any, concern: Any, *, config: Any = None
                          ) -> None:
        jobs.append(dict(concern))

    monkeypatch.setattr(task_mod, "raise_for", _record_job)
    sender = _Sender()
    _wire(monkeypatch, sender)
    _raise(informational=True)
    result = asyncio.run(outbox.sweep(None, config=dict(ON)))

    assert result.sent == 1, result.line()
    assert sender.calls[0]["title"].startswith("FYI: ")
    assert "nothing is asked of you" in sender.calls[0]["message"]
    assert jobs == [], "an FYI raised a to-do job — the mode promised not to"
    row = concerns.read()[0]
    assert row["delivered_at"], "an FYI must still be stamped as sent"
    # ⚠️ AND IT NEVER ENTERS THE ESCALATION QUEUE. Nobody acknowledges an FYI,
    # so a permanent resident here would crowd real criticals out of the
    # sweep's first-five window.
    assert outbox.awaiting_acknowledgement() == []

    # The other direction: an ordinary concern still raises the job.
    concerns._write([])
    _raise(severity="critical", subject_key="b2b2b2b2b2b2b2b2")
    result = asyncio.run(outbox.sweep(None, config=dict(ON)))
    assert result.sent == 1 and len(jobs) == 1, result.line()
    assert not sender.calls[-1]["title"].startswith("FYI")
    assert outbox.awaiting_acknowledgement() != []


def test_the_agent_being_off_sends_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    sender = _Sender()
    _wire(monkeypatch, sender)
    _raise()
    assert asyncio.run(outbox.sweep(None, config={**ON, "enabled": False})).sent == 0
    assert sender.calls == []


def test_a_burst_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ A VILLA COMING OUT OF SHADOW HAS A BACKLOG. Turning delivery on must
    not put the whole month on somebody's phone in one second."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    for i in range(outbox.MAX_PER_SWEEP + 3):
        _raise(subject_key=f"{i:016x}", title=f"Finding {i}")
    result = asyncio.run(outbox.sweep(None, config=dict(ON)))

    assert result.sent == outbox.MAX_PER_SWEEP
    assert len(outbox.undelivered()) == 3, "the rest must wait, not vanish"


def test_a_failed_send_is_retried_next_sweep(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ STAMPED AFTER THE SEND, NEVER BEFORE. Marking first loses the concern
    entirely when the send fails: stamped, so no later sweep retries it, and
    nobody was ever told."""
    sender = _Sender(ok=False)
    _wire(monkeypatch, sender)
    _raise()
    assert asyncio.run(outbox.sweep(None, config=dict(ON))).failed == 1
    assert outbox.undelivered(), "a failed send was marked delivered"

    sender.ok = True
    assert asyncio.run(outbox.sweep(None, config=dict(ON))).sent == 1


def test_no_configured_target_does_not_mark_it_delivered(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ OTHERWISE CONFIGURING A TARGET LATER SILENTLY SKIPS EVERYTHING RAISED
    BEFORE IT."""
    sender = _Sender()
    _wire(monkeypatch, sender, targets=())
    _raise()
    asyncio.run(outbox.sweep(None, config=dict(ON)))
    assert outbox.undelivered()


# ── quiet hours ─────────────────────────────────────────────────────────────
def test_an_unset_window_is_never_quiet() -> None:
    """⚠️ EMPTY MEANS NEVER QUIET, NOT ALWAYS. A property that has configured
    nothing wants its warnings, not a silence it never asked for."""
    assert outbox.quiet_now({}) is False
    assert outbox.quiet_now({"quiet_hours_start": "22:00"}) is False


@pytest.mark.parametrize("hhmm,quiet", [
    ("23:30", True), ("02:00", True), ("06:59", True),
    ("07:00", False), ("12:00", False), ("21:59", False), ("22:00", True),
])
def test_the_window_wraps_midnight(hhmm: str, quiet: bool) -> None:
    """⚠️ THE ONLY CASE THAT MATTERS. Quiet hours are 22:00–07:00 on every
    property anyone would configure, and a naive `start <= now <= end` is false
    for the WHOLE window — which reads as "working", because nothing is ever
    held."""
    import calendar
    import time as _t

    hour, minute = (int(x) for x in hhmm.split(":"))
    stamp = calendar.timegm(_t.struct_time(
        (2026, 8, 24, hour, minute, 0, 0, 236, 0)))
    assert outbox.quiet_now(
        {"quiet_hours_start": "22:00", "quiet_hours_end": "07:00",
         "timezone": "UTC"}, now=stamp) is quiet


@pytest.mark.parametrize("bad", ["", "22", "9pm", "25:00", "22:71", "::", None])
def test_an_unreadable_window_is_not_quiet(bad: Any) -> None:
    assert outbox.quiet_now(
        {"quiet_hours_start": bad, "quiet_hours_end": "07:00"}) is False


# ── held, and released ──────────────────────────────────────────────────────
def test_a_warning_in_quiet_hours_with_nobody_home_is_held(
        monkeypatch: pytest.MonkeyPatch) -> None:
    sender = _Sender()
    _wire(monkeypatch, sender, occupied=False)
    _raise(severity="warning")
    result = asyncio.run(outbox.sweep(
        None, config={**ON, "quiet_hours_start": "00:00",
                      "quiet_hours_end": "23:59", "timezone": "UTC"}))

    assert result.held == 1 and result.sent == 0
    assert sender.calls == []
    assert outbox.undelivered(), (
        "a held concern was stamped delivered — 'held until morning' would "
        "then mean 'dropped'")


def test_a_held_concern_goes_out_on_the_next_sweep_after_the_window(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE WHOLE RELEASE MECHANISM, AND IT HAS NO MOVING PARTS. There is no
    timer and no queue: the sweep runs on the clock, and the first one that
    finds the window closed sends it."""
    sender = _Sender()
    _wire(monkeypatch, sender, occupied=False)
    _raise(severity="warning")
    quiet = {**ON, "quiet_hours_start": "00:00", "quiet_hours_end": "23:59",
             "timezone": "UTC"}
    assert asyncio.run(outbox.sweep(None, config=quiet)).held == 1

    assert asyncio.run(outbox.sweep(None, config=dict(ON))).sent == 1
    assert concerns.read()[0]["delivered_at"]


def test_a_critical_ignores_quiet_hours(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THAT IS THE WHOLE MEANING OF THE WORD. If it can wait until morning
    it is a warning. `route.MATRIX` decides this, not the config."""
    sender = _Sender()
    _wire(monkeypatch, sender, occupied=False)
    _raise(severity="critical")
    result = asyncio.run(outbox.sweep(
        None, config={**ON, "quiet_hours_start": "00:00",
                      "quiet_hours_end": "23:59", "timezone": "UTC"}))
    assert result.sent == 1 and result.held == 0


def test_an_occupied_villa_is_not_held(monkeypatch: pytest.MonkeyPatch) -> None:
    """A failure nobody is experiencing can wait; the same failure with people
    in the house is happening TO somebody."""
    sender = _Sender()
    _wire(monkeypatch, sender, occupied=True)
    _raise(severity="warning")
    assert asyncio.run(outbox.sweep(
        None, config={**ON, "quiet_hours_start": "00:00",
                      "quiet_hours_end": "23:59", "timezone": "UTC"})).sent == 1


def test_unknown_occupancy_delivers(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ "I CANNOT TELL" IS NOT "NOBODY IS HOME". Holding on an assumption is
    the expensive way to be wrong."""
    sender = _Sender()
    _wire(monkeypatch, sender, occupied=None)
    _raise(severity="warning")
    assert asyncio.run(outbox.sweep(
        None, config={**ON, "quiet_hours_start": "00:00",
                      "quiet_hours_end": "23:59", "timezone": "UTC"})).sent == 1


# ── the caller ──────────────────────────────────────────────────────────────
def _decommented(src: str) -> str:
    """⚠️ COMMENTS STRIPPED BEFORE MATCHING. Six pins in this repository have
    passed by matching their own PROSE — a sentence about a call is not a
    call — and every one of them was found the same way."""
    return "\n".join(l for l in src.splitlines()
                      if not l.strip().startswith("#"))


def test_the_clock_runs_the_sweep_every_pass() -> None:
    """⚠️ UNCONDITIONALLY, AND THAT IS WHAT RELEASES A HELD CONCERN. Running it
    only after a pass that escalated would leave a concern held overnight and
    never looked at again. `feedback_pin-the-caller`."""
    import inspect

    from vesta.supervise.agent import scheduler

    assert "outbox_mod.sweep(" in _decommented(
        inspect.getsource(scheduler.dispatch)), (
        "the dispatch tail does not run the outbox, so no Concern reaches a "
        "phone and a held one is never released")
    assert "dispatch(" in _decommented(inspect.getsource(scheduler._pass)), (
        "the triage clock no longer dispatches, so a scheduled pass mints "
        "concerns and carries none of them")


def test_the_BUTTON_delivers_too_and_not_only_the_clock() -> None:
    """⚠️ THE DEFECT THIS FILE'S OTHER PIN COULD NOT SEE, AND IT SHIPPED FOR
    SIXTY RELEASES. `outbox.sweep` had exactly ONE caller — the scheduled pass —
    while "Check the villa now" called `run_once` directly. So a check an owner
    ran HIMSELF investigated, minted a Concern, recorded it and showed it on the
    tablet, and sent nothing to anybody until the six-hourly clock came round.

    Both halves were correct and nothing joined them, which is this project's
    most-repeated defect (`feedback_two-correct-halves`). The pin above proved
    the CLOCK delivers and would have stayed green through all of it, because it
    only ever asked about one of the two callers — `feedback_pin-the-caller`
    applied to the caller nobody thought to name.

    ⚠️ IT READS THE PROXY AS TEXT because the handler needs an aiohttp request,
    a session and a provider to run. What must be true is a WIRING fact, and a
    wiring fact is visible in the source.
    """
    import os

    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    with open(os.path.join(root, "rootfs", "usr", "bin",
                           "vesta", "supervise", "api.py"), encoding="utf-8") as fh:
        proxy = _decommented(fh.read())

    assert "agent_scheduler.dispatch(" in proxy, (
        "the manual 'Check the villa now' button does not dispatch, so a pass "
        "an owner started himself delivers nothing to anybody until the "
        "scheduled clock next runs")
    assert "agent_scheduler.run_once(" in proxy, (
        "the manual button no longer runs a triage pass at all")


# ── the briefing carries what the agent concluded ───────────────────────────
def test_a_concern_reaches_the_briefing() -> None:
    """⚠️ THE DISCREPANCY THIS SUBSYSTEM'S CARDINAL RULE FORBIDS. Until this
    existed the agent filed a Concern, it rendered on the kiosk, and the
    briefing showed a different list about the same villa."""
    from vesta.supervise.agent import fallback as agent_fallback

    # ⚠️ RE-POINTED AT THE BRIEF'S NEW AUTHOR (TASK-073); the property is the
    # cardinal rule itself and outlives any renderer.
    body = agent_fallback.brief(
        concerns=[{"title": "Cooling unit short-cycling",
                   "severity": "warning", "age_days": 3.0,
                   "subject_key": "a1"}]).text
    assert "Cooling unit short-cycling" in body


# ⚠️ test_the_worst_concern_sets_the_title_marker LEFT WITH ITS RENDERER
# (TASK-073): `_worst` and the emoji title markers were the old document's.
# The severity ORDERING half of the property is pinned just below.


def test_the_worst_first_ordering_is_not_inverted() -> None:
    """⚠️ TWO `severity_rank` FUNCTIONS, ONE NAME, OPPOSITE CONVENTIONS.
    `reports.contracts` counts UP to critical; `agent.contracts` counts DOWN. A
    sort written from the agent's habit puts the critical line LAST, which reads
    as "nothing much" on a phone."""
    from vesta.supervise.agent import fallback as agent_fallback

    body = agent_fallback.brief(
        concerns=[{"title": "Quiet notice", "severity": "notice",
                   "subject_key": "a1"},
                  {"title": "Loud critical", "severity": "critical",
                   "subject_key": "a2"}]).text
    assert body.index("Loud critical") < body.index("Quiet notice")


def test_a_blueprint_already_reporting_a_subject_wins() -> None:
    """⚠️ THE SAME RULE ONE LAYER UP APPLIES: while a blueprint covers a device
    it sees occupancy, schedules and tariffs the agent's evidence does not.
    Retire it and the Concern becomes the only report of that device."""
    from vesta.brief import pipeline

    pipeline.set_concerns_source(lambda: [
        {"title": "Covered", "severity": "warning", "subject_key": "dup"},
        {"title": "Uncovered", "severity": "warning", "subject_key": "solo"}])
    try:
        rows = pipeline._agent_concerns({"dup"})
    finally:
        pipeline.set_concerns_source(None)
    assert [r["title"] for r in rows] == ["Uncovered"]


def test_reports_does_not_import_the_agent_to_do_this() -> None:
    """⚠️ ARCH-003. The deterministic layer must not depend on the interpretive
    one; a briefing must still compose with the agent switched off, broken or
    absent. The first version of this feature imported `agent.sources` directly
    and `test_reports_never_imports_agent` caught it."""
    from vesta.brief import pipeline

    pipeline.set_concerns_source(None)
    assert pipeline._agent_concerns(set()) == [], (
        "with no source registered a briefing must simply carry no concerns")


def test_the_proxy_registers_the_source_at_boot() -> None:
    """⚠️ `feedback_pin-the-caller`. A hook nobody registers is this codebase's
    most repeated defect, and this one would present as briefings that quietly
    never mention anything the agent found."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                            "supervisor-proxy.py"), encoding="utf-8").read()
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    assert "set_concerns_source(" in code, (
        "nothing registers the concerns source, so no Concern reaches a report")


def test_a_concern_does_not_repeat_a_built_in_finding() -> None:
    """⚠️ THE SECOND DEDUP, AND THE FIRST CUT ONLY HAD ONE. Concerns were
    deduped against the BLUEPRINT layer and not against the built-in checks — so
    a metered device the modules had already reported could appear twice in one
    brief, once as a finding and once as a Concern, in different words, about
    the same equipment."""
    from vesta.brief import pipeline

    pipeline.set_concerns_source(lambda: [
        {"title": "Also seen by a check", "severity": "warning",
         "subject_key": "checked"},
        {"title": "Only the agent", "severity": "warning", "subject_key": "solo"}])
    try:
        rows = pipeline._agent_concerns({"checked"})
    finally:
        pipeline.set_concerns_source(None)
    assert [r["title"] for r in rows] == ["Only the agent"]


# ── acknowledgement, and the escalation it stops (TASK-112) ─────────────────
# ⚠️ EVERY TEST BELOW GOES THROUGH `escalation_sweep`, NOT THROUGH
# `route.escalate`. That function was correct, tested rung by rung, and
# imported by nothing for the whole of its existence — REQ-033 was unmet not
# because escalation was wrong but because nothing asked it. A suite that
# exercises the decision function stays green through exactly that, which is
# `feedback_pin-the-caller` for the second time in two releases.

def _delivered(minutes_ago: float, *, severity: str = "critical",
               **kw: Any) -> str:
    """A concern sent `minutes_ago` and never acknowledged."""
    cid = _raise(severity=severity, **kw)
    outbox._mark_delivered(cid, now=time.time() - minutes_ago * 60)
    return cid


def test_an_UNACKNOWLEDGED_concern_escalates_on_the_band(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """The first band is 15 minutes; 20 is past it."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    _delivered(20)
    out = asyncio.run(outbox.escalation_sweep(None, config=ON))
    assert out.sent == 1, out.line()
    assert sender.calls, "nothing was actually sent"
    assert sender.calls[0]["title"].startswith("Still open:")


def test_an_ACKNOWLEDGED_concern_does_not(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE WHOLE POINT OF TASK-112. Until `acknowledge` existed there was no
    way for this to be false, so escalation could only ever run forever — the
    precise failure alert fatigue names."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    cid = _delivered(200)
    ok, why = concerns.acknowledge(cid, by="owner")
    assert ok, why
    out = asyncio.run(outbox.escalation_sweep(None, config=ON))
    assert out.sent == 0 and sender.calls == []
    assert outbox.awaiting_acknowledgement() == []


def test_a_CLEARED_condition_stands_down_and_says_so(
        monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """⚠️ RE-EVALUATES, DOES NOT COUNT DOWN. Escalating a problem that fixed
    itself is how a supervisor loses trust fastest — and a stand-down nobody can
    see is the same empty result as nothing being due."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    cid = _delivered(200)
    concerns.transition(cid, "closed", outcome="fixed itself")
    out = asyncio.run(outbox.escalation_sweep(None, config=ON))
    assert out.sent == 0 and sender.calls == []
    assert "stood down" in capsys.readouterr().out


def test_one_STEP_is_taken_once_however_many_sweeps_run(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE SWEEP RUNS EVERY FEW MINUTES. Without this the same band fires on
    every one of them until somebody answers, which is the alert fatigue this
    path exists to prevent, delivered by the mechanism meant to prevent it."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    _delivered(20)
    first = asyncio.run(outbox.escalation_sweep(None, config=ON))
    second = asyncio.run(outbox.escalation_sweep(None, config=ON))
    assert first.sent == 1 and second.sent == 0
    assert len(sender.calls) == 1


def test_acknowledging_is_NOT_resolving() -> None:
    """A person saying "I have seen this" is not saying it is fixed. If this
    were a state transition the concern would leave `open` and the villa would
    stop carrying a problem that is still happening."""
    cid = _delivered(1)
    concerns.acknowledge(cid, by="ops")
    row = [r for r in concerns.read() if r["id"] == cid][0]
    assert row["state"] == "open"
    assert row["acknowledged_by"] == "ops"


def test_an_acknowledgement_must_say_WHO() -> None:
    """⚠️ "Somebody has it" IS THE WHOLE CONTENT. Without a name it says only
    that a request arrived, and escalation would stop on that."""
    cid = _delivered(1)
    ok, why = concerns.acknowledge(cid, by="  ")
    assert not ok and "who" in why


def test_the_FIRST_acknowledgement_wins() -> None:
    """Not an error and not an overwrite — escalation has already stopped, and
    rewriting the name would lose who actually picked it up."""
    cid = _delivered(1)
    concerns.acknowledge(cid, by="ops")
    ok, why = concerns.acknowledge(cid, by="owner")
    assert ok and "already acknowledged by ops" in why
    row = [r for r in concerns.read() if r["id"] == cid][0]
    assert row["acknowledged_by"] == "ops"


def test_a_MALFORMED_delivery_stamp_never_pages_anyone(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ A PARSE FAILURE READS AS ZERO MINUTES, i.e. inside the first band. The
    other direction — treating an unreadable stamp as "long ago" — wakes the
    owner at three in the morning because of a formatting bug."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    cid = _raise(severity="critical")
    rows = concerns.read()
    for row in rows:
        if row["id"] == cid:
            row["delivered_at"] = "not a timestamp"
    concerns._write(rows)
    out = asyncio.run(outbox.escalation_sweep(None, config=ON))
    assert out.sent == 0 and sender.calls == []


def test_the_sweep_ACCOUNTS_for_every_concern_it_considered(
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str]) -> None:
    """⚠️ FOUND BY THE OWNER'S FIRST END-TO-END CAPTURE, IN THE TIER BUILT ONE
    RELEASE EARLIER TO PREVENT EXACTLY THIS. The line read
    `escalation: considered 2, sent 0, held 0, suppressed 0, stood down 0` —
    five numbers accounting for NONE of the two concerns it had just looked at.

    Both verdicts were correct: a warning does not escalate at all, and a recent
    critical is inside the first band. Neither had a counter, so a sweep working
    perfectly was indistinguishable from one that silently dropped two concerns
    — `feedback_instruments-never-skip`, occurring inside the instrument.

    ⚠️ FUNCTIONAL, BECAUSE THE FIRST VERSION OF THIS PIN WAS A GREP AND PASSED
    VACUOUSLY. It asserted `"quiet_reasons" in source`; deleting the increment
    left the declaration and the render behind, so the mutation stayed GREEN.
    This drives the real sweep and reads the real line.
    """
    _wire(monkeypatch, _Sender())
    # A warning never escalates; a 1-minute-old critical is inside the first
    # band. Two different quiet verdicts, so the reasons cannot collapse.
    # ⚠️ DISTINCT SUBJECTS. `raise_concern` refuses a second open concern about
    # the same one, which is a real rule and would otherwise make this test read
    # as a sweep bug.
    _delivered(200, severity="warning", subject_key="a1b2c3d4a1b2c3d4")
    _delivered(1, severity="critical", subject_key="ffeeddccbbaa9988")

    out = asyncio.run(outbox.escalation_sweep(None, config=ON))
    line = capsys.readouterr().out

    assert out.considered == 2, out.line()
    assert out.sent == 0 and out.failed == 0, "neither should have escalated"
    # ⚠️ THE RECONCILIATION ITSELF: every considered concern is spoken for.
    assert "2x" in line or line.count("1x") == 2, (
        "the escalation line does not account for the concerns it considered — "
        f"a reader cannot tell a correct quiet sweep from a dropped one: {line}")
    assert "only a critical escalates" in line, (
        "the reason a warning was skipped is not on the line, so 'not critical' "
        "and 'too recent' — which an operator acts on differently — read the same")
    assert "inside the first band" in line, (
        "the reason a recent critical was skipped is not on the line")


def test_the_scheduler_RUNS_the_escalation_sweep() -> None:
    """⚠️ `feedback_pin-the-caller`, and the reason this task exists at all:
    `route.escalate` was correct and uncalled. A sweep nobody runs is the same
    defect one layer out."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "supervise", "agent",
                            "scheduler.py"), encoding="utf-8").read()
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    assert "escalation_sweep(" in code, (
        "nothing runs the escalation sweep, so nothing is ever re-evaluated")


def test_the_proxy_EXPOSES_an_acknowledgement_route() -> None:
    """⚠️ TWO FILES FOR A ROUTE. A handler with no nginx location is answered
    with index.html at status 200 and surfaces as a JSON parse error blaming the
    client (2.501.0). An alert that can only be acknowledged by walking to the
    kiosk escalates while somebody is reading it."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta",
                            "supervise", "api.py"), encoding="utf-8").read()
    conf = open(os.path.join(REPO_ROOT, "rootfs", "etc", "nginx",
                             "nginx.conf"), encoding="utf-8").read()
    assert '"/agent-acknowledge"' in src
    assert "location = /agent-acknowledge" in conf


# ── who was told, and when ──────────────────────────────────────────────────
def test_every_send_is_recorded_with_its_PROFILE_and_time() -> None:
    """⚠️ A LIST, BECAUSE ESCALATION SENDS AGAIN TO SOMEBODY ELSE. `route.escalate`
    goes to the same target, then ADDS THE OWNER, then reaches everyone — so a
    single "delivered to" field is overwritten by the second send and the card
    then claims the first never happened.

    ⚠️ AND THE PROFILE, NOT THE NOTIFY ENTITY. `notify.living_room_…_jm` tells a
    reader nothing about who is reading it; "Owner" and "Facility manager" are
    what the People tab calls them. The owner reported two concerns marked
    "sent" and nothing on their own chat — a concern routes by AUDIENCE, so a
    villa with two chats can deliver every one successfully to the chat nobody
    reads, and the card has to name which.
    """
    cid = _raise(severity="critical")
    outbox._mark_delivered(cid, now=1_787_000_000.0, profile="owner")
    outbox._mark_escalated(cid, "add the owner", now=1_787_000_900.0,
                           profile="ops")

    row = [r for r in concerns.read() if r["id"] == cid][0]
    sends = row.get("deliveries")
    assert isinstance(sends, list) and len(sends) == 2, (
        f"expected both sends recorded, got {sends!r} — the escalation "
        "overwrote the delivery instead of appending to it")
    assert [s["profile"] for s in sends] == ["owner", "ops"], (
        "the profiles are wrong or out of order; the card reads them in "
        "sequence as 'sent to X, then Y'")
    assert all(s["at"] for s in sends), "a send carries no time"
    # ⚠️ THE FIRST SEND IS STILL `delivered_at`, because `undelivered` and
    # `awaiting_acknowledgement` both key on it. Replacing it with this list
    # would have rewritten both sweeps for a display change.
    assert row.get("delivered_at"), "delivered_at no longer marks the first send"

    # ⚠️ AND BOTH CALLERS MUST ACTUALLY PASS A PROFILE. The assertions above
    # hand `_mark_delivered` and `_mark_escalated` one directly, so they prove
    # the helpers honour it and nothing more — emptying the argument at either
    # CALL SITE left them green. `feedback_pin-the-caller`, third instance in a
    # day. Scoped to each call, because `profile=` appears in the signatures too.
    import inspect

    for fn, label in ((outbox._deliver_one, "the delivery sweep"),
                      (outbox._escalate_one, "the escalation sweep")):
        src = inspect.getsource(fn)
        code = "\n".join(l for l in src.splitlines()
                          if not l.strip().startswith("#"))
        start = code.index("_mark_")
        call = code[start:code.index(")", code.index("now=", start))]
        assert "profile=role" in call, (
            f"{label} no longer passes the profile, so every send it records "
            f"is anonymous. The call reads: {call!r}")


def test_a_send_with_no_profile_is_not_recorded_as_a_blank_one() -> None:
    """⚠️ THE DEGENERATE ROW. An empty profile would render as "sent to " with
    nothing after it — worse than the missing field it replaced, because it
    looks like a name that failed to load."""
    cid = _raise(severity="critical")
    outbox._mark_delivered(cid, now=1_787_000_000.0, profile="")
    row = [r for r in concerns.read() if r["id"] == cid][0]
    assert not row.get("deliveries"), (
        f"a blank profile was recorded as a send: {row.get('deliveries')!r}")
    assert row.get("delivered_at"), "the send itself must still be marked"
