"""A message's layout: the one place that says how a message of the agent's is laid out, and how it changes.

    #18-P2 (existing)                          ← head: its title — the incident, or what it is ("Approval request")
    To: JM                                     ←       who it is for; then an incident's history (notice.Notices)
    Intrusion suspected: 2 sensors in 5 min    ← lead: why it is asked (kept when the body changes)
    Turn on Siren?                             ← body: the alert, the action — or what became of it
    (empty line)
    Status:                                    ← the history, then where it stands: replaced by a press, an expiry,
    ⚠️ Waiting for approval by the owner          a clearing

⚠️ ONE LAYOUT (owner, 2026-10-12: "make sure the formatting is uniquely and centrally defined"). An alert was laid out in
the shape above, but every other message the agent sent on its own (an approval request, "the siren cannot be
requested", a person Telegram refuses) went as "For: JM / ------- / … / ------- / status" — a shape Telegram's style
table (vesta_shared.message_format) does not know, so it arrived with no underline, no quote, no italics. Every message
is now `message_format.document`; one without a heading (an answer to the person who asked) is its text and "Status:".

⚠️ PARTS, NEVER A RE-CUT TEXT (architecture review 19, 2026-10-10). A message was sent as one text and cut apart again to
be updated: an approved siren request lost its intrusion warning. The thread's record keeps the parts; a change replaces
one part and renders the message again. `legacy` reads a record written before (0.12.141 and earlier) — once, when it
changes; a "For: …" heading recorded before 0.12.175 is laid out under UNTITLED.
"""
from __future__ import annotations


from vesta_shared.message_format import (INCIDENT_TITLE, MARK_ICONS, STAGE_ICONS, STAGE_WORDS, STATUS, TO, UNTITLED, document,
                                         parts as shape_parts)
from vesta_shared.messaging import TELEGRAM_LIMIT, tg_len

from .delivery import fit

#: The line a message recorded before 0.12.142 was cut at (its heading, its alert, its status): read by `legacy` only.
OLD_RULE = "\n-------\n"
#: A heading recorded before 0.12.175: "For: JM".
OLD_FOR = "For: "
PARTS = ("head", "lead", "body", "status", "mark")

#: An incident message's stage, as its title says it, shown again at the head of its bottom line (owner, 2026-10-11:
#: "clearly see if this message is a new alert, a follow-up, or a closure — no more follow-up expected"). Taken from the
#: title's word (notice.Notices), never decided twice: a copy retitled "(closed)" shows ✅ at once. STAGE_ICONS,
#: STAGE_WORDS and MARK_ICONS (a person pressed Need help; closed, but VESTA could not check it) live in
#: vesta_shared.message_format, the one place of the messages' shape and style.
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
    """The text Telegram shows, in ONE message of `limit` characters (4,096; a photo's or a file's caption 1,024 — the
    message's own `limit` when it recorded one): the title and "To: …", the lead and body, then "Status:" with the
    history and where it stands (message_format.document). Without a heading (an answer to the person who asked): the
    text, then "Status:". The status and the title are kept whole; the oldest history lines go first when room is short
    ("- … N earlier notices"), then the middle is shortened (architecture review 15, 20).

    ⚠️ NEVER A NEGATIVE ROOM (architecture review 20): a heading and a status longer than the limit asked fit() for a
    negative size, which never returns — the agent would have stopped answering."""
    limit = int(limit or p.get("limit") or TELEGRAM_LIMIT)
    status = fit(stage_line(p.get("head") or "", (p.get("status") or "").strip(), p.get("mark")), max(limit // 4, 40))
    lines = [x for x in (p.get("head") or "").strip().split("\n") if x]
    if lines and lines[0].startswith(OLD_FOR):
        lines = [UNTITLED, TO + lines[0][len(OLD_FOR):]] + lines[1:]
    middle = "\n".join(x.strip() for x in (p.get("lead"), p.get("body")) if x and x.strip())
    if not lines:
        tail = f"\n\n{STATUS}:\n{status}" if status else ""
        return fit(middle, max(limit - tg_len(tail), 20)) + tail if middle else tail.lstrip("\n")
    title, to, history = lines[0], (lines[1] if len(lines) > 1 else TO), lines[2:]
    to = to[len(TO):] if to.startswith(TO) else to.removeprefix(TO.strip()).strip()
    floor, dropped, cap = min(MIDDLE_FLOOR, tg_len(middle)), 0, None

    def framed(mid: str) -> str:
        more = [f"- … {dropped} earlier notice{'s' if dropped > 1 else ''}"] if dropped else []
        hist = "\n".join(history[:1] + more + history[1:])
        return document(title, to, [(None, [mid]), (STATUS, [fit(hist, cap) if cap and hist else hist, status])])
    while len(history) > 1 and tg_len(framed("")) + floor > limit:
        history.pop(1)                                 # the oldest after the first notice, which always stays
        dropped += 1
    if tg_len(framed("")) + floor > limit:
        cap = max(limit // 2, 40)                      # one history line longer than half the message: cut itself
    room = max(limit - tg_len(framed("")) - 1, 20)
    return framed(fit(middle, room) if middle else "")


def changed(p: dict, *, status: str | None = None, body: str | None = None, mark: str | None = None) -> dict:
    """The same message with a new status and/or body; its head and lead kept. A new status brings its own `mark`
    (none: the stage's icon) — a "Need help" status replaced by "Done pressed …" is no longer 🆘."""
    return {**parts(), **p, **({"status": status, "mark": mark} if status is not None else {}),
            **({"body": body} if body is not None else {})}


def legacy(text: str) -> dict:
    """The parts of a message recorded as text only: in the one shape (its title and "To:" its head, its last "Status:"
    block its status), or cut at "-------" lines (before 0.12.142: its head when it starts with "For: ", its status when
    it has three parts). Read once, when that message changes; never for a message sent since."""
    text = (text or "").rstrip()
    if shape_parts(text):
        title, _, rest = text.partition("\n")
        to, _, rest = rest.partition("\n")
        probe = "\n\n" + rest
        at = probe.rfind(f"\n\n{STATUS}:\n")
        body, notes = (probe[:at], probe[at + len(STATUS) + 4:]) if at >= 0 else (rest, "")
        blocks = [x for x in notes.split("\n\n") if x.strip()]
        history = blocks[0] if blocks and blocks[0].startswith("- ") else ""
        status = blocks[-1] if blocks and blocks[-1] != history else ""
        return parts(body=body.strip("\n"), status=status, head="\n".join(x for x in (title, to, history) if x))
    pieces = text.split(OLD_RULE)
    head = pieces.pop(0) if len(pieces) > 1 and pieces[0].startswith(OLD_FOR) else ""
    status = pieces.pop() if len(pieces) > 1 else ""
    return parts(body=OLD_RULE.join(pieces), status=status, head=head)


def of(record: dict) -> dict:
    """A thread record's parts (its own, or read from its text when it predates them)."""
    return {**parts(), **record["parts"]} if isinstance(record.get("parts"), dict) else legacy(record.get("text") or "")
