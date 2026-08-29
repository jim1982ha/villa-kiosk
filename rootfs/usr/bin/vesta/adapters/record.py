"""The RECORD — what happened at this property, from every source.

⚠️ THE OWNER'S DESIGN (2026-08-30): one ledger the briefing reads over its
window, filled the same way whichever position the Supervision switch is in.
The switch is not consulted anywhere in this module — mode-transparency falls
out of the sources that happen to be writing, which is the whole point:

    Supervision OFF  the owner enables ROI/maintenance/audit automations; they
                     alert a phone AND land here with their own figures.
    Supervision ON   those are disabled, so nothing arrives from them; triage
                     flags and the agent's concerns arrive instead.
    Either way       critical_* and control_* are always enabled, so they
                     always appear.

⚠️ NOT THE OBSERVATION JOURNAL, AND THE NAMES MUST NOT MERGE. `observe/journal`
is a ring of raw STATE CHANGES that feeds salience and triage — machine input.
This is a ledger of things a person would call events, and it is what a briefing
summarises. One word for both would be the drift this project keeps paying for.

⚠️ `ref` IS A POINTER, NEVER A COPY. An `agent` entry carries the concern id and
nothing about its state: the concern store stays the authority on open/closed/
acknowledged, so pressing ✅ cannot leave this ledger contradicting the Reason
tab. The same rule is why a flag entry carries `subject_key` rather than a
duplicate of the concern it became.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.adapters import store
from vesta.adapters.log import swallow

#: The ring bound. ⚠️ MEASURED, NOT CHOSEN — AND THE FIRST NUMBER WAS WRONG.
#: This began at 20,000 and the bound test took SEVEN MINUTES to fill it: every
#: `append` re-reads and re-writes the whole file, so the cost grows with the
#: ledger and lands on EVERY automation firing in production, not just in a
#: test. That is the instrument reporting a real cost, not a slow test.
#:
#: 5,000 is sized from the job instead of from generosity: the longest briefing
#: window is monthly, and this property's automations plus agent activity run
#: to roughly a hundred entries a day — so this is about seven weeks, with the
#: newest always surviving. Raising it makes every write more expensive; if a
#: villa ever needs more, the fix is batching appends the way the collector
#: already batches events, not a bigger number.
MAX_ENTRIES: int = 5_000

#: The sources, and what each means. A reader that meets an unknown source must
#: render it plainly rather than drop it — an unlisted kind arriving as silence
#: is the failure `standing.SEVERITY_OF_KIND` already records.
SOURCES = ("automation", "triage", "agent")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read() -> List[Dict[str, Any]]:
    """Every entry, oldest first. Never raises."""
    try:
        raw = store.read_json(store.RECORD_FILE, {"entries": []})
        entries = raw.get("entries") if isinstance(raw, dict) else None
        return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []
    except Exception as err:  # noqa: BLE001 - a ledger read may never stop a brief
        swallow("could not read the record", err)
        return []


def append(entry: Mapping[str, Any], *, now_iso: str = "") -> bool:
    """Add one entry. Returns whether it was written. NEVER RAISES.

    ⚠️ THE WRITER STAMPS THE TIME unless the caller supplies one, so an entry
    can never arrive without a position in the window a briefing reads.
    """
    try:
        row = dict(entry)
        row.setdefault("at", now_iso or _now_iso())
        row.setdefault("source", "")
        entries = read()
        entries.append(row)
        if len(entries) > MAX_ENTRIES:
            entries = entries[-MAX_ENTRIES:]
        store.write_json(store.RECORD_FILE, {"entries": entries})
        return True
    except Exception as err:  # noqa: BLE001
        swallow("could not append to the record", err)
        return False


def since(iso: str, *, sources: Optional[Sequence[str]] = None
          ) -> List[Dict[str, Any]]:
    """Every entry at or after `iso`, oldest first, optionally by source.

    ⚠️ A BAD OR EMPTY BOUND RETURNS EVERYTHING rather than nothing. A briefing
    that cannot parse its own window must be thin-but-honest, never silently
    empty — an empty section reads as "a quiet week", which is the lie this
    subsystem keeps being caught by.
    """
    rows = read()
    if sources:
        want = set(sources)
        rows = [r for r in rows if str(r.get("source") or "") in want]
    if not iso:
        return rows
    return [r for r in rows if str(r.get("at") or "") >= iso]


def stamp_outcome(subject_key: str, outcome: str, *,
                  source: str = "triage") -> int:
    """Stamp the newest un-stamped entry for this subject. Returns how many.

    ⚠️ THE NEWEST ONE ONLY. A subject flagged on three passes has three
    entries; the investigation that just finished resolves the flag that
    raised it, not the history — stamping them all would rewrite what earlier
    passes actually did, which is the record's one job to preserve.
    """
    try:
        entries = read()
        for row in reversed(entries):
            if (str(row.get("source") or "") == source
                    and str(row.get("subject_key") or "") == subject_key
                    and not str(row.get("outcome") or "").strip()):
                row["outcome"] = outcome
                store.write_json(store.RECORD_FILE, {"entries": entries})
                return 1
        return 0
    except Exception as err:  # noqa: BLE001
        swallow("could not stamp a record outcome", err)
        return 0


def remove(at: str, subject: str) -> bool:
    """Delete one entry, identified by its time and subject. NEVER RAISES.

    ⚠️ DELETING HISTORY IS A REAL ACT, so it is reachable only from the surface
    that says so — the briefing dialog's own list, never the to-do list, where
    a reader would think they were ticking work off.
    """
    try:
        entries = read()
        keep = [e for e in entries
                if not (str(e.get("at") or "") == at
                        and str(e.get("subject") or "") == subject)]
        if len(keep) == len(entries):
            return False
        store.write_json(store.RECORD_FILE, {"entries": keep})
        return True
    except Exception as err:  # noqa: BLE001
        swallow("could not remove a record entry", err)
        return False
