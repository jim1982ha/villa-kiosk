"""What a turn of a tablet's conversation may hold, by the agreement's examples (agent-contract.json
conversation.turnExamples; architecture review R, 2026-10-29). The Kiosk replays the same examples through its own door
(its tests/agent-interface.py); here the Agent's test copy of the add-on (kiosk_fake) answers them, through the real
Kiosk client, so a turn the Agent's tests accept is one the add-on keeps."""
from __future__ import annotations

import asyncio

import pytest

from kiosk_fake import CONVERSATION, FakeKiosk


@pytest.mark.parametrize("example", CONVERSATION["turnExamples"], ids=lambda ex: ex["why"])
def test_the_test_copy_of_the_add_on_keeps_and_refuses_as_the_agreement_says(example):
    kiosk = FakeKiosk()
    # the rewrite and the withdrawal are of a turn already kept, as at the add-on
    kiosk.turns["turn:9001"] = {"key": "turn:9001", "profile": "ops", "text": "The pool pump is on."}
    assert asyncio.run(kiosk.add_turn(dict(example["turn"]))) is example["kept"]


def test_the_examples_cover_every_kind_of_key_and_a_refusal_of_each_rule():
    kinds = {k: v for k, v in CONVERSATION["keys"].items()}
    starts = {str(ex["turn"].get("key", ""))[:len(v)] for ex in CONVERSATION["turnExamples"] for v in kinds.values()}
    assert set(kinds.values()) <= starts
    assert {ex["kept"] for ex in CONVERSATION["turnExamples"]} == {True, False}
