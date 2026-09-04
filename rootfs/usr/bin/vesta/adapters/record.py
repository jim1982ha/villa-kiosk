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

from vesta.shared import instants
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


def _instant(value: Any) -> Optional[datetime]:
    """An ISO-8601 stamp as an aware UTC datetime, or `None` if unreadable.

    ⚠️ DELEGATES TO `shared.instants` (2026-08-30). This was six local lines to
    avoid an import cycle — `collect` imports this module, so `collect.as_utc_iso`
    was unreachable from here — and a second implementation of the one rule that
    had just been got wrong. The rule now lives in `shared`, which both
    `adapters` and `supervise` may import and which imports nothing itself.
    """
    return instants.as_utc(value)


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

    # ⚠️ COMPARED AS INSTANTS, NEVER AS STRINGS (2026-08-30). This read
    # `str(r["at"]) >= iso`, and ordering ISO strings lexicographically is only
    # chronological when both sides carry the SAME OFFSET. `append` stamps every
    # entry in UTC; `pipeline` builds its window from `schedule.period_start`,
    # which is deliberately the villa's LOCAL wall-clock midnight. So on a villa
    # east of UTC the first hours of every local day sorted BEFORE the bound and
    # were silently dropped from the daily brief.
    #
    # ⚠️ FOUND IN THE FIELD, AND THE RULE ALREADY EXISTED. The owner's watchdog
    # fired six times at 00:52 local (16:52Z) and the 10:00 briefing did not
    # mention it; every other line of that report reconciles exactly with this
    # cut, including two entries stamped 00:00:00Z. `collect.as_utc_iso` was
    # written for precisely this and says so — "THE ONE LINE THAT MAKES STRING
    # COMPARISON LEGAL" — and `journal.since` warns callers to normalise. This
    # ledger was a new consumer of that rule and never joined it, which is
    # `feedback_audit-applicable-set` in its purest form: roll a rule out by
    # what it APPLIES to, not by its existing call sites.
    #
    # ⚠️ NORMALISED HERE RATHER THAN AT THE CALLER, unlike `journal.since`.
    # "The caller must remember" is the shape this repository keeps paying for,
    # and this function's contract is a MOMENT, not a string. It cannot import
    # `collect` (collect imports this module), so the conversion is local — six
    # lines, no new dependency, correct for every caller including the SPA's.
    bound = _instant(iso)
    if bound is None:
        return rows
    kept: List[Dict[str, Any]] = []
    for row in rows:
        at = _instant(row.get("at"))
        # An unparseable stamp is KEPT, for the same reason a bad bound returns
        # everything: thin-but-honest beats silently empty.
        if at is None or at >= bound:
            kept.append(row)
    return kept


#: How a `critical_*` incident ended, as the blueprint reports it in its own
#: event's `phase` field: `opened` when it alerted, `cleared` when the all-clear
#: went out, `timeout` when "Repeat after" closed a run whose condition was
#: still true. ⚠️ THE BLUEPRINT'S VOCABULARY, READ HERE AND NOWHERE ELSE — a
#: villa whose rules send no phase tallies plainly by count, which is why
#: every reader of this tuple treats an absent phase as "not said".
PHASES = ("opened", "cleared", "timeout")


def tally_automations(entries: Sequence[Mapping[str, Any]]
                      ) -> Dict[str, Dict[str, Any]]:
    """Firings grouped by automation, figures SUMMED, phases COUNTED.

    ⚠️ ONE RULE, TWO READERS (2026-09-04). The brief composer had this inline
    and the villa document needed the same grouping — "which rules fired this
    window, how often, and how did the incidents end" is the one sentence the
    model has never been shown. A second loop over the same rows in `sources`
    would be the duplicate this repository audits for, so the grouping moved
    here, to the module that owns the rows, and both readers call it.

    ⚠️ FIGURES ARE SUMMED, NEVER SAMPLED (2026-08-30). One firing's "0.3 kWh"
    printed beside "14 times" is wrong by a factor of fourteen. And a firing is
    counted ONCE whatever its phase: an incident that opened and later timed
    out is one rule firing once, with two rows — `times` counts the `opened`
    rows (or every row, for a rule that sends no phase), and `phases` says how
    the incidents ended.
    """
    tally: Dict[str, Dict[str, Any]] = {}
    for row in entries:
        if str(row.get("source") or "") != "automation":
            continue
        name = str(row.get("subject") or row.get("title") or "?")
        held = tally.setdefault(name, {"times": 0, "kwh": 0.0, "cost": 0.0,
                                       "mins": 0.0, "phases": {}})
        payload = row.get("payload")
        phase = ""
        if isinstance(payload, Mapping):
            phase = str(payload.get("phase") or "")
            for key, into in (("kwh", "kwh"), ("cost_local", "cost"),
                              ("wasted_minutes", "mins")):
                try:
                    held[into] += float(payload.get(key) or 0)
                except (TypeError, ValueError):
                    pass
        if phase in PHASES:
            held["phases"][phase] = int(held["phases"].get(phase, 0)) + 1
        if phase in ("", "opened"):
            held["times"] += 1
    return tally


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
