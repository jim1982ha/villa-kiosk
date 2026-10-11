"""A message's layout: the one place that says how a message of the agent's is laid out, and how it changes.

    P2 Incident #18 · Follow Up · for JM       ← head: the incident, who it is for, its history (notice.Notices)
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

import re

from vesta_shared.message_format import INCIDENT_TITLE, MARK_ICONS, STAGE_ICONS, STATUS, TO, document
from vesta_shared.messaging import RULE, TELEGRAM_LIMIT, tg_len

from .delivery import fit

SEP = f"\n{RULE}\n"
PARTS = ("head", "lead", "body", "status", "mark")

#: An incident message's stage, as its title says it, shown again at the head of its bottom line (owner, 2026-10-11:
#: "clearly see if this message is a new alert, a follow-up, or a closure — no more follow-up expected"). Taken from the
#: title's word (notice.Notices), never decided twice: a copy retitled "(closed)" shows ✅ at once. STAGE_ICONS and
#: MARK_ICONS (a person pressed Need help; closed, but VESTA could not check it) live in vesta_shared.message_format,
#: the one place of the messages' shape and style.
#: A bottom line for a stage that has none of its own: the first alert says only what Home Assistant said.
STAGE_WORDS = {"new": "New alert", "existing": "Still open", "closed": "Closed: nothing more to do"}
def _word(head: str) -> str | None:
    """The stage word of an incident message's heading ("new", "existing", "closed"); None for any other message (a
    copy sent before 0.12.152 gets the new heading the first time it changes: notice.Notices.retitle)."""
    m = INCIDENT_TITLE.fullmatch((head or "").split("\n", 1)[0])
    return m.group(1) if m else None


def stage_line(head: str, status: str, mark: str | None = None) -> str:
    """The bottom line with its icon, when the message is about an incident: "⚠️ New alert", "⚠️ ⚙️ Reminder: …",
    "🆘 Need help pressed by …", "✅ Cleared in Home Assistant on …", "☑️ Done pressed by …. Note: VESTA cannot check
    this one; …". Any other message's status as it is."""
    word = _word(head)
    if not word:
        return status
    icon = MARK_ICONS.get(mark or "") if not (mark == "unchecked" and word != "closed") else None
    return f"{icon or STAGE_ICONS[word]} {status or STAGE_WORDS[word]}"


def parts(body: str = "", status: str = "", head: str = "", lead: str = "", mark: str | None = None) -> dict:
    """A message as its parts (any may be empty); `mark`: what its status is beyond its stage (MARK_ICONS)."""
    return {"head": head or "", "lead": lead or "", "body": body or "", "status": status or "", "mark": mark}


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
    status = fit(stage_line(p.get("head") or "", (p.get("status") or "").strip(), p.get("mark")), max(limit // 4, 40))
    lines = [x for x in (p.get("head") or "").strip().split("\n") if x]
    if lines and INCIDENT_TITLE.fullmatch(lines[0]):
        return _incident(lines, p, status, limit)
    middle = "\n".join(x.strip() for x in (p.get("lead"), p.get("body")) if x and x.strip())
    floor = min(MIDDLE_FLOOR, tg_len(middle))
    dropped, head_cap = 0, max(limit // 2, 40)        # the head never takes more than half the message

    def joined() -> str:                               # the head as sent: "… N earlier notices" under its first line
        more = [f"- … {dropped} earlier notice{'s' if dropped > 1 else ''}"] if dropped else []
        return "\n".join(lines[:1] + more + lines[1:])
    while len(lines) > 1 and (tg_len(joined()) > head_cap or tg_len(joined()) + tg_len(status) + 2 * len(SEP) + floor > limit):
        lines.pop(1)                                   # the oldest notice of the history first
        dropped += 1
    head = fit(joined(), head_cap) if lines else ""
    room = max(limit - tg_len(head) - tg_len(status) - 2 * len(SEP), 20)
    return SEP.join(x for x in (head, fit(middle, room) if middle else "", status) if x)


def _incident(lines: list[str], p: dict, status: str, limit: int) -> str:
    """An alert in the owner's order (owner, 2026-10-11), written in the one shape (vesta_shared.message_format): its
    title and "To: …", the alert, then "Status:" with the history and where it stands. The oldest history lines go first
    when room is short ("- … N earlier notices"), then the alert is shortened."""
    title, to, history = lines[0], (lines[1] if len(lines) > 1 else TO), lines[2:]
    to = to[len(TO):] if to.startswith(TO) else to.removeprefix(TO.strip()).strip()
    middle = "\n".join(x.strip() for x in (p.get("lead"), p.get("body")) if x and x.strip())
    floor, dropped = min(MIDDLE_FLOOR, tg_len(middle)), 0

    def framed(mid: str) -> str:
        more = [f"- … {dropped} earlier notice{'s' if dropped > 1 else ''}"] if dropped else []
        hist = "\n".join(history[:1] + more + history[1:])
        return document(title, to, [(None, [mid]), (STATUS, [hist, status])])
    while len(history) > 1 and tg_len(framed("")) + floor > limit:
        history.pop(1)                                 # the oldest after the first alert, which always stays
        dropped += 1
    room = max(limit - tg_len(framed("")) - 1, 20)
    return framed(fit(middle, room) if middle else "")


def changed(p: dict, *, status: str | None = None, body: str | None = None, mark: str | None = None) -> dict:
    """The same message with a new status and/or body; its head and lead kept. A new status brings its own `mark`
    (none: the stage's icon) — a "Need help" status replaced by "Done pressed …" is no longer 🆘."""
    return {**parts(), **p, **({"status": status, "mark": mark} if status is not None else {}),
            **({"body": body} if body is not None else {})}


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
