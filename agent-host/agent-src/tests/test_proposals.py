"""The owner answers a proposal of the monthly report with /proposal (owner, 2026-10-13): "accept 3" typed alone
could mean anything, a command cannot. The number is the proposal's own (the store's id), the owner only answers,
the reply names the proposal, and answering again changes the answer."""
from __future__ import annotations

import asyncio
import json

from helpers import make_agent
from telegram_fake import BOT
from vesta_shared.store import Store

OWNER, FM = 111, 222
PEOPLE = [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}, {"telegram_id": FM, "name": "FM", "role": "fm"}]


def run(coro):
    return asyncio.run(coro)


def _villa(tmp_path):
    v = make_agent(tmp_path, {"people": PEOPLE}, skills=["proposals"])
    v.bot_username = BOT["username"]
    store = Store(v.s.store_path)
    gate = store.add_proposal("retune", "Retune Gate relay: it fires too often", "21 alerts in 30 days", "")
    store.add_proposal("energy", "Run the pool pump off-peak", "", "")
    return v, store, gate


def _answer(v, monkeypatch, who: int, words: str) -> list:
    """`who` writes "/proposal <words>" in their private chat; the AI runs the skill's script as SKILL.md says (the
    stand-in reads the words itself). What the script answered, as the AI saw it."""
    from ai_fake import FakeAI
    said, seen = [], []

    async def act(call):
        seen.append(call["prompt"])
        choice, number = words.split()
        said.append(await call["call"]("run_skill_script", {"skill": "proposals", "script": "answer.py", "args": [
            "answer", "--number", number, "--choice", choice]}))
    FakeAI("ok", act=act).install(monkeypatch)
    run(v.on_ha_event("telegram_command", {"id": 1, "chat_id": who, "user_id": who, "from_first": "X", "bot": BOT,
                                           "command": "/proposal", "args": words.split()}))
    assert seen, "the /proposal command did not reach the AI"
    return [(r.get("is_error", False), r["content"][0]["text"]) for r in said]


def test_the_owner_answers_a_proposal_by_its_number_and_can_change_it(tmp_path, monkeypatch):
    v, store, gate = _villa(tmp_path)
    ((err, text),) = _answer(v, monkeypatch, OWNER, f"ignore {gate}")
    assert not err and json.loads(text)["text"] == \
        f"Proposal {gate}, Retune Gate relay: it fires too often: ignored: it will not be suggested again."
    assert [p["status"] for p in store.proposals(None) if p["id"] == gate] == ["ignored"]
    assert [p["title"] for p in store.proposals("open")] == ["Run the pool pump off-peak"]   # off the next report
    # ignored: the same suggestion made again is the same proposal, still ignored — never a new number
    assert store.add_proposal("retune", "Retune Gate relay: it fires too often", "", "") == gate
    assert len(store.proposals("open")) == 1
    ((err, text),) = _answer(v, monkeypatch, OWNER, f"later {gate}")                       # answered again: changed
    assert not err and json.loads(text)["text"].endswith("kept for later: it is on the next report again. (it was ignored)")
    assert gate in [p["id"] for p in store.proposals("open")]


def test_only_the_owner_answers_and_a_number_that_is_no_proposal_changes_nothing(tmp_path, monkeypatch):
    v, store, gate = _villa(tmp_path)
    ((err, text),) = _answer(v, monkeypatch, FM, f"ignore {gate}")
    assert err and "Only the owner answers proposals." in text
    ((err, text),) = _answer(v, monkeypatch, OWNER, "ignore 99")
    assert err and "There is no proposal 99." in text
    assert all(p["status"] == "open" for p in store.proposals(None))


def test_accept_3_typed_alone_is_no_answer(tmp_path, monkeypatch):
    # the skill runs only on its command: without it, the AI may not run its script
    from ai_fake import FakeAI
    v, store, gate = _villa(tmp_path)
    said = []

    async def act(call):
        said.append(await call["call"]("run_skill_script", {"skill": "proposals", "script": "answer.py", "args": [
            "answer", "--number", str(gate), "--choice", "accept"]}))
    FakeAI("ok", act=act).install(monkeypatch)
    run(v.converse(OWNER, v.policy().person(OWNER), f"accept {gate}"))
    assert said[0].get("is_error") and "/proposal" in said[0]["content"][0]["text"]
    assert all(p["status"] == "open" for p in store.proposals(None))
