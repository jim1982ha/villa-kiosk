"""The "being prepared" message of a job asked for in a chat — when it goes, and what it says if no result comes.

⚠️ ONE MESSAGE WHILE A JOB ASKED FOR IN A CHAT RUNS, REPLACED BY ITS RESULT (owner, 2026-10-04: "I don't want
to see 3 messages"). The reply that started the job is that message; the job's first result deletes it
(Telegram cannot turn a text into a file message). Until 0.12.27 this was a dict in app.py edited from three
places, keyed by chat only, and three orders of events were lost:

- the RESULT ARRIVES BEFORE THE REPLY (a fast job, a slow reply): the result found no message to delete, the
  reply then came and stayed — the three messages again;
- TWO JOBS STARTED IN ONE TURN: the second overwrote the first, so the first job ending without a result
  edited nothing, or the second's end edited the first's message;
- a job ENDING WITHOUT A RESULT BEFORE THE REPLY: the reply then promised a report that would not come.

Pure: it answers which message goes ("delete") or says the job ended without a result ("edit"); app.py does
the Telegram calls. tests/test_job_notices.py drives every order of events through it.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class _Notice:
    jobs: set[str] = field(default_factory=set)   # jobs started from this turn and still running
    mid: int | None = None                        # the reply, once sent
    done: bool = False                            # a result already reached the chat
    failed: str | None = None                     # the last job, when all ended without a result before the reply


Step = tuple[str, int, str]   # ("delete" | "edit", message id, the job it is about)


class JobNotices:
    def __init__(self) -> None:
        self._by_chat: dict[int, _Notice] = {}

    def started(self, chat: int, job: str) -> None:
        """A job was started from this chat's current turn. A finished notice from an earlier turn whose
        reply never came is not this one."""
        n = self._by_chat.get(chat)
        if n is None or n.done or n.failed:
            n = self._by_chat[chat] = _Notice()
        n.jobs.add(job)

    def replied(self, chat: int, mid: int | None) -> Step | None:
        """The turn's reply was sent. It is dealt with at once when the jobs got there first."""
        n = self._by_chat.get(chat)
        if n is None or n.mid is not None or not mid:
            return None
        if n.done or n.failed:
            del self._by_chat[chat]
            return ("delete", mid, "") if n.done else ("edit", mid, n.failed or "")
        n.mid = mid
        return None

    def result(self, chat: int) -> Step | None:
        """A job's result reached the chat: the waiting message goes (now, or as soon as it is sent)."""
        n = self._by_chat.get(chat)
        if n is None:
            return None
        if n.mid is not None:
            del self._by_chat[chat]
            return ("delete", n.mid, "")
        n.done = True
        n.failed = None
        return None

    def ended(self, chat: int, job: str) -> Step | None:
        """A job finished. When it was the last of its turn and no result came, the waiting message says
        so (now, or as soon as it is sent)."""
        n = self._by_chat.get(chat)
        if n is None or job not in n.jobs:
            return None
        n.jobs.discard(job)
        if n.jobs or n.done:
            return None
        if n.mid is None:
            n.failed = job
            return None
        del self._by_chat[chat]
        return ("edit", n.mid, job)
