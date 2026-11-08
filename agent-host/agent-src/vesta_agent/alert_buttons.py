"""The alert buttons — the skill's own (skill.yaml `buttons`) — on a message, and what a press does.

Taken out of outcome.py (architecture review, 2026-10-07): `keyboard` puts the buttons on an alert, `press` answers a
press through the skill's on_reply. What a chat shows of an incident — which message, replaced or settled — is
incident_thread.IncidentThread's (architecture review 12, 2026-10-09).
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from vesta_shared.message_format import ON_TABLET, ON_TELEGRAM, PRESSED
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
BEFORE_BUTTONS = [{"option": "done", "label": "Done", "mark": None, "closes": True, "tells": True},
                  {"option": "need_help", "label": "Need help", "mark": "help", "closes": False, "tells": False}]
#: The buttons an older message may still show: a press says what to use instead, never "Unknown button."
RETIRED = {"not_found", "mute"}


class AlertButtons:
    def __init__(self, *, state, skills, incidents: Incidents, thread, run_job: Callable[..., Awaitable] | None = None,
                 facts=None, siren: Callable[[int, int], dict | None] | None = None):
        self.state = state
        # visit.Visits.siren: the siren's question waiting on a visit's card in a chat; None: no visit asks one
        self.siren = siren
        self.facts = facts              # chat_facts.ChatFacts: the press is told to the AI with the chat's next message
        self.skills = skills
        self.incidents = incidents      # the alert desk's incidents, as the engine reads them (built once, by app)
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident
        self.run_job = run_job          # (skill, command, timeout, values, origin) -> result: the on_reply hook
        self._pressing: set[str] = set()   # the incidents whose press is being handled now (one at a time, anywhere)

    def open(self, iid: int | str) -> bool:
        """Is incident `iid` still waiting for an answer (incidents.Incidents)? Its messages then carry the buttons."""
        return self.incidents.awaiting_answer(iid)

    @staticmethod
    def of(skill) -> list[dict]:
        """The buttons `skill` puts under an alert: its own, or those of a skill.yaml from before they were declared."""
        return getattr(skill, "buttons", None) or BEFORE_BUTTONS

    def offered(self, skill, iid: int | str) -> list[dict]:
        """The buttons `skill` offers under incident `iid` now: its own, less those offered only until it is taken on
        (skill.yaml `until: taken`) once someone took it on (Incidents.taken). ⚠️ AS ON THE TABLET (owner, 2026-11-05):
        a ticket in progress keeps Done and Need help; Not a problem and Open Ticket no longer apply."""
        taken = self.incidents.taken(iid)
        return [b for b in self.of(skill) if not (taken and b.get("until") == "taken")]

    def keyboard(self, iid: int, chat: int, skill_name: str) -> dict:
        """The buttons of incident `iid`, for a message to `chat` from `skill_name` (whose on_reply answers them)."""
        self.state.set_alert_skill(iid, chat, skill_name)
        return {"inline_keyboard": [[{"text": b["label"], "callback_data": button_data.make(button_data.ALERT, iid, b["option"])}
                                     for b in self.offered(self.skills.get(skill_name), iid)], *self._siren_row(iid, chat),
                                    *self._photos_row(iid, chat)]}

    def _siren_row(self, iid: int, chat: int) -> list[list[dict]]:
        """⚠️ THE SIREN'S QUESTION ON THE ALERT ITSELF (owner, 2026-11-08, visit #154): while it waits, "🚨 Sound siren"
        and "No siren" on a row of their own under a visit's card, in the chat's language (the desk's words: visit.Visits
        .offered keeps them) — in the chats it was asked in only (the owner's; never a facility manager's copy, never the
        tablet: kiosk_messages.of_parts). They are the approval's own buttons (button_data.APPROVAL): only an owner's own
        press sounds the siren (actions.decide). Gone once it is decided, expired or withdrawn (no longer pending)."""
        q = self.siren(iid, chat) if self.siren is not None else None
        if not q:
            return []
        b, lang = q["buttons"], self.thread.words.lang(chat) if hasattr(self.thread.words, "lang") else "en"
        return [[{"text": ((b.get(yn) or {}).get("labels") or {}).get(lang) or (b.get(yn) or {}).get("label") or word,
                  "callback_data": button_data.make(button_data.APPROVAL, q["id"], yn)}
                 for yn, word in (("y", "Sound siren"), ("n", "No siren"))]]

    def _photos_row(self, iid: int, chat: int) -> list[list[dict]]:
        """⚠️ EVERY PHOTO OF A VISIT, ON ASK (owner, 2026-11-07): the card's picture holds at most visit.sheet_tiles small
        tiles; a visit with two photos or more gets a row of its own under the alert's buttons that sends them all, whole,
        in the chat pressed (visit.Visits.album). Its words are the desk's (result.sheet `button`), in the chat's language."""
        rec = self.state.visit_photos(iid)
        b = rec.get("button") or {}
        if not b.get("label") or len(rec.get("photos") or []) + len(self.state.visit_snaps(iid)) < 2:
            return []
        lang = self.thread.words.lang(chat) if hasattr(self.thread.words, "lang") else "en"
        return [[{"text": (b.get("labels") or {}).get(lang) or b["label"],
                  "callback_data": button_data.make(button_data.PHOTOS, iid)}]]

    def still(self, iid: int | str, chat: int) -> dict | None:
        """The buttons incident `iid`'s copy in `chat` keeps now (its skill's, as offered), None when it is closed or no
        skill sent it there: a copy redrawn after a take-on (incident_thread.IncidentThread.restate)."""
        skill_name = self.state.alert_skill(iid, chat)
        if not skill_name or not self.open(iid) or not self.offered(self.skills.get(skill_name), iid):
            return None
        return self.keyboard(int(iid), chat, skill_name)

    async def press(self, chat: int, parts: list[str], person, toast: Callable[[str], Awaitable],
                    name: str | None = None, pressed: int | None = None, anywhere: bool = False) -> None:
        """A button on an alert (button_data: its incident and option; the presser is a registered person): the
        skill's on_reply decides, answering `here`. `pressed`: the message pressed (press.Press.mid). `anywhere`: pressed
        on the tablet's copy of the alert, which every chat's alert is (ticket 22 of "One inbox"): its skill is the one
        any chat's copy was sent by."""
        iid, opt = parts
        if not iid.isdigit():
            return await toast("Unknown button.")
        skill_name = self.state.alert_skill(iid, chat) or (next(
            (k for c in self.thread.shown(int(iid)) if (k := self.state.alert_skill(iid, c))), None) if anywhere else None)
        skill = self.skills.get(skill_name) if skill_name else None
        buttons = {b["option"]: b for b in self.offered(skill, iid)}
        if opt not in buttons:
            labels = [b["label"] for b in buttons.values()]
            offered = ", ".join(labels[:-1]) + " or " + labels[-1] if len(labels) > 1 else "".join(labels)
            return await toast(f"This button is no longer offered: press {offered}." if opt in RETIRED or skill
                               else "Unknown button.")
        if skill is None or not skill.on_reply:
            self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "not sent to this chat, or its skill is gone"})
            return await toast("This button belongs to another chat.")
        # ⚠️ ONE PRESS, ONE ANSWER (architecture review 15, 2026-10-10): approvals and Continue were taken once, the alert
        # buttons were not — a quick double tap on Done ran the skill's answer twice, and the second ("Already closed")
        # replaced the first in the chat; a double Need help told the owner twice. A press while one is handled, or on
        # an incident this chat already shows as settled, changes nothing.
        # ⚠️ ONE ANSWER WHEREVER IT IS PRESSED (architecture review, 2026-10-30): the tablet's chat has no copy of its own,
        # so "settled here" never held there — Need help on Telegram, then on the tablet, chased the owner twice; and
        # two presses in two places at once were each taken. Keyed by the incident; a press on the tablet's copy is
        # answered already once every copy of it is settled.
        key = str(iid)
        shown = self.thread.shown(int(iid))
        settled_everywhere = anywhere and bool(shown) and all((c or {}).get("settled") for c in shown.values())
        if key in self._pressing or (shown.get(int(chat)) or {}).get("settled") or settled_everywhere:
            self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "already answered"})
            return await toast("Already answered.")
        self._pressing.add(key)
        try:
            await self._answer(iid, buttons[opt], skill, chat, person, toast, name or person.name,
                               ON_TABLET if anywhere else ON_TELEGRAM)
        finally:
            self._pressing.discard(key)
        # ⚠️ THE COPY PRESSED MAY NOT BE THE ONE ON RECORD (architecture review scan 1, 2026-10-19: #55 twice in the
        # owner's group): every copy on record was settled above; a copy no record points to would keep its buttons
        # beside the answer — it goes now
        if pressed is not None:
            await self.thread.stray(int(iid), int(chat), int(pressed))

    async def _answer(self, iid: str, button: dict, skill, chat: int, person, toast, name: str,
                      place: str | None = None) -> None:
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
                                note_in={lang: pressed(word, name, "{time}", lang) for lang, word in labels.items()},
                                interim=True)
        # the press, for the fault's card in the Kiosk (notice.Notices.story; owner, 2026-10-14)
        # a take-on is said by its own step (restate's "Ticket opened by …"): no line of its own, as a close
        note_press(self.state, int(iid), label, name, button["mark"], bool(button.get("closes") or button.get("takes")),
                   labels, place=place or ON_TELEGRAM, told=bool(button.get("tells")))
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
                                                             "role": person.role, "name": name,
                                                             # where it was pressed: its Done says so ("Done on the tablet")
                                                             "place": place or ON_TELEGRAM}, Origin(chat))
