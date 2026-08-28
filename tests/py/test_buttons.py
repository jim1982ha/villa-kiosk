"""Buttons on a delivered alert: the wire form, the gate, and the tidy-up.

⚠️ WHAT THIS FILE DELIBERATELY DOES NOT TEST IS WHAT A PRESS DOES. That lives in
`test_alert_actions.py`, because it is the same code the tablet runs and testing
it again from this side would be exactly the duplication the design removes —
two suites that could disagree about one behaviour.

⚠️ THE TWO PROPERTIES WORTH THE MOST HERE ARE NEGATIVE ONES: `reports/deliver.py`
must stay free of any platform branch, and a target that cannot carry buttons
must never lose its message because of it. Both are easy to break by making this
feature slightly more capable, and neither would show up on a villa that happens
to use the platform this file names.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys
from typing import Any, Dict, List, Mapping, Optional, Tuple

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import actions
from vesta.supervise.agent import buttons
from vesta.supervise.agent import concerns
from vesta.adapters import collect
from vesta.adapters import deliver

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _code(fn: Any) -> str:
    return re.sub(r"#[^\n]*", "", inspect.getsource(fn))


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))
    buttons.forget_entities()


# ── the wire form ───────────────────────────────────────────────────────────
def test_a_press_ROUND_TRIPS_through_the_callback_data() -> None:
    for act in actions.ACTS:
        assert buttons.decode(buttons.encode(act.code, "c12")) == (act.id, "c12")


def test_callback_data_FITS_TELEGRAM_S_64_BYTE_CAP() -> None:
    """⚠️ THE REASON THE ALERT ID IS SHORT AND THE ACT IS ONE LETTER. It is a
    transport limit, not a style: exceed it and the button is rejected at send
    time, which would be discovered on a villa rather than here. `c` plus five
    digits is 100,000 alerts on one property."""
    worst = buttons.encode("d", "c999999")
    assert len(worst.encode("utf-8")) <= 64


def test_SOMEBODY_ELSE_S_BUTTON_is_ignored_rather_than_misread() -> None:
    """⚠️ EVERY PRESS IN THE CHAT ARRIVES HERE, including presses on buttons put
    there by the owner's own automations. Decoding is attempted before the
    sender is even looked at, so it must refuse cleanly."""
    for foreign in ("", "done:c1", "x", "vz:c1", "vd:", "vd", None, 7,
                    "confirm_delete_backup"):
        assert buttons.decode(foreign) == ("", "")


def test_the_KEYBOARD_GROUPS_BY_WHAT_AN_ACT_DOES() -> None:
    """⚠️ THE GROUPING IS WHAT A READER LEARNS THE MEANING FROM, and it is three
    rows (2026-08-28, owner: "show the stop chasing button on the same line as
    the done and need help button"). Everything that leaves the villa's problem
    STANDING shares the top row; the one irreversible act has a row to itself so
    it cannot be hit while aiming at a neighbour; the rating sits last, where a
    verdict belongs and furthest from the acts.

    ⚠️ Telegram gives every button in a row an equal share of the width, so the
    top row is capped at the three that belong there — five in a line would be
    five unreadable slivers on a phone."""
    rows = buttons.keyboard_for({"id": "c1", "state": "open"})
    assert [b[0] for b in rows[0]] == ["Done", "Need help"]
    assert [len(r) for r in rows] == [2, 1, 2]
    assert rows[-1][0][1] == "vu:c1" and rows[-1][1][1] == "vn:c1"
    # ⚠️ THE WIRE CODES ARE UNCHANGED THOUGH THE LABELS AND ROWS ARE NOT, which
    # is what keeps a button already sitting in somebody's chat meaning what it
    # meant.
    assert rows[1][0][1] == "vx:c1", "dismiss is not alone on its own row"


def test_a_RATING_IS_OFFERED_ONCE_and_the_STAMP_is_what_says_so() -> None:
    """⚠️ "The rating shall only be applied once" (2026-08-28, owner). Read
    `useful_at`, NEVER `useful`: the verdict is `false` both for "less like
    this" and for "nobody has said anything", so keying on it would withdraw the
    pair after a `+1` and leave it offered after a `-1` — the same false/unset
    conflation that hid the on-screen receipt for a `-1` one release earlier, in
    the same feature."""
    from vesta.supervise.agent import actions
    for verdict in (True, False):
        rated = {"id": "c1", "state": "open", "delivered_at": "x",
                 "useful": verdict, "useful_at": "2026-08-28T09:38:39Z"}
        ids = [a.id for a in actions.available_for(rated)]
        assert "useful" not in ids and "not_useful" not in ids, \
            f"a {'+1' if verdict else '-1'} can be pressed again"
        # ⚠️ AND THE LIFECYCLE IS UNTOUCHED BY IT — withdrawing the rating must
        # not withdraw the acts, which is the whole separation.
        assert "done" in ids and "dismiss" in ids
    unrated = [a.id for a in actions.available_for(
        {"id": "c1", "state": "open", "delivered_at": "x", "useful": False})]
    assert "useful" in unrated and "not_useful" in unrated, \
        "an unrated alert offers no rating, so nobody can ever rate one"


def test_a_SETTLED_alert_gets_NO_keyboard_and_that_is_a_real_answer() -> None:
    """It is what makes `outbox` send such an alert down the ordinary path."""
    assert buttons.keyboard_for({"id": "c1", "state": "closed"}) == []


def test_the_KEYBOARD_is_derived_from_the_SAME_list_that_guards_a_press() -> None:
    """⚠️ DRAWN AND ENFORCED FROM ONE FUNCTION, so a button can never be offered
    for an act that would be refused. Two lists here would put a live-looking
    button on every message that could not be acted on."""
    assert "available_for" in _code(buttons.keyboard_for)
    assert "available_for" in _code(actions.apply)


# ── the gate ────────────────────────────────────────────────────────────────
def _press(data: Dict[str, Any]) -> Dict[str, Any]:
    return {"event_type": buttons.EVENT_TYPE, "data": data}


def test_a_press_from_SOMEBODY_NOT_PERMITTED_acts_on_nothing() -> None:
    """⚠️ THE ROLE COMES FROM THE SENDER ID AND NOTHING ELSE. A payload must
    never influence which role it is treated as — the same rule
    `policy.sender_role` states and `chat.handle_event` obeys."""
    concerns._write([{"id": "c1", "title": "t", "state": "open",
                      "delivered_at": "x", "acknowledged_at": ""}])
    answered: List[str] = []

    async def fake_answer(session: Any, query_id: str, text: str) -> None:
        answered.append(text)

    original = buttons._answer
    buttons._answer = fake_answer                     # type: ignore[assignment]
    try:
        out = asyncio.run(buttons.handle(
            _press({"data": "vx:c1", "id": "q1", "user_id": 99,
                    "from_first": "Stranger", "role": "owner"}),
            session=None, config={"people": []}))
    finally:
        buttons._answer = original                    # type: ignore[assignment]
    assert out == "presser may not act"
    assert not concerns.read()[0]["acknowledged_at"], \
        "an unlisted sender acknowledged an alert"
    # ⚠️ ANSWERED, UNLIKE AN UNKNOWN TYPED MESSAGE. A button is only visible to
    # somebody already in the chat, so leaving their press spinning forever is
    # a broken app rather than a closed door.
    assert answered, "the refused press was left spinning"


def test_the_ROLE_is_read_from_the_SENDER_ID_never_from_the_payload() -> None:
    code = _code(buttons.handle)
    assert 'sender_id=data.get("user_id")' in code
    assert 'data.get("role")' not in code, \
        "the press names its own role, so anyone in the chat can claim one"


def test_a_press_that_is_NOT_OURS_stops_before_anything_is_read() -> None:
    assert asyncio.run(buttons.handle({"event_type": "telegram_text"},
                                      session=None)) == ""
    assert asyncio.run(buttons.handle(
        _press({"data": "confirm:1", "user_id": 1}), session=None)) == ""


# ── the two negative properties ─────────────────────────────────────────────
def test_DELIVER_stays_the_INTERSECTION_of_every_platform() -> None:
    """⚠️ THE WHOLE REASON `buttons.py` EXISTS AS A SEPARATE FILE. `deliver.py`'s
    header says sending a `data` block "has a Telegram branch in it, which is
    the first step toward a platform table". If a keyboard ever reaches that
    file, the offline villa on some other notify platform starts receiving
    payloads its service will reject."""
    # ⚠️ CODE ONLY. `deliver.py` NAMES THE PLATFORM IN ITS PROSE ON PURPOSE —
    # its header explains that the DOMAIN travels in the target string, using
    # the very service this feature sends through as the example, and
    # `_service_path`'s docstring records the 404 that taught it. A check that
    # matched prose would forbid the file from explaining itself, which is the
    # opposite of what this repository wants. Comments and docstrings out,
    # then look for a branch.
    source = re.sub(r'"""(?:.|\n)*?"""', "", inspect.getsource(deliver))
    source = re.sub(r"#[^\n]*", "", source)
    for word in ("inline_keyboard", "callback", "telegram", "reply_markup"):
        assert word not in source, (
            f"`{word}` reached reports/deliver.py's CODE, which must stay "
            f"platform-agnostic — put it in agent/buttons.py")
    assert "telegram" in inspect.getsource(deliver), (
        "this test just stopped measuring anything: if the file no longer "
        "mentions the platform at all, check the stripping above still works")


def test_a_target_that_CANNOT_carry_buttons_is_SKIPPED_not_FAILED() -> None:
    """⚠️ AND THE CALLER THEN SENDS IT PLAINLY. Collapsing the two would make a
    villa on any other platform — or one whose registry could not be read —
    look half-broken every time an alert went out, and would eventually cost
    the message rather than the buttons."""
    async def run() -> List[Dict[str, Any]]:
        async def none(session: Any, *, now: Any = None) -> frozenset:
            return frozenset()
        original = buttons.telegram_entities
        buttons.telegram_entities = none              # type: ignore[assignment]
        try:
            return await buttons.send(None, ["entity:notify.x", "notify.y"],
                                      "t", "b", [[["Done", "vd:c1"]]])
        finally:
            buttons.telegram_entities = original      # type: ignore[assignment]

    results = asyncio.run(run())
    assert [r["status"] for r in results] == ["skipped", "skipped"]


def test_the_OUTBOX_sends_plainly_whatever_the_buttons_did_not_take() -> None:
    """⚠️ THE FALL-THROUGH IS THE FEATURE. A villa that uses no chat platform
    must deliver exactly as it did before this existed — so what is pinned is
    that the plain list is computed from what did NOT land, rather than from
    whether buttons were attempted at all."""
    from vesta.supervise.agent import outbox
    code = _code(outbox._deliver_one)
    assert "_send_with_buttons" in code
    plain = code[code.index("plain = "):code.index("landed = ")]
    assert '"sent"' in plain and "not any" in plain, (
        "the plain send is chosen by something other than which targets "
        "actually received the alert")


def test_a_BUTTON_FAILURE_never_costs_the_ALERT() -> None:
    """The message is the alert; the buttons are an affordance on top of it."""
    from vesta.supervise.agent import outbox

    async def boom(*a: Any, **kw: Any) -> Any:
        raise RuntimeError("telegram is down")

    original = buttons.send
    buttons.send = boom                               # type: ignore[assignment]
    try:
        plan = type("P", (), {"targets": ["entity:notify.x"],
                              "title": "t", "body": "b"})()
        out = asyncio.run(outbox._send_with_buttons(
            None, {"id": "c1", "state": "open"}, plan, config={}))
    finally:
        buttons.send = original                       # type: ignore[assignment]
    assert out == [], "a Telegram failure propagated instead of falling through"


# ── keeping the phone in step with the tablet ───────────────────────────────
def test_the_PRESS_rides_the_socket_the_collector_already_holds() -> None:
    """⚠️ NO WEBHOOK, NO PUBLIC URL, NO INBOUND FIREWALL HOLE — the same posture
    that made polling the right Telegram platform for a villa behind a tunnel.
    It is also what let handling move into the add-on at all: the blueprint had
    to wait for its own press inside a `wait_for_trigger`, so its buttons died
    with the automation's timeout and a restart lost the wait entirely."""
    assert buttons.EVENT_TYPE in collect.CHAT_EVENT_TYPES
    proxy_path = os.path.join(REPO, "rootfs", "usr", "bin",
                              "supervisor-proxy.py")
    with open(proxy_path, encoding="utf-8") as handle:
        proxy = handle.read()
    dispatch = proxy[proxy.index("def _chat_dispatch"):]
    dispatch = dispatch[:dispatch.index("\ndef _chat_targets")]
    assert "agent_buttons.handle(" in dispatch, \
        "a press arrives on the socket and nothing consumes it"
    assert dispatch.index("agent_buttons.handle(") < \
        dispatch.index("agent_chat.handle_event("), (
        "a press is routed through the chat path, which would spend a model "
        "turn deciding what 'vd:c7' means")


def _acts_now(row: Dict[str, Any]) -> str:
    """What the store currently offers on this alert, as `Ref.acts` spells it.

    ⚠️ ASKED OF THE CODE, NOT TYPED OUT. A literal here would pass while the two
    sides disagreed — the fixture would be pinning my transcription of the act
    list rather than the list, which is `feedback_pin-the-caller` inside a
    fixture.
    """
    from vesta.supervise.agent import actions
    return ",".join(a.id for a in actions.available_for(row, {}))


def test_RECONCILE_handles_THREE_outcomes_not_two() -> None:
    """⚠️ THE FIXTURE OF THE VERSION THIS REPLACES IS WHY THE DEFECT SHIPPED.
    It had one live alert, `acknowledged_at: ""`, and one settled — so it
    measured "leave" and "retire" and never the state BETWEEN them, which is the
    only one that moves: acknowledging withdraws `Seen` and keeps four acts, so
    the drawn set CHANGED without EMPTYING. The owner found it on their phone.

    Three rows, three outcomes, and the middle one is the regression."""
    # ⚠️ A RATING IS WHAT CHANGES THE SET NOW, NOT AN ACKNOWLEDGEMENT. This
    # fixture used `acknowledged_at` until `Seen` merged into the closer
    # (2026-08-28) and the branch that withdrew it was deleted — after which
    # acknowledging changed nothing and the "stale" row was identical to the
    # live one. The guard below caught that on the first run, which is what a
    # vacuous-pass guard is for: the test would otherwise have gone green while
    # measuring one case twice.
    live = {"id": "c1", "title": "live", "state": "open", "acknowledged_at": ""}
    ack = {"id": "c2", "title": "rated", "state": "open",
           "acknowledged_at": "", "useful": True,
           "useful_at": "2026-08-28T07:23:03Z"}
    concerns._write([
        # in step: drawn with exactly what it still offers
        {**live, "messages": [{"entity_id": "notify.x", "message_id": "11",
                               "acts": _acts_now(live)}]},
        # STALE: drawn while unacknowledged, acknowledged since
        {**ack, "messages": [{"entity_id": "notify.x", "message_id": "22",
                              "acts": _acts_now(live)}]},
        # settled: nothing is offered at all
        {"id": "c3", "title": "settled", "state": "closed",
         "messages": [{"entity_id": "notify.x", "message_id": "33",
                       "acts": _acts_now(live)}]},
    ])
    assert _acts_now(ack) and _acts_now(ack) != _acts_now(live), \
        "the fixture cannot show a CHANGED set: rating changed nothing"

    retired: List[str] = []
    redrawn: List[Tuple[str, str]] = []

    async def fake_retire(session: Any, ref: Any, closing: str) -> bool:
        retired.append(ref.message_id)
        return True

    async def fake_redraw(session: Any, ref: Any, keyboard: Any) -> bool:
        redrawn.append((ref.message_id, buttons.acts_of(keyboard)))
        return True

    originals = (buttons.retire, buttons.redraw)
    buttons.retire = fake_retire                      # type: ignore[assignment]
    buttons.redraw = fake_redraw                      # type: ignore[assignment]
    try:
        count = asyncio.run(buttons.reconcile(None, config={}))
    finally:
        buttons.retire, buttons.redraw = originals    # type: ignore[assignment]

    assert retired == ["33"], \
        "reconciliation retired the buttons of an alert that still offers acts"
    assert redrawn == [("22", _acts_now(ack))], \
        "a message whose act set CHANGED was left showing the old buttons"
    assert count == 2

    rows = {r["id"]: r for r in concerns.read()}
    assert rows["c1"]["messages"][0]["acts"] == _acts_now(live), \
        "a message already in step was rewritten, so every tick rewrites it"
    assert rows["c2"]["messages"][0]["acts"] == _acts_now(ack), \
        "a redrawn message kept its old stamp, so it is redrawn on every tick"
    assert rows["c3"]["messages"] == [], \
        "a retired message is remembered, so it is rewritten on every tick"


def _fake_chat(retire_ok: bool = True, restate_ok: bool = True) -> Any:
    """Patch the three calls a press makes to the outside world. Records both."""
    seen: Dict[str, Any] = {"retired": [], "restated": []}

    async def fake_retire(session: Any, ref: Any, closing: str) -> bool:
        seen["retired"].append(ref.message_id)
        return retire_ok

    async def fake_restate(session: Any, ref: Any, text: str,
                           keyboard: Any) -> bool:
        seen["restated"].append((ref.message_id, buttons.acts_of(keyboard), text))
        return restate_ok

    async def fake_answer(session: Any, query_id: str, text: str) -> None:
        return None

    async def fake_entity(session: Any, data: Any) -> str:
        return "notify.x"

    seen["_originals"] = (buttons.retire, buttons.restate,
                          buttons._answer, buttons._entity_of)
    buttons.retire = fake_retire                      # type: ignore[assignment]
    buttons.restate = fake_restate                    # type: ignore[assignment]
    buttons._answer = fake_answer                     # type: ignore[assignment]
    buttons._entity_of = fake_entity                  # type: ignore[assignment]
    return seen


def _restore(seen: Any) -> None:
    (buttons.retire, buttons.restate,
     buttons._answer, buttons._entity_of) = seen["_originals"]


def test_a_press_that_LEAVES_ACTS_LIVE_restates_rather_than_retiring() -> None:
    """⚠️ THE OWNER'S QUESTION, AND IT WAS RIGHT: "if I click stop chasing, I
    should still see the done and thumb up/down buttons, right?" `Seen` withdraws
    only ITSELF — the store goes on offering Done, Need help and the thumbs, and
    the tablet goes on showing them — but this path retired the WHOLE keyboard
    after any press. The phone then offered nothing while the tablet offered
    four, which is the same two surfaces disagreeing, mirrored.

    The message keeps its ref, is stamped with what it now shows, and carries the
    alert's own body — an edit replaces everything, so live buttons under a
    one-line receipt would say nothing about what they are for."""
    concerns._write([{"id": "c1", "title": "Pump", "body": "used 243% more",
                      "state": "open", "delivered_at": "x",
                      "acknowledged_at": "",
                      "messages": [{"entity_id": "notify.x",
                                    "message_id": "174", "acts": "stale"}]}])
    # ⚠️ A `+1`, WHICH IS NOW THE ACT THAT LEAVES THE MOST BEHIND. `Seen` was
    # this test's press until it merged into the closer (2026-08-28), and the
    # closer SETTLES — so pressing it here would exercise the retire path and
    # the test would have been measuring the opposite of its own name.
    seen = _fake_chat()
    try:
        asyncio.run(buttons.handle(
            _press({"data": "vu:c1", "id": "q1", "user_id": 1,
                    "from_first": "Jm", "message": {"message_id": "174"}}),
            session=None,
            config={"people": [{"telegram": "1", "role": "owner"}]}))
    finally:
        _restore(seen)

    assert not seen["retired"], \
        "the whole keyboard was retired while three acts were still live"
    assert len(seen["restated"]) == 1
    message_id, acts, text = seen["restated"][0]
    # ⚠️ THE SET A `+1` LEAVES: the rating pair withdraws, the acts stay.
    row = {"id": "c1", "state": "open", "delivered_at": "x",
           "useful": True, "useful_at": "yes"}
    assert message_id == "174"
    assert acts == _acts_now(row), \
        "the message was redrawn with something other than what the alert offers"
    assert "useful" not in acts and "not_useful" not in acts, \
        "the rating just given is still offered"
    assert "Pump" in text and "243% more" in text, \
        "the alert's own body was dropped, leaving live buttons explaining nothing"

    kept = concerns.read()[0]["messages"]
    assert [r["message_id"] for r in kept] == ["174"], \
        "a message that still carries buttons was forgotten"
    assert kept[0]["acts"] == acts, \
        "the stamp was not updated, so reconcile redraws it on every tick"


def test_a_press_on_a_SETTLED_alert_retires_and_FORGETS_the_message() -> None:
    """⚠️ THE OTHER HALF, AND THE REGRESSION THE REDRAW ALMOST SHIPPED. With no
    act left the keyboard goes for good, and the ref must go with it: a ref
    exists only so a message can be edited later, and reconciliation would
    otherwise draw the buttons again on the message just dealt with.

    ⚠️ THE PRESS IS REFUSED HERE (`spent`) AND THE MESSAGE IS STILL CORRECTED —
    a press on a stale button is the best moment to discover it."""
    concerns._write([{"id": "c1", "title": "t", "state": "closed",
                      "delivered_at": "x",
                      "messages": [{"entity_id": "notify.x",
                                    "message_id": "174", "acts": "stale"},
                                   {"entity_id": "notify.fm",
                                    "message_id": "999", "acts": "stale"}]}])
    seen = _fake_chat()
    try:
        asyncio.run(buttons.handle(
            _press({"data": "vx:c1", "id": "q1", "user_id": 1,
                    "from_first": "Jm", "message": {"message_id": "174"}}),
            session=None,
            config={"people": [{"telegram": "1", "role": "owner"}]}))
    finally:
        _restore(seen)

    assert seen["retired"] == ["174"] and not seen["restated"], \
        "a settled alert's message kept or gained buttons"
    left = [r["message_id"] for r in concerns.read()[0]["messages"]]
    assert "174" not in left, \
        "the pressed message is still tracked, so its buttons come back"
    # ⚠️ THE OTHER CHAT'S COPY SURVIVES. An escalated alert has a message in more
    # than one chat and a press in one says nothing about the other, which still
    # carries live buttons and must still be reconciled.
    assert left == ["999"], "a press abandoned another chat's live message"


def test_a_press_whose_EDIT_FAILED_keeps_the_message_to_try_again() -> None:
    """⚠️ FORGETTING IS FOR A MESSAGE THAT HAS ACTUALLY BEEN RETIRED. If Telegram
    could not be reached, that message is still sitting there with live buttons
    on an alert already acted on — the one state this whole mechanism exists to
    prevent — and dropping the ref would mean nothing ever revisits it. The same
    "an outage must not look like agreement" rule `reconcile` keeps.

    ⚠️ BOTH EDITS, because a press now makes one of two calls and each has its
    own way of lying about success. The restate half is the sharper one: the
    stamp must NOT advance, or the next tick believes an unreachable message is
    showing buttons it never received."""
    ref = {"entity_id": "notify.x", "message_id": "174", "acts": "stale"}

    # (a) the alert keeps acts → restate → refused
    concerns._write([{"id": "c1", "title": "t", "state": "open",
                      "delivered_at": "x", "acknowledged_at": "",
                      "messages": [dict(ref)]}])
    seen = _fake_chat(restate_ok=False)
    try:
        asyncio.run(buttons.handle(
            _press({"data": "vu:c1", "id": "q1", "user_id": 1,
                    "from_first": "Jm", "message": {"message_id": "174"}}),
            session=None,
            config={"people": [{"telegram": "1", "role": "owner"}]}))
    finally:
        _restore(seen)
    kept = concerns.read()[0]["messages"]
    assert [r["message_id"] for r in kept] == ["174"], \
        "an unreachable message was forgotten, so its live buttons are never fixed"
    assert kept[0]["acts"] == "stale", \
        "a refused restate advanced the stamp, so the phone is never corrected"

    # (b) nothing left to offer → retire → refused
    concerns._write([{"id": "c1", "title": "t", "state": "closed",
                      "delivered_at": "x", "messages": [dict(ref)]}])
    seen = _fake_chat(retire_ok=False)
    try:
        asyncio.run(buttons.handle(
            _press({"data": "vx:c1", "id": "q1", "user_id": 1,
                    "from_first": "Jm", "message": {"message_id": "174"}}),
            session=None,
            config={"people": [{"telegram": "1", "role": "owner"}]}))
    finally:
        _restore(seen)
    assert [r["message_id"] for r in concerns.read()[0]["messages"]] == ["174"], \
        "an unreachable message was forgotten, so its live buttons are never fixed"


def test_a_ref_stored_BEFORE_acts_existed_is_redrawn_ONCE() -> None:
    """⚠️ AN ABSENT RECORD IS NOT AGREEMENT. Every message already out on a villa
    when this shipped has no `acts`, and reading that as "in step" would let the
    defect survive its own fix on exactly the alerts that have it."""
    concerns._write([{"id": "c1", "title": "t", "state": "open",
                      "acknowledged_at": "",
                      "messages": [{"entity_id": "notify.x",
                                    "message_id": "11"}]}])
    calls: List[str] = []

    async def fake_redraw(session: Any, ref: Any, keyboard: Any) -> bool:
        calls.append(ref.message_id)
        return True

    original = buttons.redraw
    buttons.redraw = fake_redraw                      # type: ignore[assignment]
    try:
        assert asyncio.run(buttons.reconcile(None, config={})) == 1
        assert calls == ["11"], "a message with no record of its buttons was trusted"
        assert asyncio.run(buttons.reconcile(None, config={})) == 0, \
            "the stamp did not take, so this message is redrawn forever"
    finally:
        buttons.redraw = original                     # type: ignore[assignment]


def test_a_redraw_that_FAILED_is_not_stamped() -> None:
    """⚠️ RECORDING WHAT WE MEANT TO DRAW WOULD MAKE THE NEXT TICK BELIEVE AN
    UNREACHABLE MESSAGE IS CORRECT — the same rule the retire path keeps."""
    concerns._write([{"id": "c1", "title": "t", "state": "open",
                      "acknowledged_at": "",
                      "messages": [{"entity_id": "notify.x",
                                    "message_id": "11"}]}])

    async def refuse(session: Any, ref: Any, keyboard: Any) -> bool:
        return False

    original = buttons.redraw
    buttons.redraw = refuse                           # type: ignore[assignment]
    try:
        assert asyncio.run(buttons.reconcile(None, config={})) == 0
    finally:
        buttons.redraw = original                     # type: ignore[assignment]
    assert not concerns.read()[0]["messages"][0].get("acts"), \
        "a failed redraw was stamped, so the stale buttons are never tried again"


def test_ACTS_ARE_READ_OFF_THE_KEYBOARD_that_was_drawn() -> None:
    """⚠️ DERIVED, NEVER DECLARED. `acts_of` reading the real keyboard is what
    makes the record incapable of describing a message that was never sent."""
    for state in ({"acknowledged_at": ""},
                  {"acknowledged_at": "2026-08-28T07:23:03Z"},
                  {"acknowledged_at": "", "informational": True}):
        row = {"id": "c9", "title": "t", "state": "open", **state}
        keyboard = buttons.keyboard_for(row, {})
        assert buttons.acts_of(keyboard) == _acts_now(row), \
            f"what a message records and what it draws disagree: {state}"
    assert buttons.acts_of([[["Other", "somebody-elses-button"]]]) == "", \
        "a button this cannot decode was claimed as one of ours"


def test_the_COMPARISON_survives_a_reordered_keyboard() -> None:
    """⚠️ THE ROW LAYOUT IS A DECISION ABOUT PHONES AND `available_for` IS A
    DECISION ABOUT ACTS. They agree on order today and nothing makes them: a
    stamp taken from the act list would, the day the rows were rearranged,
    describe an order never drawn — or match nothing and redraw the same message
    on every tick forever. So reconcile reads the keyboard it is about to send,
    and reversing the rows must change NOTHING about how often it redraws."""
    row = {"id": "c1", "title": "t", "state": "open", "acknowledged_at": ""}
    upright = buttons.keyboard_for(row, {})
    concerns._write([{**row, "messages": [
        {"entity_id": "notify.x", "message_id": "11",
         "acts": buttons.acts_of(list(reversed(upright)))}]}])

    async def never(session: Any, ref: Any, keyboard: Any) -> bool:
        raise AssertionError("redrew a message drawn from a reordered keyboard")

    original_kb = buttons.keyboard_for
    buttons.keyboard_for = (                          # type: ignore[assignment]
        lambda concern, config=None: list(reversed(original_kb(concern, config))))
    original_rd, buttons.redraw = buttons.redraw, never  # type: ignore[assignment]
    try:
        assert asyncio.run(buttons.reconcile(None, config={})) == 0
    finally:
        buttons.keyboard_for = original_kb            # type: ignore[assignment]
        buttons.redraw = original_rd                  # type: ignore[assignment]


def test_a_message_it_COULD_NOT_retire_is_KEPT_and_tried_again() -> None:
    """⚠️ A TELEGRAM OUTAGE MUST NOT SILENTLY GIVE UP ON A STALE BUTTON. This is
    why `concerns.set_messages` replaces rather than clears: `clear` would make
    "I gave up" the easy call to write."""
    concerns._write([{"id": "c1", "title": "t", "state": "closed",
                      "messages": [{"entity_id": "notify.x",
                                    "message_id": "11"}]}])

    async def refuse(session: Any, ref: Any, closing: str) -> bool:
        return False

    original = buttons.retire
    buttons.retire = refuse                           # type: ignore[assignment]
    try:
        assert asyncio.run(buttons.reconcile(None, config={})) == 0
    finally:
        buttons.retire = original                     # type: ignore[assignment]
    assert concerns.read()[0]["messages"], \
        "an unreachable message was forgotten, so its buttons stay live forever"


def test_RECONCILE_is_REACHED_from_the_chase_clock() -> None:
    """⚠️ THE ASSERTION THAT WOULD CATCH THE DEFECT THIS REPO KEEPS MAKING.
    `concerns.verify` had unit tests and no caller for its whole existence."""
    from vesta.supervise.agent import scheduler
    assert "buttons_mod.reconcile" in _code(scheduler.dispatch), \
        "nothing ever retires a stale button"


def test_a_message_with_NO_ID_is_not_remembered() -> None:
    """⚠️ THE ONLY THING A REF IS FOR IS EDITING THAT MESSAGE LATER. Storing an
    unidentified one grows a list of things that look retirable and are not,
    and `reconcile` would walk them forever."""
    concerns._write([{"id": "c1", "title": "t", "state": "open",
                      "messages": []}])
    assert not concerns.note_message("c1", "notify.x", "")
    assert not concerns.note_message("c1", "", "11")
    assert concerns.read()[0]["messages"] == []


def test_the_remembered_messages_are_BOUNDED() -> None:
    """An alert escalated repeatedly must not grow one row without limit."""
    concerns._write([{"id": "c1", "title": "t", "state": "open",
                      "messages": []}])
    for n in range(concerns.MAX_MESSAGE_REFS + 4):
        concerns.note_message("c1", "notify.x", str(n))
    refs = concerns.read()[0]["messages"]
    assert len(refs) == concerns.MAX_MESSAGE_REFS
    assert refs[-1]["message_id"] == str(concerns.MAX_MESSAGE_REFS + 3), \
        "the bound dropped the NEWEST message rather than the oldest"
