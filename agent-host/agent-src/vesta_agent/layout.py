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

from datetime import datetime

from vesta_shared.message_format import (CLOSED_STAGES, INCIDENT_TITLE, MARK_ICONS, STAGE_ICONS, TO, UNTITLED, document,
                                         parts as shape_parts, status_head, STATUS_BREAK)
from vesta_shared import status_words
from vesta_shared.limits import limit
from vesta_shared.messaging import split_message, telegram_message_chars, tg_len
from vesta_shared.timeutil import moment_label


def fit(text: str, limit: int | None = None) -> str:
    """One message's text at most `limit` (Telegram's units; the villa's message limit by default), cut between lines
    with "…" — for an edit, which cannot be split as a send is (Delivery), and every part of a layout."""
    limit = limit or telegram_message_chars()
    if tg_len(text) <= limit:
        return text
    head = split_message(text, limit - 2)[0]
    return head.rstrip() + "\n…"


#: The line a message recorded before 0.12.142 was cut at (its heading, its alert, its status): read by `legacy` only.
OLD_RULE = "\n-------\n"
#: A heading recorded before 0.12.175: "For: JM".
OLD_FOR = "For: "
PARTS = ("head", "lead", "body", "status", "mark")


def fill_time(text: str | None, now: datetime, zone: str) -> str:
    """"{time}" in a message's text, status or note: the villa's time at `now`, as every notice writes a moment
    (10/10/2026 15:04, timeutil.moment_label). ⚠️ THE ONE PLACE (architecture review round 3, 2026-10-19): posting, the
    thread's close and restate, and a taken-over message each replaced it by hand."""
    return (text or "").replace("{time}", moment_label(now, zone))

def head(title: str, to: str = "", history=(), word: str | None = None, lang: str | None = None, story=None) -> dict:
    """A message's heading as facts, never as text: its `title` ("#9-P2", "Approval request"), who it is for (`to`,
    the "To:" line's words), an incident's `history` (its "- …" lines and dividers), for an incident, its title's
    `word` ("new", "existing", "closed": the title reads "#9-P2 (existing)") and the language its chat reads (`lang`,
    a code; none: English) — the Status section is drawn in it (status_words; owner, 2026-10-23). `story`: an
    incident's EVERY step, whoever it went to (the chat's `history` lists its own): the tablet's card, which is
    everyone's, tells it (kiosk_messages.of_parts; alert #83, owner 2026-10-29: after the escalation to the owner, the
    tablet's card kept the owner's line alone and lost the facility manager's alert and reminder).

    ⚠️ FACTS UNTIL DRAWN (architecture review, 2026-10-17): the heading was written as text, then read back — its stage
    word by a pattern, its title rewritten by another, its "To:" and history by splitting lines — so a wording change
    could quietly drop a card's ✅ or its "(closed)". Only a record stored before 0.12.230 is read from text (`head_of`)."""
    h = {"title": (title or "").strip(), "to": (to or "").strip(), "history": [x for x in history if x],
         "word": word or None, **({"story": [x for x in story if x]} if story is not None else {})}
    # English is said by no key: a heading recorded before (and every English one) stays exactly as it was
    return {**h, "lang": lang} if lang and status_words.lang_of(lang) != "en" else h


def head_of(h) -> dict | None:
    """A heading as facts: one written by `head`, or one recorded as text (before 0.12.230: "#9-P2 (existing)" / "To: …" /
    its history; before 0.12.175 "For: JM"). None for no heading."""
    if isinstance(h, dict):
        return head(h.get("title") or "", h.get("to") or "", h.get("history") or (), h.get("word"), h.get("lang"),
                    h.get("story"))
    lines = [x for x in (h or "").strip().split("\n") if x]
    if not lines:
        return None
    if lines[0].startswith(OLD_FOR):
        lines = [UNTITLED, TO + lines[0][len(OLD_FOR):]] + lines[1:]
    title, to, history = lines[0], (lines[1] if len(lines) > 1 else TO), lines[2:]
    to = to[len(TO):] if to.startswith(TO) else to.removeprefix(TO.strip()).strip()
    m = INCIDENT_TITLE.fullmatch(title)
    return head(title[:-len(f" ({m.group(1)})")] if m else title, to, history, m.group(1) if m else None)


def title_line(h: dict) -> str:
    """A heading's first line: "#9-P2 (existing)", "Approval request"."""
    return f"{h['title']} ({h['word']})" if h.get("word") else h["title"]


def head_text(h) -> str:
    """A heading as the message shows it: its title line, "To: …", then its history."""
    h = head_of(h)
    return "\n".join([title_line(h), f"{TO}{h['to']}".rstrip(), *h["history"]]) if h else ""


#: An incident message's stage, as its title says it, shown again at the head of its bottom line (owner, 2026-10-11:
#: "clearly see if this message is a new alert, a follow-up, or a closure — no more follow-up expected"). Taken from the
#: title's word (notice.Notices), never decided twice: a copy retitled "(closed)" shows ✅ at once. STAGE_ICONS,
#: STAGE_WORDS and MARK_ICONS (a person pressed Need help; closed, but VESTA could not check it) live in
#: vesta_shared.message_format, the one place of the messages' shape and style.
def stage_line(h, status: str, mark: str | None = None) -> str:
    """The bottom line with its icon, when the message is about an incident: "⚠️ New alert", "⚠️ ⚙️ Reminder sent … to FM — …",
    "🆘 Need help pressed by …", "✅ Cleared in Home Assistant on …", "☑️ Done pressed by …. Note: VESTA cannot check
    this one; …". Any other message's status as it is."""
    h = head_of(h) or {}
    word = h.get("word")
    if not word:
        return status
    icon = MARK_ICONS.get(mark or "") if not (mark == "unchecked" and word not in CLOSED_STAGES) else None
    return f"{icon or STAGE_ICONS[word]} {status or status_words.stage_words(word, lang=h.get('lang') or 'en')}"


def parts(body: str = "", status: str = "", head=None, lead: str = "", mark: str | None = None) -> dict:
    """A message as its parts (any may be empty); `head`: its heading as facts (`head`; a text one is read once:
    `head_of`); `mark`: what its status is beyond its stage (MARK_ICONS)."""
    return {"head": head_of(head) or "", "lead": lead or "", "body": body or "", "status": status or "", "mark": mark}


def middle_floor() -> int:
    """What the middle (the alert, the action) always keeps, however long the head's history and the status are."""
    return limit("telegram.alert_middle_chars", 300, unit="characters", group="text", lo=50, hi=2000,
                 says="What an alert's message always keeps of the alert itself, however long its history.",
                 reached="The oldest history lines go first (\"… N earlier notices\"), then the alert is shortened "
                         "with \"…\".", told="person")


def body_shown(p: dict, h: dict | None) -> str:
    """The body as this copy shows it: the alert's own words in the language its heading is drawn in, when the copy
    holds them (`tr`: translation.Translations, owner 2026-10-23), else as written. ⚠️ ONLY IN ITS OWN LANGUAGE: a
    copy's parts handed to another chat (IncidentThread.sync) carry the first chat's `tr` — a German copy never shows
    the French words, whatever forgot to draw them again."""
    tr = p.get("tr")
    if isinstance(tr, dict) and isinstance(tr.get("body"), str) and h and tr.get("lang") == h.get("lang"):
        return tr["body"]
    return p.get("body") or ""


def render(p: dict, limit: int | None = None) -> str:
    """The text Telegram shows, in ONE message of `limit` characters (4,096; a photo's or a file's caption 1,024 — the
    message's own `limit` when it recorded one): the title and "To: …", the lead and body, then "Status:" with the
    history and where it stands (message_format.document). Without a heading (an answer to the person who asked): the
    text, then "Status:". The status and the title are kept whole; the oldest history lines go first when room is short
    ("- … N earlier notices"), then the middle is shortened (architecture review 15, 20).

    ⚠️ NEVER A NEGATIVE ROOM (architecture review 20): a heading and a status longer than the limit asked fit() for a
    negative size, which never returns — the agent would have stopped answering."""
    limit = int(limit or p.get("limit") or telegram_message_chars())
    h = head_of(p.get("head"))
    status = fit(stage_line(h, (p.get("status") or "").strip(), p.get("mark")), max(limit // 4, 40))
    middle = "\n".join(x.strip() for x in (p.get("lead"), body_shown(p, h)) if x and x.strip())
    if not h:
        tail = f"{status_head()}{status}" if status else ""
        return fit(middle, max(limit - tg_len(tail), 20)) + tail if middle else tail.lstrip("\n")
    title, to, history = title_line(h), h["to"], list(h["history"])
    floor, dropped, cap = min(middle_floor(), tg_len(middle)), 0, None
    lang = h.get("lang") or "en"                       # the chat's language: its Status label and counted line

    def framed(mid: str) -> str:
        more = [f"- {status_words.earlier(dropped, lang)}"] if dropped else []
        hist = "\n".join(history[:1] + more + history[1:])
        return document(title, to, [(None, [mid]), (status_words.label(lang),
                                                    [fit(hist, cap) if cap and hist else hist, status])])
    while len(history) > 1 and tg_len(framed("")) + floor > limit:
        history.pop(1)                                 # the oldest after the first notice, which always stays
        dropped += 1
    if tg_len(framed("")) + floor > limit:
        cap = max(limit // 2, 40)                      # one history line longer than half the message: cut itself
    room = max(limit - tg_len(framed("")) - 1, 20)
    return framed(fit(middle, room) if middle else "")


def step_said(stage: str | None, roles, at: datetime, status: str, status_in: dict | None = None,
              incident: int | None = None) -> dict:
    """What a copy's bottom line was drawn from, kept as its `said` so the copy another chat gets of it is drawn again
    in that chat's language (notice.Notices.restatus): the step, to whom, when, the skill's words (and their other
    languages), and whose incident (a step to no role says what its priority does: "(to: digest)"). ⚠️ ONE SHAPE
    (architecture review, 2026-10-30): five writers spelled it, and Poster's had no incident — a step to no role, redrawn
    in another chat, read "(to: nobody)" where the villa's own message taken over read "(to: digest)"."""
    return {"stage": stage, "roles": sorted(roles), "at": at.isoformat(), "status": status,
            **({"status_in": status_in} if status_in else {}), **({"incident": int(incident)} if incident is not None else {})}


def note_said(note: str, note_in: dict, now: datetime, zone: str) -> dict:
    """What a note (a close, a restatement) was drawn from: the note and its other languages, its time filled in — no
    step, so no time of its own on a redraw (notice.Notices.restatus)."""
    return {"stage": None, "status": fill_time(note, now, zone),
            "status_in": {k: fill_time(v, now, zone) for k, v in note_in.items()}}


def changed(p: dict, *, status: str | None = None, body: str | None = None, mark: str | None = None) -> dict:
    """The same message with a new status and/or body; its head and lead kept. A new status brings its own `mark`
    (none: the stage's icon) — a "Need help" status replaced by "Done pressed …" is no longer 🆘."""
    # a new status is no longer the step it was drawn from (`said`: notice.Notices.restatus redraws a step's line in
    # each chat's language; a replaced one is the new words, as they are)
    # a new body is no longer the words translated (`tr`): it is shown as written until it is translated again
    kept = {k: v for k, v in p.items() if not (status is not None and k == "said") and not (body is not None and k == "tr")}
    return {**parts(), **kept, **({"status": status, "mark": mark} if status is not None else {}),
            **({"body": body} if body is not None else {})}


def legacy(text: str) -> dict:
    """The parts of a message recorded as text only: in the one shape (its title and "To:" its head, its last "Status:"
    block its status), or cut at "-------" lines (before 0.12.142: its head when it starts with "For: ", its status when
    it has three parts). Read once, when that message changes; never for a message sent since."""
    text = (text or "").rstrip()
    if shape_parts(text):
        title, _, rest = text.partition("\n")
        to, _, rest = rest.partition("\n")
        probe = STATUS_BREAK + rest
        at = probe.rfind(status_head())
        body, notes = (probe[:at], probe[at + len(status_head()):]) if at >= 0 else (rest, "")
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
