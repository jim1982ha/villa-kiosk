"""What a device IS, what it is called, and whether it is reporting.

⚠️ THIS IS THE KIOSK'S RULE, IN PYTHON, AND THAT IS NORMALLY THIS PROJECT'S
CARDINAL SIN. A second implementation of a shared predicate is how this codebase
has repeatedly shipped two surfaces that disagree — the fault picker against the
HUD badge, Readiness against the alert count, the menu against the modal. So the
justification has to be better than "the server needs it too", and it is:

  * The report composes with NOBODY at the tablet. Deriving the list in the
    browser and publishing it would make a briefing depend on someone having
    opened the kiosk recently, which fails exactly on the villa nobody visits —
    and on a fresh install, where it would go blind rather than sparse.
  * The alternative — the report using its own, different idea of a device —
    is the divergence this file exists to end. The owner's words:
    "both supervision systems are like brother and sisters and shall always
    report consistent findings... User shall never notice any discrepancy
    between what VESTA Kiosk UI is reporting and the alerts he is receiving."

⚠️ SO IT IS PINNED, NOT TRUSTED. `tests/py/test_consistency_parity.py` runs the
SHIPPED TypeScript (`tests/consistency/kiosk_view.ts`, under plain node) and
this module over the same fixtures and fails on any difference. A comment
claiming the two agree would be worth nothing; the harness is the claim.

⚠️ AND THE FIXTURES CAME FIRST. The harness was written and run before this file
existed, so its first result is a measured baseline rather than a self-portrait.

The source of truth for every rule here, to be read alongside:
    src/config/deviceGroups.ts      selectable / unavailable / group folding
    src/config/dismissedEntities.ts what "dismissed" means
    src/config/EntityMap.ts         displayLabelFor
    src/utils/stateColors.ts        isUnavailable
"""

from __future__ import annotations

import json
import re
from typing import (Any, Dict, Iterable, List, Mapping, Optional, Sequence,
                    Set, Tuple)

from .log import warn

DEVICE_CONFIG_FILE = "/data/device-config.json"

#: ⚠️ THE SAME PAIR AS `deviceGroups.ts`, AND THE ONLY ONE THERE IS. A combo
#: sensor exposing `_temperature` and `_humidity` is ONE device, and the first
#: suffix is the primary (its badge stays on the map). Pinned against the
#: TypeScript by the parity test, which reads the constant out of the source
#: rather than restating it — the `CONFIG_WIRE_KEYS` treatment, for the same
#: reason: a string literal on each side of a language boundary with nothing
#: between them is this subsystem's most repeated defect.
PAIRABLE_SUFFIXES: Sequence[Tuple[str, str]] = (("_temperature", "_humidity"),)

#: States in which an entity's true value is NOT known. ⚠️ AND AN ABSENT ENTITY
#: COUNTS: `isUnavailable(undefined)` is true in the kiosk, because a mapping
#: pointing at an entity Home Assistant does not have is not a working device.
UNKNOWN_STATES = frozenset({"unavailable", "unknown"})


def read_config(path: str = DEVICE_CONFIG_FILE) -> Dict[str, Any]:
    """The shared device configuration, degrading to empty.

    ⚠️ READ ONLY, exactly like `ledger.read`. This document is served by
    `_json_store_handlers` behind an `asyncio.Lock`; writing it from outside
    that handler is a defect the proxy's own docstring records having shipped
    once already, against a store several devices write concurrently.

    ⚠️ AND THE ENVELOPE KEY IS `config`, NOT `data`. Getting that wrong is this
    subsystem's most-repeated bug (six instances across 2.544.0–2.546.0), and it
    fails SILENTLY on a read: a store that parses to nothing is indistinguishable
    from a property nobody has configured. `tests/py/test_store_envelope.py`
    derives the key from the proxy.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            raw: Any = json.load(handle)
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as err:
        warn(f"device config unreadable, treating as empty: {err}")
        return {}
    if not isinstance(raw, dict):
        return {}
    inner = raw.get("config")
    return inner if isinstance(inner, dict) else raw


# ── the rules ────────────────────────────────────────────────────────────────

def is_unavailable(entity: Optional[Mapping[str, Any]]) -> bool:
    """`stateColors.isUnavailable` — absent counts, and that is load-bearing."""
    if entity is None:
        return True
    return str(entity.get("state") or "") in UNKNOWN_STATES


def dismissed_set(dismissed_ids: Iterable[str],
                  entities: Mapping[str, Any]) -> Set[str]:
    """`dismissedEntities.dismissedEntitySet`.

    ⚠️ A DISMISSAL ONLY APPLIES WHILE HOME ASSISTANT STILL DOES NOT KNOW THE
    ENTITY. Not "is this id in the list" — the kiosk's own header records that
    splitting that rule across callers is how the original bug happened, one
    surface reading the entity map (where removal worked) and another reading
    mesh-derived ids (where it did not).
    """
    return {i for i in dismissed_ids if i not in entities}


def _primary_by_member(entity_map: Mapping[str, Any],
                       device_groups: Sequence[Mapping[str, Any]]) -> Dict[str, str]:
    """member entity_id → the entity_id that REPRESENTS it.

    ⚠️ EXPLICIT GROUPS, THEN THE SUFFIX SUGGESTIONS — so a device folds
    identically whether or not the owner has confirmed the grouping.

    ⚠️ HOME ASSISTANT'S DEVICE REGISTRY IS NOT CONSULTED, AND THAT MATCHES THE
    KIOSK. `suggestDeviceGroups` accepts an `entityDeviceIds` map and would use
    it in preference, but `primaryByMember` — the only caller on this path —
    passes two arguments, so the registry half is dead here on both sides. The
    parity test pins that call site: if the kiosk starts passing a registry, the
    two implementations diverge silently and this comment becomes the lie.
    """
    rep: Dict[str, str] = {}
    already: Set[str] = set()
    for group in device_groups:
        primary = str(group.get("primaryEntityId") or "")
        members = group.get("memberEntityIds") or []
        if primary:
            already.add(primary)
        for member in members:
            rep[str(member)] = primary
            already.add(str(member))

    ids = list(entity_map)
    id_set = set(ids)
    for primary_suffix, member_suffix in PAIRABLE_SUFFIXES:
        for entity_id in ids:
            if not entity_id.endswith(primary_suffix) or entity_id in already:
                continue
            base = entity_id[: -len(primary_suffix)]
            member_id = f"{base}{member_suffix}"
            if member_id in id_set and member_id not in already:
                rep.setdefault(member_id, entity_id)
    return rep


def selectable_device_ids(entity_map: Mapping[str, Any],
                          device_groups: Sequence[Mapping[str, Any]],
                          mesh_entity_ids: Iterable[str],
                          entities: Mapping[str, Any],
                          dismissed_ids: Iterable[str] = ()) -> List[str]:
    """`deviceGroups.selectableDeviceIds` — "what may a person be shown".

    Four rules, in the kiosk's own order:
      * `disabled` — the owner hid it;
      * CONFIG DEBRIS — no HA entity AND no geometry. Not a broken device, just
        a key nothing has cleaned up (a renamed entity, an older model);
      * dismissed — see `dismissed_set` for the half that matters;
      * group members fold into their primary.
    """
    mapped = set(mesh_entity_ids)
    dismissed = dismissed_set(dismissed_ids, entities)
    rep_of = _primary_by_member(entity_map, device_groups)
    reps: List[str] = []
    seen: Set[str] = set()
    for entity_id in list(mapped) + list(entity_map):
        mapping = entity_map.get(entity_id)
        if isinstance(mapping, dict) and mapping.get("disabled"):
            continue
        if entity_id not in mapped and entity_id not in entities:
            continue
        if entity_id in dismissed:
            continue
        rep = rep_of.get(entity_id, entity_id)
        if rep not in seen:
            seen.add(rep)
            reps.append(rep)
    return reps


def unavailable_device_ids(entity_map: Mapping[str, Any],
                           device_groups: Sequence[Mapping[str, Any]],
                           mesh_entity_ids: Iterable[str],
                           entities: Mapping[str, Any],
                           dismissed_ids: Iterable[str] = ()) -> List[str]:
    """`deviceGroups.unavailableDeviceIds` — the reality filter is not repeated
    here for the same reason it is not repeated there: the two lists must not be
    able to drift apart."""
    return [i for i in selectable_device_ids(
        entity_map, device_groups, mesh_entity_ids, entities, dismissed_ids)
        if is_unavailable(entities.get(i))]


# ── naming ───────────────────────────────────────────────────────────────────

_RAW_SLUG = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)+$")


def _dedupe_repeated_prefix(words: List[str]) -> List[str]:
    """`EntityMap.dedupeRepeatedPrefix` — "master bedroom master bedroom light"
    is one room said twice, which is what an integration's own naming produces."""
    for length in range(len(words) // 2, 0, -1):
        first = " ".join(words[:length]).lower()
        second = " ".join(words[length:2 * length]).lower()
        if first == second:
            return words[:length] + words[2 * length:]
    return words


def _prettify_raw(raw: str) -> str:
    words = _dedupe_repeated_prefix([w for w in raw.replace("_", " ").split() if w])
    return " ".join(w[:1].upper() + w[1:] for w in words) or raw


def prettify_entity_slug(entity_id: str) -> str:
    parts = entity_id.split(".", 1)
    return _prettify_raw(parts[1] if len(parts) > 1 else entity_id)


def _looks_like_raw_fallback(entity_id: str, label: str) -> bool:
    """⚠️ NORMALISE BOTH SIDES. Normalising only the entity_id missed a label
    that is the raw slug with its UNDERSCORES intact — read as a deliberate
    customisation and shown verbatim, while the visually identical
    space-separated form was upgraded. Reported as "sometimes it works"."""
    def norm(value: str) -> str:
        return " ".join(value.replace("_", " ").split()).strip().lower()
    parts = entity_id.split(".", 1)
    return norm(label) == norm(parts[1] if len(parts) > 1 else "")


def display_label(entity_id: str, stored_label: Optional[str] = None,
                  friendly_name: Optional[str] = None) -> str:
    """`EntityMap.displayLabelFor` — what this device is CALLED, everywhere.

    ⚠️ THE OWNER'S OWN LABEL WINS, and that is the whole point of porting this:
    a briefing that calls a device by its Home Assistant id while the tablet
    shows the name its owner typed is two names for one thing, in two places
    that are supposed to agree.
    """
    if stored_label and not _looks_like_raw_fallback(entity_id, stored_label):
        return stored_label
    name = (friendly_name or "").strip()
    if name:
        return _prettify_raw(name) if _RAW_SLUG.match(name) else name
    return prettify_entity_slug(entity_id)


def label_for(entity_id: str, entity_map: Mapping[str, Any],
              entities: Mapping[str, Any]) -> str:
    """`display_label`, with both sources looked up the way a caller means it."""
    mapping = entity_map.get(entity_id)
    stored = mapping.get("label") if isinstance(mapping, dict) else None
    entity = entities.get(entity_id) or {}
    attributes = entity.get("attributes") if isinstance(entity, dict) else {}
    friendly = attributes.get("friendly_name") if isinstance(attributes, dict) else None
    return display_label(entity_id, stored if isinstance(stored, str) else None,
                         friendly if isinstance(friendly, str) else None)
