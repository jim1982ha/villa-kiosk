"""The alert buttons — Done / Need help — on a message, and what a press does.

Taken out of outcome.py (architecture review, 2026-10-07): `keyboard` puts the buttons on an alert, `press` answers a
press through the skill's on_reply. What a chat shows of an incident — which message, replaced or settled — is
incident_thread.IncidentThread's (architecture review 12, 2026-10-09).
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from . import button_data
from .routing import Origin

log = logging.getLogger("vesta.outcome")

# ⚠️ TWO BUTTONS (owner, 2026-10-10: Not found and Mute removed, "too complex for now, I want to simplify it")
LADDER = [("Done", "done"), ("Need help", "need_help")]
#: The buttons an older message may still show: a press says what to use instead, never "Unknown button."
RETIRED = {"not_found", "mute"}


class AlertButtons:
    def __init__(self, *, state, skills, store_path: str, thread, run_job: Callable[..., Awaitable] | None = None):
        self.state = state
        self.skills = skills
        self.store_path = store_path
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident
        self.run_job = run_job          # (skill, command, timeout, values, origin) -> result: the on_reply hook
        self._pressing: set[tuple[str, int]] = set()   # (incident, chat) whose press is being handled now

    def _store(self):
        from vesta_shared.store import Store
        return Store(self.store_path)

    def open(self, iid: int | str) -> bool:
        """Is incident `iid` still waiting for an answer (not closed)? Its messages then carry the buttons."""
        inc = self._store().incident(int(iid)) if str(iid).isdigit() else None
        return bool(inc) and not inc.get("closed_at")

    def keyboard(self, iid: int, chat: int, skill_name: str) -> dict:
        """The buttons of incident `iid`, for a message to `chat` from `skill_name` (whose on_reply answers them)."""
        self.state.set_alert_skill(iid, chat, skill_name)
        return {"inline_keyboard": [[{"text": a, "callback_data": button_data.make(button_data.ALERT, iid, b)} for a, b in LADDER]]}

    async def press(self, q: dict, chat: int, parts: list[str], person, toast: Callable[[str], Awaitable],
                    name: str | None = None) -> None:
        """Done / Need help on an alert (button_data: its incident and option; the presser is a
        registered person): the skill's on_reply decides, answering `here`."""
        iid, opt = parts
        if not iid.isdigit():
            return await toast("Unknown button.")
        options = {b: a for a, b in LADDER}
        if opt in RETIRED:
            return await toast("This button is no longer offered: press Done or Need help.")
        if opt not in options:
            return await toast("Unknown button.")
        skill_name = self.state.alert_skill(iid, chat)
        skill = self.skills.get(skill_name) if skill_name else None
        if skill is None or not skill.on_reply:
            self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "not sent to this chat, or its skill is gone"})
            return await toast("This button belongs to another chat.")
        # ⚠️ ONE PRESS, ONE ANSWER (architecture review 15, 2026-10-10): approvals and Continue were taken once, the alert
        # buttons were not — a quick double tap on Done ran the skill's answer twice, and the second ("Already closed")
        # replaced the first in the chat; a double Need help told the owner twice. A press while one is handled, or on
        # an incident this chat already shows as settled, changes nothing.
        key = (iid, int(chat))
        if key in self._pressing or (self.thread.shown(int(iid)).get(int(chat)) or {}).get("settled"):
            self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "already answered"})
            return await toast("Already answered.")
        self._pressing.add(key)
        try:
            await self._answer(iid, opt, options[opt], skill, chat, person, toast, name or person.name)
        finally:
            self._pressing.discard(key)

    async def _answer(self, iid: str, opt: str, label: str, skill, chat: int, person, toast, name: str) -> None:
        await toast(f"{label}: noted.")
        self.state.log("ladder", {"incident": iid, "by": person.name, "reply": label})
        log.info("Button %s on incident #%s pressed by %s", label, iid, person.name)
        # the buttons go, and the message says who did what, when: nobody presses twice,
        # and the chat itself shows the incident was handled
        # ⚠️ THE FOOTER (owner, 2026-10-10): "<button> pressed by <Name> on 09/10/2026 17:13", the name as the People list
        # names this person for the chat's role
        await self.thread.close(int(iid), f"{label} pressed by {name} on {{time}}")
        if self.run_job:
            await self.run_job(skill, skill.on_reply, 120, {"incident": iid, "text": label, "role": person.role},
                               Origin(chat))
