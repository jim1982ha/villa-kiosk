"""How far back the villa's detailed history goes — measured on the villa, never assumed — and the long-term figures
that take over before it.

⚠️ "NOTHING RECORDED" WAS "NO LONGER KEPT" (owner, 2026-10-20: "I want the skills to read the Detailed history setting
and be clever enough to switch to long-term memory when necessary"). The villa's system keeps every change for a number
of days (its recorder's purge_keep_days, 10 by default) and, for measured values, one figure an hour for ever. Neither
ha-mcp nor any skill knew the number: a period older than it read as empty, and was said as "nothing recorded".

`measure(client)` finds the oldest change the villa's system still holds (the knowledge pack's nightly build: the
`retention` it carries). A reader then knows where detail ends (`HABase.kept_from`), says so, and reads the hourly
figures for the part before it (`older_figures`).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

#: A device every villa's system has, changing twice a day: its oldest change is where the detailed history begins
PROBE = "sun.sun"
LONGEST_DAYS = 3650


def _has(client, day_ago: int, now: datetime) -> bool:
    a = now - timedelta(days=day_ago + 1)
    rows = client.history([PROBE], a, a + timedelta(days=1)).get(PROBE) or []
    return bool(rows)


def measure(client, now: datetime | None = None) -> float | None:
    """How many days of detailed history the villa's system holds now (its oldest change of PROBE), or None when it
    cannot tell (no PROBE, nothing recorded, a read that failed)."""
    now = now or datetime.now(timezone.utc)
    if not _has(client, 0, now):
        return None
    lo, hi = 0, LONGEST_DAYS                   # lo: a day that has history; hi: one that has none (or the bound)
    if _has(client, hi, now):
        return float(LONGEST_DAYS)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        lo, hi = (mid, hi) if _has(client, mid, now) else (lo, mid)
    a = now - timedelta(days=lo + 1)
    rows = client.history([PROBE], a, a + timedelta(days=1)).get(PROBE) or []
    times = []
    for r in rows:
        try:
            times.append(datetime.fromisoformat(str(r.get("last_changed") or r.get("last_updated"))))
        except ValueError:
            continue
    oldest = min(times) if times else a
    return round((now - oldest).total_seconds() / 86400, 2)


def days_words(days: float) -> str:
    return f"{days:.0f} day{'s' if round(days) != 1 else ''}"


def not_kept(what: str, kept_from_words: str, days: float) -> str:
    """THE sentence for a period older than the detail kept: every reader's."""
    return (f"{what} before {kept_from_words} is no longer kept in detail: the villa's system keeps every change for "
            f"{days_words(days)} only")


def figure_period(start: datetime, end: datetime) -> str:
    """Hourly figures for up to a week, a figure a day beyond (a month of hours is 720 lines to read)."""
    return "hour" if (end - start) <= timedelta(days=7) else "day"


def older_figures(client, ids, start: datetime, kept_from: datetime) -> tuple[str, dict[str, list[dict]]]:
    """The long-term figures of `ids` over [start, kept_from): (the period, {entity: rows}) — a device the villa's
    system keeps no figures of (a door, a lock, a switch) has none."""
    period = figure_period(start, kept_from)
    got = client.statistics(list(ids), start, kept_from, period, ("mean", "min", "max", "change"))
    return period, {e: rows for e, rows in got.items() if rows}


def ai_history_answer(client, args: dict, text: str, days: float | None, now: datetime | None = None) -> str:
    """The AI's own history read, with the part before the detail kept said, and its long-term figures added: the
    AI never answers about an older period from the detail alone (tools.Toolbox). `text`: ha-mcp's answer."""
    if not days or not text:
        return text
    try:
        outer = json.loads(text)
    except ValueError:
        return text
    body = outer.get("data") if isinstance(outer, dict) and isinstance(outer.get("data"), dict) else outer
    if not isinstance(body, dict) or body.get("source") not in (None, "history"):
        return text
    per = body.get("period") or {}
    try:
        start = datetime.fromisoformat(str(per.get("start")))
        end = datetime.fromisoformat(str(per.get("end")))
    except ValueError:
        return text
    now = now or datetime.now(timezone.utc)
    kept_from = now - timedelta(days=days)
    if start >= kept_from:
        return text
    ids = [e.get("entity_id") for e in body.get("entities") or [] if isinstance(e, dict) and e.get("entity_id")]
    until = min(end, kept_from)
    try:
        period, figures = older_figures(client, ids, start, until)
    except Exception:  # noqa: BLE001 — said, never left out
        period, figures = figure_period(start, until), {}
    body["older_than_detail"] = {
        "note": (f"The villa's system keeps every change for {days_words(days)} only: nothing before "
                 f"{kept_from.isoformat(timespec='minutes')} is in the readings above. "
                 + (f"For that older part, its long-term figures (one a {period}: mean, min, max, change) are below: "
                    "answer from them, and say the older part is from figures, not from each change."
                    if figures else
                    "The villa's system keeps no long-term figures of these devices (only measured values have them): "
                    "say that the older part cannot be known.")),
        "kept_from": kept_from.isoformat(timespec="seconds"), "days_kept": days, "period": period,
        "figures": figures, "no_figures": [e for e in ids if e not in figures]}
    return json.dumps(outer, ensure_ascii=False, default=str)


def ai_logbook_answer(args: dict, text: str, days: float | None, now: datetime | None = None) -> str:
    """The AI's own logbook read reaching back past the detail kept: said in its answer."""
    if not days or not text or (args.get("source") or "logbook") != "logbook":
        return text
    now = now or datetime.now(timezone.utc)
    try:
        end = datetime.fromisoformat(str(args["end_time"])) if args.get("end_time") else now
        hours = float(args.get("hours_back") or 1)
    except (TypeError, ValueError):
        return text
    kept_from = now - timedelta(days=days)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end - timedelta(hours=hours) >= kept_from:
        return text
    try:
        outer = json.loads(text)
    except ValueError:
        return text
    body = outer.get("data") if isinstance(outer, dict) and isinstance(outer.get("data"), dict) else outer
    if not isinstance(body, dict):
        return text
    body["older_than_detail"] = {
        "note": (f"The villa's system keeps its logbook for {days_words(days)} only: nothing before "
                 f"{kept_from.isoformat(timespec='minutes')} can be listed. Say so: an empty or short list for that "
                 "part does not mean nothing happened."),
        "kept_from": kept_from.isoformat(timespec="seconds"), "days_kept": days}
    return json.dumps(outer, ensure_ascii=False, default=str)
