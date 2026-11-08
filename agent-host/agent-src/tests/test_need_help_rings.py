"""A person's Need help forwarded to the escalation role rings; a plain escalation stays quiet."""
from vesta_shared.message_format import rings


def test_need_help_escalation_rings():
    assert rings("escalated", "help")
    assert not rings("escalated")
    assert rings("new")
