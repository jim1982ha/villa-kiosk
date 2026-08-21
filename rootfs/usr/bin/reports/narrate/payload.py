"""The privacy boundary: what may leave the villa, and nothing else.

⚠️ THIS IS THE ONLY FILE IN THE SUBSYSTEM WHERE A MISTAKE IS UNRECOVERABLE.
Every other defect here produces a wrong report, and the next release fixes it.
A field that should not have travelled has already travelled — to a third party,
possibly into a training set, certainly outside the owner's control — and no
subsequent release un-sends it.

⚠️ ALLOW-LIST BY CONSTRUCTION, NOT BY FILTERING. This copies the permitted keys
onto a fresh object; it never takes a Finding and removes things. The difference
is what happens to a field nobody thought about: a deny-list passes it, an
allow-list drops it. So a new field added to `Finding` is excluded until someone
deliberately writes its name in `contracts.PAYLOAD_ALLOWED_FIELDS`, and the
reviewer of that one line is looking directly at a privacy decision instead of
at a diff that mentions nothing of the sort.

⚠️ NEVER ADMISSIBLE, whatever a future module wants: photographs or any image,
credentials, occupant location or presence history, raw event logs, ENTITY IDS,
and ledger free text beyond a summary count.

⚠️ ROOM AND EQUIPMENT NAMES **ARE** ADMITTED, AND THAT IS A DECISION RATHER
THAN AN OVERSIGHT. `label` and `area` are on the allow-list because prose that
cannot say which pump or which room is prose nobody can act on. Entity ids are
excluded for a different reason: they carry the same information WITHOUT being
needed for it — `sensor.<firstname>_bedroom_window` names a child's bedroom in a
string the reader never sees, so it is pure leak with no reader benefit. The
line is "what does the sentence require", not "what looks sensitive".

⚠️ AND THE PAYLOAD IS NOT `ReportContext`. That object carries the whole
discovery result, the collector's state, the raw aggregation and every event
payload the villa fired. A narrator that could see it is one edit away from
transmitting it, which is why `narrate/base.py` says the two must never be the
same object.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence

from ..contracts import (
    AUDIENCE, CADENCE, FINDING_KIND, PAYLOAD_ALLOWED_FIELDS, SEVERITY,
    TREND_DIRECTION, ZONE,
)

#: Context the provider needs to write ABOUT something, none of which
#: identifies the property. Deliberately tiny and deliberately enumerated here
#: rather than passed through from the report — the same rule as the field
#: allow-list, one level up.
#:
#: ⚠️ `period` IS A DATE OR A WEEK NUMBER ("2026-W34"), which is fine. It is not
#: a location, an address or an install id, and nothing here is.
FRAME_KEYS = ("audience", "cadence", "period", "finding_count")


def _clean(value: Any) -> Any:
    """A value fit to leave, or None.

    ⚠️ SCALARS ONLY. A permitted key whose value is a dict or a list could
    carry anything nested inside it — that is how an allow-list keyed on NAMES
    gets defeated by a VALUE — so only the primitive types a report sentence can
    actually use survive, and everything else becomes None.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value
    return None


def finding_payload(finding: Mapping[str, Any]) -> Dict[str, Any]:
    """One finding, reduced to what may travel.

    ⚠️ BUILT BY COPYING, NOT BY DELETING — see the module docstring. The loop is
    over the ALLOW-LIST, never over the finding's own keys, so an unknown field
    cannot reach the output even by accident.
    """
    out: Dict[str, Any] = {}
    for key in PAYLOAD_ALLOWED_FIELDS:
        if key not in finding:
            continue
        value = _clean(finding[key])
        if value is not None and value != "":
            out[key] = value
    return out


def build(
    findings: Sequence[Mapping[str, Any]],
    *,
    audience: str,
    cadence: str,
    period: str,
    blind_spots: Sequence[str] = (),
) -> Dict[str, Any]:
    """The whole payload for one narration request.

    `blind_spots` are `capability_absent` sentences — "Water use is not
    metered" — which are constants in this add-on's own source, identical on
    every install, and are what stop a provider writing confidently about
    something the property cannot measure.

    ⚠️ THE ENUMS ARE VALIDATED ON THE WAY OUT, not just on the way in. A
    `severity` or `kind` that is not in the contract is dropped rather than
    forwarded: these reach a third party, and "whatever the module put there"
    is not a thing to hand over.
    """
    safe: List[Dict[str, Any]] = []
    for finding in findings:
        if not isinstance(finding, Mapping):
            continue
        item = finding_payload(finding)
        if item.get("severity") not in SEVERITY:
            item.pop("severity", None)
        if item.get("kind") not in FINDING_KIND:
            item.pop("kind", None)
        # ⚠️ THE NEW ENUMS GET THE SAME TREATMENT, not a comment saying they
        # should. An unvalidated enum is a free-text field with a short name.
        if item.get("zone") not in ZONE:
            item.pop("zone", None)
        if item.get("trend_direction") not in TREND_DIRECTION:
            item.pop("trend_direction", None)
        if item:
            safe.append(item)

    return {
        "audience": audience if audience in AUDIENCE else AUDIENCE[0],
        "cadence": cadence if cadence in CADENCE else CADENCE[0],
        "period": str(period),
        "finding_count": len(safe),
        "findings": safe,
        # ⚠️ Sentences from THIS add-on's own constants, never from the
        # deployment. `capability_absent` is a fixed table in `discovery.py`;
        # nothing an operator typed reaches it.
        "not_covered": [str(s) for s in blind_spots if isinstance(s, str)],
    }


def audit(payload: Mapping[str, Any]) -> List[str]:
    """Everything in this payload that should not be there. Empty is the pass.

    ⚠️ A SECOND OPINION ON THE FIRST ONE, and it exists because `build` being
    correct is not the same as `build` being correct FOREVER. This walks the
    finished object rather than the code that made it, so a future refactor
    that reintroduces a key — or a provider adapter that adds one on the way
    out — is caught by the thing that ships, not by review.

    Callers should treat a non-empty result as "do not send".
    """
    problems: List[str] = []
    allowed_top = set(FRAME_KEYS) | {"findings", "not_covered"}

    for key in payload:
        if key not in allowed_top:
            problems.append(f"unexpected top-level key: {key}")

    findings = payload.get("findings")
    if not isinstance(findings, list):
        problems.append("findings is not a list")
        return problems

    for index, item in enumerate(findings):
        if not isinstance(item, Mapping):
            problems.append(f"findings[{index}] is not an object")
            continue
        for key, value in item.items():
            if key not in PAYLOAD_ALLOWED_FIELDS:
                problems.append(f"findings[{index}].{key} is not allow-listed")
            if _clean(value) is None:
                problems.append(
                    f"findings[{index}].{key} is not a scalar — a nested value "
                    f"can carry anything")
        # ⚠️ THE ENTITY-ID SHAPE, CHECKED ON THE VALUE. The allow-list governs
        # KEYS; this catches an entity id smuggled inside a permitted one —
        # a `label` copied from `entity_id` by a module that meant well.
        # ⚠️ `detail` IS ABSENT FROM THIS LIST BECAUSE IT IS ABSENT FROM THE
        # ALLOW-LIST. It is where blueprint free text lands — an operator's
        # `task_text`, a ticket description — so it is the one Finding field
        # whose contents nobody can bound, and the contract excludes it. The
        # provider gets NUMBERS and writes the sentence; it is never handed a
        # sentence to rephrase.
        for key in ("label", "area", "ref"):
            value = item.get(key)
            if isinstance(value, str) and _looks_like_entity_id(value):
                problems.append(
                    f"findings[{index}].{key} looks like an entity id: {value!r}")
    return problems


def from_context(context: Any) -> Dict[str, Any]:
    """A `ReportContext` narrowed to what may leave the villa.

    ⚠️ THE NARROWING LIVES HERE, IN THE FILE THAT OWNS THE BOUNDARY, and not in
    `pipeline.py` where it would be one convenient line among fifty. Every field
    that crosses is named in this function or in `PAYLOAD_ALLOWED_FIELDS`, so
    the whole privacy decision is readable in one place — and it goes through
    `build`, so it inherits the allow-list rather than reimplementing it.

    ⚠️ IT TAKES `Any`, NOT `ReportContext`, ON PURPOSE. Importing the dataclass
    would make this module depend on the object it exists to keep out, and the
    type annotation would be the only thing standing between them. Duck-typed
    reads of four attributes cannot accidentally widen into "pass the context
    through"; `build`'s signature — pinned by a test — is what actually holds
    the line.

    ⚠️ AND THE BLIND SPOTS ARE THIS ADD-ON'S OWN SENTENCES. `capability_absent`
    is a fixed table in `discovery.py`, identical on every install. It is what
    stops a provider writing confidently about water use on a property with no
    water meter — the same reason the deterministic renderer's section 8 exists.
    """
    discovery: Mapping[str, Any] = getattr(context, "discovery", {}) or {}
    absent: Mapping[str, Any] = discovery.get("capability_absent") or {}
    missing = discovery.get("capabilities_missing") or []

    blind: List[str] = []
    for capability in missing:
        sentence = absent.get(capability)
        if isinstance(sentence, str) and sentence:
            blind.append(sentence)

    # ⚠️ THE COLLECTOR'S GAP TRAVELS TOO. A provider told only about findings
    # will write "a quiet week"; a gap in the recording is the one fact that
    # makes that sentence false, and it is about this add-on rather than about
    # the property, so nothing identifying rides along with it.
    collector: Mapping[str, Any] = getattr(context, "collector", {}) or {}
    if collector.get("blueprint_categories") and not collector.get("connected"):
        blind.append("This property's own automation alerts were not being "
                     "recorded for part of this period.")

    # ⚠️ THE ZONE IS ATTACHED HERE, FROM THE RENDERER'S OWN TABLE, so the model
    # is told what leads by the same rule the document is built with. Deriving it
    # separately would let the two disagree about what "needs you" means, which
    # is the divergence this whole subsystem exists to prevent.
    def _zoned(item: Mapping[str, Any]) -> Mapping[str, Any]:
        from .deterministic import SECTION_FOR_KIND, ZONE_OF_SECTION
        section = SECTION_FOR_KIND.get(str(item.get("kind") or ""), "trends")
        zone = ZONE_OF_SECTION.get(section)
        return {**item, "zone": zone} if zone else item

    findings: List[Mapping[str, Any]] = [
        _zoned(f) for f in (getattr(context, "findings", None) or [])
        if isinstance(f, Mapping)]
    # `aggregated["findings"]` are `Finding` objects — the blueprint layer's
    # own output, already free of entity ids by `to_findings`' contract.
    aggregated: Mapping[str, Any] = getattr(context, "aggregated", {}) or {}
    for item in aggregated.get("findings") or []:
        as_dict = getattr(item, "as_dict", None)
        if callable(as_dict):
            findings.append(as_dict())
        elif isinstance(item, Mapping):
            findings.append(item)

    return build(
        findings,
        audience=str(getattr(context, "audience", "")),
        cadence=str(getattr(context, "cadence", "")),
        period=str(getattr(context, "period", "")),
        blind_spots=blind,
    )


def _looks_like_entity_id(value: str) -> bool:
    """`domain.object_id` — the shape, not a list of domains.

    ⚠️ SHAPE, DELIBERATELY. A domain list goes stale the moment Home Assistant
    adds one, and this must not have to be maintained to keep working. A human
    label almost never looks like `lower_snake.lower_snake` with no spaces.
    """
    if " " in value or "." not in value:
        return False
    head, _, tail = value.partition(".")
    ok = "abcdefghijklmnopqrstuvwxyz0123456789_"
    return (bool(head) and bool(tail)
            and all(c in ok for c in head)
            and all(c in ok for c in tail))
