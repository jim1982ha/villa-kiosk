"""A conversation's turn, around the AI's run: the turn asked for (`Ask`), the question as the AI reads it
(`question_words`), and what follows the answer, in its order (`Answering.deliver`).

⚠️ OUT OF app.Vesta (architecture review, 2026-10-30): the agent's main module built the prompt's framing itself and
ran the five steps after every answer inline, their order written nowhere else — the end of every Telegram and tablet
answer, its buttons, approvals, jobs and its voice, could be tested only through the whole agent. Each is here once,
with its own tests (tests/test_answering.py).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, NamedTuple

from .policy import Language


@dataclass(frozen=True)
class Ask:
    """One turn of a conversation, as app.Vesta.converse is asked for it. ⚠️ ONE VALUE, NOT TWELVE ARGUMENTS
    (architecture review 2026-10-30, round 2): they were passed by position from converse to _converse, twice listed,
    where a swapped pair was no error.

    `resume`: the AI conversation to go on with ("auto": by the reset rule; None: a fresh one). `is_continue`: a
    Continue pressed. `voice`: the words are a voice message's, as transcribed; `spoken`: the language Whisper said it
    heard it in (transcriber.Heard), None when it did not say (instructions.md rule 6 then reads the words). `image`: a
    photo the person sent (base64, mime), `text` its caption: the AI looks at it. `invoked`: the command skill the
    person's "/command" called (a new request); `request`: the one a Continue continues (command_request.Request).
    `about`: what the answer whose button started this request had read (command_offers.subject), told to the AI with
    the question. `aloud`: the answer is spoken too (a question spoken on the tablet: speech.Aloud)."""
    chat: int
    person: object
    text: str
    resume: str | None = "auto"
    is_continue: bool = False
    voice: bool = False
    image: tuple[str, str] | None = None
    invoked: str | None = None
    request: object = None
    spoken: str | None = None
    about: str | None = None
    aloud: bool = False
    #: the villa's status check (app.Vesta.before_answer) already started (a spoken question: while Whisper writes it
    #: out); None: run when the turn needs it
    checked: object = None
    #: a spoken question's steps, timed (Timeline); None: not timed
    timeline: object = None


class Timeline:
    """⚠️ A SPOKEN QUESTION'S STEPS, ON ONE CLOCK (owner, 2026-10-30: "measure the latency … until the beginning of its
    vocal reply … what steps are taking most of the time"): from the add-on keeping the recording to its answer's sound
    named on the tablet, each step's seconds, logged as one line once the voice is ready (speech.Aloud). The AI's own
    start and first reply are runner.run's line beside it."""

    def __init__(self, profile: str, waited_s: float | None = None, clock: Callable[[], float] = time.monotonic):
        self.profile, self.clock = profile, clock
        self.began = self.last = clock()
        self.waited = max(0.0, waited_s) if isinstance(waited_s, (int, float)) else None
        self.steps: list[tuple[str, float]] = []

    def mark(self, step: str) -> None:
        """`step` just ended: its seconds are the time since the one before."""
        now = self.clock()
        self.steps.append((step, now - self.last))
        self.last = now

    def line(self) -> str:
        """"Spoken question (owner): reached VESTA 0.3 s · words 6.1 s · … · 24.0 s in all"."""
        parts = ([("reached VESTA", self.waited)] if self.waited is not None else []) + self.steps
        total = (self.last - self.began) + (self.waited or 0.0)
        return (f"Spoken question ({self.profile}): " + " · ".join(f"{n} {s:.1f} s" for n, s in parts) +
                f" · {total:.1f} s in all")


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


class Asked(NamedTuple):
    """What a spoken answer's voice is told of the question it answers (speech.Aloud): its words, the language a
    speech-to-text said it heard them in (None: it said none), the person's saved language. ⚠️ THE LANGUAGE OF THE
    EXCHANGE IS THE SKILL'S, TOLD ONCE (architecture review, 2026-10-30, round 3): the engine carries these to the
    skill that chooses the voice (on_event.answer_aloud), which tells the question's language once; the engine never
    guesses one."""
    question: str
    heard: str | None
    saved: str | None


class Answering:
    """What follows an answer, in this order, for every conversation (a Telegram chat and a tablet alike): the answer
    sent with the camera pictures the AI looked at (Delivery.reply); the fault offers it carries remembered under it;
    each approval it told of rewriting it from now (Approvals.answered); this turn's jobs, their waiting message and
    their "typing…" (ChatJobs.replied); and — a question spoken on the tablet — its voice, beside the conversation (the
    next question never waits on it: Tablet.later, speech.Aloud)."""

    def __init__(self, delivery, fault_offers, approvals, chat_jobs, later: Callable, aloud):
        self.delivery, self.fault_offers, self.approvals, self.chat_jobs = delivery, fault_offers, approvals, chat_jobs
        self.later, self.aloud = later, aloud

    async def deliver(self, cid: int, reply, photos, approvals, aloud: bool = False, timeline=None,
                      asked: Asked | None = None) -> int | None:
        """The answer `reply` (turn_reply.Reply) sent and followed; its message id."""
        mid = await self.delivery.reply(cid, reply.text, keyboard=reply.keyboard, photos=photos)
        self.fault_offers.delivered(reply.offered, mid)
        self.approvals.answered(approvals, cid, mid, reply.text)
        await self.chat_jobs.replied(cid, mid)
        if timeline is not None:
            timeline.mark("answer on the tablet")
        if aloud:
            self.later(self.aloud.answer(cid, mid, reply.text, timeline, asked))
        return mid


__all__ = ["question_words", "Answering", "Ask", "Asked", "Timeline"]
