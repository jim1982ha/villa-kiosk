"""Which wall clock the villa keeps. The agent tier's one answer.

⚠️ THE AGENT'S OWN TIMEZONE SETTING HAS NEVER BEEN LEARNED, DESPITE SAYING IT
WAS. `config.py`'s `timezone` field carries the comment "it is read from
discovery where possible rather than typed" — and nothing in this tree ever
wrote it. Its only writer is the settings screen. So on an install where nobody
typed it, every `resolve_timezone(cfg["timezone"])` in this tier silently
degraded to UTC, which on the reference property is wrong by eight hours.

⚠️ THE BRIEF TIER ALREADY SOLVED THIS AND CACHED THE ANSWER. `pipeline.resolve_zone`
asks Home Assistant for `time_zone` once and persists it into
`reports-state.json`. Reading that cache is what makes this resolver
synchronous — the tool boundary that needs a zone has no session and no
`await` — and it means the villa is asked ONCE per install rather than once per
layer. One property, one wall clock, learned in one place.

⚠️ THE ORDER MIRRORS `pipeline.resolve_zone` EXACTLY, minus the fetch: an
operator's explicit setting wins, then the learned cache, then UTC — and UTC
says so loudly rather than pretending. Any other order would let the two tiers
schedule and narrate in different zones, which is worse than either being
wrong.
"""

from __future__ import annotations

from datetime import timezone, tzinfo
from typing import Any, Mapping, Optional

from vesta.adapters import schedule as schedule_mod
from vesta.adapters import store
from vesta.adapters.log import warn

#: Remembered for the life of the process so a per-tool-call resolution does not
#: re-read the state file, and so the UTC warning is not shouted per call.
_RESOLVED: Optional[tzinfo] = None
_WARNED = False


def villa_zone(config: Optional[Mapping[str, Any]] = None) -> tzinfo:
    """The villa's wall clock. Never raises; degrades to UTC.

    ⚠️ CACHED PER PROCESS, NOT PER CALL, and deliberately NOT invalidated: a
    property does not change timezone while the add-on is running, and a
    resolver that re-read a file on every rendered timestamp would put file I/O
    inside a loop over a history series.
    """
    global _RESOLVED, _WARNED
    if _RESOLVED is not None:
        return _RESOLVED

    explicit = str((config or {}).get("timezone") or "")
    if explicit:
        _RESOLVED = schedule_mod.resolve_timezone(explicit)
        return _RESOLVED

    cached: Any = None
    try:
        state = store.read_json(store.REPORTS_STATE_FILE, store.EMPTY_STATE)
        cached = state.get("timezone") if isinstance(state, dict) else None
    except Exception:  # noqa: BLE001 - a missing state file is not a failure
        cached = None
    if isinstance(cached, str) and cached:
        _RESOLVED = schedule_mod.resolve_timezone(cached)
        return _RESOLVED

    if not _WARNED:
        warn("narrating times in UTC — the villa's timezone is neither "
             "configured nor yet learned from Home Assistant, so alerts will "
             "name the wrong hour on any property that is not at UTC+0")
        _WARNED = True
    _RESOLVED = timezone.utc
    return _RESOLVED


def zone_name(zone: tzinfo) -> str:
    """How the zone should be NAMED to a reader — "Asia/Singapore", or the
    offset when the zone has no name to give."""
    name = getattr(zone, "key", "")
    return str(name) if name else "UTC"


def reset_for_test() -> None:
    """Forget the resolved zone. ⚠️ FOR TESTS ONLY — the cache above is what
    keeps this off the hot path, and a production caller clearing it would put
    a file read back inside every rendered timestamp."""
    global _RESOLVED, _WARNED
    _RESOLVED = None
    _WARNED = False
