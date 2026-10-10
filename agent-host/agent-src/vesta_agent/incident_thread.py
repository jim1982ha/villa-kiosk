"""An incident's message in each chat: the one module that decides what a chat shows of an incident.

⚠️ ONE MESSAGE PER INCIDENT PER CHAT (owner, 2026-10-09: "only show the latest message for a given incident, so the
Telegram channel is not overflowed"). Every message about an incident — the alert, a reminder, an escalation, an
answer, and Home Assistant's own alert once its incident is known — replaces the earlier one in the same chat: the
new one is posted first, then the older one is deleted, so a failed send never leaves the chat without the incident.
One Telegram will no longer let the bot delete (older than 48 hours) is cut down to a pointer instead.

⚠️ ONE MODULE, ONE RECORD (architecture review 12, 2026-10-09). This was spread over two record families with two
lifetimes, alert_buttons' replace / adopt / settle, and the order outcome.carry_out ran them in. Settling after the
sends took the buttons off the owner's escalation the moment "Need help" sent it, and the latest-message records were
never pruned. Here a chat holds one record per incident (state.incident_message) and `close` settles only what was
shown before it, whatever order the caller uses.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Awaitable, Callable

import logging

from vesta_shared.messaging import incident_tag

from . import layout
from .notice import when

log = logging.getLogger("vesta.thread")

Edit = Callable[..., Awaitable]     # (chat, message id, text[, keyboard])
Delete = Callable[[int, int], Awaitable]


class IncidentThread:
    def __init__(self, state, timezone: str, edit: Edit | None = None, delete: Delete | None = None):
        self.state = state
        self.tz = timezone
        self.edit = edit                # Telegram's edit (its buttons go); None while Telegram is off
        self.delete = delete            # Telegram's deleteMessage: True when the message is gone

    async def post(self, iid: int | str, chat: int, mid: int, parts: dict, *, buttons: bool = False) -> None:
        """Message `mid`, just sent to `chat` with these `parts` (layout.py), is now incident `iid`'s message there: the
        earlier one goes."""
        old = self.state.incident_message(iid, chat)
        if old and old["mid"] != mid:
            gone = bool(self.delete and await self.delete(chat, old["mid"]))
            if not gone and self.edit:
                # past Telegram's 48 hours: the old message cannot go, so it stops repeating the incident
                await self.edit(chat, old["mid"], f"{incident_tag(iid)} · see the newer message below.")
            # what happened to the earlier copy, said (owner, 2026-10-10: two messages of #14 stayed in the group)
            log.info("%s in chat %s: message %s replaced by %s (%s)", iid, chat, old["mid"], mid,
                     "deleted" if gone else "kept, now a pointer" if self.edit else "kept")
        self.state.set_incident_message(iid, chat, {"mid": mid, "parts": parts, "text": layout.render(parts),
                                                    "buttons": buttons, "settled": False})

    async def adopt(self, iid: int, chat: int, mid: int, parts: dict, keyboard: dict | None = None) -> None:
        """One of Home Assistant's own messages (a VESTA rule's alert, its all-clear) belongs to incident `iid`: it is
        rewritten as the incident's message — its number, the original alert and, while it is open, its buttons
        (`keyboard`) — and replaces the earlier one."""
        text = layout.render(parts)
        if self.edit:
            await self.edit(chat, mid, text, keyboard) if keyboard else await self.edit(chat, mid, text)
        await self.post(iid, chat, mid, parts, buttons=bool(keyboard))

    async def close(self, iid: int | str, note: str, body: str | None = None) -> int:
        """Every message of incident `iid` still showing its buttons, in every chat, loses them and shows `note` (who
        did what, when; "{time}": the villa's time now). Returns how many. Settled once: a second close changes nothing.

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the facility
        manager's; pressed in one, the others kept buttons that only answered "already closed"."""
        note = note.replace("{time}", when(datetime.now(timezone.utc), self.tz))     # 10/10/2026 17:13, as every notice
        n = 0
        for chat, rec in self.state.incident_chats(iid):
            if not rec.get("buttons") or rec.get("settled"):
                continue
            # where it stands is the note now, under the line at the bottom; a new body when one is given (an approved
            # request: what happened) — the head and the lead kept (layout.py)
            p = layout.changed(layout.of(rec), status=note, body=body) if note else layout.of(rec)
            text = layout.render(p)
            if self.edit and note:
                await self.edit(chat, rec["mid"], text)
                n += 1
            self.state.set_incident_message(iid, chat, {**rec, "parts": p, "text": text, "settled": True})
        return n

    async def rewrite(self, iid: int | str, body: str) -> None:
        """Every copy of `iid` says `body` now in its middle part, its heading and status kept (an approved request whose
        device got there: "Opening …" becomes "Opened …")."""
        for chat, rec in self.state.incident_chats(iid):
            p = layout.changed(layout.of(rec), body=body)
            text = layout.render(p)
            if self.edit:
                await self.edit(chat, rec["mid"], text)
            self.state.set_incident_message(iid, chat, {**rec, "parts": p, "text": text})

    def shown(self, iid: int | str) -> dict[int, dict]:
        """What each chat shows of incident `iid`: {chat: {mid, parts, text, buttons, settled}}."""
        return dict(self.state.incident_chats(iid))
