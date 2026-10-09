"""The alert buttons — Done / Not found / Need help / Mute — on a message, and what a press does.

Taken out of outcome.py (architecture review, 2026-10-07). carry_out puts the buttons on an alert (keyboard,
remember); a press goes to the skill's on_reply (press); settle takes them off every message that carries them.

Also here, because it is what a chat SHOWS of an incident: ONE MESSAGE PER INCIDENT PER CHAT (owner, 2026-10-09:
"only show the latest message for a given incident, so the Telegram channel is not overflowed"). Every message
about an incident — the alert, a reminder, an escalation, an answer, and Home Assistant's own alert once its
incident is known (adopt) — replaces the earlier ones in the same chat: the new one is sent first, then the older
ones are deleted, so a failed send never leaves the chat without the incident. A message Telegram will no longer
let the bot delete (older than 48 hours) is cut down to a pointer instead.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

from vesta_shared.messaging import incident_tag

from . import button_data
from .routing import Origin

log = logging.getLogger("vesta.outcome")

LADDER = [("Done", "done"), ("Not found", "not_found"), ("Need help", "need_help"), ("Mute", "mute")]


class AlertButtons:
    def __init__(self, *, state, skills, store_path: str, timezone: str, edit: Callable[..., Awaitable] | None = None,
                 run_job: Callable[..., Awaitable] | None = None, delete: Callable[..., Awaitable] | None = None):
        self.state = state
        self.skills = skills
        self.store_path = store_path
        self.tz = timezone
        self.edit = edit                # Telegram's edit: the message keeps its text, loses its buttons
        self.run_job = run_job          # (skill, command, timeout, values, origin) -> result: the on_reply hook
        self.delete = delete            # Telegram's deleteMessage: True when the message is gone

    def _store(self):
        from vesta_shared.store import Store
        return Store(self.store_path)

    def keyboard(self, iid: int, chat: int, skill_name: str) -> dict:
        """The buttons of incident `iid`, for a message to `chat` from `skill_name` (whose on_reply answers them)."""
        self.state.set_alert_skill(iid, chat, skill_name)
        return {"inline_keyboard": [[{"text": a, "callback_data": button_data.make(button_data.ALERT, iid, b)} for a, b in LADDER]]}

    def remember(self, iid: int, chat: int, mid: int, text: str) -> None:
        """A message sent with incident `iid`'s buttons: every one of them settles together."""
        self.state.remember_alert_message(iid, chat, mid, text)

    async def replace(self, iid: int, chat: int, mid: int, text: str, *, buttons: bool = False) -> int:
        """Message `mid` is now incident `iid`'s message in `chat`: the earlier ones there go. Returns how many."""
        n = 0
        for old in self.state.incident_messages(iid, chat):
            if old == mid:
                continue
            gone = bool(self.delete and await self.delete(chat, old))
            if not gone and self.edit:
                # past Telegram's 48 hours: the old message cannot go, so it stops repeating the incident
                await self.edit(chat, old, f"{incident_tag(iid)} · see the newer message below.")
            self.state.forget_incident_message(iid, chat, old)
            n += 1
        self.state.remember_incident_message(iid, chat, mid)
        if buttons:
            self.remember(iid, chat, mid, text)
        return n

    async def adopt(self, iid: int, chat: int, mid: int, text: str) -> None:
        """One of Home Assistant's own messages (the VESTA rule's alert, its all-clear) belongs to incident `iid`:
        it is rewritten as one of the incident's messages — its number and the original alert — and replaces
        the incident's earlier messages in that chat."""
        if self.edit:
            await self.edit(chat, mid, text)
        await self.replace(iid, chat, mid, text)

    async def settle(self, iid: int, note: str) -> int:
        """Every message carrying incident `iid`'s buttons — the alert in each chat it went to, and each
        reminder — loses them and shows `note` (who did what, when). Returns how many were edited.

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the
        facility manager's, and a reminder repeats it; pressed in one, the others kept buttons that
        only answered "already closed"."""
        note = note.replace("{time}", datetime.now(ZoneInfo(self.tz)).strftime("%H:%M"))
        n = 0
        for chat, mid, text in self.state.alert_messages(iid):
            if self.edit and note:
                await self.edit(chat, mid, f"{text.rstrip()}\n\n{note}"[:4096])
                n += 1
            self.state.forget_alert_message(iid, chat, mid)
        return n

    async def press(self, q: dict, chat: int, parts: list[str], person, toast: Callable[[str], Awaitable]) -> None:
        """Done / Not found / Need help / Mute on an alert (button_data: its incident and option; the presser is a
        registered person): the skill's on_reply decides, answering `here`."""
        iid, opt = parts
        if not iid.isdigit():
            return await toast("Unknown button.")
        options = {b: a for a, b in LADDER}
        if opt not in options:
            return await toast("Unknown button.")
        skill_name = self.state.alert_skill(iid, chat)
        skill = self.skills.get(skill_name) if skill_name else None
        if skill is None or not skill.on_reply:
            self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "not sent to this chat, or its skill is gone"})
            return await toast("This button belongs to another chat.")
        if opt == "mute" and person.role != "owner":
            inc = self._store().incident(int(iid)) or {}
            if inc.get("severity") in ("P1", "P2"):
                self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "mute of a P1/P2 is owner only"})
                return await toast("Only the owner can mute a P1 or P2 alert.")
        label = options[opt]
        await toast(f"{label}: noted.")
        self.state.log("ladder", {"incident": iid, "by": person.name, "reply": label})
        log.info("Button %s on incident #%s pressed by %s", label, iid, person.name)
        # the buttons go, and the message says who did what, when: nobody presses twice,
        # and the chat itself shows the incident was handled
        await self.settle(int(iid), f"{label} — {person.name}, {{time}}")
        if self.run_job:
            await self.run_job(skill, skill.on_reply, 120, {"incident": iid, "text": label, "role": person.role},
                               Origin(chat))
