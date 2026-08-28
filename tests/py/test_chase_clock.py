"""The escalation ladder's own clock, and the job tick that stops it.

⚠️ THE LADDER'S BANDS ARE IN MINUTES AND IT HAD NO CLOCK IN MINUTES. Its sweep's
only caller was the tail of a triage pass, so on a villa checking every 360
minutes a 15-minute band was evaluated up to six hours late — while the concern
card printed "by 14:32 it is re-sent to the same place". `route.SWEEP_MINUTES`
was declared, documented as the sweep's cadence, and read by nothing.

⚠️ IT HID BEHIND A CONFIGURATION. The reference villa had nobody in the facility
manager role, and that branch skips the bands and escalates immediately — so
every earlier end-to-end run proved the ladder without the clock ever mattering.
The owner adding a facility manager is what made it reachable, and asking "how
do I test this" is what found it.
"""

from __future__ import annotations

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import route
from vesta.supervise.agent import scheduler

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")


def _code(fn) -> str:
    """Source with comments stripped — four pins in this repo have matched the
    prose recording their own fix."""
    return re.sub(r"#[^\n]*", "", inspect.getsource(fn))


def test_the_sweep_cadence_is_DERIVED_from_the_first_band() -> None:
    """⚠️ ONE RHYTHM, ONE NUMBER (owner's instruction). Two independent
    literals for the same cadence is how a 15-minute promise comes to be
    checked on a 5-minute clock — or, as it shipped, on none."""
    assert route.SWEEP_MINUTES == route.BANDS[0][0]


def test_the_cadence_is_not_a_LITERAL_that_happens_to_match() -> None:
    """A hard-coded 15 would pass the test above and drift the day somebody
    retunes the first band, which is the whole failure being fixed."""
    src = re.sub(r"#[^\n]*", "", inspect.getsource(route))
    assert "SWEEP_MINUTES: int = BANDS[0][0]" in src, (
        "the sweep cadence is written as a number rather than derived from the "
        "band it must match")


def test_the_chase_has_a_loop_of_its_OWN() -> None:
    """⚠️ THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT. `SWEEP_MINUTES`
    existing proves nothing — it existed throughout. What was missing was
    anything that slept on it."""
    assert hasattr(scheduler, "chase_forever")
    code = _code(scheduler.chase_forever)
    assert "dispatch(" in code, "the chase loop runs nothing"
    # ⚠️ THE SLEEP, NOT THE TOKEN ANYWHERE IN THE FUNCTION. The first cut
    # asserted `"SWEEP_MINUTES" in code` and SURVIVED a mutation that swapped
    # the sleep for the triage cadence — because the name still appeared in the
    # loop's own start-up log line. Anchor on the declaration, not the token:
    # this repo's third instance, and mutation is the only thing that finds it.
    sleeps = [ln for ln in code.split("\n") if "asyncio.sleep(" in ln]
    assert sleeps, "the chase loop never sleeps"
    assert any("SWEEP_MINUTES" in ln for ln in sleeps), (
        f"the chase loop sleeps on something other than its own cadence: "
        f"{sleeps}")


def test_the_chase_loop_is_NOT_the_triage_loop() -> None:
    """⚠️ `run_forever` SLEEPS OUT THE REMAINDER OF A CADENCE PERIOD and
    `continue`s, so anything folded into it inherits the triage cadence — which
    is the bug. Two rhythms, two tasks."""
    assert _code(scheduler.chase_forever) != _code(scheduler.run_forever)
    triage = _code(scheduler.run_forever)
    assert "SWEEP_MINUTES" not in triage, (
        "the triage loop now reads the chase cadence, which means one loop is "
        "trying to keep two rhythms")


def test_the_chase_loop_asks_the_MASTER_SWITCH() -> None:
    """A villa with supervision switched off must not have its concerns chased
    by a second loop that never heard about it."""
    assert "enabled" in _code(scheduler.chase_forever)


def test_the_chase_loop_RE_RAISES_cancellation() -> None:
    """⚠️ THE TRAP THREE OTHER LOOPS IN THIS TREE DOCUMENT. Swallowing
    `CancelledError` holds aiohttp's shutdown open until its timeout."""
    code = _code(scheduler.chase_forever)
    assert "CancelledError" in code and "raise" in code


def test_the_chase_task_is_STARTED_and_CANCELLED_by_the_proxy() -> None:
    """⚠️ BOTH HALVES, BECAUSE THE CLEANUP LIST IS HAND-KEPT. A task started
    and not named in the shutdown loop holds the whole shutdown open — the same
    trap one level up from the one above."""
    # ⚠️ THE START MOVED INTO `supervise/service.py` (TASK-115 step 5); the
    # proxy mounts the returned tasks under `agent_<name>` and the cleanup
    # list names them. Three hops now — service creates, proxy mounts, cleanup
    # cancels — and each is pinned, because any one missing is either a loop
    # nobody runs or a shutdown that hangs.
    with open(PROXY, encoding="utf-8") as handle:
        src = re.sub(r"#[^\n]*", "", handle.read())
    service_path = PROXY.replace("supervisor-proxy.py",
                                 "vesta/supervise/service.py")
    with open(service_path, encoding="utf-8") as handle:
        service = re.sub(r"#[^\n]*", "", handle.read())
    assert "chase_forever(" in service, "nothing starts the chase clock"
    assert 'tasks["chase"]' in service
    assert "agent_service.start(" in src, "the proxy never starts the service"
    assert 'a[f"agent_{_name}"] = _task' in src, (
        "the service's tasks are not mounted where cleanup can see them")
    assert '"agent_triage", "agent_chase"' in src, (
        "the chase task is not in the cleanup list, so shutdown will hang on it")


# ── a ticked job counts as "somebody has this" ──────────────────────────────
def test_a_TICKED_JOB_RUNS_THE_SAME_ACT_AS_THE_BUTTON() -> None:
    """⚠️ THREE SURFACES, ONE ACT (2026-08-29, reported: "I checked the item in
    Home Assistant … nothing has been modified in the Reason tab and in the
    Telegram message"). Ticking the row in Home Assistant's own to-do panel,
    pressing ✅ on the phone and pressing Done on the tablet are the same
    statement — the work is finished — so they run one implementation.

    A LOCAL `transition` HERE WOULD BE A FOURTH WAY TO END AN ALERT and the
    first to fall behind; `actions.apply` also writes the `action: cNN done by
    …` line, so the trace reads identically whichever surface did it.
    """
    import inspect
    import re as _re
    from vesta.supervise.agent import task
    assert hasattr(task, "reconcile_done")
    code = _re.sub(r"#[^\n]*", "", inspect.getsource(task.reconcile_done))
    assert 'apply(' in code and '"done"' in code, (
        "a ticked job no longer runs the shared act, so Home Assistant's own "
        "panel and the phone's button do different things")
    assert "transition(" not in code, (
        "the lifecycle is moved here by hand instead of through the one act")
    assert "completed" in code, "it does not read the COMPLETED half of the list"


def test_a_TICKED_JOB_CLOSES_THE_ALERT_EVERYWHERE(tmp_path: Any) -> None:
    """⚠️ THIS REVERSES A PRINCIPLE THIS FILE USED TO PIN, AND THE REVERSAL IS
    THE OWNER'S. The old rule read: "a ticked job means somebody dealt with the
    WORK, not that the pump stopped — closing is a claim about the villa". That
    was right while `Done` only acknowledged. On 2026-08-28 the owner merged
    Done and the closer ("should imply the same effect"), so ✅ now ticks,
    records and SETTLES; leaving the Home Assistant path at an acknowledgement
    made the same gesture mean two different things depending on where it was
    made — the alert kept its buttons on the phone and its row in the briefing.

    ⚠️ WHAT THE OLD PRINCIPLE PROTECTED IS STILL PROTECTED, JUST NOT HERE. "The
    condition may not have cleared" is the verification sweep's question, and it
    still runs over settled alerts; a person saying the work is done was never
    the same claim as the villa observing it, and neither is asked to be.
    """
    import asyncio
    import inspect
    import re as _re
    from vesta.supervise.agent import task, concerns as concerns_mod

    code = _re.sub(r"#[^\n]*", "", inspect.getsource(task.reconcile_done))
    assert "acknowledge(" not in code, (
        "it acknowledges directly again, which is the half-close that left "
        "the phone and the briefing out of step")

    # ⚠️ RUN, NOT READ: the act must actually settle the row.
    seen: list = []

    async def fake_apply(session, action, concern_id, **kw):
        seen.append((action, concern_id, kw.get("by")))
        class _Out:
            ok = True
        return _Out()

    # ⚠️ THE STORE IS REDIRECTED FIRST. This file has no autouse fixture for it,
    # so a write would land on the real path, `read()` would return nothing, and
    # the loop would never reach the act — a test that passes by never running
    # the thing it is about.
    original_file = concerns_mod.CONCERNS_FILE
    concerns_mod.CONCERNS_FILE = str(tmp_path / "c.json")

    from vesta.supervise.agent import actions as actions_mod
    original = actions_mod.apply
    actions_mod.apply = fake_apply                    # type: ignore[assignment]
    try:
        concerns_mod._write([{"id": "c1", "title": "t", "state": "open",
                              "delivered_at": "x", "acknowledged_at": ""}])

        async def _tasks(_h, _lists, status=""):
            return [{"rule_id": "c1", "uid": "u1"}] if status == "completed" else []

        from vesta.adapters import ledger as ledger_mod
        original_tasks = ledger_mod.todo_tasks
        ledger_mod.todo_tasks = _tasks                # type: ignore[assignment]

        class _Hass:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def command(self, *a, **k): return None
        from vesta.adapters import hass as hass_mod
        original_client = hass_mod.HassClient
        hass_mod.HassClient = lambda _s: _Hass()      # type: ignore[assignment]
        try:
            asyncio.run(task.reconcile_done(object(),
                                            config={"task_list": "todo.x"}))
        finally:
            ledger_mod.todo_tasks = original_tasks    # type: ignore[assignment]
            hass_mod.HassClient = original_client     # type: ignore[assignment]
    finally:
        actions_mod.apply = original                  # type: ignore[assignment]
        concerns_mod.CONCERNS_FILE = original_file

    assert seen == [("done", "c1", "the job was ticked")], seen

def test_an_UNDELIVERED_concern_is_not_acknowledged_by_a_tick() -> None:
    """Nobody was told, so there is nothing to acknowledge — and stamping it
    would hide the row from the wall and stop a chase that never started."""
    from vesta.supervise.agent import task
    assert "delivered_at" in _code(task.reconcile_done)


def test_the_reconcile_runs_BEFORE_the_chase_in_the_same_pass() -> None:
    """Or a job finished on a phone stops the chase one pass late, which on the
    old six-hour clock was the entire defect."""
    code = _code(scheduler.dispatch)
    assert "reconcile_done" in code, "nothing reconciles ticked jobs"
    assert code.index("reconcile_done") < code.index("escalation_sweep"), (
        "a job ticked on a phone is reconciled after the chase has already "
        "decided, so it is chased once more than it should be")


def test_the_join_is_the_BRACKET_both_sides_already_use() -> None:
    """⚠️ NOT A SECOND PARSE. `ledger.todo_tasks` already extracts the
    `[rule_id]` prefix — the same signal the blueprint's Done matches on and
    `task.summary_for` writes — so this reads `rule_id` rather than re-deriving
    it from the summary."""
    from vesta.supervise.agent import task
    code = _code(task.reconcile_done)
    assert "todo_tasks(" in code
    assert "rule_id" in code
