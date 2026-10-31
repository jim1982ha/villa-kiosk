"""An automation (or a script) of the villa in the words a person reads: its own name, without a blueprint's prefix, in
apostrophes — "'Pool leak'", "automation 'Pool leak'" — never its entity id.

⚠️ ONE WRITER (architecture review round 11, card 3): the same automation was named five ways — "Retune
automation.pool_leak_watch" (the alert desk's proposal never looked its name up), "Turn on the automation Critical ---
Pool leak" (the request words), "automation 'Critical --- Pool leak'" (the night check), "The automation Critical ---
Pool leak watches …" (the hidden-device finding) and the reports' own trimming. Every one of them asks here now.
"""
from __future__ import annotations

#: what parts a blueprint's prefix from the automation's own name ("Critical --- Pool leak")
PREFIX = "---"


def name(alias, entity_id: str | None = None) -> str:
    """The automation's own name: its alias without a blueprint's prefix ("Critical --- Pool leak" → "Pool leak"); no
    alias (or the entity id given as one): its entity id's object id in words ("pool_leak_watch" → "Pool leak watch").
    The first letter is a capital, the rest as written."""
    text = str(alias or "").strip()
    if not text or text == entity_id:
        text = str(entity_id or "").split(".", 1)[-1].replace("_", " ")
    if PREFIX in text:
        text = text.split(PREFIX, 1)[1]
    text = text.replace("_", " ").strip()                   # an alias written as an id ("entrance_unlocked")
    return text[:1].upper() + text[1:]


def quoted(alias, entity_id: str | None = None) -> str:
    """The automation's own name in apostrophes: "'Pool leak'"."""
    return f"'{name(alias, entity_id)}'"


def words(alias, entity_id: str | None = None, kind: str | None = None) -> str:
    """"automation 'Pool leak'" ("script '…'" for a script: `kind`, else the entity id's domain); never "rule" in what a
    person reads (owner, 2026-10-22)."""
    k = "script" if (kind or str(entity_id or "").split(".", 1)[0]) == "script" else "automation"
    return f"{k} {quoted(alias, entity_id)}"


def alias_in(states: dict, entity_id: str):
    """An automation's alias from the villa's states (its friendly name), None when it is not there."""
    return (((states or {}).get(entity_id) or {}).get("attributes") or {}).get("friendly_name")
