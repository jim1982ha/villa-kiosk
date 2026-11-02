"""What the AI is told before it answers a person: the one module that puts it together.

⚠️ ONE PLACE FOR "WHAT THE AI IS TOLD BEFORE AN ANSWER" (architecture review round 16). It was assembled inside
app._converse, beside the conversation's lock and the delivery, with the villa's status check in app.before_answer —
and the guest's rule split: _converse dropped the status for a guest after it had run, while tools.Reads.for_role
limited what a guest's tools may read. Now, in this order, for every conversation (a Telegram chat, a tablet):

  status check  each skill's `before_answer` check (its script's "text"), and the approval requests when acting is on —
                a check that failed is said to have failed, never left out silently. ⚠️ NEVER FOR A GUEST (architecture
                review round 8): it names the offline devices, the open alerts and the locks, which the guest's tablet
                does not show — not run at all for one, so nothing of it can reach the guest's answer. What a guest's
                tools may read is the asker's role too (tools.Toolbox._reads: profiles.Reads.for_role).
  chat facts    what is being prepared for this chat and what reached it since the AI last answered there
                (chat_facts.py)
  the question  the person's words as the AI reads them (answering.question_words): who, in which role, where

app keeps the conversation's lock, the AI turn and the delivery; it asks `before(ask)` and gets the words and the moment
they were told (ChatFacts.told once the AI answered).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from vesta_shared.limits import limit

from . import answering, script_run, tool_access
from .policy import Language

#: What a Continue is told: no question, no check, no facts.
CONTINUE = "Continue exactly where you stopped. Do not repeat what you already wrote."


def status_timeout_s() -> float:
    return limit("chat.status_check_timeout_s", 60, unit="seconds", group="run", lo=5, hi=600,
                 says="How long the skill check that reads the villa's status before each chat answer may take.",
                 reached="The AI is told the check could not run just now, and says so if asked.", told="ai")


def is_guest(person) -> bool:
    """Is the asker a guest (tool_access.GUEST: answers only)? The one test of this module's guest rule."""
    return person is not None and getattr(person, "role", None) == tool_access.GUEST


@dataclass(frozen=True)
class Told:
    """What the AI is told before it answers (`prompt`), and when (`at`: None for a Continue, which tells no facts)."""
    prompt: str
    at: datetime | None


class Briefing:
    """See the module's note. `checks` () → [(skill name, its before_answer command, the skill)]; `run` (skill, command)
    → its text or None (the check failed); `approvals` () → the approval requests' words when acting is on, else None;
    `facts`: chat_facts.ChatFacts; `where` (chat) → the place the question was written (a chat's label, the tablet's)."""

    def __init__(self, *, checks: Callable[[], list], run: Callable, approvals: Callable[[], str | None], facts,
                 where: Callable[[int], str]):
        self._checks, self._run, self._approvals, self._facts, self._where = checks, run, approvals, facts, where

    def status(self) -> str:
        """What each skill's `before_answer` check says now, for the AI to have in front of it before it answers. A check
        that fails is said to have failed, never left out silently: the AI must not answer as if it had seen it."""
        out = []
        for name, command, skill in self._checks():
            text = self._run(skill, command)
            if text:
                out.append(f"[Checked just now by the {name} skill; answer from this, never from memory]\n{text}")
            else:
                out.append(f"[The {name} skill's check could not run just now: say so if asked about it]")
        if (now := self._approvals()) is not None:
            out.append(now)
        return "\n\n".join(out)

    def check_for(self, person) -> asyncio.Future | None:
        """The status check started now, beside what comes before the words (a spoken question: while Whisper writes it
        out), for `before` to await; None for a guest, who is never told it."""
        if is_guest(person):
            return None
        checking = asyncio.ensure_future(asyncio.to_thread(self.status))
        checking.add_done_callback(lambda t: t.cancelled() or t.exception())
        return checking

    async def before(self, ask: "answering.Ask") -> Told:
        """What the AI is told before it answers `ask` (answering.Ask), in the module's order."""
        if ask.is_continue:
            return Told(CONTINUE, None)
        person = ask.person
        sk = ask.request.skill if ask.request else None
        # ⚠️ WHERE IT WAS WRITTEN, AND HOW THAT PLACE SHOWS THE ANSWER: a tablet's conversation (tablet.WHERE) is no
        # Telegram chat (ticket 21 of "One inbox"); the words of the question: answering.question_words
        question = answering.question_words(
            ask.text, image=bool(ask.image), voice=bool(ask.voice), spoken=ask.spoken,
            who=person.name if person else None, role=person.role if person else None,
            language=Language.of(person.language).name if person else "English", where=self._where(ask.chat), skill=sk,
            command_by=person.name if person else None, about=ask.about)
        if is_guest(person):
            if ask.checked is not None:
                ask.checked.cancel()                 # started for nobody: a guest is never told it
            checked = None
        else:
            checked = await (ask.checked if ask.checked is not None else asyncio.to_thread(self.status))
        if ask.timeline is not None:
            ask.timeline.mark("status check")        # what was left of it once the words came (it ran beside them)
        # ⚠️ WHAT THIS CHAT HAS, AS FACTS, WITH EVERY MESSAGE (owner, 2026-10-23): the digest a job had sent at 14:40 was
        # promised again at 14:50 as "on its way" — the AI read only its own transcript. What is being prepared here now
        # (or that nothing is) and what reached this chat since the AI's last answer here (chat_facts.py) head the message
        at = datetime.now(timezone.utc)
        here = self._facts.now(ask.chat)
        return Told("\n\n".join(p for p in (checked, here, question) if p), at)


def skill_checks(skills) -> list:
    """Every skill's `before_answer` check: (its name, its command, the skill) — app's `checks`."""
    return [(sk.name, sk.before_answer, sk) for sk in skills.all().values() if sk.before_answer]


def run_check(settings, state) -> Callable:
    """A skill's check run as every script runs (script_run.run_command), within status_timeout_s: its "text", or None."""
    def run(skill, command):
        ans = script_run.run_command(settings, state, skill, command, timeout=status_timeout_s())
        return (ans.result() or {}).get("text") if ans.ok else None
    return run
