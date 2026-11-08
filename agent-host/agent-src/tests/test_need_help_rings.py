"""A person's Need help forwarded to the escalation role rings; a plain escalation stays quiet."""
from vesta_shared.message_format import rings


def test_need_help_escalation_rings():
    assert rings("escalated", "help")
    assert not rings("escalated")
    assert rings("new")


def test_one_decision_per_chat_and_step():
    # architecture review of 2026-11-09, card 1: Telegram's send or edit and the tablet's quiet read ringing.decide
    from vesta_agent import ringing as R
    assert R.decide(1, "new") == R.RING_NEW and R.decide(1, "escalated", "help") == R.RING_NEW
    assert R.decide(1, "escalated") == R.EDIT_QUIET and R.decide(1, "still", editable=False) == R.SEND_SILENT
    assert R.decide(None, "escalated") == R.RING_NEW, "a message about no incident is no quiet step"
    assert R.PICTURE == R.SEND_SILENT
    rang = R.Rang()
    rang.shown(7, 111)
    assert rang.question(7, 111) == R.EDIT_QUIET and rang.question(7, 222) == R.RING_NEW
