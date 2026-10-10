"""What a device's state says — offline, a battery's charge — one reading for every skill.

⚠️ THE REPORTS AND THE NIGHT CHECK JUDGED THE SAME DEVICE TWO WAYS (architecture review, 2026-10-07):
  - "unknown" is a sensor with no value to give (a wind chill on a warm day) while its device reports; the night
    check learnt that on 2026-10-04, the weekly report still counted such sensors as offline devices;
  - a battery reporting in volts was read by the report as a percentage: a 3.0 V cell showed "3 %, replace".
"""
from __future__ import annotations

OFFLINE = frozenset({"unavailable"})          # lost; "unknown" is not offline


def is_offline(state) -> bool:
    return str(state or "") in OFFLINE


def out_of(row: dict, bad, now, minutes: float, unknown_tells: bool = False, offline_ok: bool = False) -> bool:
    """Has this entity (a state row: state, last_changed) been out of the `bad` states for `minutes`? Offline counts as
    out of them only when `offline_ok` (a rule that does not list it); "unknown" only when `unknown_tells` (a device that reports, its sensor without a value:
    back online — never "the door is locked").

    ⚠️ ONE ANSWER TO "IS IT BACK" (architecture review 22): the alert desk said "unknown" was not back, the night check's
    recheck said it was, and the desk knew only "unavailable" — a Wi-Fi access point "disconnected" never closed."""
    from datetime import datetime, timedelta, timezone
    st, since = str(row.get("state") or ""), row.get("last_changed")
    if not st or st in bad or (is_offline(st) and not offline_ok) or (st == "unknown" and not unknown_tells) or not since:
        return False
    return now - datetime.fromisoformat(since).astimezone(timezone.utc) >= timedelta(minutes=minutes)


def battery_charge(value: float | None, unit: str | None, nominal_v: float | None = None) -> float | None:
    """A battery's charge in %: as the sensor gives it (%), or its voltage against its nominal voltage (V).
    None when it cannot be told — volts with no nominal set (the night check asks for the helper)."""
    if value is None:
        return None
    unit = (unit or "%").strip()
    if unit == "%":
        return float(value)
    if unit == "V":
        return round(min(100.0, value / nominal_v * 100), 1) if nominal_v else None
    return None
