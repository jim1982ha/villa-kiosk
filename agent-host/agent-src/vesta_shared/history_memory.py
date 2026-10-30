"""A device's past, kept between two readings of a job that runs every few minutes.

⚠️ THE PAST WAS READ AGAIN EVERY 5 MINUTES (owner, 2026-10-30: the preventive-maintenance recheck took 41.9 s, then
89.6 s; each pass read every offline device's last week again, though what a device said a week ago never changes).
`remembered(client, store, key, now)` is a client's history(ids, start, end) that keeps what it read in the store
under `key`: the next pass reads only from where the last one settled. Only the settled past is kept: a reading of the
last `settled_minutes` may still be written by the villa's system, so it is read again every time. A device whose
reading stopped short (history_cut) is never kept, nor one with more rows than `kept_rows`: it is read whole next time.
Only the devices asked for in the last pass are kept, from the start asked for (the store stays as small as one read).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .limits import limit


def settled_minutes() -> float:
    return limit("history.settled_minutes", 10, unit="minutes", group="read", lo=1, hi=120,
                 says="How recent a device's history is still read again on every pass of a job that runs every few "
                      "minutes (older readings are kept from the last pass).",
                 reached="Readings older than this are taken from the last pass, not read again.", told="")


def kept_rows() -> int:
    return limit("history.kept_rows", 5000, unit="readings", group="read", lo=100, hi=100000,
                 says="Readings of one device a job that runs every few minutes keeps between two passes.",
                 reached="A busier device is read whole again on every pass.", told="")


def _when(row: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(row.get("last_changed") or row.get("last_updated")))
    except (TypeError, ValueError):
        return None


def _from(rows: list[dict], start: datetime) -> list[dict]:
    """`rows` (oldest first, as history answers) as a read from `start` answers them: the state held at `start`,
    stamped at `start` when it began before, then each change after."""
    before = [r for r in rows if (t := _when(r)) is not None and t <= start]
    after = [r for r in rows if (t := _when(r)) is not None and t > start]
    head = []
    if before:
        last = before[-1]
        head = [last if _when(last) == start else {**last, "last_changed": start.isoformat()}]
    return head + after


def remembered(client, store, key: str, now: datetime):
    """client.history(ids, start, end), keeping the settled past in `store` under `key` (module doc)."""

    def history(entity_ids, start: datetime, end: datetime) -> dict[str, list[dict]]:
        ids = list(dict.fromkeys(entity_ids))
        kept = (store.cache_get(key) or {}).get("devices") or {}
        settled = min(end, now - timedelta(minutes=settled_minutes()))
        old: dict[str, list[dict]] = {}
        # each device kept from at most `start` reads on from where its last pass settled; the others from `start`
        reads: dict[datetime, list[str]] = {}
        for eid in ids:
            k = kept.get(eid) or {}
            try:
                frm, to = datetime.fromisoformat(k["from"]), datetime.fromisoformat(k["to"])
            except (KeyError, TypeError, ValueError):
                frm = to = None
            if frm is not None and frm <= start <= to:
                old[eid] = [r for r in k.get("rows") or [] if (t := _when(r)) is not None and t < end]
                reads.setdefault(min(to, end), []).append(eid)       # nothing to read when it settled past `end`
            else:
                reads.setdefault(start, []).append(eid)
        out: dict[str, list[dict]] = {}
        cut: dict[str, datetime] = {}
        for at, group in reads.items():
            got = client.history(group, at, end) if at < end else {e: [] for e in group}
            cut.update(getattr(client, "history_cut", None) or {})
            for eid in group:
                new = list(got.get(eid) or [])
                rows = old.get(eid, [])
                if rows and new and new[0].get("state") == rows[-1].get("state"):
                    new = new[1:]                       # the carried-over state at the pass's start: no change
                out[eid] = _from(rows + new, start)
        if hasattr(client, "history_cut"):
            client.history_cut = {e: t for e, t in cut.items() if e in out}   # what the caller would have read
        cap = kept_rows()
        devices = {}
        for eid, rows in out.items():
            if eid in cut:
                continue                                 # stopped short: not known whole, read again next time
            settled_rows = [r for r in rows if (t := _when(r)) is not None and t < settled]
            if len(settled_rows) <= cap:
                devices[eid] = {"from": start.isoformat(), "to": settled.isoformat(), "rows": settled_rows}
        store.cache_put(key, {"devices": devices})
        return out

    return history
