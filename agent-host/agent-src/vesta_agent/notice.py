"""A message the agent sends on its own — an alert, its reminder or escalation, a night check's finding, a report —
and the one heading every such message carries (owner, 2026-10-10):

    For: Jean-Marie, Fabien_FM, P1 Incident: Follow Up #9
    First time seen on 09/10/2026 13:12, to Jean-Marie, Fabien_FM
    Escalated on 09/10/2026 13:27, to Fabien
    -------
    <the message>

`For` names the people of the message's role (`to`: owner or fm) as the Rules page's People list names them — never a
group, which is only where they read it; without a role, the people of the roles the chat is listed with. The incident part, when the
message is about one: "New" for its first notice, "Follow Up" after; then one line per earlier notice — when, of what
kind, to whom — whatever chat it went to (each chat keeps only an incident's latest message: incident_thread.py). A
reply to a person in a chat carries none: it answers them.

⚠️ ONE PLACE (owner, 2026-10-10: "coded in the simplest possible way, DRY"). The incident's line was written by the
skill ("Incident #9 · Still there…"), its earlier messages by the thread ("Earlier messages: …") and nothing at all
named who a message was for. The skill now writes only what happened; this writes the rest, for every skill.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from vesta_shared.messaging import RULE  # the one line between a notice's parts

#: A notice's kind (vesta_shared.result.message `stage`), as its history line says it.
STAGES = {"new": "First time seen", "reminder": "Reminded", "escalated": "Escalated", "update": "Updated"}
#: A role in a heading when no person of it is listed (owner, 2026-10-10: "the Facility Manager", capitals)
ROLE_WORDS = {"owner": "the Owner", "fm": "the Facility Manager"}
WHEN = "%d/%m/%Y %H:%M"


def when(at: datetime, zone: str) -> str:
    """A moment as every notice says it: 09/10/2026 13:12, in the villa's time."""
    return at.astimezone(ZoneInfo(zone)).strftime(WHEN)


class Notices:
    def __init__(self, state, policy: Callable, timezone_name: str, severity: Callable[[int], str | None] | None = None):
        self.state, self.policy, self.tz = state, policy, timezone_name
        # an incident's priority (P1…P4) as its skill stored it: "P2 Incident: New #18" (owner, 2026-10-10)
        self.severity = severity or (lambda _iid: None)

    def _for(self, chat: int, to=None) -> list[str]:
        """Who a notice to `chat` is for: the People list's persons of the roles `to` (a role, or every role the copy went
        there for: outcome merges them), else of the chat's roles; the role itself when no person of it is listed."""
        pol = self.policy()
        wanted = {to} if isinstance(to, str) else set(to or ())
        roles = (wanted & set(ROLE_WORDS)) or pol.roles_in(chat)
        return pol.names_for(roles) or [ROLE_WORDS[r] for r in sorted(roles)]

    def heading(self, chat: int, incident: int | None = None, to=None) -> str:
        """The heading of a notice to `chat` (about `incident`), as it stands before this notice is recorded."""
        head = f"For: {', '.join(self._for(chat, to)) or 'this chat'}"
        lines = []
        if incident is not None:
            history = self.state.incident_history(incident)
            try:
                p = self.severity(int(incident))
            except Exception:  # noqa: BLE001 — the heading is written without its priority, never not at all
                p = None
            head += f", {f'{p} ' if p else ''}Incident: {'Follow Up' if history else 'New'} #{incident}"
            lines = [f"{STAGES.get(h.get('stage'), 'Sent')} on {when(datetime.fromisoformat(h['at']), self.tz)}, "
                     f"to {', '.join(h.get('to') or []) or 'nobody'}" for h in history]
        return "\n".join([head, *lines, RULE])

    def compose(self, chat: int, text: str, incident: int | None = None, to=None) -> str:
        """`text` under its heading; `to`: the role (or roles) it is for."""
        return f"{self.heading(chat, incident, to)}\n{text}"

    def record(self, incident: int, stage: str | None, sent: list[tuple[int, object]], at: datetime | None = None) -> None:
        """A notice about `incident` went to `sent` — (chat, the role or roles it was for) — one result's messages being one
        notice: its history line. `stage` unset: "new" for the first, "update" after."""
        history = self.state.incident_history(incident)
        names = list(dict.fromkeys(n for c, to in sent for n in self._for(c, to)))
        history.append({"at": (at or datetime.now(timezone.utc)).isoformat(),
                        "stage": stage if stage in STAGES else ("update" if history else "new"), "to": names})
        self.state.set_incident_history(incident, history[-20:])
