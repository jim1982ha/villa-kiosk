"""The alert buttons — the skill's own (skill.yaml `buttons`) — on a message, and what a press does.

Taken out of outcome.py (architecture review, 2026-10-07): `keyboard` puts the buttons on an alert, `press` answers a
press through the skill's on_reply. What a chat shows of an incident — which message, replaced or settled — is
incident_thread.IncidentThread's (architecture review 12, 2026-10-09).
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from vesta_shared.message_format import PRESSED
from vesta_shared.limits import limit
from vesta_shared.status_words import pressed

from . import button_data
from .incidents import Incidents
from .notice import note_press
from .routing import Origin

log = logging.getLogger("vesta.outcome")

# ⚠️ THE SKILL DECLARES ITS BUTTONS (architecture review, 2026-10-13): skill.yaml `buttons`, the option on_reply is
# given and the label shown. These are the buttons of an alert-desk folder edited before 0.12.180, whose skill.yaml
# has none and whose desk.py still reads the label (`{text}`). Owner, 2026-10-10: two buttons, Done and Need help.
BEFORE_BUTTONS = [{"option": "done", "label": "Done", "mark": None},
                  {"option": "need_help", "label": "Need help", "mark": "help"}]
#: The buttons an older message may still show: a press says what to use instead, never "Unknown button."
RETIRED = {"not_found", "mute"}


class AlertButtons:
    def __init__(self, *, state, skills, store_path: str, thread, run_job: Callable[..., Awaitable] | None = None,
                 facts=None):
        self.state = state
        self.facts = facts              # chat_facts.ChatFacts: the press is told to the AI with the chat's next message
        self.skills = skills
        self.store_path = store_path
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident
        self.run_job = run_job          # (skill, command, timeout, values, origin) -> result: the on_reply hook
        self._pressing: set[tuple[str, int]] = set()   # (incident, chat) whose press is being handled now

    def open(self, iid: int | str) -> bool:
        """Is incident `iid` still waiting for an answer (incidents.Incidents)? Its messages then carry the buttons."""
        return Incidents(self.store_path).awaiting_answer(iid)

    @staticmethod
    def of(skill) -> list[dict]:
        """The buttons `skill` puts under an alert: its own, or those of a skill.yaml from before they were declared."""
        return getattr(skill, "buttons", None) or BEFORE_BUTTONS

    def keyboard(self, iid: int, chat: int, skill_name: str) -> dict:
        """The buttons of incident `iid`, for a message to `chat` from `skill_name` (whose on_reply answers them)."""
        self.state.set_alert_skill(iid, chat, skill_name)
        return {"inline_keyboard": [[{"text": b["label"], "callback_data": button_data.make(button_data.ALERT, iid, b["option"])}
                                     for b in self.of(self.skills.get(skill_name))]]}

    async def press(self, chat: int, parts: list[str], person, toast: Callable[[str], Awaitable],
                    name: str | None = None, pressed: int | None = None) -> None:
        """A button on an alert (button_data: its incident and option; the presser is a registered person): the
        skill's on_reply decides, answering `here`. `pressed`: the message pressed (press.Press.mid)."""
        iid, opt = parts
        if not iid.isdigit():
            return await toast("Unknown button.")
        skill_name = self.state.alert_skill(iid, chat)
        skill = self.skills.get(skill_name) if skill_name else None
        buttons = {b["option"]: b for b in self.of(skill)}
        if opt not in buttons:
            offered = " or ".join(b["label"] for b in buttons.values())
            return await toast(f"This button is no longer offered: press {offered}." if opt in RETIRED or skill
                               else "Unknown button.")
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
            await self._answer(iid, buttons[opt], skill, chat, person, toast, name or person.name)
        finally:
            self._pressing.discard(key)
        # ⚠️ THE COPY PRESSED MAY NOT BE THE ONE ON RECORD (architecture review scan 1, 2026-10-19: #55 twice in the
        # owner's group): every copy on record was settled above; a copy no record points to would keep its buttons
        # beside the answer — it goes now
        if pressed is not None:
            await self.thread.stray(int(iid), int(chat), int(pressed))

    async def _answer(self, iid: str, button: dict, skill, chat: int, person, toast, name: str) -> None:
        label = button["label"]
        await toast(f"{label}: noted.")
        self.state.log("ladder", {"incident": iid, "by": person.name, "reply": label})
        log.info("Button %s on incident #%s pressed by %s", label, iid, person.name)
        # the buttons go, and the message says who did what, when: nobody presses twice,
        # and the chat itself shows the incident was handled
        # ⚠️ THE FOOTER (owner, 2026-10-10): "<button> pressed by <Name> on 09/10/2026 17:13", the name as the People list
        # names this person for the chat's role
        # ⚠️ IN EACH CHAT'S LANGUAGE (owner, 2026-10-23): "Terminé le … (JM)." where the button has a label in it (the
        # skill's `labels`); a language it has none for reads the whole line in English, never half
        labels = button.get("labels") or {}
        await self.thread.close(int(iid), PRESSED.format(label=label, name=name, time="{time}"), mark=button["mark"],
                                note_in={lang: pressed(word, name, "{time}", lang) for lang, word in labels.items()})
        # the press, for the fault's card in the Kiosk (notice.Notices.story; owner, 2026-10-14)
        note_press(self.state, int(iid), label, name, button["mark"], button["option"], labels)
        # ⚠️ TOLD TO THE AI (owner, 2026-10-23): a press goes to the agent, never into the conversation — the AI could
        # say an alert waits for an answer that was given here a minute before
        if self.facts is not None:
            self.facts.pressed(int(chat), label, f"alert {self.thread.name(iid)}", name)
        if self.run_job:
            # `text`: the label, for a skill.yaml from before `buttons` (its on_reply reads `--text {text}`)
            await self.run_job(skill, skill.on_reply, limit(
                "alerts.reply_hook_timeout_s", 120, unit="seconds", group="run", lo=10, hi=1800,
                says="How long a skill may take to handle a button pressed under an alert.",
                reached="That handling stops and counts as failed; the press itself is recorded.", told="person"), {"incident": iid, "option": button["option"], "text": label,
                                                             "role": person.role, "name": name}, Origin(chat))
