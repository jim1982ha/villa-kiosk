"""What the add-on keeps of VESTA's message, by the agreement's examples (agent-contract.json vestaMessage.examples;
architecture review round 13, 2026-11-01). The Kiosk replays the same examples through its own door and its record (its
tests/agent-interface.py); here the Agent's test copy of the add-on (kiosk_fake) keeps them through the real Kiosk door,
so a message the Agent's tests accept is one the tablet keeps exactly as tested."""
from __future__ import annotations

import asyncio

import pytest

from kiosk_fake import VESTA_MESSAGE, FakeKiosk


@pytest.mark.parametrize("example", VESTA_MESSAGE["examples"], ids=lambda ex: ex["why"])
def test_the_test_copy_of_the_add_on_keeps_a_message_as_the_agreement_says(example):
    kiosk = FakeKiosk()
    kiosk.keeps_messages = True
    status, _ = asyncio.run(kiosk._req("POST", "/agent/v1/vesta-message", example["sent"]))
    if example["kept"] is None:
        assert status == 400
        assert not kiosk.messages
    else:
        assert status == 200
        kept = {k: v for k, v in kiosk.messages[example["kept"]["key"]].items() if k != "at"}   # less its `at`, as the examples
        assert kept == example["kept"]


