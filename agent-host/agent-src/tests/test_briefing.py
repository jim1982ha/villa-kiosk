"""What the AI is told before it answers, as one module (briefing.py, architecture review round 16): the status check,
the chat's facts and the question, in that order — and a guest never told the villa's status (round 8), the check not
even run for one. Driven on the module with stand-ins: no agent built. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from vesta_agent import answering, tool_access
from vesta_agent.briefing import CONTINUE, Briefing

CHAT = 4242
STATUS = "V: AMBER\nOffline (1): Example pump plug"


def briefing(ran: list, approvals=None, failing=False):
    class Facts:
        def now(self, chat):
            return f"[facts of chat {chat}]"

    def run(skill, command):
        ran.append(command)
        return None if failing else STATUS
    return Briefing(checks=lambda: [("lookout", "look.py", object())], run=run, approvals=lambda: approvals,
                    facts=Facts(), where=lambda chat: "example chat")


def person(role):
    return SimpleNamespace(name="Example", role=role, language="en")


def told(b, ask):
    return asyncio.run(b.before(ask))


def test_the_owner_is_told_the_check_the_facts_and_the_question_in_that_order():
    ran = []
    t = told(briefing(ran), answering.Ask(CHAT, person("owner"), "Is the pump on?"))
    check, facts, question = t.prompt.split("\n\n", 2)
    assert check == f"[Checked just now by the lookout skill; answer from this, never from memory]\n{STATUS}"
    assert facts == f"[facts of chat {CHAT}]" and '"""Is the pump on?"""' in question and "role owner" in question
    assert "example chat" in question and ran == ["look.py"] and t.at is not None


def test_a_guest_is_never_told_the_villas_status_nor_is_it_run_for_one():
    ran = []
    t = told(briefing(ran, approvals="Requests for approval: none"), answering.Ask(CHAT, person(tool_access.GUEST), "Hi"))
    assert "lookout skill" not in t.prompt and STATUS not in t.prompt and "Requests for approval" not in t.prompt
    assert ran == [] and f"[facts of chat {CHAT}]" in t.prompt and '"""Hi"""' in t.prompt
    # a check started before the words came (a spoken question) is never started for a guest either
    assert briefing(ran).check_for(person(tool_access.GUEST)) is None and ran == []


def test_a_check_that_fails_is_said_and_the_approvals_follow_when_acting_is_on():
    t = told(briefing([], approvals="Requests for approval: none", failing=True),
             answering.Ask(CHAT, person("fm"), "Status?"))
    assert t.prompt.startswith("[The lookout skill's check could not run just now: say so if asked about it]\n\n"
                               "Requests for approval: none\n\n")


def test_a_continue_is_told_nothing_else():
    ran = []
    t = told(briefing(ran), answering.Ask(CHAT, person("owner"), "", is_continue=True))
    assert (t.prompt, t.at) == (CONTINUE, None)
    assert ran == []
