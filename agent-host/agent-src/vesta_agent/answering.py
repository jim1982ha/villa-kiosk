"""A conversation's turn, around the AI's run: the question as the AI reads it (`question_words`), and what follows the
answer, in its order (`Answering.deliver`).

⚠️ OUT OF app.Vesta (architecture review, 2026-10-30): the agent's main module built the prompt's framing itself and
ran the five steps after every answer inline, their order written nowhere else — the end of every Telegram and tablet
answer, its buttons, approvals, jobs and its voice, could be tested only through the whole agent. Each is here once,
with its own tests (tests/test_answering.py).
"""
from __future__ import annotations

from typing import Callable

from .policy import Language


def question_words(text: str, *, image: bool, voice: bool, spoken: str | None, who: str | None, role: str | None,
                   language: str, where: str, skill=None, command_by: str | None = None, about: str | None = None) -> str:
    """The person's message as the AI reads it: what it is (a message, a photo, a voice message as transcribed and in
    which language Whisper heard it), from whom (their role, the language saved for them), where (a Telegram chat's
    label or the tablet's conversation: tablet.WHERE), and — a command's request — which skill to follow, with the
    subject of the answer it follows (`about`). ⚠️ THE LANGUAGE OF THE ANSWER IS THE SKILL'S RULE (owner,
    2026-10-05): the saved language is said, never "answer in it"."""
    said = ("a photo (attached: look at it) with this message" if image and text else
            "a photo (attached: look at it), with no message" if image else
            (f"a voice message, as transcribed (spoken in {Language.name_of(spoken)})" if spoken else
             "a voice message, as transcribed") if voice else "a message")
    prompt = (f"{said[0].upper() + said[1:]} from {who or 'someone'} (role {role or '?'}; language saved for them: "
              f"{language}) in the {where}:\n\"\"\"{text}\"\"\"")
    if skill is not None:
        prompt = (f"{command_by or 'The person'} wrote /{skill.command}: this is a request for the {skill.name} skill. "
                  f"Read it with read_skill and follow it.\n\n{prompt}")
        if about:
            # ⚠️ A FOLLOW-UP'S SUBJECT (review, 2026-10-23): pressed under "and why did it keep starting?", the fresh
            # conversation had only those words — what the answer it came from read is said with them
            prompt += (f"\nThe question follows an answer that read these devices (and periods); it is about them unless "
                       f"it names others:\nabout: {about}")
    return prompt


class Answering:
    """What follows an answer, in this order, for every conversation (a Telegram chat and a tablet alike): the answer
    sent with the camera pictures the AI looked at (Delivery.reply); the fault offers it carries remembered under it;
    each approval it told of rewriting it from now (Approvals.answered); this turn's jobs, their waiting message and
    their "typing…" (ChatJobs.replied); and — a question spoken on the tablet — its voice, beside the conversation (the
    next question never waits on it: Tablet.later, speech.Aloud)."""

    def __init__(self, delivery, fault_offers, approvals, chat_jobs, later: Callable, aloud):
        self.delivery, self.fault_offers, self.approvals, self.chat_jobs = delivery, fault_offers, approvals, chat_jobs
        self.later, self.aloud = later, aloud

    async def deliver(self, cid: int, reply, photos, approvals, aloud: bool = False) -> int | None:
        """The answer `reply` (turn_reply.Reply) sent and followed; its message id."""
        mid = await self.delivery.reply(cid, reply.text, keyboard=reply.keyboard, photos=photos)
        self.fault_offers.delivered(reply.offered, mid)
        self.approvals.answered(approvals, cid, mid, reply.text)
        await self.chat_jobs.replied(cid, mid)
        if aloud:
            self.later(self.aloud.answer(cid, mid, reply.text))
        return mid


__all__ = ["question_words", "Answering"]
