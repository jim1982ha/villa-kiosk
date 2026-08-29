"""Where reports state lives on disk, and what shape it has.

Four documents under `/data`, all owned by this subsystem alone — the count
said "three" from before `reports-events.json` was added until /dry-audit read
the list under the sentence (2.573.0):

  reports-config.json   operator settings. Owner-writable from the SPA.
  reports-history.json  a bounded ring of what was produced and delivered.
                        SERVER-WRITTEN — read-only to every client.
  reports-state.json    scheduler bookkeeping (last fire, idempotency keys).
                        Never shown to anyone; not an API.
  reports-events.json   findings caught live from the blueprint layer's
                        `vesta_*` events. SERVER-WRITTEN, single writer.

⚠️ AND FOUR IS THE COUNT OF WHAT THIS SUBSYSTEM OWNS, NOT OF THE PATHS IT
NAMES. `ledger.py`, `devices.py` and `model.py` each carry a `/data` path of
their own — `fm-data.json`, `device-config.json`, `www/villa.glb` — because they
READ stores this subsystem does not own and must not write. Centralising those
here would put the villa's maintenance record and device configuration behind a
module whose whole contract is "these are ours"; each reader states its own path
beside the docstring explaining why it may only read it.

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

import json
import os
import tempfile
from typing import Any, Dict, Final, List

from vesta.shared.contracts import CADENCE, CONTRACT_VERSION, NARRATION_MODE, PROFILE
from .log import warn

# ⚠️ NOT Final ANY MORE (TASK-115 step 4): `configure()` below repoints it for
# an external deployment. The add-on never calls that, so /data stands.
DATA_DIR: str = "/data"


def configure(*, data_dir: str = "") -> None:
    """Point every store at a different directory. The export's seam
    (REQ-063); the add-on never calls it. Startup-only, like `hass.configure`.

    ⚠️ THE `*_FILE` CONSTANTS BELOW ARE DERIVED AT IMPORT and are deliberately
    LEFT ALONE here — every reader joins paths through them, so they are
    rebuilt from the new root instead. A caller that imported one by value
    before configuring gets the old path, which is why this must run before
    anything else touches the package; the external entrypoint owns that
    ordering, exactly as the proxy owns its boot order today.
    """
    global DATA_DIR
    if not data_dir:
        return
    old_root = DATA_DIR
    DATA_DIR = data_dir.rstrip("/")
    for name, value in list(globals().items()):
        if name.endswith("_FILE") and isinstance(value, str)                 and value.startswith(old_root + "/"):
            globals()[name] = DATA_DIR + value[len(old_root):]

REPORTS_CONFIG_FILE: Final[str] = f"{DATA_DIR}/reports-config.json"
REPORTS_HISTORY_FILE: Final[str] = f"{DATA_DIR}/reports-history.json"
REPORTS_STATE_FILE: Final[str] = f"{DATA_DIR}/reports-state.json"
#: The findings the blueprint layer emits, caught live by `collect.py`. Its own
#: file rather than part of the state document because it is append-heavy and
#: bounded by a different rule — see MAX_EVENTS.
REPORTS_EVENTS_FILE: Final[str] = f"{DATA_DIR}/reports-events.json"

#: The RECORD — what happened at this property, over time, from every source
#: (2026-08-30). Read by the briefing for its window; written by the collector
#: (automation firings), triage (flagged items) and the agent (concerns). Not
#: the observation journal: that is a ring of raw STATE CHANGES feeding
#: salience, and this is a ledger of things a person would call events.
RECORD_FILE: Final[str] = f"{DATA_DIR}/record.json"

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
EMPTY_EVENTS: Final[Dict[str, Any]] = {}

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
    # ⚠️ EMPTY MEANS "ASK HOME ASSISTANT", AND SOMETHING FINALLY DOES.
    # `pipeline.resolve_zone` reads this first, then a name cached in the state
    # file, then Home Assistant itself. For one release this comment described
    # a behaviour that did not exist and everything scheduled in UTC — on a
    # UTC+8 property that is not an hour's drift, it is a schedule set for the
    # current hour never becoming due at all.
    "timezone": "",
    "min_history_days": 14,
    # ⚠️ THE CATALOG'S NOISE RULE, AS DEFAULTS RATHER THAN CONSTANTS. "20 fires
    # a month with no acknowledgement" is the workbook's number for ONE
    # property; a busier or quieter villa needs a different one, and a tuning
    # constant baked into a redistributable add-on is CLAUDE.md's first hard
    # rule broken. See `noise.py` for what they gate.
    "noise_threshold_fires": 20,
    "noise_window_days": 30,
    # ⚠️ THE OBSERVATION FLOOR'S CADENCE, AND IT IS CONFIG FOR THE SAME REASON
    # THE TWO ABOVE ARE. A villa with a slow Home Assistant and one with 3,000
    # entities want different numbers, and a period compiled into the image is
    # a per-property constant by another name. `observe/cycle.py` re-reads this
    # every cycle, so a change takes effect without restarting the add-on.
    "observe_cycle_minutes": 15,
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
            # ⚠️ OPTIONAL, because every schedule written before minutes existed
            # has no such key. Absent is valid and means the top of the hour;
            # present and wrong is refused, so a typo fails at the moment it is
            # saved rather than by silently delivering at :00 forever.
            minute = item.get("minute")
            if minute is not None and (not isinstance(minute, int)
                                       or isinstance(minute, bool)
                                       or not 0 <= minute <= 59):
                problems.append(f"{where}.minute must be an integer 0-59")
            weekday = item.get("weekday")
            if weekday is not None and (not isinstance(weekday, int)
                                        or isinstance(weekday, bool)
                                        or not 0 <= weekday <= 6):
                problems.append(f"{where}.weekday must be an integer 0-6")
            month_day = item.get("day")
            if month_day is not None and (not isinstance(month_day, int)
                                          or isinstance(month_day, bool)
                                          or not 1 <= month_day <= 31):
                problems.append(f"{where}.day must be an integer 1-31")
            # ⚠️ THE PROFILE A SCHEDULE IS FOR, AND OPTIONAL BECAUSE EVERY
            # SCHEDULE WRITTEN BEFORE IT EXISTED HAS NO SUCH KEY. Absent means
            # the legacy shape — its own `targets` and its own stored
            # `audience` — which `pipeline.targets_for` still honours. Present
            # and unrecognised is REFUSED here rather than resolved to nowhere
            # at delivery time: `targets_for_role` answers `[]` for an unknown
            # profile, which at 03:00 looks exactly like a villa nobody
            # configured.
            role = item.get("role")
            if role is not None and role not in PROFILE:
                problems.append(
                    f"{where}.role must be one of {', '.join(PROFILE)}")

    targets = value.get("notify_targets", [])
    if not isinstance(targets, list):
        problems.append("notify_targets must be a list")
    elif not all(isinstance(t, str) for t in targets):
        problems.append("notify_targets must be a list of strings")

    # ⚠️ AN UNKNOWN MODE MUST FAIL HERE, NOT SILENTLY MEAN "OFF". `providers.
    # shared()` returns None for anything that is not exactly NARRATION_MODE[1],
    # which is the right runtime behaviour — a typo can never accidentally
    # enable a paid third-party call — and the wrong SAVE behaviour: an operator
    # who typed it would get a green "Saved." and a report that never changes,
    # with nothing anywhere saying why. The two together are the rule this
    # subsystem follows everywhere: refuse at the moment of the mistake, degrade
    # at the moment of use.
    narration = value.get("narration", {})
    if not isinstance(narration, dict):
        problems.append("narration must be an object")
    else:
        mode = narration.get("mode", NARRATION_MODE[0])
        if mode not in NARRATION_MODE:
            problems.append(
                f"narration.mode must be one of {', '.join(NARRATION_MODE)}")
        limit = narration.get("monthly_limit")
        if limit is not None and (not isinstance(limit, int)
                                  or isinstance(limit, bool) or limit < 0):
            # `isinstance(True, int)` is True in Python — see the hour check.
            problems.append("narration.monthly_limit must be a whole number")

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


#: The Supervisor writes the add-on's configured options here, revalidated and
#: rewritten whenever an operator saves the Configuration page.
OPTIONS_FILE: Final[str] = f"{DATA_DIR}/options.json"


def addon_option(key: str, default: Any = None) -> Any:
    """One value from the add-on's Configuration page, or `default`.

    ⚠️ THE PROXY HAS `_read_options` AND THIS IS DELIBERATELY NOT A SECOND
    IMPLEMENTATION OF IT — it is the same one, moved to the side both callers
    can reach. `reports/__init__.py`'s layering rule forbids anything here from
    importing the proxy (a reports bug must never reach the kiosk's auth path),
    so the shared home has to be this package, which the proxy already imports.
    `_read_options` now delegates here; see `write_json`'s note on why the
    atomic-write helper has NOT been converged the same way.

    ⚠️ RE-READ ON EVERY CALL, never cached. An operator toggling an option
    expects it to take effect without restarting the add-on — every other
    tunable in this file behaves that way, and a cached one would be the odd
    setting that silently needs a restart nobody documents. The file is a few
    hundred bytes and the callers here are hourly.
    """
    raw = read_json(OPTIONS_FILE, {})
    if not isinstance(raw, dict) or key not in raw:
        return default
    return raw[key]


def read_json(path: str, empty: Dict[str, Any]) -> Any:
    """Parse a store, degrading to `empty` for absent/corrupt/wrong-typed."""
    try:
        with open(path, encoding="utf-8") as handle:
            data: Any = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return empty
    return data if isinstance(data, type(empty)) else empty


def write_json(path: str, payload: Any) -> None:
    """Atomic overwrite: temp file in the same directory, then os.replace.

    ⚠️ DELIBERATELY NOT `supervisor-proxy.py`'s `atomic_write`, and this is the
    one place in the subsystem that duplicates a shared rule on purpose.
    CLAUDE.md says every write under /data goes through that helper; the
    layering rule in `__init__.py` says nothing here may import the proxy,
    because a reports bug must never be able to reach the kiosk's own auth
    path. Both rules are right and they collide here.

    The MECHANISM is what matters and it is reproduced exactly: same directory
    (so os.replace is atomic rather than a cross-device copy), fsync before
    replace, temp file removed on failure. A partial or failed write can never
    leave the live store truncated — a reader sees the whole previous version
    or the whole new one.

    ⚠️ The convergence path, if this is ever worth doing: the proxy ALREADY
    imports this package, so the helper could move HERE and the proxy import
    it — inverting the dependency rather than duplicating the code. Not done
    now because it would touch every existing atomic_write call site, and
    those are covered by a security suite this subsystem has no business
    destabilising.
    """
    write_text(path, json.dumps(payload))


def write_text(path: str, body: str) -> None:
    """The same atomic overwrite, for a file that is not JSON.

    ⚠️ THE MECHANISM ABOVE, EXTRACTED — NOT A SECOND ONE. The villa memory
    store writes markdown rather than JSON, and /dry-audit found it about to
    hand-roll the same temp-file-then-replace dance a THIRD time (the proxy's
    `atomic_write`, this module's, and its own). The reasoning in `write_json`
    about why this subsystem may not import the proxy applies unchanged; what
    must not multiply is the number of places that get fsync-before-replace
    subtly wrong.
    """
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=directory, delete=False)
    temp_name = handle.name
    try:
        with handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
