"""Whether the villa's system is restarting, or was when something happened: ONE answer for every check.

  minutes()                 the settle time: the agreement's restartSettle.minutes (DEFAULT_MINUTES without it)
  settling(client, now)     is it starting now, or started less than minutes() ago? (its logbook, read here)
  Guard(client)             a check's run: was it restarting at any moment since the run began? (the wall clock)
  Restarts(rows)            its "stopped" and "started" entries in logbook rows: near(when), settling(now)
  RestartDrops(rows)        each drop of the rows judged against them: at_restart, theirs, kept_down

⚠️ FOUR ANSWERS, TWO SETTINGS (architecture review, 2026-11-13: stopped 14:43:20, started 14:47:43; at 14:49 the 5-minute
check cleared two faults whose devices were still offline). The 5-minute check rested for the agreement's 5 minutes,
the night check's drops and stamps and the investigation used their own restart_settle_minutes (10), the night check's
endings had no rest at all, and an agreement without the value turned the rest off without a word. Every check now
asks here, with the one value both apps use (agent-contract.json restartSettle).

The villa's system says when it restarted: its own logbook entries ({"domain": "homeassistant", "message": "stopped"}
and "started"), the same on every install.
"""
from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timedelta, timezone

from . import agreement
from .device_state import is_offline

log = logging.getLogger("vesta.restart")

#: The agreement's own value (agent-contract.json restartSettle: "minutes": 5), used when no copy of it says one — a
#: missing agreement is never "no rest" (the 5-minute check closed faults while the devices were still loading).
DEFAULT_MINUTES = 5
#: How far before the settle time the logbook is read for the restart's "stopped" entry (a stop that lasted longer
#: reads as "started" alone: settled after minutes(), as before).
STOP_READ_MINUTES = 60
_told = False                 # a missing value is said once per run


def minutes() -> float:
    """How long the villa's system is let settle after its start before what it says is believed: the agreement's
    restartSettle.minutes, DEFAULT_MINUTES (said on stderr) when the agreement has none."""
    m = agreement.section("restartSettle").get("minutes")
    if isinstance(m, (int, float)) and not isinstance(m, bool) and m > 0:
        return float(m)
    global _told
    if not _told:
        _told = True
        print(f"The agreement with the Kiosk has no restartSettle.minutes: the villa's system is let settle "
              f"{DEFAULT_MINUTES} minutes after a restart", file=sys.stderr)
    return float(DEFAULT_MINUTES)


def _said(rows: list[dict]) -> list[tuple[datetime, str]]:
    """(when, "stopped" | "started") of the villa system's own entries in `rows`, in order."""
    out = []
    for r in rows:
        said = str(r.get("message") or "").strip().lower()
        if r.get("domain") != "homeassistant" or said not in ("stopped", "started"):
            continue
        try:
            out.append((datetime.fromisoformat(str(r["when"])), said))
        except (KeyError, ValueError):
            continue
    return sorted(out)


class Restarts:
    """The restarts in a stretch of logbook rows: each from its "stopped" entry (its "started" one alone when the rows
    hold no stop before it) to its "started" one. `settle`: minutes() when not said."""

    def __init__(self, rows: list[dict], settle: float | None = None):
        self.settle = minutes() if settle is None else float(settle)
        said = _said(rows)
        self.starts = [t for t, s in said if s == "started"]
        self.spans: list[tuple[datetime, datetime]] = []
        stop = None
        for t, s in said:
            if s == "stopped":
                stop = stop or t
            else:
                self.spans.append((stop or t, t))
                stop = None
        self.stopped = stop                    # a stop with no start after it: still starting

    def near(self, when: datetime) -> bool:
        """Is `when` a restart's: from `settle` before its stop (the integrations unloading) to `settle` after its start
        (the devices answering again)? A drop there is the restart's, never a device's own.

        ⚠️ HOME ASSISTANT SAYS WHEN IT RESTARTED (2026-10-13): a minute with 20 entities dropping together was taken for
        a restart — but one Wi-Fi relay is nine entities. Its own entries decide."""
        if not self.settle:
            return False
        pad = timedelta(minutes=self.settle)
        if self.stopped is not None and when >= self.stopped - pad:
            return True
        return any(begin - pad <= when <= start + pad for begin, start in self.spans)

    def settling(self, now: datetime) -> bool:
        """Is the villa's system still starting (a stop with no start after it), or started less than `settle` before
        `now`? Its integrations load in that time, and a device of one not loaded yet reads "not found" or "unavailable".

        ⚠️ "MISSING" DURING A RESTART (owner, 2026-11-13: stopped 14:43, started 14:47, the LED Strip's integration loaded
        at 14:52; the 5-minute check at 14:49 opened "LED Strip is missing from the villa's system")."""
        if self.stopped is not None:
            return True
        return bool(self.starts) and now - self.starts[-1] < timedelta(minutes=self.settle)


    def during(self, start: datetime, end: datetime) -> bool:
        """Was the villa's system restarting, or settling after a start, at any moment from `start` to `end`? (A stop
        with no start after it, or a restart from its stop to `settle` after its start, meeting that span.)
        during(now, now) is settling(now)."""
        if self.stopped is not None and self.stopped <= end:
            return True
        pad = timedelta(minutes=self.settle)
        return any(begin <= end and start < began + pad for begin, began in self.spans)


def _logbook(client, start: datetime, end: datetime) -> list[dict] | None:
    """The villa's logbook from `start` to `end`, None when it cannot be read (said on stderr)."""
    try:
        return client.logbook(start, end)
    except Exception as e:  # noqa: BLE001 — not readable: judged as settled
        print(f"The villa's logbook could not be read to tell a restart ({type(e).__name__})", file=sys.stderr)
        return None


def settling(client, now: datetime) -> bool:
    """Is the villa's system restarting at `now`, or settling after its start (Restarts.settling, its logbook read
    here)? Nothing is opened or closed then. A logbook that cannot be read: not settling (said on stderr) — a villa
    whose logbook never answers would otherwise never be checked."""
    settle = minutes()
    rows = _logbook(client, now - timedelta(minutes=settle + STOP_READ_MINUTES), now)
    return rows is not None and Restarts(rows, settle).settling(now)


class Guard:
    """One check's run against the villa system's restarts, judged on the WALL clock — the moment the villa's states
    are read, never the day a night check judges (--as-of) — over the whole run: `settling()` asks whether it was
    restarting at any moment from the run's start (`began`) to now. `now`: the moment the run began (the tests' --now;
    the wall clock when not given), counted on by the time the run has taken. No `client` (no villa's system to read):
    never settling.

    ⚠️ JUDGED ONCE AT THE END OF A 30-MINUTE RUN (architecture review, 2026-11-14): the night check asked "is it
    settling at the night's end?" (its --as-of day: a night check of an earlier day never rested), once, after up to 30
    minutes of reading — a restart in the middle of its reading, settled by the end, was not seen."""

    def __init__(self, client, now: datetime | None = None):
        self.client = client
        self.began = now or datetime.now(timezone.utc)
        self._t0 = time.monotonic()

    def now(self) -> datetime:
        """The moment it is now, on the run's clock."""
        return self.began + timedelta(seconds=time.monotonic() - self._t0)

    def settling(self) -> bool:
        """Was the villa's system restarting, or settling after a start, at any moment of this run so far
        (Restarts.during)? A logbook that cannot be read: not settling (as settling())."""
        if self.client is None:
            return False
        settle, end = minutes(), self.now()
        rows = _logbook(self.client, self.began - timedelta(minutes=settle + STOP_READ_MINUTES),
                        end + timedelta(seconds=1))
        return rows is not None and Restarts(rows, settle).during(self.began, end)

    def settled_at(self) -> datetime:
        """When a run resting now may try again: the settle time from now."""
        return self.now() + timedelta(minutes=minutes())


class RestartDrops:
    """The drops of a stretch of logbook rows, each judged against the villa system's restarts — ONE answer to "was
    this drop the restart's?" for the nightly check and the investigation, with the one settle time (minutes()):
    - `at_restart`: the drop came with a restart (Restarts.near) — never a device's own reconnect;
    - `theirs`: …and the device answered again with it — the restart's alone, nothing to list;
    - `kept_down`: …and it did not answer again — the restart took it down, said as such.

    ⚠️ ONE ANSWER, TWO SKILLS (architecture review, 2026-10-15): the same rule was written into each on 2026-10-13,
    differently — the night check left out every drop near a restart, the investigation only those that answered again."""

    def __init__(self, rows: list[dict], settle_minutes: float | None = None):
        self._r = Restarts(rows, settle_minutes)
        self.restarts = self._r.starts
        self.settle = self._r.settle
        self._back: set[str] = set()
        went = {r.get("entity_id") for r in rows if is_offline(r.get("state"))}
        for r in rows:
            eid = r.get("entity_id")
            if eid in went and not is_offline(r.get("state")):
                try:
                    if self._r.near(datetime.fromisoformat(str(r["when"]))):
                        self._back.add(eid)
                except (KeyError, ValueError):
                    continue

    def at_restart(self, entity_id: str, when) -> bool:
        return self._r.near(when)

    def theirs(self, entity_id: str, when) -> bool:
        return self._r.near(when) and entity_id in self._back

    def kept_down(self, entity_id: str, when) -> bool:
        return self._r.near(when) and entity_id not in self._back
