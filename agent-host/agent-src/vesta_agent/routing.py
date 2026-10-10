"""Which chat a message goes to: the one routing rule, written once (owner, 2026-10-01).

1. A reply to a person goes to the chat they wrote in or pressed a button in: `here`. While a person is
   being ANSWERED (a conversation) or a job they ASKED FOR runs, everything goes to their chat, the
   scripts' messages included — whatever a skill's steps name (owner, fm).
2. A scheduled or alert message goes to EVERY chat of its role: each chat id the People list names
   with `owner` or `fm`, a person's or a group's (owner, 2026-10-10; the Chats card's one chat per
   role is gone).
3. An approval request goes to the chat it was asked from, or to every owner chat when only the
   owner may approve (or when it was asked from a chat the policy does not know).
4. A chat listed with both roles gets a message meant for both once (Outcome sends each (chat,
   text) once).

Skills say WHO a message is for (`here`, `owner`, `fm`); only this module says WHERE that is — and,
from the same Origin, what the AI is offered (the destinations of send_message, start_job, the report
commands kept for their job). One value for "who is asking", read in one place (architecture review,
2026-10-01: the rule had four homes, and a script run inside a conversation still sent to the fm chat
while the AI's own messages were held to the asker's).
"""
from __future__ import annotations

from dataclasses import dataclass

from .policy import Policy

TARGETS = ("here", "owner", "fm")


CONVERSATION = "conversation"   # a person writing to the agent in this chat
JOB = "job"                     # a job a person asked for in this chat (a report from the group)
PRESS = "press"                 # a button pressed in this chat (an alert's Done / Need help...)


@dataclass(frozen=True)
class Origin:
    """Who is asking, and in which chat: where `here` points. No Origin: a scheduled job or an alert
    hook — nobody asked, messages go to their role's chat."""
    chat: int
    kind: str = PRESS
    # A job asked for in this chat (kind JOB): which one — its result is told by name, never guessed
    # (chat_jobs.ChatJobs.result; architecture review 12).
    job: str | None = None
    # The role of the person who asked (a job they started): what its run may use is theirs (tool_access.allowed_for;
    # owner, 2026-10-10: "only adjust to who is triggering the request"). None: nobody known.
    role: str | None = None

    @property
    def holds(self) -> bool:
        """Everything goes back to this chat: the person who asked gets the result, and nothing goes to
        a chat nobody asked from (owner, 2026-10-01). Not for a button: its skill may escalate to the owner."""
        return self.kind in (CONVERSATION, JOB)

    @property
    def is_conversation(self) -> bool:
        """A person is being answered: the AI may start a job for them, and a command kept for a job
        (skill.yaml job_only) is refused — the job runs with its own brain and limit instead."""
        return self.kind == CONVERSATION


class Routing:
    def __init__(self, policy: Policy):
        self.policy = policy

    @staticmethod
    def offered(origin: Origin | None) -> list[str]:
        """The destinations send_message offers the AI: the asker's chat only, while someone is asking."""
        if origin is None:
            return ["owner", "fm"]
        return ["here"] if origin.holds else ["here", "owner", "fm"]

    def target(self, to: str | None, origin: Origin | None = None) -> list[int]:
        """Rules 1 and 2: every chat it goes to. [] when there is nowhere to send it (no origin for `here`, nobody of
        that role in the People list)."""
        if origin and origin.holds and to in TARGETS:
            return [origin.chat]
        if to == "here":
            return [origin.chat] if origin else []
        if to in ("owner", "fm"):
            return self.policy.chats_for(to)
        return []

    def approver_chats(self, required_role: str | None, origin_chat: int | None) -> list[int]:
        """Rule 3: where an Approve / Refuse request is sent."""
        owners = self.policy.chats_for("owner")
        if required_role == "owner" or origin_chat is None:
            return owners
        known = bool(self.policy.roles_in(origin_chat)) or int(origin_chat) in self.policy.people
        return [int(origin_chat)] if known else owners

    def label(self, chat_id: int) -> str:
        """For the log: which chat this is, never who is in it."""
        return self.policy.chat_label(chat_id)


def job_to(job: dict, origin: Origin | None) -> str:
    """Where a job's result goes, as a target word: `here` when it was asked for in a chat, else the job's `to`
    (skill.yaml), the owner when it names none. Written four times in app.py before (architecture review 5)."""
    return "here" if origin else (job.get("to") or "owner")
