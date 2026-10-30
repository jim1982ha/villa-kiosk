"""A conversation's turn around the AI's run (vesta_agent/answering.py; architecture review 2026-10-30: out of app.Vesta):
the question as the AI reads it, and what follows the answer, in its order. Synthetic villa; names invented."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from vesta_agent.answering import Answering, question_words


def test_the_question_says_what_it_is_from_whom_and_where():
    assert question_words("Is the pump on?", image=False, voice=False, spoken=None, who="Owner", role="owner",
                          language="French", where="owner group") == (
        'A message from Owner (role owner; language saved for them: French) in the owner group:\n"""Is the pump on?"""')
    assert question_words("", image=True, voice=False, spoken=None, who=None, role=None, language="English",
                          where="x").startswith("A photo (attached: look at it), with no message from someone (role ?;")
    assert question_words("Allume", image=False, voice=True, spoken="fr", who="Owner", role="owner", language="English",
                          where="x").startswith("A voice message, as transcribed (spoken in French) from Owner")


def test_a_commands_request_names_its_skill_and_the_subject_it_follows():
    skill = SimpleNamespace(command="investigate", name="investigate")
    words = question_words("why?", image=False, voice=False, spoken=None, who="Owner", role="owner", language="English",
                           where="x", skill=skill, command_by="Owner", about="switch.example_pump")
    assert words.startswith("Owner wrote /investigate: this is a request for the investigate skill.")
    assert words.endswith("about: switch.example_pump")


class _Log:
    def __init__(self):
        self.done = []


def _answering(log, aloud_on=True):
    async def reply(cid, text, keyboard=None, photos=()):
        log.done.append(f"reply {text} {len(photos)}")
        return 42

    async def replied(cid, mid):
        log.done.append(f"jobs {mid}")

    async def aloud(cid, mid, text, timeline=None, asked=None):
        log.done.append(f"aloud {mid}")
    later = []
    a = Answering(delivery=SimpleNamespace(reply=reply),
                  fault_offers=SimpleNamespace(delivered=lambda offered, mid: log.done.append(f"offers {mid}")),
                  approvals=SimpleNamespace(answered=lambda ap, cid, mid, text: log.done.append(f"approvals {mid}")),
                  chat_jobs=SimpleNamespace(replied=replied), later=later.append,
                  aloud=SimpleNamespace(answer=aloud))
    return a, later


def test_what_follows_an_answer_comes_in_its_order_and_the_voice_beside_it():
    log = _Log()
    a, later = _answering(log)
    reply = SimpleNamespace(text="On.", keyboard=None, offered=[])
    mid = asyncio.run(a.deliver(7, reply, ["photo"], [], aloud=True))
    assert mid == 42 and log.done == ["reply On. 1", "offers 42", "approvals 42", "jobs 42"]
    # the voice is handed beside the conversation, never awaited in it (the next question never waits on it)
    assert len(later) == 1
    asyncio.run(later[0])
    assert log.done[-1] == "aloud 42"
    log2 = _Log()
    a2, later2 = _answering(log2)
    asyncio.run(a2.deliver(7, reply, [], [], aloud=False))
    assert later2 == []
