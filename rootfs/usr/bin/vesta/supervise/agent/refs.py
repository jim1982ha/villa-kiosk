"""Opaque handles, so the model never sees an entity id. CTR-004, REQ-022.

⚠️ THIS IS A PRIVACY REQUIREMENT FIRST AND AN EXTRACTION PROPERTY SECOND. An
entity id is not a neutral identifier at this property: an id of the shape
`sensor.<someone>_bedroom_window` carries a person's name and a room, and the
reader never sees it because the label already said everything useful. (⚠️ That
example is DELIBERATELY shaped rather than real. The real one was written here
first, and in `snapshot.py` earlier the same day, both times while explaining
why real ids must not travel — which is how it reaches four tracked sites.) `contracts.PAYLOAD_ALLOWED_FIELDS` bans
ids from unattended payloads for exactly that reason, and a reasoning run is the
largest unattended payload in the system.

⚠️ THE TABLE IS PER-RUN, IN MEMORY, AND NEVER LEAVES THE PROCESS. Not written to
disk, not included in any payload, not returned by any tool. It exists so VESTA
can turn the model's `d3` back into something Home Assistant understands, on
THIS side of the boundary. Persisting it would create a durable ids-to-handles
map — the thing the handles exist to avoid — in a file whose whole purpose is to
be kept.

⚠️ AND THE RESOLUTION IS ONE-WAY BY CONSTRUCTION. `resolve` is how VESTA reads a
ref; there is deliberately no tool that resolves one, so a model cannot ask what
`d3` stands for. That is what makes the boundary a boundary rather than a
convention.

⚠️ REFS ARE SEQUENTIAL AND MEANINGLESS. Not a hash of the id — a hash is stable
across runs, which makes it a pseudonymous identifier that can be correlated
between conversations and accumulated. `d1` in one run and `d1` in the next are
unrelated, and that is the point.
"""

from __future__ import annotations

from typing import Dict, List, Mapping, Optional, Tuple

from vesta.shared.text import readable_label


class RefTable:
    """One run's handles. Create per run; let it fall out of scope with the run.

    ⚠️ NO `__eq__`, NO SERIALISATION, NO `to_dict`. Anything that makes this
    object storable makes it storeABLE, and the one rule here is that it is not.
    If a future caller needs to persist "which devices did this run look at",
    persist the SUBJECT KEYS — they are hashes and carry nothing.
    """

    __slots__ = ("_to_ref", "_to_id", "_labels", "_prefix", "_next")

    def __init__(self, prefix: str = "d") -> None:
        self._to_ref: Dict[str, str] = {}
        self._to_id: Dict[str, str] = {}
        self._labels: Dict[str, str] = {}
        self._prefix = prefix
        self._next = 1

    def ref_for(self, entity_id: str, label: str = "") -> str:
        """The handle for this id, minting one on first sight. Idempotent."""
        key = str(entity_id or "").strip()
        if not key:
            return ""
        existing = self._to_ref.get(key)
        if existing is not None:
            if label:
                self._labels[existing] = str(label)
            return existing
        ref = f"{self._prefix}{self._next}"
        self._next += 1
        self._to_ref[key] = ref
        self._to_id[ref] = key
        # ⚠️ `readable_label` IS THE SHARED RULE and this must not grow its own.
        # "What do we call this device" is answered in one place for the kiosk,
        # the brief and now the agent; a second prettifier here is how the
        # tablet and the notification come to name one pump differently.
        self._labels[ref] = str(label) if label else readable_label(key)
        return ref

    def resolve(self, ref: str) -> Optional[str]:
        """The entity id behind a handle, or None. VESTA-side only."""
        return self._to_id.get(str(ref or "").strip())

    def label(self, ref: str) -> str:
        return self._labels.get(str(ref or "").strip(), "")

    def describe(self, entity_id: str, label: str = "") -> Dict[str, str]:
        """The pair every tool result should carry instead of an id."""
        ref = self.ref_for(entity_id, label)
        return {"ref": ref, "label": self.label(ref)}

    def known(self) -> Tuple[str, ...]:
        return tuple(self._to_id)

    def __len__(self) -> int:
        return len(self._to_id)


#: ⚠️ ANCHORED ON `(?:^|[^\w.])`, NOT ON `\b`, AND THE REPO HAS PAID FOR THIS
#: TWICE. `door` matches inside `outdoor`, and `\b` does not help because `_` is
#: a word character. A leak detector that misses half the leaks is worse than
#: none, because it is believed.
import re as _re

_ENTITY_ID = _re.compile(
    r"(?:^|[^\w.])"
    r"((?:sensor|binary_sensor|light|switch|cover|lock|fan|climate|automation|"
    r"scene|script|camera|media_player|vacuum|number|select|button|todo|"
    r"device_tracker|person|alarm_control_panel|water_heater|input_\w+)"
    r"\.[a-z][a-z0-9_]*)"
    # ⚠️ AND A TRAILING GUARD, because an entity id is lowercase THROUGHOUT.
    # Without it `scene.getMeshByName` matches as `scene.get` and the detector
    # cries wolf on ordinary Babylon code — which is how a leak detector stops
    # being believed, and an unbelieved detector is worse than none.
    r"(?![A-Za-z0-9_])")


def pseudonymise(text: str, table: "RefTable") -> str:
    """Every entity id in free text, replaced by this run's opaque handle.

    ⚠️ FOR A TOOL THAT DID NOT BUILD ITS OWN RESULT. Our own tools call
    `RefTable.describe` and never hold an id in the first place, which is the
    better shape. An UPSTREAM tool returns whatever Home Assistant's MCP server
    sends, ids included, and something has to translate before `redact.scrub`
    sees it — see `upstream.UpstreamTool.run`.

    ⚠️ IT USES `_ENTITY_ID`, THE SAME PATTERN THE DETECTOR USES, for the reason
    already recorded at `redact.audit`: two regexes for one rule is how the
    weaker one comes to be the only one anybody runs. Substituting with a
    pattern that matched LESS than the detector would leave exactly the ids the
    audit then refuses the whole result over.

    ⚠️ THE MATCH KEEPS ITS LEADING CHARACTER. The pattern anchors on
    `(?:^|[^\\w.])` and captures the id in group 1, so replacing group 0 would
    eat the quote or space in front of it and corrupt the JSON the model reads.
    """
    if table is None:
        return text

    def swap(match: "_re.Match[str]") -> str:
        entity_id = match.group(1)
        return match.group(0).replace(entity_id, table.ref_for(entity_id))

    return _ENTITY_ID.sub(swap, str(text))


def entity_ids_in(blob: object) -> List[str]:
    """Every entity id anywhere in a structure. The leak detector.

    ⚠️ WALKS KEYS AS WELL AS VALUES. A payload keyed BY entity id leaks exactly
    as much as one that lists them, and a value-only scan reports clean — which
    is the shape of a check that passes while measuring nothing.
    """
    found: List[str] = []

    def walk(node: object) -> None:
        if isinstance(node, Mapping):
            for key, value in node.items():
                walk(key)
                walk(value)
        elif isinstance(node, (list, tuple, set)):
            for item in node:
                walk(item)
        elif isinstance(node, str):
            found.extend(_ENTITY_ID.findall(node))

    walk(blob)
    return sorted(set(found))
