"""What a device's state says — offline, a battery's charge — one reading for every skill.

⚠️ THE REPORTS AND THE NIGHT CHECK JUDGED THE SAME DEVICE TWO WAYS (architecture review, 2026-10-07):
  - "unknown" is a sensor with no value to give (a wind chill on a warm day) while its device reports; the night
    check learnt that on 2026-10-04, the weekly report still counted such sensors as offline devices;
  - a battery reporting in volts was read by the report as a percentage: a 3.0 V cell showed "3 %, replace".

⚠️ ONE READING, EVERY CALLER (architecture review, 2026-10-13): five scripts kept their own tuple of "does not answer"
states, and the night check's reconnect count still put "unknown" in it — a sensor with no value now and then read as
"dropped and reconnected 12 times: a Wi-Fi or power problem". Home Assistant itself says "unavailable" when it loses
a device; "unknown" is an entity that answers with no value (a button never pressed, a select with no option, a wind
chill on a still day). A device lost for good while saying "unknown" is the silent check's (PM-SILENT), not this one's.
"""
from __future__ import annotations

OFFLINE = frozenset({"unavailable"})          # lost; "unknown" is not offline
NO_VALUE = frozenset({"unknown", ""})         # it answers, without a value
#: What a state says, one of four. ABSENT is an entity Home Assistant does not have (no state at all).
ANSWERS, NO_VALUE_NOW, OFFLINE_NOW, ABSENT = "answers", "no value", "offline", "absent"


def reading(state) -> str:
    """What `state` (a state string, or None for an entity Home Assistant does not have) says of its device."""
    if state is None:
        return ABSENT
    st = str(state)
    return OFFLINE_NOW if st in OFFLINE else NO_VALUE_NOW if st in NO_VALUE else ANSWERS


def is_offline(state) -> bool:
    return reading(state) == OFFLINE_NOW


def has_value(state) -> bool:
    """A value to read: neither absent, offline nor without a value."""
    return reading(state) == ANSWERS


def out_of(row: dict, bad, now, minutes: float, unknown_tells: bool = False, offline_ok: bool = False) -> bool:
    """Has this entity (a state row: state, last_changed) been out of the `bad` states for `minutes`? Offline counts as
    out of them only when `offline_ok` (a rule that does not list it); "unknown" only when `unknown_tells` (a device that reports, its sensor without a value:
    back online — never "the door is locked").

    ⚠️ ONE ANSWER TO "IS IT BACK" (architecture review 22): the alert desk said "unknown" was not back, the night check's
    recheck said it was, and the desk knew only "unavailable" — a Wi-Fi access point "disconnected" never closed."""
    from datetime import datetime, timedelta, timezone
    st, since = str(row.get("state") or ""), row.get("last_changed")
    if not st or st in bad or (is_offline(st) and not offline_ok) or (reading(st) == NO_VALUE_NOW and not unknown_tells) or not since:
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


def ha_restarts(logbook: list[dict]) -> list:
    """When Home Assistant said it had started, from logbook rows: its own entry ({"domain": "homeassistant",
    "message": "started"}), the same on every install."""
    from datetime import datetime
    out = []
    for r in logbook:
        if r.get("domain") == "homeassistant" and str(r.get("message") or "").strip().lower() == "started":
            try:
                out.append(datetime.fromisoformat(str(r["when"])))
            except (KeyError, ValueError):
                continue
    return sorted(out)


def in_restart(when, restarts: list, settle_minutes: float) -> bool:
    """Is `when` within `settle_minutes` of a Home Assistant start (before it: the integrations loading; after it: the
    devices answering again)?

    ⚠️ HOME ASSISTANT SAYS WHEN IT RESTARTED (2026-10-13): a minute with 20 entities dropping together was taken for a
    restart — but one Wi-Fi relay is nine entities, so three relays losing the same access point were "a restart" and
    their drops never counted, while a small villa's real restart might stay under 20. Its own "started" entry decides."""
    from datetime import timedelta
    return any(abs(when - r) <= timedelta(minutes=settle_minutes) for r in restarts)


class RestartDrops:
    """The drops of a stretch of logbook rows, each judged against the villa system's restarts — ONE answer to "was
    this drop the restart's?" for the nightly check and the investigation.

    ⚠️ ONE ANSWER, TWO SKILLS (architecture review, 2026-10-15): the same rule was written into each on 2026-10-13,
    differently — the night check left out every drop near a restart, the investigation only those that answered again.
    Each now asks this, and keeps its own setting (restart_settle_minutes) and its own words:
    - `at_restart`: the drop came with a restart (within the settle window) — never a device's own reconnect;
    - `theirs`: …and the device answered again with it — the restart's alone, nothing to list;
    - `kept_down`: …and it did not answer again — the restart took it down, said as such."""

    def __init__(self, rows: list[dict], settle_minutes: float):
        from datetime import datetime
        self.restarts = ha_restarts(rows)
        self.settle = settle_minutes
        self._back: set[str] = set()
        went = {r.get("entity_id") for r in rows if is_offline(r.get("state"))}
        for r in rows:
            eid = r.get("entity_id")
            if eid in went and not is_offline(r.get("state")):
                try:
                    if self._near(datetime.fromisoformat(str(r["when"]))):
                        self._back.add(eid)
                except (KeyError, ValueError):
                    continue

    def _near(self, when) -> bool:
        return bool(self.settle) and in_restart(when, self.restarts, self.settle)

    def at_restart(self, entity_id: str, when) -> bool:
        return self._near(when)

    def theirs(self, entity_id: str, when) -> bool:
        return self._near(when) and entity_id in self._back

    def kept_down(self, entity_id: str, when) -> bool:
        return self._near(when) and entity_id not in self._back
