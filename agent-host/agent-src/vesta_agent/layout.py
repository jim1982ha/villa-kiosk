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


#: What the middle (the alert, the action) always keeps, however long the head's history and the status are.
MIDDLE_FLOOR = 300


def render(p: dict, limit: int | None = None) -> str:
    """The text Telegram shows: head, then lead and body, then status — each under a line, in ONE message of `limit`
    characters (4,096; a photo's or a file's caption 1,024 — the message's own `limit` when it recorded one). The status is
    kept whole and the head's first line too; the head's oldest history lines go first when room is short (replaced by
    "… N earlier"), then the middle is shortened (architecture review 15, 20).

    ⚠️ NEVER A NEGATIVE ROOM (architecture review 20): a head and a status longer than the limit asked fit() for a negative
    size, which never returns — the agent would have stopped answering."""
    limit = int(limit or p.get("limit") or TELEGRAM_LIMIT)
    status = fit((p.get("status") or "").strip(), max(limit // 4, 40))
    lines = [x for x in (p.get("head") or "").strip().split("\n") if x]
    middle = "\n".join(x.strip() for x in (p.get("lead"), p.get("body")) if x and x.strip())
    floor = min(MIDDLE_FLOOR, tg_len(middle))
    dropped, head_cap = 0, max(limit // 2, 40)        # the head never takes more than half the message

    def joined() -> str:                               # the head as sent: "… N earlier notices" under its first line
        more = [f"… {dropped} earlier notice{'s' if dropped > 1 else ''}"] if dropped else []
        return "\n".join(lines[:1] + more + lines[1:])
    while len(lines) > 1 and (tg_len(joined()) > head_cap or tg_len(joined()) + tg_len(status) + 2 * len(SEP) + floor > limit):
        lines.pop(1)                                   # the oldest notice of the history first
        dropped += 1
    head = fit(joined(), head_cap) if lines else ""
    room = max(limit - tg_len(head) - tg_len(status) - 2 * len(SEP), 20)
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
