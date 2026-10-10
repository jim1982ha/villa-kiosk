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

from vesta_shared.messaging import TELEGRAM_LIMIT, incident_tag, tg_len

from .delivery import fit
from .notice import when

Edit = Callable[..., Awaitable]     # (chat, message id, text[, keyboard])
Delete = Callable[[int, int], Awaitable]


class IncidentThread:
    def __init__(self, state, timezone: str, edit: Edit | None = None, delete: Delete | None = None):
        self.state = state
        self.tz = timezone
        self.edit = edit                # Telegram's edit (its buttons go); None while Telegram is off
        self.delete = delete            # Telegram's deleteMessage: True when the message is gone

    async def post(self, iid: int, chat: int, mid: int, text: str, *, buttons: bool = False) -> None:
        """Message `mid`, just sent to `chat`, is now incident `iid`'s message there: the earlier one goes."""
        old = self.state.incident_message(iid, chat)
        if old and old["mid"] != mid:
            gone = bool(self.delete and await self.delete(chat, old["mid"]))
            if not gone and self.edit:
                # past Telegram's 48 hours: the old message cannot go, so it stops repeating the incident
                await self.edit(chat, old["mid"], f"{incident_tag(iid)} · see the newer message below.")
        self.state.set_incident_message(iid, chat, {"mid": mid, "text": text, "buttons": buttons, "settled": False})

    async def adopt(self, iid: int, chat: int, mid: int, text: str, keyboard: dict | None = None) -> None:
        """One of Home Assistant's own messages (a VESTA rule's alert, its all-clear) belongs to incident `iid`: it is
        rewritten as the incident's message — its number, the original alert and, while it is open, its buttons
        (`keyboard`) — and replaces the earlier one."""
        if self.edit:
            await self.edit(chat, mid, text, keyboard) if keyboard else await self.edit(chat, mid, text)
        await self.post(iid, chat, mid, text, buttons=bool(keyboard))

    async def close(self, iid: int, note: str) -> int:
        """Every message of incident `iid` still showing its buttons, in every chat, loses them and shows `note` (who
        did what, when; "{time}": the villa's time now). Returns how many. Settled once: a second close changes nothing.

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the facility
        manager's; pressed in one, the others kept buttons that only answered "already closed"."""
        note = note.replace("{time}", when(datetime.now(timezone.utc), self.tz))     # 10/10/2026 17:13, as every notice
        n = 0
        for chat, rec in self.state.incident_chats(iid):
            if not rec.get("buttons") or rec.get("settled"):
                continue
            # the note is kept whole, the alert's own text shortened to make room (architecture review 15: cut at 4,096
            # characters, a long alert lost "Done — Marie, 09:14" at its end)
            text = f"{fit(rec['text'].rstrip(), TELEGRAM_LIMIT - tg_len(note) - 2)}\n\n{note}" if note else rec["text"]
            if self.edit and note:
                await self.edit(chat, rec["mid"], text)
                n += 1
            self.state.set_incident_message(iid, chat, {**rec, "text": text, "settled": True})
        return n

    def shown(self, iid: int) -> dict[int, dict]:
        """What each chat shows of incident `iid`: {chat: {mid, text, buttons, settled}}."""
        return dict(self.state.incident_chats(iid))
