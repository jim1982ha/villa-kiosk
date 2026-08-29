"""🆘 stops being drawn once it can no longer do anything.

⚠️ ALL THREE OF THESE CAME OFF THE OWNER'S PHONE IN ONE SESSION (2026-08-29),
and they are one defect wearing three faces: a button drawn for a state the
store had already left.

  (a) "I clicked on SOS … I still see an SOS button in the escalated message …
      there is no other SOS person to speak with, so this 2nd message shall not
      have the SOS button."
  (b) the same press, made twice, escalated TWICE — `_help` calls
      `_escalate_one` directly and so misses the sweep's "one step is taken
      once" guard. `apply` refuses an act absent from `available_for`, so the
      fix for (a) closes this by construction rather than by a second guard.
  (c) the escalation message is DRAWN before `_mark_escalated` stamps the rung,
      so the row it is drawn from still says the ladder has not moved.

⚠️ (c) IS THE ONE A UNIT TEST OF `available_for` ALONE WOULD MISS, which is why
it is pinned at the caller — `feedback_pin-the-caller`, again. The predicate can
be perfectly right and still produce a wrong button, because the caller hands it
a row that is about to be stale.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import actions as actions_mod  # noqa: E402
from vesta.supervise.agent import route as route_mod  # noqa: E402


def _live(**over: Any) -> Dict[str, Any]:
    row = {"id": "c1", "title": "t", "state": "open", "delivered_at": "x"}
    row.update(over)
    return row


def _ids(row: Dict[str, Any]) -> List[str]:
    return [a.id for a in actions_mod.available_for(row)]


# ── the rung is a real band, named once ─────────────────────────────────────
def test_the_help_rung_is_a_band_the_ladder_actually_has() -> None:
    """⚠️ A STEP NOTHING RECOGNISES WOULD SILENTLY DISABLE THE WITHDRAWAL —
    `_help_is_spent` returns False for an unknown step, by design, so a typo
    here fails OPEN and 🆘 is drawn forever with nothing to say why."""
    assert route_mod.HELP_STEP in [name for _, name in route_mod.BANDS]


def test_help_is_offered_while_the_ladder_has_not_reached_its_rung() -> None:
    assert "help" in _ids(_live())
    assert "help" in _ids(_live(escalated_step="resend to the same target")), (
        "the first band adds nobody, so 🆘 still has the owner to add")


def test_help_withdraws_once_the_ladder_has_reached_or_passed_its_rung() -> None:
    assert "help" not in _ids(_live(escalated_step=route_mod.HELP_STEP))
    assert "help" not in _ids(
        _live(escalated_step="every configured target, once")), (
        "everybody has been told, so 🆘 has nobody left to add — position on "
        "the ladder, not equality with one step")


def test_withdrawing_help_takes_nothing_else_with_it() -> None:
    """⚠️ THE ALERT IS STILL LIVE. Escalating it does not finish it, so the two
    acts that CLEAR it must survive — a message offering nothing is retired
    entirely, and retiring an unresolved alert is the opposite of the intent."""
    ids = _ids(_live(escalated_step=route_mod.HELP_STEP))
    assert "done" in ids and "dismiss" in ids


def test_an_unrecognised_step_keeps_the_button() -> None:
    """Fail open: a stamp this ladder cannot parse is not evidence anybody was
    told, and 🆘 is the act that reaches a human."""
    assert "help" in _ids(_live(escalated_step="something nobody wrote"))


# ── (b) the act itself is refused, not merely undrawn ───────────────────────
def test_a_second_help_is_refused_by_apply_not_only_undrawn() -> None:
    """⚠️ THE BUTTON SET IS A CONVENIENCE; THE GUARD IS THE RULE. An old message
    still sitting in the chat carries a live 🆘, and pressing it must not
    escalate a second time just because that keyboard predates the stamp."""
    import inspect
    src = inspect.getsource(actions_mod.apply)
    assert "available_for" in src, (
        "apply no longer checks the act is offered, so a stale button in chat "
        "history can still fire an act the store has withdrawn")


def test_help_takes_the_shared_rung_rather_than_a_literal() -> None:
    import inspect
    src = inspect.getsource(actions_mod._help)
    assert "HELP_STEP" in src and '"add the owner"' not in src, (
        "the act spells its own rung, so the button and the act it triggers "
        "can drift apart")


# ── (c) the escalation is drawn from the post-escalation view ───────────────
def test_the_escalation_message_is_drawn_as_though_the_step_had_landed() -> None:
    """⚠️ PINNED AT THE CALLER. `_mark_escalated` runs AFTER the send — so a
    failed send does not lose the escalation — which means the row in hand
    still carries the OLD step while the message being written IS the new one.
    Without the projection the escalation arrives offering the very act that
    produced it."""
    import inspect
    from vesta.supervise.agent import outbox as outbox_mod
    src = inspect.getsource(outbox_mod._escalate_one)

    # ⚠️ THE CALL SITES, NOT THE NAMES. Both names also appear in the comment
    # that explains this projection, so a bare `index()` measured the prose and
    # reported the order backwards — /dry-audit step 7's comment trap, hit while
    # writing the pin that guards against getting this order wrong.
    send_at = src.index("_send_with_buttons(session, drawn_as")
    mark_at = src.index("_mark_escalated(str(concern")
    assert send_at < mark_at, (
        "the stamp now precedes the send — if that is deliberate the "
        "projection below is redundant, but a failed send loses the escalation")
    assert "drawn_as" in src and 'drawn_as["escalated_step"] = verdict.step' in src, (
        "the escalation is drawn from the stored row, which still says the "
        "ladder has not moved — so the message offers 🆘 for the escalation it "
        "already is")
    assert "_send_with_buttons(session, drawn_as" in src, (
        "the projected row is built and then not used for the draw")
