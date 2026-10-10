"""A message's layout: the one place that says how a message of the agent's is laid out, and how it changes.

    For: JM, P2 Incident: Follow Up #18        ← head: who it is for, the incident, its history (notice.Notices)
    -------
    Intrusion suspected: 2 sensors in 5 min    ← lead: why it is asked (kept when the body changes)
    Turn on Siren?                             ← body: the alert, the action — or what became of it
    -------
    Waiting for approval by the owner (…)      ← status: where it stands, replaced by a press, an expiry, a clearing

⚠️ PARTS, NEVER A RE-CUT TEXT (architecture review 19, 2026-10-10). A message was sent as one text and cut apart again at
its "-------" lines to be updated: an approved siren request lost its intrusion warning (the warning and the action were
one middle part, replaced whole), an alert whose own text holds a "-------" line lost its end at a press, and a copy
without a heading had two statuses stacked. The thread's record now keeps the parts; a change replaces one part and
renders the message again. `legacy` reads a record written before (0.12.141 and earlier) — once, when it changes.
"""
from __future__ import annotations

from vesta_shared.messaging import RULE, TELEGRAM_LIMIT, tg_len

from .delivery import fit

SEP = f"\n{RULE}\n"
PARTS = ("head", "lead", "body", "status")


def parts(body: str = "", status: str = "", head: str = "", lead: str = "") -> dict:
    """A message as its parts (any may be empty)."""
    return {"head": head or "", "lead": lead or "", "body": body or "", "status": status or ""}


def render(p: dict) -> str:
    """The text Telegram shows: head, then lead and body, then status — each under a line. The head and the status are
    kept whole; the middle is shortened to fit Telegram's 4,096 characters (architecture review 15)."""
    head, status = (p.get("head") or "").strip(), (p.get("status") or "").strip()
    middle = "\n".join(x.strip() for x in (p.get("lead"), p.get("body")) if x and x.strip())
    room = TELEGRAM_LIMIT - tg_len(head) - tg_len(status) - 2 * len(SEP)
    return SEP.join(x for x in (head, fit(middle, room) if middle else "", status) if x)


def changed(p: dict, *, status: str | None = None, body: str | None = None) -> dict:
    """The same message with a new status and/or body; its head and lead kept."""
    return {**parts(), **p, **({"status": status} if status is not None else {}), **({"body": body} if body is not None else {})}


def legacy(text: str) -> dict:
    """The parts of a message recorded as text only (before 0.12.142): its head when it starts with "For: ", its status
    when it has three parts. Read once, when that message changes; never for a message sent since."""
    pieces = (text or "").rstrip().split(SEP)
    head = pieces.pop(0) if len(pieces) > 1 and pieces[0].startswith("For: ") else ""
    status = pieces.pop() if len(pieces) > 1 else ""
    return parts(body=SEP.join(pieces), status=status, head=head)


def of(record: dict) -> dict:
    """A thread record's parts (its own, or read from its text when it predates them)."""
    return {**parts(), **record["parts"]} if isinstance(record.get("parts"), dict) else legacy(record.get("text") or "")
