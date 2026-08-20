"""Where reports state lives on disk, and what shape it has.

Three documents under `/data`, all owned by this subsystem alone:

  reports-config.json   operator settings. Owner-writable from the SPA.
  reports-history.json  a bounded ring of what was produced and delivered.
                        SERVER-WRITTEN — read-only to every client.
  reports-state.json    scheduler bookkeeping (last fire, idempotency keys).
                        Never shown to anyone; not an API.

⚠️ REPORTS WRITE ONLY THESE FILES. Specifically NOT `fm-data.json`, even
though appending a scheduled report to `FmData.savedDocuments` is the obvious
design and would put manual and scheduled documents in one list. Doing that
means writing the FM store from outside its HTTP handler, which bypasses the
`asyncio.Lock` that `_json_store_handlers` creates per store — and the proxy's
own docstring records that exact defect having shipped once already, when a
hand-written second FM PUT handler copied the auth but not the lock, leaving
the villa's maintenance and cost records with no concurrency protection at all
while several devices wrote them. The separation removes the possibility
instead of managing it, and buys a guarantee worth more than the convenience:
Phase 0 changes no existing behaviour anywhere.

⚠️ THE STORED CONFIG IS A SPARSE OVERLAY, NEVER A SEEDED DOCUMENT. `EMPTY_CONFIG`
is `{}` and defaults are applied at READ time by `config_view()`, never written
back. CLAUDE.md's hard rule states why in general terms; the specific bug it
comes from is worth restating because this subsystem is a prime candidate to
repeat it: a default table spread UNDERNEATH stored config on load resurrects
entries the operator deleted, because "absent" and "deleted" become the same
state. Here that would mean a schedule the owner removed reappearing at the
next restart and delivering a report they had switched off. Absent means
absent; the default is what we FALL BACK to, not what we persist.
"""

from __future__ import annotations

from typing import Any, Dict, Final, List

from .contracts import CADENCE, CONTRACT_VERSION
from .log import warn

DATA_DIR: Final[str] = "/data"

REPORTS_CONFIG_FILE: Final[str] = f"{DATA_DIR}/reports-config.json"
REPORTS_HISTORY_FILE: Final[str] = f"{DATA_DIR}/reports-history.json"
REPORTS_STATE_FILE: Final[str] = f"{DATA_DIR}/reports-state.json"

# Size ceilings, enforced by the proxy's store factory (413 on exceed).
#
# Config is small by nature — a handful of schedules and module toggles — and
# 256 KB is already generous; the ceiling exists so a buggy client cannot fill
# /data, which on HAOS is the same filesystem Home Assistant's database lives
# on. Filling it does not degrade the kiosk, it takes down the house.
REPORTS_CONFIG_MAX_BYTES: Final[int] = 256_000
REPORTS_HISTORY_MAX_BYTES: Final[int] = 2_000_000

# History is a ring, like telemetry. A report entry is metadata plus findings,
# not the rendered prose, so entries are small; 200 is roughly four years of
# weekly reports or seven months of daily ones. Bounded because nothing here
# ever prunes on a timer and an unbounded append-only file on a tablet that
# runs for years is a slow-motion disk-full bug.
REPORTS_HISTORY_MAX_ENTRIES: Final[int] = 200

# ⚠️ EMPTY, NOT SEEDED — see the module docstring.
EMPTY_CONFIG: Final[Dict[str, Any]] = {}
EMPTY_HISTORY: Final[Dict[str, Any]] = {}
EMPTY_STATE: Final[Dict[str, Any]] = {}

# Applied at READ time by config_view(); never written to disk.
#
# `enabled` is False by the plan's D4 and by this add-on's existing posture: a
# feature that reaches out and messages people must be switched on
# deliberately, never inherited from an update. A villa that updates the add-on
# and starts sending its owner unsolicited notifications has done something the
# owner did not ask for.
#
# `schedules` and `notify_targets` are EMPTY lists, not examples. A seeded
# schedule is the resurrection bug above; a seeded notify target would also be
# villa-specific data, which may not ship at all.
CONFIG_DEFAULTS: Final[Dict[str, Any]] = {
    "enabled": False,
    "schedules": [],
    "notify_targets": [],
    "modules": {},
    "narration": {"mode": "deterministic"},
    "timezone": "",          # "" means "ask Home Assistant" (Phase 2)
    "min_history_days": 14,
}


def config_view(raw: Any) -> Dict[str, Any]:
    """The EFFECTIVE config: stored values over defaults, computed per read.

    Accepts anything, because it is fed straight from `_read_json_store`, which
    degrades a corrupt or wrong-typed file to `EMPTY_CONFIG` but cannot vouch
    for the shape of a file some other version of this add-on wrote.

    Deliberately shallow: only top-level keys fall back. A nested merge would
    reintroduce exactly the resurrection bug this file's docstring is about,
    one level down — an operator who empties `narration` gets the default back
    on the next read, which is what they asked for, whereas an operator who
    removes ONE key inside it would silently get that key back with a nested
    merge and no way to express its absence.
    """
    if not isinstance(raw, dict):
        return dict(CONFIG_DEFAULTS)
    view = dict(CONFIG_DEFAULTS)
    for key, value in raw.items():
        if key in CONFIG_DEFAULTS:
            view[key] = value
        else:
            # Kept, not dropped: a config written by a NEWER version of the
            # add-on must survive a downgrade untouched. Silently discarding
            # unknown keys here would mean a rollback quietly deletes the
            # settings the newer version stored.
            view[key] = value
    return view


def validate_config(value: Any) -> List[str]:
    """Structural problems with a proposed config, as human-readable strings.

    Returns [] when acceptable. Validates SHAPE, not policy: whether a notify
    target actually exists is a question for Home Assistant at delivery time,
    and refusing it here would make the config unwritable while HA is
    restarting.

    ⚠️ This is a convenience for the operator, NOT a security boundary. The
    proxy's own role gate is what stops a non-owner writing this store, exactly
    as with every other shared store; see CLAUDE.md on RBAC being server-side.
    """
    problems: List[str] = []
    if not isinstance(value, dict):
        return ["config must be an object"]

    enabled = value.get("enabled", False)
    if not isinstance(enabled, bool):
        problems.append("enabled must be true or false")

    schedules = value.get("schedules", [])
    if not isinstance(schedules, list):
        problems.append("schedules must be a list")
    else:
        for index, item in enumerate(schedules):
            where = f"schedules[{index}]"
            if not isinstance(item, dict):
                problems.append(f"{where} must be an object")
                continue
            cadence = item.get("cadence")
            if cadence not in CADENCE:
                problems.append(
                    f"{where}.cadence must be one of {', '.join(CADENCE)}")
            hour = item.get("hour")
            if not isinstance(hour, int) or isinstance(hour, bool) \
                    or not 0 <= hour <= 23:
                # `isinstance(True, int)` is True in Python, so a JSON `true`
                # would sail through a bare int check and schedule an hour 1.
                problems.append(f"{where}.hour must be an integer 0-23")

    targets = value.get("notify_targets", [])
    if not isinstance(targets, list):
        problems.append("notify_targets must be a list")
    elif not all(isinstance(t, str) for t in targets):
        problems.append("notify_targets must be a list of strings")

    return problems


def history_view(raw: Any) -> Dict[str, Any]:
    """The history document, shaped, whatever is on disk."""
    if not isinstance(raw, dict):
        return {"version": CONTRACT_VERSION, "entries": []}
    entries = raw.get("entries")
    if not isinstance(entries, list):
        if entries is not None:
            warn("history document has a non-list `entries`; reading as empty")
        entries = []
    return {
        "version": raw.get("version", CONTRACT_VERSION),
        "entries": entries,
    }


def trim_history(entries: List[Any]) -> List[Any]:
    """Keep the newest N. Same shape as the telemetry ring, deliberately —
    newest-N in one file, no rotation logic, no index."""
    if len(entries) <= REPORTS_HISTORY_MAX_ENTRIES:
        return entries
    return entries[-REPORTS_HISTORY_MAX_ENTRIES:]
