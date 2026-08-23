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

from agent import concerns, outbox, route  # noqa: E402
from agent.concerns import Concern  # noqa: E402

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
    from reports import deliver as deliver_mod
    from reports import people as people_mod

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


def test_shadow_mode_sends_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ ASKED BY `route.plan`, NOT HERE — the path runs THROUGH the module
    that consults shadow rather than around it, which is what keeps
    `test_shadow`'s rule true as paths are added."""
    sender = _Sender()
    _wire(monkeypatch, sender)
    _raise()
    result = asyncio.run(outbox.sweep(None, config={**ON, "shadow": True}))

    assert result.suppressed == 1 and result.sent == 0
    assert sender.calls == []
    assert not concerns.read()[0]["delivered_at"], (
        "a suppressed concern was stamped as delivered; turning shadow off "
        "would then never send it")


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
def test_the_clock_runs_the_sweep_every_pass() -> None:
    """⚠️ UNCONDITIONALLY, AND THAT IS WHAT RELEASES A HELD CONCERN. Running it
    only after a pass that escalated would leave a concern held overnight and
    never looked at again. `feedback_pin-the-caller`."""
    import inspect

    from agent import scheduler

    src = inspect.getsource(scheduler._pass)
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    assert "outbox_mod.sweep(" in code, (
        "the triage clock does not run the outbox, so no Concern reaches a "
        "phone and a held one is never released")


# ── the briefing carries what the agent concluded ───────────────────────────
def test_a_concern_reaches_the_briefing() -> None:
    """⚠️ THE DISCREPANCY THIS SUBSYSTEM'S CARDINAL RULE FORBIDS. Until this
    existed the agent filed a Concern, it rendered on the kiosk, and the
    briefing showed a different list about the same villa."""
    from reports import pipeline
    from reports.narrate import DeterministicNarrator, ReportContext

    ctx = ReportContext(audience="owner", cadence="weekly", period="w34",
                        generated_at="2026-08-24T07:00:00Z",
                        discovery={"reachable": True},
                        concerns=[{"title": "Cooling unit short-cycling",
                                   "severity": "warning", "age_days": 3.0,
                                   "subject_key": "a1"}])
    _, body = DeterministicNarrator().render(ctx)
    assert "Cooling unit short-cycling" in body
    assert "open 3 days" in body


def test_the_worst_concern_sets_the_title_marker() -> None:
    """⚠️ A BRIEF OPENING WITH A CRITICAL UNDER AN 'ALL CLEAR' TITLE IS THE
    INSTRUMENT LYING, one surface further out."""
    from reports.narrate import DeterministicNarrator, ReportContext

    ctx = ReportContext(audience="owner", cadence="weekly", period="w34",
                        generated_at="2026-08-24T07:00:00Z",
                        discovery={"reachable": True},
                        concerns=[{"title": "Gate lock battery critical",
                                   "severity": "critical", "subject_key": "a1"}])
    narrator = DeterministicNarrator()
    assert narrator._worst(ctx) == "critical"


def test_the_worst_first_ordering_is_not_inverted() -> None:
    """⚠️ TWO `severity_rank` FUNCTIONS, ONE NAME, OPPOSITE CONVENTIONS.
    `reports.contracts` counts UP to critical; `agent.contracts` counts DOWN. A
    sort written from the agent's habit puts the critical line LAST, which reads
    as "nothing much" on a phone."""
    from reports.narrate import DeterministicNarrator, ReportContext

    ctx = ReportContext(audience="owner", cadence="weekly", period="w34",
                        generated_at="2026-08-24T07:00:00Z",
                        discovery={"reachable": True},
                        concerns=[{"title": "Quiet notice", "severity": "notice",
                                   "subject_key": "a1"},
                                  {"title": "Loud critical", "severity": "critical",
                                   "subject_key": "a2"}])
    _, body = DeterministicNarrator().render(ctx)
    assert body.index("Loud critical") < body.index("Quiet notice")


def test_a_blueprint_already_reporting_a_subject_wins() -> None:
    """⚠️ THE SAME RULE ONE LAYER UP APPLIES: while a blueprint covers a device
    it sees occupancy, schedules and tariffs the agent's evidence does not.
    Retire it and the Concern becomes the only report of that device."""
    from reports import pipeline

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
    from reports import pipeline

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
    from reports import pipeline

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

def _delivered(minutes_ago: float, *, severity: str = "critical") -> str:
    """A concern sent `minutes_ago` and never acknowledged."""
    cid = _raise(severity=severity)
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


def test_the_scheduler_RUNS_the_escalation_sweep() -> None:
    """⚠️ `feedback_pin-the-caller`, and the reason this task exists at all:
    `route.escalate` was correct and uncalled. A sweep nobody runs is the same
    defect one layer out."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
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
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                            "supervisor-proxy.py"), encoding="utf-8").read()
    conf = open(os.path.join(REPO_ROOT, "rootfs", "etc", "nginx",
                             "nginx.conf"), encoding="utf-8").read()
    assert '"/agent-acknowledge"' in src
    assert "location = /agent-acknowledge" in conf
