"""One implementation of every act, so two surfaces cannot disagree.

⚠️ THE OWNER ASKED FOR A PROPERTY, NOT A FEATURE (2026-08-28, about the phone
buttons): *"each state shall be properly and fully synchronised with what the
VESTA Agent UI is doing, so that there can't be, by design, any de-synchronised
state"*. "By design" is the whole requirement — two implementations kept in step
by review is exactly what this repository has got wrong fourteen times, and a
test asserting they currently agree would pass on the day they stopped.

So what is pinned here is the SHAPE: every act has one definition, both surfaces
reach it, and neither can perform half of one. A test that checked the tablet's
behaviour and the phone's behaviour separately would be measuring the thing that
must not need measuring.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys
from typing import Any, Dict, List, Mapping, Optional

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import actions, concerns                          # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY = os.path.join(REPO, "rootfs", "usr", "bin", "supervisor-proxy.py")


def _code(fn: Any) -> str:
    return re.sub(r"#[^\n]*", "", inspect.getsource(fn))


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def _store(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))


def _put(**fields: Any) -> Dict[str, Any]:
    row = {"id": "c1", "subject_key": "k", "title": "Pool pump", "body": "b",
           "severity": "warning", "state": "open", "delivered_at": "2026-01-01",
           "acknowledged_at": "", "informational": False, "messages": []}
    row.update(fields)
    concerns._write([row])
    return row


# ── the shape: one definition, both surfaces ────────────────────────────────
def test_every_act_is_defined_EXACTLY_ONCE() -> None:
    """⚠️ THE HANDLER TABLE IS DERIVED FROM THE ACT TABLE, so an act nobody
    implemented cannot be offered and an implementation nothing offers cannot
    hide. Two lists that must agree are two lists that eventually do not."""
    assert set(actions._HANDLERS) == {a.id for a in actions.ACTS}
    assert len({a.code for a in actions.ACTS}) == len(actions.ACTS), \
        "two acts share a wire code, so a press is ambiguous"


def test_BOTH_surfaces_reach_the_same_function() -> None:
    """⚠️ THE ONE ASSERTION THE OWNER'S REQUIREMENT REDUCES TO. The tablet posts
    to `/agent-action`; a Telegram press arrives on the websocket. If either
    built its own verdict, "synchronised by design" would be false however
    carefully the two were written."""
    from agent import buttons
    proxy = _read(PROXY)
    assert "agent_actions.apply(" in proxy, \
        "the tablet no longer performs acts through the shared definition"
    assert "actions_mod.apply(" in _code(buttons.handle), \
        "a button press no longer performs acts through the shared definition"


def test_the_PERMITTED_ROLES_are_one_tuple_not_two() -> None:
    """⚠️ A VILLA WHERE THE FACILITY MANAGER MAY ACT ON THE TABLET AND NOT ON
    THEIR PHONE is the desynchronised state in its purest form. The proxy used
    to declare its own tuple; it now aliases this one."""
    proxy = _read(PROXY)
    assert re.search(r"TASK_ACK_ROLES\s*=\s*agent_actions\.MAY_ACT", proxy), \
        "the proxy declares its own permitted-roles list again"
    assert "ops" in actions.MAY_ACT and "guest" not in actions.MAY_ACT


def test_the_TABLET_cannot_perform_half_an_act() -> None:
    """⚠️ IT COULD, AND THAT IS WHY THIS EXISTS. `AgentTodo.finish` completed the
    to-do item over Home Assistant's websocket and then acknowledged the alert
    through the add-on — two calls, nothing joining them, and the first landing
    while the second failed leaves a ticked job beside an alert still chased."""
    todo = _read(os.path.join(REPO, "src", "components", "agent",
                              "AgentTodo.tsx"))
    assert "acknowledgeConcern(" not in todo, (
        "the browser assembles the pair again, so it can still perform half of "
        "an act")
    assert "actOnAlert(" in todo


# ── which acts apply ────────────────────────────────────────────────────────
def test_a_SETTLED_alert_offers_nothing() -> None:
    """Its state was reached deliberately; every act would contradict it or be
    a no-op wearing a button."""
    for state in concerns.SETTLED:
        assert actions.available_for({"id": "c1", "state": state}) == []


def test_an_FYI_offers_only_the_JOB_and_the_thumbs() -> None:
    """⚠️ "Alert only" MEANS NOTHING IS ASKED OF ANYBODY, so Done, Need help and
    Seen all presume something that did not happen. Turning it into work is the
    one act that makes sense — and it is exactly the act the mode withheld."""
    ids = [a.id for a in actions.available_for(
        {"id": "c1", "state": "open", "informational": True})]
    assert ids == ["job", "useful", "not_useful"]


def test_an_ACKNOWLEDGED_alert_stops_offering_to_be_acknowledged() -> None:
    """⚠️ ACKNOWLEDGED IS NOT SETTLED. Somebody has it; the villa still has the
    problem. So `seen` is spent and everything that CHANGES something is live."""
    ids = [a.id for a in actions.available_for(
        {"id": "c1", "state": "open", "acknowledged_at": "2026-01-01"})]
    assert "seen" not in ids
    assert "done" in ids and "help" in ids and "useful" in ids


def test_an_OPEN_alert_offers_the_full_set() -> None:
    ids = [a.id for a in actions.available_for({"id": "c1", "state": "open"})]
    assert ids == ["done", "help", "seen", "useful", "not_useful"]


# ── applying one ────────────────────────────────────────────────────────────
def test_a_STALE_press_is_refused_against_the_STORE_not_the_message() -> None:
    """⚠️ THE ONE WAY THE SURFACES CAN STILL VISIBLY DISAGREE, and it is
    answered rather than prevented: a phone shows whatever it showed when the
    message was drawn, so a press is checked against the store at the moment it
    ARRIVES. Otherwise scrolling back a week and pressing Done acts on an alert
    settled six days ago."""
    _put(state="closed")
    out = asyncio.run(actions.apply(None, "done", "c1", by="owner"))
    assert not out.ok and out.spent, \
        "a press on a settled alert was accepted"


def test_an_ACT_must_say_who_took_it() -> None:
    """⚠️ SAME RULE `/agent-acknowledge` STATES, INHERITED RATHER THAN RESTATED.
    "Who picked this up" is the content of an acknowledgement, and an anonymous
    one would let anything stop the villa escalating.

    ⚠️ CHECKED ON EVERY ACT, NOT ON `seen`, AND MUTATION IS WHAT SHOWED WHY.
    Deleting the guard in `apply` left a `seen` test green, because
    `concerns.acknowledge` refuses a nameless caller on its own — so the pin was
    measuring the store's guard, not this one. `job` and `help` never touch that
    function, so without `apply`'s check an anonymous presser could raise work
    and page the owner.
    """
    for act in actions.ACTS:
        _put(informational=(act.id == "job"))
        out = asyncio.run(actions.apply(None, act.id, "c1", by="  "))
        assert not out.ok, f"{act.id} was performed by nobody"


def test_a_THUMB_actually_REACHES_the_flag_type_table() -> None:
    """⚠️ BEHAVIOURAL, BECAUSE THE SOURCE PIN BESIDE IT CANNOT SEE A DISABLED
    BRANCH. `test_flag_types` asserts the call appears in `_judge`; wrapping
    that call in `if False:` leaves the text exactly where it was and the pin
    green. Mutation found this on the day it was written, which is the whole
    argument for running it: the assertion looked complete and measured the
    presence of a string.

    ⚠️ AND AN ALERT WITH NO KIND IS NOT AN ERROR. One raised about a topic
    rather than a device has no measurement to name; its verdict still counts.
    """
    from agent import flagtypes
    taught: List[Any] = []
    original = flagtypes.record
    flagtypes.record = lambda kind, *, useful: taught.append((kind, useful))  # type: ignore[assignment]
    try:
        _put(flag_type="power.rise")
        assert asyncio.run(actions.apply(None, "useful", "c1", by="Jim")).ok
        assert taught == [("power.rise", True)], \
            "a thumb recorded a verdict and taught the villa nothing"

        taught.clear()
        _put(flag_type="")
        assert asyncio.run(actions.apply(None, "not_useful", "c1", by="Jim")).ok
        assert taught == [], "a kindless alert taught something anyway"
    finally:
        flagtypes.record = original                   # type: ignore[assignment]


def test_NOTHING_TO_TICK_and_A_REFUSED_TICK_are_told_apart() -> None:
    """⚠️ THE REAL FUNCTION, NOT THE STUB THE TWO TESTS BELOW USE. Those pin how
    `_done` BRANCHES on the answer; this pins that the answer is right. Mutation
    caught the gap — turning the no-list return into `failed` left both of them
    green, because neither ever ran this code, and Done would have been dead on
    every villa that has not configured a list."""
    assert asyncio.run(actions._complete_item(None, "c1", config={})) == "none", \
        "a villa with no to-do list reads as a FAILED tick, so Done refuses"
    assert asyncio.run(actions._complete_item(
        None, "c1", config={"task_list": "todo.x"})) == "none", \
        "no session reads as a failed tick rather than nothing to do"


def test_an_UNKNOWN_act_is_refused_rather_than_ignored() -> None:
    _put()
    out = asyncio.run(actions.apply(None, "delete_everything", "c1", by="owner"))
    assert not out.ok and "delete_everything" in out.note


def test_SEEN_acknowledges_and_claims_nothing_else() -> None:
    _put()
    assert asyncio.run(actions.apply(None, "seen", "c1", by="Jim")).ok
    row = concerns.read()[0]
    assert row["acknowledged_by"] == "Jim"
    assert row["state"] == "open", "acknowledging closed the alert"


def test_a_THUMB_records_the_verdict_AND_acknowledges() -> None:
    """The compound the feedback handler used to assemble at its call site."""
    _put()
    assert asyncio.run(actions.apply(None, "useful", "c1", by="Jim")).ok
    row = concerns.read()[0]
    assert row["useful"] is True and row["acknowledged_at"]


def test_a_THUMB_DOWN_dismisses_rather_than_closing() -> None:
    """⚠️ `dismissed` IS NOT `closed`, and collapsing them loses the only signal
    alert-fatigue measurement has."""
    _put()
    assert asyncio.run(actions.apply(None, "not_useful", "c1", by="Jim")).ok
    assert concerns.read()[0]["state"] == "dismissed"


def test_HELP_does_NOT_acknowledge() -> None:
    """⚠️ ASKING FOR HELP IS THE OPPOSITE OF "I HAVE THIS COVERED". The chase
    must continue: the presser has just said they cannot finish alone, and
    stamping it seen is what would stop the ladder that is about to matter."""
    from agent import outbox
    code = _code(actions._help)
    assert "acknowledge" not in code, \
        "asking for help stops the chase, which is the opposite of asking"
    assert "_escalate_one" in code, (
        "help sends by some other route, so it dodges `route.plan` and leaves "
        "`escalated_step` unwritten — the ladder would then repeat it by hand")


def test_JOB_does_not_rewrite_the_alert_as_non_informational() -> None:
    """⚠️ THE STAMP RECORDS WHAT THE MODE WAS WHEN THE ALERT WAS RAISED.
    Clearing it would relabel history — the trap `Concern.informational`'s own
    comment names — and a person asking for a job is a later decision."""
    code = _code(actions._job)
    assert "informational" not in code.split('"""')[2], \
        "asking for a job rewrites what the villa's mode was at the time"


def test_DONE_refuses_to_acknowledge_when_the_TICK_FAILED() -> None:
    """⚠️ AND STILL ACKNOWLEDGES WHEN THERE WAS NOTHING TO TICK. Opposite
    outcomes: a refused tick leaves the job visibly outstanding, so stamping it
    seen stops the chase on work nobody can see was done; nothing to tick means
    Done is simply a person saying they dealt with it, and refusing would make
    the button dead on every villa with no list configured."""
    _put()
    calls: List[str] = []

    async def fake(session: Any, concern_id: str, *, config: Any) -> str:
        calls.append(concern_id)
        return "failed"

    original = actions._complete_item
    actions._complete_item = fake                     # type: ignore[assignment]
    try:
        out = asyncio.run(actions.apply(None, "done", "c1", by="Jim"))
    finally:
        actions._complete_item = original             # type: ignore[assignment]
    assert calls == ["c1"]
    assert not out.ok, "a failed tick still stamped the alert as seen"
    assert not concerns.read()[0]["acknowledged_at"]


def test_DONE_acknowledges_when_there_is_NOTHING_to_tick() -> None:
    _put()

    async def fake(session: Any, concern_id: str, *, config: Any) -> str:
        return "none"

    original = actions._complete_item
    actions._complete_item = fake                     # type: ignore[assignment]
    try:
        out = asyncio.run(actions.apply(None, "done", "c1", by="Jim"))
    finally:
        actions._complete_item = original             # type: ignore[assignment]
    assert out.ok and concerns.read()[0]["acknowledged_at"]


def test_a_HANDLER_that_raises_is_reported_not_propagated() -> None:
    """⚠️ A PERSON PRESSED A BUTTON. An exception here reaches a background
    websocket consumer on one path and an HTTP handler on the other; neither
    should take supervision down because a to-do list was unreachable."""
    _put()

    async def boom(*args: Any, **kw: Any) -> Any:
        raise RuntimeError("no")

    original = actions._HANDLERS["seen"]
    actions._HANDLERS["seen"] = boom                  # type: ignore[assignment]
    try:
        out = asyncio.run(actions.apply(None, "seen", "c1", by="Jim"))
    finally:
        actions._HANDLERS["seen"] = original          # type: ignore[assignment]
    assert not out.ok and out.note


def test_the_ACT_reports_whether_the_alert_is_now_SPENT() -> None:
    """It is what tells a chat to take the buttons off the message, and it is
    computed from the store after the act rather than predicted before it."""
    _put()
    out = asyncio.run(actions.apply(None, "not_useful", "c1", by="Jim"))
    assert out.ok and out.spent, \
        "dismissing an alert left its buttons claiming to be live"
