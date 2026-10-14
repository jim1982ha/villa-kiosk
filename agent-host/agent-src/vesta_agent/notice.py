"""A message the agent sends on its own — an alert, its reminder or escalation, a night check's finding, a report —
and the one heading every such message carries (owner, 2026-10-11, the order and shape the owner drew):

    #9-P1 (existing)                          ← in bold (vesta_shared.message_format: the one shape and style)
    To: Owner & Facility Manager
    <the alert>                               ← as a quote
    (empty line)
    Status:
    - Alert sent 09/10/2026 13:12 to Owner & Facility Manager     ← a quote, in italics
    - Escalation sent 09/10/2026 13:27 to Owner
    ⚠️ ⚙️ Reminder: no answer after 15 min                         ← the same quote: history and where it stands

A message about no incident is headed the same way, by its title (owner, 2026-10-12: one layout):

    Approval request
    To: Owner

"To" names the ROLES a message is for (message_format.audience: "Owner", "Facility Manager", "Owner & Facility
Manager") — the message's role (`to`: owner or fm), else the roles the chat is listed with; never a person's name
(owner, 2026-10-13: "To: Fabien, JM" became "To: Facility Manager"). The title says "new" for an incident's first notice, "closed" for the one that
ends it, "existing" otherwise; then one line per earlier notice — what, when, to whom — whatever chat it went to (each
chat keeps only an incident's latest message: incident_thread.py). A reply to a person in a chat carries none: it
answers them.

⚠️ ONE PLACE (owner, 2026-10-10: "coded in the simplest possible way, DRY"). The incident's line was written by the
skill ("Incident #9 · Still there…"), its earlier messages by the thread ("Earlier messages: …") and nothing at all
named who a message was for. The skill now writes only what happened; this writes the rest, for every skill.
"""
from __future__ import annotations

import re

from vesta_shared.message_format import INCIDENT_TITLE, MARK_ICONS, ROLE_WORDS, TO, UNTITLED, audience, titled
from vesta_shared.messaging import incident_tag
from vesta_shared.timeutil import moment_label

from datetime import datetime, timezone
from typing import Callable
from zoneinfo import ZoneInfo


#: A notice's kind (vesta_shared.result.message `stage`), as its history line says it.
#: ⚠️ WHAT WAS SENT, TO WHOM (owner, 2026-10-11, the laundry door's #21: "redundant and at different places, hard to
#: understand"): "First time seen on …, to the Owner" read as who had seen it; "For: the Owner, P2 Incident" as a list.
STAGES = {"new": "Alert sent", "reminder": "Reminder sent", "escalated": "Escalation sent", "update": "Update sent",
          "back": "Came-back alert sent", "still": "Still-there alert sent", "reopened": "Reopen request sent",
          "closed": "Closing note sent"}
#: The title's word for a notice of this stage (owner, 2026-10-11: a closing message headed "New #9" — "is it a
#: closure or not?"; then: "mention if it's a new or an existing alert, no more Follow Up wording anywhere"): the
#: message says what IT is; a notice without a stage goes by the incident's history.
HEAD_WORDS = {"new": "new", "closed": "closed"}
EXISTING = "existing"
#: An incident's history kept: its first notice, a line counting those dropped, and the latest ones (review 28: after
#: 20 notices the first alert vanished without a word).
HISTORY_KEPT = 20


#: The notices a fault's card in the Kiosk tells too (a "noted" step each, tickets.repair): what chased or escalated it,
#: or brought it back — never the first alert (the fault itself) nor the closing (its close step says it).
NOTED_STAGES = ("reminder", "escalated", "still", "back", "reopened")
#: A button pressed on an alert, in its history for the Kiosk's card only (Telegram shows it as the message's footer).
PRESSED_STAGE = "pressed"


def note_press(state, incident: int, label: str, name: str, mark: str | None = None, option: str = "") -> None:
    """A button pressed on incident `incident`'s alert, kept in its history (the Kiosk's card says it: Notices.story).
    Done is not kept: the fault's close says "Done by … on Telegram." already."""
    if option == "done":
        return
    history = state.incident_history(incident)
    history.append({"at": datetime.now(timezone.utc).isoformat(), "stage": PRESSED_STAGE, "label": label,
                    "name": name, **({"mark": mark} if mark else {})})
    state.set_incident_history(incident, _kept(history))


def note_step(state, incident: int, stage: str, note: str) -> None:
    """A step of incident `incident` that is not a notice sent — someone took it on in the Kiosk ("taken") — kept in its
    history in its own words, so a later "Status:" still lists it (owner, 2026-10-15)."""
    history = state.incident_history(incident)
    history.append({"at": datetime.now(timezone.utc).isoformat(), "stage": stage, "note": note.rstrip(".")})
    state.set_incident_history(incident, _kept(history))


def _kept(history: list[dict]) -> list[dict]:
    """The history with its first notice always kept and the dropped ones counted ("- … 3 earlier notices")."""
    if len(history) <= HISTORY_KEPT:
        return history
    first, rest = history[0], history[1:]
    dropped = sum(h.get("dropped", 1) if h.get("dropped") else 0 for h in rest)
    rest = [h for h in rest if not h.get("dropped")]
    cut = len(rest) - (HISTORY_KEPT - 2)
    return [first, {"dropped": dropped + cut}] + rest[cut:]


def when(at: datetime, zone: str) -> str:
    """A moment as every notice says it: 09/10/2026 13:12, in the villa's time (timeutil.moment_label: one format)."""
    return moment_label(at, zone)


class Notices:
    def __init__(self, state, policy: Callable, timezone_name: str, severity: Callable[[int], str | None] | None = None,
                 closed: Callable[[int], bool] | None = None):
        self.state, self.policy, self.tz = state, policy, timezone_name
        # an incident's priority (P1…P4) as its skill stored it: "P2 Incident: New #18" (owner, 2026-10-10)
        self.severity = severity or (lambda _iid: None)
        # whether an incident is closed as its skill stored it: its copies are headed "Closed" (architecture review 25)
        self.closed = closed or (lambda _iid: False)

    def roles_for(self, chat: int, to=None) -> set[str]:
        """The roles a notice to `chat` is for: `to` (a role, or every role the copy went there for: outcome merges
        them), else the roles the chat is listed with — for a private chat listed with none, its person's role."""
        wanted = {to} if isinstance(to, str) else set(to or ())
        roles = wanted & set(ROLE_WORDS)
        if roles:
            return roles
        pol = self.policy()
        roles = pol.roles_in(chat)
        if not roles and int(chat) > 0 and pol.person(chat) is not None:
            roles = {pol.person(chat).role}
        return roles & set(ROLE_WORDS)

    def heading(self, chat: int, incident: int | None = None, to=None, stage: str | None = None,
                also=None, title: str | None = None) -> str:
        """The heading of a notice to `chat` (about `incident`), as it stands before this notice is recorded — its lines,
        which the layout places (layout.py: the title and "To …:" on top, the history under "Status:"):

            #9-P2 (existing)            the incident, its priority, and "new" / "existing" / "closed" (`stage`)
            To: Owner & Facility Manager                      who this message is for
            - Alert sent 11/10/2026 09:57 to Facility Manager      one line per earlier notice
            - Escalation sent 11/10/2026 10:27 to Owner

        "To:" names every role the incident went to — every earlier notice's, and `also` (roles), this notice's — the
        same line in every chat (owner, 2026-10-11: one incident, one picture). A message about no incident: its `title`
        (UNTITLED when it has none), and "To:" the roles of `also`, else the chat's of `to`."""
        if incident is None:
            return titled(title or UNTITLED, audience(set(also or ()) or self.roles_for(chat, to)), "")
        history = self.state.incident_history(incident)
        everyone = {r for h in history for r in self._roles(h)} | set(also or ())
        who = audience(everyone or self.roles_for(chat, to)) or "this chat"
        try:
            p = self.severity(int(incident))
        except Exception:  # noqa: BLE001 — the heading is written without its priority, never not at all
            p = None
        word = self.word(int(incident), stage, bool(history))
        lines = [f"- … {h['dropped']} earlier notice{'s' if h['dropped'] > 1 else ''}" if h.get("dropped") else
                 f"- {h['note']}" if h.get("note") else
                 f"- {self._pressed(h)} {when(datetime.fromisoformat(h['at']), self.tz)}" if h.get("stage") == PRESSED_STAGE else
                 f"- {STAGES.get(h.get('stage'), 'Sent')} {when(datetime.fromisoformat(h['at']), self.tz)} "
                 f"to {audience(self._roles(h)) or 'nobody'}" for h in history]
        return "\n".join([f"{incident_tag(incident)}{f'-{p}' if p else ''} ({word})", f"{TO}{who}", *lines])

    @staticmethod
    def _pressed(h: dict) -> str:
        """A press as every reader tells it — Telegram's Status and the Kiosk card: "🆘 Need help pressed by Fabien"."""
        return f"{MARK_ICONS.get(h.get('mark') or '', '')} {h.get('label')} pressed by {h.get('name')}".strip()

    def story(self, incident: int) -> list[dict]:
        """What a fault's card in the Kiosk tells of incident `incident`'s Telegram life, oldest first: [{at, note}] —
        "Reminder sent to Facility Manager", "🆘 Need help pressed by Fabien" — its time is the step's own (the Kiosk
        writes it). ⚠️ ONE STORY (architecture review, 2026-10-14): the card is told from the history Telegram's
        "Status:" is written from, never by a second writer."""
        out = []
        for h in self.state.incident_history(incident):
            if h.get("stage") in NOTED_STAGES:
                out.append({"at": h["at"], "note": f"{STAGES[h['stage']]} to {audience(self._roles(h)) or 'nobody'}"})
            elif h.get("stage") == PRESSED_STAGE:
                out.append({"at": h["at"], "note": self._pressed(h)})
        return out

    def word(self, incident: int, stage: str | None = None, history: bool = True) -> str:
        """The title's word for a notice about `incident`: what the notice is (`stage`) — else what the incident is
        (closed: "closed") — else "existing" once anything was sent about it, "new" before."""
        if stage:
            return HEAD_WORDS.get(stage, EXISTING)
        try:
            if self.closed(int(incident)):
                return "closed"
        except Exception:  # noqa: BLE001 — the heading is written without it, never not at all
            pass
        return EXISTING if history else "new"

    def retitle(self, incident, head: str, chat: int = 0) -> str:
        """A copy's heading as the incident stands now: an incident closed since is "closed" in every copy settled
        (architecture review 25: the owner's earlier copy kept "New #9" under "Cleared in Home Assistant on …")."""
        if not str(incident).isdigit() or not head:
            return head
        first, _, rest = head.partition("\n")
        if not INCIDENT_TITLE.fullmatch(first):
            # ⚠️ A COPY SENT BEFORE 0.12.152 ("For: Jim, P2 Incident: Follow Up #9") gets the new heading whole the
            # first time it changes (review 28: settled, it kept the old look with the new icons, the other chats the new)
            return self.heading(chat, int(incident))
        if self._is_closed(int(incident)):
            first = re.sub(r"^(#\d+(?:-P\d)?) \((new|existing|closed)\)$", r"\1 (closed)", first)
        return first + ("\n" + rest if rest else "")

    def _is_closed(self, incident: int) -> bool:
        try:
            return bool(self.closed(incident))
        except Exception:  # noqa: BLE001
            return False

    def record(self, incident: int, stage: str | None, sent: list[tuple[int, object]], at: datetime | None = None) -> None:
        """A notice about `incident` went to `sent` — (chat, the role or roles it was for) — one result's messages being one
        notice: its history line, each chat with the roles it was for. `stage` unset: "new" for the first, "update" after."""
        if stage == PRESSED_STAGE:
            # the answer to a press in its own chat: the press itself is the story's line (note_press) — recorded as
            # "Update sent", it told the same press as two events (architecture review, 2026-10-15)
            return
        history = self.state.incident_history(incident)
        chats = [[int(c), sorted(self.roles_for(c, to))] for c, to in sent]
        history.append({"at": (at or datetime.now(timezone.utc)).isoformat(), "chats": chats,
                        "stage": stage if stage in STAGES else ("update" if history else "new")})
        self.state.set_incident_history(incident, _kept(history))

    def _roles(self, h: dict) -> set[str]:
        """The roles a history line's notice went to, as recorded. A line recorded before 0.12.181 named people (`to`,
        or chats without their roles): their roles as the People list gives them now, a role's own word read back."""
        roles = {r for _chat, rs in h.get("chats") or [] for r in rs or ()}
        if roles:
            return roles & set(ROLE_WORDS)
        try:
            pol = self.policy()
            roles = {r for chat, _rs in h.get("chats") or [] for r in pol.roles_in(int(chat))}
            names = set(h.get("to") or [])
            roles |= {e.role for e in pol.entries if e.name in names}
        except Exception:  # noqa: BLE001 — a policy that cannot be read: the role words written then
            names = set(h.get("to") or [])
        words = {w.removeprefix("the ").lower(): r for r, w in ROLE_WORDS.items()}
        roles |= {words[n.removeprefix("the ").lower()] for n in names if n.removeprefix("the ").lower() in words}
        return roles & set(ROLE_WORDS)
