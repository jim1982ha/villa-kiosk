"""Which chat a message goes to: the one routing rule, written once (owner, 2026-10-01).

1. A reply to a person goes to the chat they wrote in or pressed a button in: `here`.
2. A scheduled or alert message goes to its role's chat: `owner` or `fm` (policy.yaml `chats`).
3. An approval request goes to the chat it was asked from, or to the owner chat when only the
   owner may approve (or when it was asked from a chat the policy does not know).
4. When the owner and the facility manager share one chat, a message meant for both is sent
   once there (Outcome sends each (chat, text) once).

Skills say WHO a message is for (`here`, `owner`, `fm`); only this module says WHERE that is.
"""
from __future__ import annotations

from dataclasses import dataclass

from .policy import Policy

TARGETS = ("here", "owner", "fm")


@dataclass(frozen=True)
class Origin:
    """The chat a person is being answered in: where `here` points."""
    chat: int


class Routing:
    def __init__(self, policy: Policy):
        self.policy = policy

    def target(self, to: str | None, origin: Origin | None = None) -> int | None:
        """Rules 1 and 2. None when there is nowhere to send it (no origin for `here`, an unset role chat)."""
        if to == "here":
            return origin.chat if origin else None
        if to in ("owner", "fm"):
            return self.policy.chats.get(to)
        return None

    def approver_chat(self, required_role: str | None, origin_chat: int | None) -> int | None:
        """Rule 3: where an Approve / Refuse request is sent."""
        owner = self.policy.chats.get("owner")
        if required_role == "owner" or origin_chat is None:
            return owner
        known = self.policy.chat_role(origin_chat) is not None or int(origin_chat) in self.policy.people
        return int(origin_chat) if known else owner

    def label(self, chat_id: int) -> str:
        """For the log: which chat this is, never who is in it."""
        roles = [r for r, c in self.policy.chats.items() if int(c) == int(chat_id)]
        if roles:
            return " and ".join(f"{r}" for r in sorted(roles)) + " chat"
        return "private chat" if int(chat_id) > 0 else "group"
