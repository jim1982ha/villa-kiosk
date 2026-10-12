"""A message the agent sends on its own — an alert, its reminder or escalation, a night check's finding, a report —
and the one heading every such message carries (owner, 2026-10-11, the order and shape the owner drew):

    #9-P1 (existing)                          ← underlined (vesta_shared.message_format: the one shape and style)
    To: Jean-Marie, Fabien_FM
    <the alert>                               ← as a quote
    (empty line)
    Status:
    - Alert sent 09/10/2026 13:12 to Jean-Marie, Fabien_FM        ← a quote, in italics
    - Escalation sent 09/10/2026 13:27 to Fabien
    (empty line)
    ⚠️ ⚙️ Reminder: no answer after 15 min                         ← a quote, in italics

A message about no incident is headed the same way, by its title (owner, 2026-10-12: one layout):

    Approval request
    To: Jean-Marie

"To" names the people of the message's role (`to`: owner or fm) as the Rules page's People list names them — never a
group, which is only where they read it; without a role, the people of the roles the chat is listed with. In a private
chat, the one person whose chat it is. The title says "new" for an incident's first notice, "closed" for the one that
ends it, "existing" otherwise; then one line per earlier notice — what, when, to whom — whatever chat it went to (each
chat keeps only an incident's latest message: incident_thread.py). A reply to a person in a chat carries none: it
answers them.

⚠️ ONE PLACE (owner, 2026-10-10: "coded in the simplest possible way, DRY"). The incident's line was written by the
skill ("Incident #9 · Still there…"), its earlier messages by the thread ("Earlier messages: …") and nothing at all
named who a message was for. The skill now writes only what happened; this writes the rest, for every skill.
"""
from __future__ import annotations

import re

from vesta_shared.message_format import INCIDENT_TITLE, TO, UNTITLED, titled
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
#: A role in a heading when no person of it is listed (owner, 2026-10-10: "the Facility Manager", capitals)
ROLE_WORDS = {"owner": "the Owner", "fm": "the Facility Manager"}
WHEN = "%d/%m/%Y %H:%M"
#: An incident's history kept: its first notice, a line counting those dropped, and the latest ones (review 28: after
#: 20 notices the first alert vanished without a word).
HISTORY_KEPT = 20


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

    def _for(self, chat: int, to=None) -> list[str]:
        """Who a notice to `chat` is for: the People list's persons of the roles `to` (a role, or every role the copy went
        there for: outcome merges them), else of the chat's roles; the role itself when no person of it is listed."""
        pol = self.policy()
        wanted = {to} if isinstance(to, str) else set(to or ())
        roles = (wanted & set(ROLE_WORDS)) or pol.roles_in(chat)
        if int(chat) > 0:
            # ⚠️ A PRIVATE CHAT IS ONE PERSON'S (owner, 2026-10-10: "why was this message addressed to Fabien, since it's a
            # direct request from my personal chat?"): the reader is named, never every person of the role
            own = list(dict.fromkeys(e.name for e in pol.entries if e.telegram_id == int(chat) and (e.role in roles or not roles)))
            if len(own) == 1:
                return own
            p = pol.person(chat)                       # listed in both roles, the copy for both: the one person, once
            if p is not None:
                return [p.name]
        return pol.names_for(roles) or [ROLE_WORDS[r] for r in sorted(roles)]

    def recipients(self, chat: int, to=None) -> list[str]:
        """Who a message to `chat` is for, as its "To:" line names them (a report's: message_format.fill_to)."""
        return self._for(chat, to)

    def heading(self, chat: int, incident: int | None = None, to=None, stage: str | None = None,
                also: list[str] | None = None, title: str | None = None) -> str:
        """The heading of a notice to `chat` (about `incident`), as it stands before this notice is recorded — its lines,
        which the layout places (layout.py: the title and "To …:" on top, the history under "Status:"):

            #9-P2 (existing)            the incident, its priority, and "new" / "existing" / "closed" (`stage`)
            To: Jim                     who this message is for
            - Alert sent 11/10/2026 09:57 to Jim, Fabien     one line per earlier notice
            - Escalation sent 11/10/2026 10:27 to Jim

        "To:" names everyone the incident went to — every earlier notice's people, and `also`, this notice's — the same
        line in every chat (owner, 2026-10-11: one incident, one picture; it named only the chat's reader before).
        A message about no incident: its `title` (UNTITLED when it has none), and "To:" naming `also`, else the chat's
        people of `to`."""
        who = ', '.join(self._for(chat, to)) or 'this chat'
        if incident is None:
            return titled(title or UNTITLED, list(also or []) or self._for(chat, to), "")
        history = self.state.incident_history(incident)
        everyone = list(dict.fromkeys([n for h in history for n in self._names(h)] + list(also or [])))
        who = ', '.join(everyone) or who
        try:
            p = self.severity(int(incident))
        except Exception:  # noqa: BLE001 — the heading is written without its priority, never not at all
            p = None
        word = self.word(int(incident), stage, bool(history))
        lines = [f"- … {h['dropped']} earlier notice{'s' if h['dropped'] > 1 else ''}" if h.get("dropped") else
                 f"- {STAGES.get(h.get('stage'), 'Sent')} {when(datetime.fromisoformat(h['at']), self.tz)} "
                 f"to {', '.join(self._names(h)) or 'nobody'}" for h in history]
        return "\n".join([f"{incident_tag(incident)}{f'-{p}' if p else ''} ({word})", f"{TO}{who}", *lines])

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
        notice: its history line. `stage` unset: "new" for the first, "update" after."""
        history = self.state.incident_history(incident)
        names = list(dict.fromkeys(n for c, to in sent for n in self._for(c, to)))
        chats = [[int(c), sorted([to] if isinstance(to, str) else (to or []))] for c, to in sent]
        history.append({"at": (at or datetime.now(timezone.utc)).isoformat(), "chats": chats,
                        "stage": stage if stage in STAGES else ("update" if history else "new"), "to": names})
        self.state.set_incident_history(incident, _kept(history))

    def _names(self, h: dict) -> list[str]:
        """Who a history line's notice went to, as the People list names them NOW — a person removed from it is no
        longer named (review 28: "To: Fabien, Ketut, Made" after Ketut left); the names written then, for a line
        recorded before 0.12.152 or a chat no longer listed."""
        out = []
        for chat, roles in h.get("chats") or []:
            try:
                out += self._for(int(chat), roles or None) if self.policy().knows_chat(int(chat)) else []
            except Exception:  # noqa: BLE001 — a policy that cannot be read: the names written then
                return list(h.get("to") or [])
        return list(dict.fromkeys(out)) if h.get("chats") else list(h.get("to") or [])
