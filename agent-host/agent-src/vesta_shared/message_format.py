"""The ONE shape of the agent's messages and the ONE place that says how each part looks (owner, 2026-10-11: "the
formatting shall be centrally defined and easily and fully re-configurable if we decide to change the delivery channel
in the future — without risking to miss any rule").

Every alert and every report is written as plain text in this shape:

    The Lys House, daily report on 11/10/2026.     ← title                       (one line)
    To: JM                                         ← who it is for              ("To: " line)
                                                   ← (an empty line, between sections and between items)
    New since yesterday:                           ← a section's label          (a line ending ":")
    - P3 Onsen pump used 0.12 kWh/day …            ← an item                    (its lines, up to an empty line)

    Still open:
    - Incident #5 · ⚠️ House Pump Power …

    - P2 Motion1 Occupancy battery at 7%: replace now.

An alert ("#1-P2 (existing)" / "To: Jim" / the alert / "Status:" / its history / where it stands) is the same shape:
vesta_agent/notice.py writes its heading, vesta_agent/layout.py lays it out with `document`.

`parts` reads the shape back from the text as it is finally sent — the daily digest is written by the AI, in the
facility manager's language, so the style is never trusted to the writer: it is found in the text. Each channel says
how a part looks in ONE table (TELEGRAM below); `telegram_entities` is all the Telegram sender knows about style.
Another channel is another table of the same five keys, read the same way.
"""
from __future__ import annotations

import re

from .messaging import tg_len

TO = "To: "
#: An alert's first line: "#9-P2 (existing)" (vesta_agent/notice.py).
INCIDENT_TITLE = re.compile(r"#\d+(?:-P\d)? \((new|existing|closed)\)")
#: The label of an alert's where-it-stands section (vesta_agent/layout.py).
STATUS = "Status"
#: An alert's bottom line starts with one of these (vesta_agent/layout.py; owner, 2026-10-11): its title's word — new,
#: existing, closed — or what the skill marked (vesta_shared.result.MARKS).
STAGE_ICONS = {"new": "⚠️", "existing": "⚠️ ⚙️", "closed": "✅"}
MARK_ICONS = {"help": "🆘", "unchecked": "☑️"}
#: Sections whose items are notes — what happened, said by the agent — rather than the things reported.
NOTE_SECTIONS = frozenset({STATUS})

#: How each part of a message looks on Telegram — the only style rule set. Keys: the parts `parts` finds.
#: Values: Telegram's MessageEntity types, applied over the part's text (sent as it is, never as markup).
TELEGRAM: dict[str, tuple[str, ...]] = {
    "title": ("underline",),
    "to": (),
    "label": (),
    "item": ("blockquote",),
    "note": ("blockquote", "italic"),
}


def document(title: str, to: str, sections: list[tuple[str | None, list[str]]]) -> str:
    """A message in the shape: `title`, "To: `to`" ("" leaves "To:" for the agent to fill: `fill_to`), then each section
    — its label (None: none) and its items, each item its own block."""
    out = [title.strip(), (TO + to).rstrip()]
    first = True
    for label, items in sections:
        items = [i.strip() for i in items if i and i.strip()]
        if not items:
            continue                                 # a section with nothing in it is not said
        lead = [f"{label}:"] if label else []
        if not first or label:
            out.append("")
        first = False
        out.append("\n\n".join(["\n".join(lead + items[:1])] + items[1:]) if items else lead[0])
    return "\n".join(out)


def fill_to(text: str, names: list[str]) -> str | None:
    """A message in the shape whose "To:" line a skill left for the agent: that line naming `names`. None for any other
    text (it is not in the shape, or already says who)."""
    title, nl, rest = (text or "").partition("\n")
    line, nl2, body = rest.partition("\n")
    if not nl or line.strip() != TO.strip() or not title.strip():
        return None
    return f"{title}\n{TO}{', '.join(names) or 'this chat'}" + (nl2 + body if nl2 else "")


def titled(title: str, names: list[str], body: str) -> str:
    """A report in the shape from its parts as data (owner, 2026-10-11, review 28: a report is never recognised by its
    text — the agent writes its title and "To:" itself, whatever the AI wrote under them): `title`, "To: `names`", then
    `body` (its sections) — under an empty line when it starts with a section's label."""
    body = (body or "").strip("\n")
    gap = "\n\n" if body.split("\n", 1)[0].rstrip().endswith(":") else "\n"
    return f"{title.strip()}\n{TO}{', '.join(names) or 'this chat'}" + (gap + body if body else "")


def split_title(text: str) -> tuple[str, str] | None:
    """(title, body) of a message in the shape whose "To:" a skill left for the agent; None for any other text."""
    title, _, rest = (text or "").partition("\n")
    line, _, body = rest.partition("\n")
    if not title.strip() or line.strip() != TO.strip():
        return None
    return title.strip(), body.strip("\n")


def pages(title: str, names: list[str], body: str, limit: int) -> list[str]:
    """A report as messages of at most `limit` (Telegram's units), each a whole message in the shape — its own title
    "(1/2)", "To:", and its section's label again when a section goes on (owner, 2026-10-11, review 28: one long daily
    report lost its whole "Still open" section, cut at Telegram's 4,096). Cut between items; an item longer than a
    message is cut itself."""
    whole = titled(title, names, body)
    if tg_len(whole) <= limit:
        return [whole]
    blocks, label = [], None                         # (the label it is under, the block's text)
    for block in (body or "").strip("\n").split("\n\n"):
        first = block.split("\n", 1)[0]
        if first.rstrip().endswith(":") and not first.lstrip().startswith("- "):
            label = first.rstrip()
        blocks.append((label, block))
    numbered = lambda i, n: f"{title.strip().rstrip('.')} ({i}/{n})."
    room = limit - tg_len(titled(numbered(99, 99), names, "")) - 4
    out: list[list[str]] = [[]]
    used = 0
    for lab, block in blocks:
        block = block if tg_len(block) <= room else block[:max(room - 1, 1)] + "…"
        if out[-1] and used + 2 + tg_len(block) > room:
            out.append([])
            used = 0
            if lab and not block.startswith(lab):
                block = f"{lab}\n{block}"           # the section goes on: its label again
        out[-1].append(block)
        used += 2 + tg_len(block)
    return [titled(numbered(i + 1, len(out)), names, "\n\n".join(b)) for i, b in enumerate(out)]


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
    section, block = None, None                      # the current label; the current item's first line
    for i in range(2, len(lines) + 1):
        ln = lines[i] if i < len(lines) else ""
        if not ln.strip():
            if block is not None:                    # an item ends at an empty line
                end = starts[i - 1] + len(lines[i - 1])
                found.append(("note" if section in NOTE_SECTIONS else "item", starts[block], end))
                block = None
            continue
        if block is None and ln.rstrip().endswith(":") and not ln.lstrip().startswith("- "):
            section = ln.rstrip()[:-1].strip()
            found.append(("label", starts[i], starts[i] + len(ln)))
            continue
        if block is None:
            block = i
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
    start = at + len(label)
    for block in text[start:].split("\n\n"):
        if block.strip():
            found.append(("note", start, start + len(block)))
        start += len(block) + 2
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
    """How Telegram shows a message (TELEGRAM): the title underlined, each item quoted, a note quoted in italics."""
    return entities(text, TELEGRAM)
