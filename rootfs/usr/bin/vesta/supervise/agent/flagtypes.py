"""What KIND of thing was flagged, and how readily that kind should be raised.

⚠️ THE SCREEN ALREADY PROMISED THIS AND NOTHING IMPLEMENTED IT. The thumb
buttons on the Reason tab have carried the tooltips "the villa raises this kind
more readily" and "…less readily" since they shipped, while `concerns.feedback`
recorded a verdict and only ever acted on the SUBJECT — three `-1` ratings silence
one device (`NEGATIVES_TO_SUPPRESS`), and "this kind" existed nowhere in the
code. This module is the missing half, added at the owner's request 2026-08-28.

⚠️ THE DEVICE IS DELIBERATELY IRRELEVANT, WHICH IS THE WHOLE POINT AND THE
OWNER'S EXPLICIT INSTRUCTION. "Living Room NVR — network transmit far above its
own baseline" and the same sentence about a camera are ONE kind. Scoring per
device is what the existing suppression already does and it does not
generalise: a person who does not care about network chatter has to say so once
per camera, forever, and a new camera arrives un-taught.

⚠️ SO THE KEY IS A MEASUREMENT AND A DIRECTION, AND BOTH HALVES ARE FACTS
RATHER THAN JUDGEMENTS. The measurement comes from Home Assistant's OWN
`device_class` (or, failing that, the unit, or the domain); the direction comes
from the observation that flagged it — above its baseline, below it, or stopped
reporting altogether. Neither is a model's opinion, so the same condition
produces the same key on every run and on every property. `test_flag_types.py`
pins that.

⚠️ DIRECTION IS PART OF THE KEY AND MAY NOT BE DROPPED. "Temperature above
baseline" in a plant room and "temperature below baseline" in the same room are
opposite findings, and an owner who silences one has said nothing about the
other. Collapsing them would make a demerit for a summer nuisance hide a frozen
pipe.

⚠️ THE WEIGHT RE-RANKS, IT DOES NOT GATE (owner's choice, 2026-08-28, against a
hard threshold). A demerited kind sinks in the villa document the check reads
and may fall off the end of it — but nothing is ever refused for its kind alone,
so a kind you found annoying at 1.1 sigma can still reach you at 12. A hard gate
was the other option offered and was declined for exactly that reason.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters import store
from vesta.adapters.log import swallow

FLAG_TYPES_FILE: str = f"{store.DATA_DIR}/vesta/flag-types.json"

#: ⚠️ BOUNDED LIKE EVERY STORE HERE. A villa has tens of measurement classes,
#: not hundreds; this is a stop against a malformed import filling the disk.
MAX_TYPES: int = 500

#: ⚠️ THE STORED NUMBER **IS** THE MULTIPLIER, AND THAT IS THE OWNER'S DESIGN
#: (2026-08-28). The first cut stored an integer score and derived a factor from
#: it — `+1` meaning "doubled", `-2` meaning "a third" — so the screen had to
#: print a sentence translating a number that meant nothing on its own. Their
#: correction: "1.1 is promoted by 10%, 0.8 is demoted by 20%, and each click on
#: the +/- button increases the weight index by 0.1". One number, no
#: translation, and the arithmetic is legible at a glance.
NEUTRAL: float = 1.0

#: What one press is worth. ⚠️ A TENTH, WHICH IS DELIBERATELY SMALL. A thumb
#: expresses a preference, not a calibration; the previous design moved the
#: ranking by a factor of two on the FIRST press, which makes a control feel
#: unsafe to try. Ten presses to halve a kind is a dial rather than a switch.
STEP: float = 0.1

#: ⚠️ THE FLOOR IS NOT ZERO, AND THAT IS THE WHOLE "RE-RANK, NEVER MUTE" RULE
#: EXPRESSED AS A NUMBER. At 0.0 a kind's novelty is annihilated whatever it
#: reads, which is the hard gate the owner declined; at 0.1 an extreme reading
#: still outranks an ordinary one of a kind nobody demerited. The ceiling is 3.0
#: because promotion only has to lift a kind past the document's cut, and
#: anything beyond that is just reordering the top of a list.
MIN_FACTOR: float = 0.1
MAX_FACTOR: float = 3.0


def clamp(value: Any) -> float:
    """A factor, bounded and rounded to one decimal. Never raises.

    ⚠️ THE ROUNDING IS NOT COSMETIC. `1.1 + 0.1` is `1.2000000000000002` in
    binary floating point, so ten presses of `+` without it produce a number no
    screen can print and no export can round-trip — and the store would slowly
    fill with values that differ from the ones an owner set. Rounded at the one
    place that writes, so every reader sees the same number.
    """
    try:
        out = float(value)
    except (TypeError, ValueError):
        return NEUTRAL
    if out != out:                                    # NaN, which no bound catches
        return NEUTRAL
    return round(max(MIN_FACTOR, min(MAX_FACTOR, out)), 1)

#: The directions a flag can carry, and the only ones.
ABOVE: str = "above"
BELOW: str = "below"
OFFLINE: str = "offline"
CHANGED: str = "changed"
DIRECTIONS: Tuple[str, ...] = (ABOVE, BELOW, OFFLINE, CHANGED)

_DIRECTION_WORDS: Dict[str, str] = {
    ABOVE: "above baseline",
    BELOW: "below baseline",
    OFFLINE: "stopped reporting",
    CHANGED: "changed unexpectedly",
}

#: Units mapped to the measurement they measure, for entities carrying no
#: `device_class`. ⚠️ HOME ASSISTANT'S OWN UNITS, NOT A VESTA VOCABULARY — the
#: same rule `tools/logs.py` follows for log levels. Lower-cased on lookup.
#: ⚠️ AND THIS IS A FALLBACK, NOT THE SOURCE OF TRUTH: `device_class` is
#: authoritative wherever it exists, because a unit is ambiguous (`%` is a
#: battery, a humidity and a valve position) and a class is not.
_MEASUREMENT_OF_UNIT: Dict[str, str] = {
    "w": "power", "kw": "power",
    "wh": "energy", "kwh": "energy", "mwh": "energy",
    "v": "voltage", "mv": "voltage",
    "a": "current", "ma": "current",
    "°c": "temperature", "°f": "temperature", "k": "temperature",
    "pa": "pressure", "hpa": "pressure", "kpa": "pressure", "bar": "pressure",
    "l": "volume", "m³": "volume", "gal": "volume",
    "l/min": "flow", "m³/h": "flow",
    "b/s": "data rate", "kb/s": "data rate", "mb/s": "data rate",
    "gb/s": "data rate", "bit/s": "data rate", "mbit/s": "data rate",
    "b": "data size", "kb": "data size", "mb": "data size", "gb": "data size",
    "ppm": "concentration", "µg/m³": "concentration",
    "db": "sound", "dba": "sound",
    "lx": "illuminance", "lm": "illuminance",
    "s": "duration", "min": "duration", "h": "duration", "d": "duration",
}

#: What a measurement is called when nothing identifies it. ⚠️ NAMED RATHER
#: THAN BLANK, so a kind nobody could classify still groups, still scores and
#: still appears in the list an owner can tune — an unnamed bucket that silently
#: swallowed them would be this project's "0 that means not measured" again.
UNCLASSIFIED: str = "reading"

_EMPTY: Dict[str, Any] = {"types": {}}


# ── the key ─────────────────────────────────────────────────────────────────
def measurement_of(device_class: str = "", unit: str = "",
                   domain: str = "") -> str:
    """What is being measured, ignoring which device measures it.

    ⚠️ THE ORDER IS THE CORRECTNESS ARGUMENT. `device_class` is Home
    Assistant's own declaration and is unambiguous; a UNIT is not (`%` is a
    battery level, a humidity and a valve position, and grouping those three
    would let one demerit silence the other two); a DOMAIN is coarse but is
    still a fact about the thing. Reversing any two of these makes the key less
    precise, never more.
    """
    cls = str(device_class or "").strip().lower().replace("_", " ")
    if cls:
        return cls
    by_unit = _MEASUREMENT_OF_UNIT.get(str(unit or "").strip().lower())
    if by_unit:
        return by_unit
    dom = str(domain or "").strip().lower()
    return dom or UNCLASSIFIED


def key_for(measurement: str, direction: str) -> str:
    """The stored key. ⚠️ LOWER-CASE AND COLON-SEPARATED so it survives a round
    trip through JSON, an export file and a text field without changing
    identity — an owner may edit an exported list by hand."""
    m = str(measurement or UNCLASSIFIED).strip().lower() or UNCLASSIFIED
    d = str(direction or CHANGED).strip().lower()
    return f"{m}:{d if d in DIRECTIONS else CHANGED}"


def label_of(key: str) -> str:
    """What the settings screen calls this kind. Sentence case, no ids."""
    measurement, _, direction = str(key or "").partition(":")
    words = _DIRECTION_WORDS.get(direction, _DIRECTION_WORDS[CHANGED])
    name = (measurement or UNCLASSIFIED).replace("_", " ")
    return f"{name[:1].upper()}{name[1:]} {words}"


def direction_of(observed: Optional[float], baseline: Optional[float], *,
                 offline: bool = False) -> str:
    """Which way the reading went. ⚠️ `offline` WINS OVER THE NUMBERS, because a
    device that stopped reporting has no observation to compare — treating its
    last value as "below baseline" would file a dead sensor under the same kind
    as a cold room."""
    if offline:
        return OFFLINE
    if observed is None or baseline is None:
        return CHANGED
    try:
        return ABOVE if float(observed) >= float(baseline) else BELOW
    except (TypeError, ValueError):
        return CHANGED


# ── the store ───────────────────────────────────────────────────────────────
def read() -> Dict[str, Dict[str, Any]]:
    """Every scored kind, degrading to none. Never raises."""
    raw = store.read_json(FLAG_TYPES_FILE, dict(_EMPTY))
    rows = raw.get("types") if isinstance(raw, Mapping) else None
    if not isinstance(rows, Mapping):
        return {}
    return {str(k): dict(v) for k, v in rows.items() if isinstance(v, Mapping)}


def _write(rows: Mapping[str, Mapping[str, Any]]) -> bool:
    try:
        kept = dict(list(rows.items())[:MAX_TYPES])
        store.write_json(FLAG_TYPES_FILE, {"types": kept})
        return True
    except Exception as err:  # noqa: BLE001
        swallow("could not write the flag-type weights", err)
        return False


def _now_iso(now: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))


def record(key: str, *, useful: bool, now: Optional[float] = None
           ) -> Tuple[bool, str]:
    """A person judged one concern of this kind. Returns `(ok, reason)`.

    ⚠️ THE COUNTS ARE KEPT BESIDE THE WEIGHT, NOT DERIVED FROM IT. A weight of
    0 is reached by never being judged AND by being judged once each way, and
    those are opposite facts about how settled an owner's opinion is — the
    settings screen shows both so a reader can tell a kind nobody has an
    opinion about from one they have argued with themselves over.
    """
    if not str(key or "").strip():
        return False, "a flag type is needed"
    rows = read()
    row = dict(rows.get(key) or {})
    current = float(row.get("factor", NEUTRAL) or NEUTRAL)
    row["factor"] = clamp(current + (STEP if useful else -STEP))
    row["up"] = int(row.get("up") or 0) + (1 if useful else 0)
    row["down"] = int(row.get("down") or 0) + (0 if useful else 1)
    row["label"] = label_of(key)
    row["first_at"] = str(row.get("first_at") or _now_iso(now))
    row["last_at"] = _now_iso(now)
    rows[key] = row
    ok = _write(rows)
    return ok, "" if ok else "the flag-type store could not be written"


def factor_of(key: str, rows: Optional[Mapping[str, Any]] = None) -> float:
    """This kind's multiplier, or 1.0 when nobody has judged it.

    ⚠️ THERE IS NO SECOND FUNCTION TURNING THIS INTO SOMETHING ELSE. The stored
    number IS what multiplies the score — that is the owner's design, and the
    reason the settings screen can show the value with no sentence beside it.
    """
    source = read() if rows is None else rows
    row = source.get(str(key))
    if not isinstance(row, Mapping):
        return NEUTRAL
    return clamp(row.get("factor", NEUTRAL))


def apply_weights(scored: Sequence[Any],
                  type_of: Any,
                  rows: Optional[Mapping[str, Any]] = None) -> List[Any]:
    """Re-score a salience list by the owner's taught preferences.

    ⚠️ IT MUTATES THE SCORE AND NOTHING ELSE. `reason`, `observed`, `baseline`
    and `spread` travel untouched, because `salience.py`'s founding rule is that
    the numbers a reader would argue with must survive with the score — a
    re-ranked list whose reasons no longer match its order is unarguable.

    ⚠️ AN UNSCORABLE ENTITY IS LEFT ALONE. Its score is `None`, meaning "cannot
    say"; multiplying that would turn "I could not assess this" into a number,
    which is the one thing `build_scorer` refuses to do.

    ⚠️ NEVER RAISES, AND A FAILURE LEAVES THE RANKING UNWEIGHTED. This sits on
    the document path that every check reads; a broken preference file must cost
    the tuning, never the check.
    """
    weights = read() if rows is None else rows
    if not weights:
        return list(scored)
    out: List[Any] = []
    for item in scored:
        try:
            if getattr(item, "score", None) is None:
                out.append(item)
                continue
            key = type_of(item)
            factor = factor_of(key, weights) if key else NEUTRAL
            if factor != NEUTRAL:
                item.score = float(item.score) * factor
        except Exception as err:  # noqa: BLE001
            swallow("could not weight a salience row", err)
        out.append(item)
    return out


# ── what the settings screen edits ──────────────────────────────────────────
def listing() -> List[Dict[str, Any]]:
    """Every judged kind, worst-demerited first. ⚠️ THE ORDER IS THE ANSWER TO
    "what have I told this villa to ignore" — the question an owner opens this
    list to ask. Ties break on the label so the order is stable between reads
    rather than following dictionary insertion."""
    rows = read()
    out = [{"key": k, **v} for k, v in rows.items()]
    out.sort(key=lambda r: (clamp(r.get("factor", NEUTRAL)),
                            str(r.get("label") or "")))
    return out


def nudge(key: str, direction: int) -> Tuple[bool, str]:
    """One press of `+` or `-`. Returns `(ok, reason)`.

    ⚠️ THE SERVER OWNS THE STEP, NOT THE BUTTON. The screen sends "up" or
    "down" and never a computed number, so the tenth is stated once — a client
    that sent `factor + 0.1` would be a second implementation of the arithmetic,
    and the first rounding difference between the two would be invisible until
    an owner's list stopped matching what they had pressed.
    """
    rows = read()
    if str(key) not in rows:
        return False, f"no flag type {key!r}"
    row = dict(rows[str(key)])
    current = float(row.get("factor", NEUTRAL) or NEUTRAL)
    row["factor"] = clamp(current + (STEP if direction >= 0 else -STEP))
    row["label"] = label_of(str(key))
    rows[str(key)] = row
    ok = _write(rows)
    return ok, "" if ok else "the flag-type store could not be written"


def set_factor(key: str, factor: Any) -> Tuple[bool, str]:
    """Set the multiplier outright — used by an import and by a typed edit."""
    rows = read()
    if str(key) not in rows:
        return False, f"no flag type {key!r}"
    row = dict(rows[str(key)])
    row["factor"] = clamp(factor)
    row["label"] = label_of(str(key))
    rows[str(key)] = row
    ok = _write(rows)
    return ok, "" if ok else "the flag-type store could not be written"


def forget(key: str) -> Tuple[bool, str]:
    """Remove one kind. ⚠️ NOT THE SAME AS SETTING IT TO ZERO, and the
    difference is visible: a kind at zero has been judged and found neutral,
    a forgotten one is back to never having been judged, so its counts go too."""
    rows = read()
    if str(key) not in rows:
        return False, f"no flag type {key!r}"
    rows.pop(str(key))
    ok = _write(rows)
    return ok, "" if ok else "the flag-type store could not be written"


def clear() -> Tuple[bool, str]:
    """Forget every taught preference."""
    ok = _write({})
    return ok, "" if ok else "the flag-type store could not be written"


def replace(document: Any) -> Tuple[bool, str]:
    """Import a list, replacing what is there. Returns `(ok, reason)`.

    ⚠️ VALIDATED BY CONSTRUCTION, NOT BY TRUST. This reads a file a person may
    have edited by hand or carried from another property, so it BUILDS a clean
    row from each entry rather than storing what it was handed — an imported
    key with an unknown direction, a weight past the limit or a label
    disagreeing with its key would otherwise become the store's own state and
    outlive the file it came from. The label is always re-derived, never
    imported: it is a function of the key, so accepting one would let an import
    rename a kind into something it is not.
    """
    rows = document.get("types") if isinstance(document, Mapping) else document
    if not isinstance(rows, Mapping):
        return False, "expected an object of flag types"
    clean: Dict[str, Dict[str, Any]] = {}
    for raw_key, raw in list(rows.items())[:MAX_TYPES]:
        measurement, _, direction = str(raw_key or "").partition(":")
        if not measurement.strip():
            continue
        key = key_for(measurement, direction)
        row = raw if isinstance(raw, Mapping) else {}
        clean[key] = {
            # ⚠️ `clamp` HANDLES EVERY BAD SHAPE — a string, a null, a NaN, a
            # number past either bound — so this path needs no validation of
            # its own and cannot drift from the one the thumb uses.
            "factor": clamp(row.get("factor", NEUTRAL)),
            "up": max(0, int(row.get("up") or 0) if str(
                row.get("up") or 0).lstrip("-").isdigit() else 0),
            "down": max(0, int(row.get("down") or 0) if str(
                row.get("down") or 0).lstrip("-").isdigit() else 0),
            "label": label_of(key),
            "first_at": str(row.get("first_at") or ""),
            "last_at": str(row.get("last_at") or ""),
        }
    if not clean:
        return False, "that file contained no usable flag types"
    ok = _write(clean)
    return ok, "" if ok else "the flag-type store could not be written"
