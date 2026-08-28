"""Long-term statistics: what exists, and what it did over a window.

Home Assistant's recorder keeps two things per statistic — 5-minute rows for a
few days, and hourly/daily rollups forever. This module reads the rollups,
because a report looks back weeks and the short-term table simply does not go
that far.

⚠️ THE ONE THING THAT IS EASY TO GET WRONG, AND WRONG QUIETLY: `sum` vs
`change` for a `total_increasing` statistic. An energy meter's `sum` is a
running total since the recorder started — a number in the hundreds of
thousands that means nothing on its own and that a naive reader will happily
present as "yesterday's consumption". `change` is the delta within each
returned bucket, which is what every question a report asks is actually about.
Asking for `sum` and subtracting consecutive buckets yourself gets the same
answer right up until a meter resets, which `total_increasing` explicitly
allows and which HA's own `change` already compensates for.

So: this module requests `change` and exposes nothing else for increasing
statistics. `mean`/`min`/`max` are for `measurement` statistics (temperature,
power draw), where a delta would be meaningless.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from vesta.adapters.hass import HassClient, HassUnavailable
from vesta.adapters.log import warn

# `statistics_during_period` takes a list of ids and returns a dict keyed by
# them. Asking for hundreds at once builds a response big enough to stall the
# recorder on a Pi; asking one at a time pays the round trip hundreds of times.
# 50 is the plan's figure and is a reasonable middle — small enough that a
# failure loses one chunk rather than the pass.
CHUNK = 50

# Which statistic types exist for which kind of sensor. `state_class` decides:
# total/total_increasing accumulate, measurement samples.
ACCUMULATING = ("total", "total_increasing")


def start_of_day(now: datetime, days_back: int = 0) -> datetime:
    """Midnight, local wall clock, `days_back` days ago.

    ⚠️ WALL CLOCK, NOT 24-HOUR MULTIPLES. A report covering "the last 7 days"
    must line up with the days a person lived through, and two of those days
    are 23 or 25 hours long wherever DST applies. Subtracting `7 * 86400`
    seconds gives a window that starts an hour off for half the year, which
    shifts every daily bucket and makes a day-of-week baseline compare Monday
    against a slice of Sunday.

    `now` is expected to already carry the villa's timezone.
    """
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if days_back:
        # Arithmetic on the DATE, then re-attached to midnight, so a DST
        # transition inside the window cannot accumulate an offset.
        midnight = (midnight - timedelta(days=days_back)).replace(
            hour=0, minute=0, second=0, microsecond=0)
    return midnight


def _iso(moment: datetime) -> str:
    """HA wants an ISO timestamp; naive values are assumed UTC rather than
    silently reinterpreted as local, which would move the window by the
    offset."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.isoformat()


def chunked(items: Sequence[str], size: int = CHUNK) -> Iterable[Sequence[str]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


async def list_statistic_ids(hass: HassClient,
                             statistic_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """Every statistic the recorder knows about.

    ⚠️ CACHE THIS PER PASS, never across passes. It is one of the more
    expensive commands Core answers (it walks the whole statistics metadata
    table), and a report pass asks for it from several modules — but caching it
    beyond one pass means a device added today is invisible until a restart.
    The caching belongs to the caller that owns the pass, not here, so this
    function stays honest about doing the work.
    """
    payload: Dict[str, Any] = {}
    if statistic_type:
        payload["statistic_type"] = statistic_type
    result: Any = await hass.command("recorder/list_statistic_ids", **payload)
    return [row for row in result if isinstance(row, dict)] if isinstance(result, list) else []


async def statistics_during_period(
    hass: HassClient,
    statistic_ids: Sequence[str],
    start: datetime,
    end: Optional[datetime] = None,
    period: str = "day",
    types: Sequence[str] = ("change",),
) -> Dict[str, List[Dict[str, Any]]]:
    """Bucketed statistics for many ids, chunked and merged.

    A failing chunk is WARNED AND SKIPPED rather than aborting the pass: one
    statistic that 404s (a renamed entity whose metadata lingers) would
    otherwise cost the report every other statistic in the same request. The
    caller sees the id simply absent from the result, which `completeness`
    downstream is built to express.
    """
    merged: Dict[str, List[Dict[str, Any]]] = {}
    for group in chunked(list(statistic_ids)):
        payload: Dict[str, Any] = {
            "start_time": _iso(start),
            "statistic_ids": list(group),
            "period": period,
            "types": list(types),
        }
        if end is not None:
            payload["end_time"] = _iso(end)
        try:
            result: Any = await hass.command("recorder/statistics_during_period", **payload)
        except HassUnavailable as err:
            warn(f"statistics chunk of {len(group)} failed, skipping: {err}")
            continue
        if isinstance(result, dict):
            for key, rows in result.items():
                if isinstance(rows, list):
                    merged[key] = [row for row in rows if isinstance(row, dict)]
    return merged


def total_change(rows: Sequence[Dict[str, Any]]) -> Optional[float]:
    """Sum the per-bucket `change` values, or None if there is nothing usable.

    None rather than 0.0 deliberately: "this meter recorded no consumption" and
    "this meter reported nothing at all" are different findings, and a report
    that shows 0 kWh for an offline meter is stating a measurement it does not
    have. DATA_QUALITY exists for the second case.
    """
    values = [row["change"] for row in rows
              if isinstance(row.get("change"), (int, float))]
    if not values:
        return None
    return float(sum(values))


def completeness(rows: Sequence[Dict[str, Any]], expected_buckets: int) -> float:
    """What fraction of the expected buckets actually carried a value.

    Travels with every finding so a conclusion drawn from four days of a
    fourteen-day window can say so, rather than presenting itself with the same
    confidence as a full one.
    """
    if expected_buckets <= 0:
        return 0.0
    present = sum(1 for row in rows if isinstance(row.get("change"), (int, float)))
    return min(1.0, present / expected_buckets)


def accumulating_ids(metadata: Sequence[Dict[str, Any]]) -> List[str]:
    """The statistic ids that accumulate, so `change` is the right question.

    Reads `has_sum`, which the recorder sets for total/total_increasing, rather
    than inferring from the entity's current `state_class` — the metadata is
    what the stored statistics were actually recorded under, and an entity
    whose state_class was changed later still has its old rows.
    """
    return [row["statistic_id"] for row in metadata
            if isinstance(row.get("statistic_id"), str) and row.get("has_sum")]


def measurement_ids(metadata: Sequence[Dict[str, Any]]) -> List[str]:
    """Statistics sampled rather than accumulated — mean/min/max apply."""
    return [row["statistic_id"] for row in metadata
            if isinstance(row.get("statistic_id"), str)
            and row.get("has_mean") and not row.get("has_sum")]


def statistics_fetcher(session: Any, now_local: Any,
                       tally: Dict[str, Any]) -> Any:
    """The ONLY way an analysis module gets data. TASK-115 step 8.

    ⚠️ MOVED HERE FROM `brief/pipeline.py`, WHERE IT WAS A PRIVATE — and the
    private-ness was the debt: `agent/tools/analysis.py` reached
    `pipeline._statistics_fetcher`, the single supervise → brief edge in the
    lattice, carried in test_layering's ALLOWED_DEBT with this extraction named
    as its payment. Both halves (the briefing's module runs and the agent's
    analysis tools) now get it from the adapter that owns the statistics call
    it wraps, and the debt list is empty.

    ⚠️ MODULES DO NOT GET THE SESSION. A module that can open its own websocket
    can also make its own unbudgeted queries, and the scheduler could then no
    longer bound a pass — one badly written module would stall the proxy's
    event loop, and the kiosk's own API alongside it. Modules ask; this
    fetches, chunked and with `change` rather than `sum`.

    Hourly, because the idle floor a module looks for is a property of the
    hours within a day — daily buckets average it away entirely.
    """
    from .hass import HassClient, HassUnavailable
    from .log import warn

    async def fetch(ids: Sequence[str], days: int) -> Dict[str, List[Dict[str, Any]]]:
        if not ids:
            return {}
        start = start_of_day(now_local, days)
        try:
            async with HassClient(session) as hass:
                series = await statistics_during_period(
                    hass, list(ids), start, period="hour", types=("change",))
        except HassUnavailable as err:
            warn(f"statistics unavailable for this pass: {err}")
            tally["error"] = str(err)
            series = {}
        # ⚠️ RECORDED, NOT ASSUMED. "The module found nothing" and "the module
        # received nothing" produce an identical report, and telling them apart
        # by reading the code is guesswork. A live preview that returns no
        # findings is uninterpretable without these three numbers.
        tally["requested"] = tally.get("requested", 0) + len(ids)
        tally["returned"] = tally.get("returned", 0) + len(series)
        tally["rows"] = tally.get("rows", 0) + sum(len(v) for v in series.values())
        tally["days_asked"] = days
        tally["empty_ids"] = sorted(i for i in ids if not series.get(i))[:5]
        # ⚠️ THE RAW SHAPE, verbatim. The `start` field's type is the whole
        # reason Phase 3's first live run found nothing, and a tally of counts
        # could not have shown it — 11,859 rows arrived and every one was
        # unusable. Recording one real row makes the next reading confirm the
        # diagnosis instead of assuming the fix is why anything changed.
        for rows in series.values():
            if rows:
                tally["sample_row"] = rows[0]
                break
        return series

    return fetch
