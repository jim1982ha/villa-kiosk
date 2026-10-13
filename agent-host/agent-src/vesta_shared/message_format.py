"""The ONE shape of the agent's messages and the ONE place that says how each part looks (owner, 2026-10-11: "the
formatting shall be centrally defined and easily and fully re-configurable if we decide to change the delivery channel
in the future — without risking to miss any rule").

Every alert and every report is written as plain text in this shape:

    Villa Example, daily report on 11/10/2026.     ← title, in bold             (one line)
    To: Facility Manager                           ← the roles it is for        ("To: " line, `audience`)
                                                   ← (an empty line, between sections)
    New since yesterday:                           ← a section's label          (a line ending ":")
    - P3 Onsen pump used 0.12 kWh/day …            ← its items, one per line: ONE quote block per section

    Still open:
    - #5 · ⚠️ House Pump Power …
    - P2 Motion1 Occupancy battery at 7%: replace now.

An alert ("#1-P2 (existing)" / "To: Jim" / the alert / "Status:" / its history / where it stands) is the same shape,
and so is every other message the agent sends on its own ("Approval request" / "To: JM" / … / "Status:" / where it
stands): vesta_agent/notice.py writes its heading, vesta_agent/layout.py lays it out with `document` — the ONE layout
(owner, 2026-10-12: "uniquely and centrally defined"; a "For: … / -------" layout lived beside it until 0.12.175).

`parts` reads the shape back from the text as it is finally sent — the daily digest is written by the AI, in the
facility manager's language, so the style is never trusted to the writer: it is found in the text. Each channel says
how a part looks in ONE table (TELEGRAM below); `telegram_entities` is all the Telegram sender knows about style.
Another channel is another table of the same five keys, read the same way.
"""
from __future__ import annotations

import re

from .messaging import tg_len

TO = "To: "
#: The roles as every "To:" line, history line and page names them, in this order (owner, 2026-10-13: "To: Owner",
#: "To: Facility Manager", "To: Owner & Facility Manager" — roles only, never a person's name).
ROLE_WORDS = {"owner": "Owner", "fm": "Facility Manager"}
#: What joins two roles in a "To:" line.
AND = " & "


def audience(roles) -> str:
    """Who a message is for, as its "To:" line says it: its roles in ROLE_WORDS order ("Owner & Facility Manager"); ""
    for none.

    ⚠️ ROLES, NEVER NAMES (owner, 2026-10-13): "To: Fabien, JM" named the people the People list gives each role — a
    message is for a role, whoever holds it. The same words in Home Assistant's own messages (vesta_message.jinja)."""
    wanted = set(roles or ())
    return AND.join(w for r, w in ROLE_WORDS.items() if r in wanted)


#: The longest "To:" line any message can carry (every role): the room a skill keeps for it in a caption.
TO_LONGEST = TO + audience(ROLE_WORDS)
#: The title of a message about no incident whose sender gave it none (an AI's message sent without one; a heading
#: "For: …" recorded before 0.12.175). Every message the agent sends on its own has a title: this is the last resort.
UNTITLED = "Message from VESTA"
#: An alert's first line: "#9-P2 (existing)" (vesta_agent/notice.py).
INCIDENT_TITLE = re.compile(r"#\d+(?:-P\d)? \((new|existing|closed)\)")
#: The label of an alert's where-it-stands section (vesta_agent/layout.py).
STATUS = "Status"
#: An alert's bottom line starts with one of these (vesta_agent/layout.py; owner, 2026-10-11): its title's word — new,
#: existing, closed — or what the skill marked (vesta_shared.result.MARKS).
STAGE_ICONS = {"new": "⚠️", "existing": "⚠️ ⚙️", "closed": "✅"}
MARK_ICONS = {"help": "🆘", "unchecked": "☑️"}
#: The bottom line of a stage that has none of its own (the first alert says only what Home Assistant said).
STAGE_WORDS = {"new": "New alert", "existing": "Still open", "closed": "Closed: nothing more to do"}
#: What a pressed Done / Need help leaves on its message ("{time}": the villa's time then, timeutil.moment_label).
#: ⚠️ ONE WORDING (architecture review, 2026-10-13): Home Assistant's own job messages said "✅ Done - JM" and
#: "🆘 Help requested - JM" where the agent's said "Done pressed by JM on 12/10/2026 17:13." — the HA template
#: (homeassistant/custom_templates/vesta_message.jinja) carries these tables too, and its test holds it to them.
PRESSED = "{label} pressed by {name} on {time}."
#: Sections whose items are notes — what happened, said by the agent — rather than the things reported.
NOTE_SECTIONS = frozenset({STATUS})

#: How each part of a message looks on Telegram — the only style rule set. Keys: the parts `parts` finds.
#: Values: Telegram's MessageEntity types, applied over the part's text (sent as it is, never as markup).
TELEGRAM: dict[str, tuple[str, ...]] = {
    "title": ("bold",),
    "to": (),
    "label": (),
    "item": ("blockquote",),
    "note": ("blockquote", "italic"),
}


def document(title: str, to: str, sections: list[tuple[str | None, list[str]]]) -> str:
    """A message in the shape: `title`, "To: `to`" ("" leaves "To:" for the agent to fill: `fill_to`), then each section
    — its label (None: none) and its items (_section)."""
    body = _body(sections)
    return "\n".join([title.strip(), (TO + to).rstrip()] + ([body] if body else []))


def _section(label: str | None, items: list[str]) -> str:
    """A section's text: its label, then its items — a labelled section's one per line, ONE block; a section without a
    label (prose: an alert's text, a page's lead) its paragraphs apart.

    ⚠️ ONE BLOCK PER SECTION (owner, 2026-10-13: "regroup all of them into a unique quote block … 1 block under New
    since yesterday and 1 block under Still open"; an alert's history and where it stands in one block too): each item
    was its own quote, the daily report a column of nine boxes."""
    lead = [f"{label}:"] if label else []
    return "\n".join(lead + [("\n" if label else "\n\n").join(items)])


def _body(sections: list[tuple[str | None, list[str]]]) -> str:
    """The sections of a message under its "To:" line: an empty line before each labelled one and between sections."""
    out, first = [], True
    for label, items in sections:
        items = [i.strip() for i in items if i and i.strip()]
        if not items:
            continue                                 # a section with nothing in it is not said
        if not first or label:
            out.append("")
        first = False
        out.append(_section(label, items))
    return "\n".join(out)


def _is_label(line: str) -> bool:
    return line.rstrip().endswith(":") and not line.lstrip().startswith("- ")


def _sections(body: str) -> list[tuple[str | None, list[str]]]:
    """The sections of a message's body, read back (pages): a label starts one; its items are its "- " lines (with the
    lines that go on under them), a section without a label its paragraphs."""
    out: list[tuple[str | None, list[str]]] = []
    for block in (body or "").strip("\n").split("\n\n"):
        lines = block.split("\n")
        if _is_label(lines[0]):
            out.append((lines[0].rstrip()[:-1], []))
            lines = lines[1:]
        elif not out:
            out.append((None, []))
        label, items = out[-1]
        if label is None:
            items.append("\n".join(lines))
            continue
        for ln in lines:
            if ln.lstrip().startswith("- ") or not items:
                items.append(ln)
            else:
                items[-1] += "\n" + ln
    return [(lab, [i for i in items if i.strip()]) for lab, items in out]


def fill_to(text: str, to: str) -> str | None:
    """A message in the shape whose "To:" line a skill left for the agent: that line saying `to` (audience). None for
    any other text (it is not in the shape, or already says who)."""
    title, nl, rest = (text or "").partition("\n")
    line, nl2, body = rest.partition("\n")
    if not nl or line.strip() != TO.strip() or not title.strip():
        return None
    return f"{title}\n{TO}{to or 'this chat'}" + (nl2 + body if nl2 else "")


def titled(title: str, to: str, body: str) -> str:
    """A report in the shape from its parts as data (owner, 2026-10-11, review 28: a report is never recognised by its
    text — the agent writes its title and "To:" itself, whatever the AI wrote under them): `title`, "To: `to`", then
    `body` (its sections) — under an empty line when it starts with a section's label."""
    body = (body or "").strip("\n")
    gap = "\n\n" if body.split("\n", 1)[0].rstrip().endswith(":") else "\n"
    return f"{title.strip()}\n{TO}{to or 'this chat'}" + (gap + body if body else "")


def split_title(text: str) -> tuple[str, str] | None:
    """(title, body) of a message in the shape whose "To:" a skill left for the agent; None for any other text."""
    title, _, rest = (text or "").partition("\n")
    line, _, body = rest.partition("\n")
    if not title.strip() or line.strip() != TO.strip():
        return None
    return title.strip(), body.strip("\n")


def pages(title: str, to: str, body: str, limit: int) -> list[str]:
    """A report as messages of at most `limit` (Telegram's units), each a whole message in the shape — its own title
    "(1/2)", "To:", and its section's label again when a section goes on (owner, 2026-10-11, review 28: one long daily
    report lost its whole "Still open" section, cut at Telegram's 4,096). Cut between items; an item longer than a
    message is cut into pieces (_pieces), one after the other — never shortened.

    ⚠️ NO TEXT IS LOST (architecture review 3, 2026-10-13): a labelled section's paragraphs are one item (_sections), and
    an item longer than a message was cut with "…" — a 4,400-character report under "Findings:" arrived as ONE message,
    its tail gone without a word."""
    whole = titled(title, to, body)
    if tg_len(whole) <= limit:
        return [whole]
    numbered = lambda i, n: f"{title.strip().rstrip('.')} ({i}/{n})."
    room = limit - tg_len(titled(numbered(99, 99), to, "")) - 4
    out: list[list[tuple[str | None, list[str]]]] = [[]]
    for label, items in _sections(body):
        for item in (p for i in items for p in _pieces(i, max(room - tg_len(label or "") - 4, 1))):
            page = out[-1]
            grown = page[:-1] + [(label, page[-1][1] + [item])] if page and page[-1][0] == label else page + [(label, [item])]
            if page and tg_len(_body(grown)) > room:
                out.append([(label, [item])])        # the section goes on: its label again
            else:
                out[-1] = grown
    return [titled(numbered(i + 1, len(out)), to, _body(p)) for i, p in enumerate(out)]


#: Where a piece of a too-long item ends, the first found wins: between paragraphs, lines, sentences, words.
CUTS = ("\n\n", "\n", ". ", " ")


def _pieces(item: str, cap: int) -> list[str]:
    """`item` as pieces of at most `cap` (Telegram's units), cut at the last CUTS that fits — mid-word only for a word
    longer than `cap`. Together they are the whole item, less the spaces at the cuts."""
    out: list[str] = []
    rest = item.strip()
    while tg_len(rest) > cap:
        lo, hi = 1, len(rest)                        # the longest start of `rest` that fits (units are not characters)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            lo, hi = (mid, hi) if tg_len(rest[:mid]) <= cap else (lo, mid - 1)
        at = next((k + (len(c) if c == ". " else 0) for c in CUTS if (k := rest.rfind(c, 0, lo)) > 0), lo)
        out.append(rest[:at].rstrip())
        rest = rest[at:].lstrip()
    return out + ([rest] if rest else [])


def parts(text: str) -> list[tuple[str, int, int]]:
    """The parts of a message in the shape, as (kind, start, end) character spans of `text`: "title", "to", "label",
    "item", "note" — a section's items are "note" under a NOTE_SECTIONS label. [] for any other text: its first line is
    no title or its second no "To: " line.

    ⚠️ AN ALERT'S TEXT IS ONE ITEM, WHATEVER IT SAYS (review 28): Home Assistant's own words are free text — a line
    "Status:" or "Water leak detected in:" in them was read as a section of the agent's, drawn as a heading and its next
    line in italics as if the agent had written it. An alert ("#9-P2 (…)") is its title, "To:", its text — ONE quote, up
    to its last "Status:" line — and that section's notes."""
    text = text or ""
    lines = text.split("\n")
    if len(lines) < 2 or not lines[0].strip() or not lines[1].startswith(TO.strip()):
        return []
    if INCIDENT_TITLE.fullmatch(lines[0]):
        return _alert_parts(text, len(lines[0]), len(lines[0]) + 1 + len(lines[1]))
    found: list[tuple[str, int, int]] = []
    at = 0
    starts = []
    for ln in lines:
        starts.append(at)
        at += len(ln) + 1
    found.append(("title", 0, len(lines[0])))
    found.append(("to", starts[1], starts[1] + len(lines[1])))
    # ⚠️ ONE BLOCK PER SECTION (owner, 2026-10-13): a section's items are ONE part, from its first line to its last —
    # an AI that wrote its items apart (the daily digest) is quoted the same way
    section, span, after = None, None, True          # the current label; its items' (start, end); a label may start
    for i in range(2, len(lines)):
        ln = lines[i]
        if not ln.strip():
            after = True
            continue
        if after and _is_label(ln):
            if span:
                found.append(("note" if section in NOTE_SECTIONS else "item", *span))
                span = None
            section = ln.rstrip()[:-1].strip()
            found.append(("label", starts[i], starts[i] + len(ln)))
            continue
        after = False
        span = (span[0] if span else starts[i], starts[i] + len(ln))
    if span:
        found.append(("note" if section in NOTE_SECTIONS else "item", *span))
    return found


def _alert_parts(text: str, title_end: int, to_end: int) -> list[tuple[str, int, int]]:
    found = [("title", 0, title_end), ("to", title_end + 1, to_end)]
    label = f"\n\n{STATUS}:\n"
    at = text.rfind(label)
    if at < to_end:
        if to_end + 1 < len(text):
            found.append(("item", to_end + 1, len(text)))
        return found
    if at > to_end + 1:
        found.append(("item", to_end + 1, at))
    found.append(("label", at + 2, at + len(label) - 1))
    start, end = at + len(label), len(text.rstrip())
    if end > start:
        found.append(("note", start, end))           # its history and where it stands: ONE block (owner, 2026-10-13)
    return found


def entities(text: str, table: dict[str, tuple[str, ...]]) -> list[dict]:
    """The text's parts styled by a channel's table, as MessageEntity-like dicts {type, offset, length} in the UTF-16
    units Telegram counts. [] for a text not in the shape."""
    out = []
    for kind, start, end in parts(text):
        for style in table[kind]:
            out.append({"type": style, "offset": tg_len(text[:start]), "length": tg_len(text[start:end])})
    return out


def telegram_entities(text: str) -> list[dict]:
    """How Telegram shows a message (TELEGRAM): the title in bold, each section's items quoted, its notes quoted in
    italics."""
    return entities(text, TELEGRAM)
