"""A read of the villa's past, and how far it got.

`HABase.history_read` and `HABase.logbook_read` hand back the rows TOGETHER with where the reading stopped, the period's
end brought back to now. `History` answers the two questions every reader asked of a history — the state at a moment,
and each state's period — and never past where the reading reached; `unread` is the one sentence a reader says about
the rest.

⚠️ A READ STOPPED SHORT WAS A SIDE NOTE (architecture review, round 2, 2026-10-16): history() and logbook() returned
plain lists and left `history_cut` / `logbook_cut` on the client, reset at every call. /investigate and the night check
looked; a pump's runs for the closing day, the weekly page's alert count, a report's "state at noon" and the alert
desk's "back for 10 minutes" did not — the last row read was stretched to the period's end, and a day after the cut
was counted with the state the reading stopped on. history() and logbook() still return their plain lists, and still
set the two attributes: a starter skill edited on the villa is kept by updates and still reads them.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import NamedTuple


def unread(what: str, when: str) -> str:
    """THE sentence for a read stopped short, every reader's (it was /investigate's first): "<what> could not be read
    whole: nothing is known after <when>". The caller words the moment its own way (a clock, a day and a clock)."""
    return f"{what} could not be read whole: nothing is known after {when}"


def until(end: datetime, now: datetime | None = None) -> datetime:
    """A period's end brought back to now: a period that would end later ends now (villa, 2026-10-15: "--end" today was
    midnight tonight, and a sensor offline since read an hour longer than it had been)."""
    return min(end, now or datetime.now(timezone.utc))


def _when(row: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(row.get("last_changed") or row.get("last_updated")))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- an automation's run, read off a logbook row
#: How the logbook names a run the villa's SYSTEM started, in the logbook's own words (a row's `source`, the end of its
#: "triggered by …" message) — never a villa's data: a reload of the rules fires every rule once
#: ("event 'automation_reloaded'"), so does a start ("event 'homeassistant_start'" / "…_started"; older: the words
#: "Home Assistant starting"). Such a run re-checks the rule's condition and stops: it is nobody's action.
SYSTEM_RELOAD = ("event 'automation_",)
SYSTEM_START = ("event 'homeassistant_", "Home Assistant starting")
TRIGGERED, TRIGGERED_BY = "triggered", "triggered by "


class Run(NamedTuple):
    """One run of an automation: when, what started it (the logbook's words: "state of lock.x", "time",
    "event 'automation_reloaded'"; "" when the row does not say), whether the villa's system started it itself."""
    at: datetime
    started_by: str
    is_system: bool


def system_run(started_by: str) -> str | None:
    """"reloaded" when the rules were reloaded, "started" when the system started; None for any other start."""
    s = str(started_by or "")
    if s.startswith(SYSTEM_RELOAD):
        return "reloaded"
    if s.startswith(SYSTEM_START):
        return "started"
    return None


def automation_run(row: dict) -> Run | None:
    """The run a logbook row of an automation records, or None: only a "triggered…" row is a run — "turned on",
    "turned off" are the switch, not a run (architecture review round 2, 2026-10-19: the investigation counted every
    row as a run and worded a reload at 16:59 as 23 "Automation “X” ran … check whether it did" lines; the weekly
    page already kept "triggered" rows only). The two readers now share this one reading."""
    message = str(row.get("message") or "")
    if not message.startswith(TRIGGERED):
        return None
    try:
        at = datetime.fromisoformat(str(row.get("when") or row.get("last_changed") or ""))
    except ValueError:
        return None
    started_by = str(row.get("source") or "") or (message[len(TRIGGERED_BY):] if message.startswith(TRIGGERED_BY) else "")
    return Run(at, started_by, system_run(started_by) is not None)


class History:
    """Each entity's recorded states over [start, end) and how far each reading reached.

    `rows`: as Home Assistant answers — the state carried over from before `start` stamped at `start`, then each
    change. `cut`: {entity: where its reading stopped}, only for a reading that stopped before `end`."""

    def __init__(self, rows: dict[str, list[dict]], start: datetime, end: datetime,
                 cut: dict[str, datetime] | None = None, kept_from: datetime | None = None):
        self.rows, self.start, self.end = rows, start, max(start, end)
        self.cut = {e: t for e, t in (cut or {}).items() if t is not None and t < self.end}
        self.kept_from = kept_from

    @property
    def older_than_kept(self) -> datetime | None:
        """Where the villa's detail begins, when this period starts before it (vesta_shared.retention): the part
        before it is not "nothing happened" but "no longer kept"; None when the whole period is kept."""
        return self.kept_from if self.kept_from is not None and self.start < self.kept_from else None

    def reach(self, entity_id: str) -> datetime:
        """How far this entity's reading got: the period's end, or where it stopped."""
        return self.cut.get(entity_id, self.end)

    def whole(self, entity_id: str | None = None) -> bool:
        return not self.cut if entity_id is None else entity_id not in self.cut

    def changes(self, entity_id: str) -> list[tuple[datetime, str]]:
        """(moment, state) of each row read, oldest first; a row without a readable moment is left out."""
        out = [(t, "" if r.get("state") is None else str(r.get("state")))
               for r in self.rows.get(entity_id) or [] if (t := _when(r)) is not None]
        return sorted(out, key=lambda x: x[0])

    def state_at(self, entity_id: str, moment: datetime) -> str | None:
        """The state at `moment`; None where it is not known — before the period, past the reach, or before the first
        row read."""
        if moment < self.start or moment > self.reach(entity_id):
            return None
        state = None
        for t, s in self.changes(entity_id):
            if t > moment:
                break
            state = s
        return state

    def periods(self, entity_id: str) -> list[tuple[datetime, datetime, str]]:
        """(from, to, state) of each state, the last one to the reach — never to the period's end past it."""
        reach, out = self.reach(entity_id), []
        rows = [(max(t, self.start), s) for t, s in self.changes(entity_id) if t <= reach]
        for i, (t, s) in enumerate(rows):
            to = rows[i + 1][0] if i + 1 < len(rows) else reach
            if out and out[-1][2] == s:
                out[-1] = (out[-1][0], to, s)
            elif to > t:
                out.append((t, to, s))
        return out


class Logbook:
    """The logbook's rows over [start, end) and how far the reading reached (`cut`: where it stopped, or None)."""

    def __init__(self, rows: list[dict], start: datetime, end: datetime, cut: datetime | None = None,
                 kept_from: datetime | None = None):
        self.rows, self.start, self.end = rows, start, max(start, end)
        self.cut = cut if cut is not None and cut < self.end else None
        self.kept_from = kept_from

    @property
    def older_than_kept(self) -> datetime | None:
        """Where the villa's logbook begins, when this period starts before it (History.older_than_kept)."""
        return self.kept_from if self.kept_from is not None and self.start < self.kept_from else None

    @property
    def reach(self) -> datetime:
        return self.end if self.cut is None else self.cut

    @property
    def whole(self) -> bool:
        return self.cut is None
