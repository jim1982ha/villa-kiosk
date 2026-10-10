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

#: How many times a copy Telegram refused to update is tried again (housekeeping: about an hour), then given up.
OWED_TRIES = 12


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
        did what, when; "{time}": the villa's time now). Returns how many chats show it now. Settled once: a second close
        changes nothing.

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the facility
        manager's; pressed in one, the others kept buttons that only answered "already closed"."""
        note = note.replace("{time}", when(datetime.now(timezone.utc), self.tz))     # 10/10/2026 17:13, as every notice
        n = 0
        for chat, rec in self.state.incident_chats(iid):
            if not rec.get("buttons") or rec.get("settled"):
                continue
            if not note:
                self.state.set_incident_message(iid, chat, {**rec, "settled": True})
                continue
            # where it stands is the note now, under the line at the bottom; a new body when one is given (an approved
            # request: what happened) — the head and the lead kept (layout.py). Settled: decided, whatever Telegram said — a copy it did not take is owed and tried again (`catch_up`)
            n += await self._show(iid, chat, {**rec, "settled": True}, layout.changed(layout.of(rec), status=note, body=body))
        return n

    async def rewrite(self, iid: int | str, body: str) -> None:
        """Every copy of `iid` says `body` now in its middle part, its heading and status kept (an approved request whose
        device got there: "Opening …" becomes "Opened …")."""
        for chat, rec in self.state.incident_chats(iid):
            await self._show(iid, chat, rec, layout.changed(layout.of(rec), body=body))

    async def _show(self, iid: int | str, chat: int, rec: dict, p: dict) -> bool:
        """The copy in `chat` shows `p` now (its buttons gone). The record keeps `p` whatever Telegram said; a copy Telegram
        did not take is OWED and tried again by `catch_up`.

        ⚠️ RECORDED ONLY WHEN SHOWN (architecture review 21): a refused edit (a network blip) was recorded settled like
        a shown one and never tried again — one chat kept Done / Need help, "Already answered." at every press."""
        text = layout.render(p)
        ok = bool(self.edit and await self.edit(chat, rec["mid"], text))
        tries = 0 if ok else int(rec.get("owed_tries") or 0) + 1
        rec = {k: v for k, v in rec.items() if k not in ("owed", "owed_tries")} | {"parts": p, "text": text}
        if not ok:
            rec |= {"owed": tries < OWED_TRIES, "owed_tries": tries}
            log.info("%s in chat %s: message %s not updated (%s)", iid, chat, rec["mid"],
                     "tried again later" if rec["owed"] else "given up")
        self.state.set_incident_message(iid, chat, rec)
        return ok

    async def catch_up(self) -> int:
        """Every copy a refused edit left behind is tried again (housekeeping, every few minutes; at most OWED_TRIES times
        each — a message deleted in the chat can never be changed). Returns how many are shown now."""
        n = 0
        for iid, chat, rec in self.state.incident_messages_owed():
            n += await self._show(iid, chat, rec, layout.of(rec))
        return n

    def shown(self, iid: int | str) -> dict[int, dict]:
        """What each chat shows of incident `iid`: {chat: {mid, parts, text, buttons, settled}}."""
        return dict(self.state.incident_chats(iid))
