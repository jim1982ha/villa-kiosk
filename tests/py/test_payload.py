"""The privacy boundary, pinned.

⚠️ EVERY OTHER TEST IN THIS SUITE GUARDS A REPORT. This one guards the owner.
A wrong report is fixed by the next release; a field that should not have left
the villa has already left it — to a third party, possibly into a training set,
certainly outside anyone's control — and no release un-sends it.

So the negative cases are the file. "It sends the right things" is easy and
nearly worthless; "it cannot send the wrong things, including ones nobody has
thought of yet" is the property.
"""

from __future__ import annotations

from typing import Any, Dict

from reports.contracts import PAYLOAD_ALLOWED_FIELDS
from reports.narrate import payload as P


def _finding(**extra: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "ref": "g0", "kind": "ANOMALY", "severity": "warning",
        "label": "Pump short-cycling", "detail": "14 transitions",
        "area": "Plant room", "metric": "energy", "unit": "kWh",
        "observed": 1.4, "baseline": 0.9, "delta": 0.55,
        "window_days": 7, "confidence": 0.8, "completeness": 1.0,
    }
    base.update(extra)
    return base


# ── what may travel ─────────────────────────────────────────────────────────

def test_the_permitted_fields_survive() -> None:
    out = P.finding_payload(_finding())
    for key in ("ref", "kind", "severity", "label", "area",
                "observed", "baseline", "confidence"):
        assert key in out, key


def test_the_free_TEXT_does_not_travel_but_the_NUMBERS_do() -> None:
    """⚠️ `detail` IS NOT ON THE ALLOW-LIST, and I asserted it should be before
    reading the contract. It is right and I was wrong: `detail` is where
    blueprint free text lands — `task_text` an operator wrote, a description
    from a ticket, whatever `_measurement` rendered — so it is the one field on
    a Finding whose contents nobody can bound.

    The structured fields carry the same information in a form that CAN be
    bounded: `observed`, `baseline`, `delta`, `unit`, `metric`. The provider is
    given numbers and writes the sentence; it is not given a sentence to
    rephrase. That is a better division anyway — it is what stops a provider
    laundering an operator's free text into prose that looks like the add-on's.
    """
    out = P.finding_payload(_finding(detail="<firstname> said the pump is loud"))
    assert "detail" not in out
    assert out["observed"] == 1.4 and out["baseline"] == 0.9
    assert out["unit"] == "kWh"


def test_a_room_name_is_admitted_on_purpose() -> None:
    """⚠️ A DECISION, NOT AN OVERSIGHT. Prose that cannot say which pump or
    which room is prose nobody can act on. Entity ids are excluded for a
    different reason — they carry the same information WITHOUT being needed
    for it."""
    assert P.finding_payload(_finding())["area"] == "Plant room"


# ── what may not, including what nobody has thought of ──────────────────────

def test_an_unknown_field_is_dropped_by_construction() -> None:
    """⚠️ THE WHOLE POINT OF AN ALLOW-LIST. A deny-list passes what nobody
    anticipated; this drops it. A new `Finding` field is excluded until someone
    deliberately writes its name in the contract."""
    out = P.finding_payload(_finding(
        entity_id="sensor.bedroom_window",
        photo_id="abc123",
        raw_event={"anything": "at all"},
        occupant_home=True,
    ))
    for forbidden in ("entity_id", "photo_id", "raw_event", "occupant_home"):
        assert forbidden not in out, forbidden


def test_a_permitted_key_holding_a_nested_value_is_dropped() -> None:
    """⚠️ AN ALLOW-LIST KEYED ON NAMES IS DEFEATED BY A VALUE. A `label` that
    is a dict could carry an entire event payload under an approved name."""
    out = P.finding_payload(_finding(label={"entity_id": "light.bedroom_lamp"}))
    assert "label" not in out
    out = P.finding_payload(_finding(detail=["sensor.a", "sensor.b"]))
    assert "detail" not in out


def test_the_allow_list_is_the_loop() -> None:
    """A finding with a hundred unknown keys yields only allow-listed ones —
    the iteration is over the CONTRACT, never over the input."""
    noisy = _finding(**{f"leak_{n}": f"secret_{n}" for n in range(100)})
    assert set(P.finding_payload(noisy)) <= set(PAYLOAD_ALLOWED_FIELDS)


# ── the whole payload ───────────────────────────────────────────────────────

def test_build_emits_only_the_frame_and_the_findings() -> None:
    out = P.build([_finding()], audience="owner", cadence="weekly",
                  period="2026-W34")
    assert set(out) == {"audience", "cadence", "period", "finding_count",
                        "findings", "not_covered"}


def test_an_off_contract_enum_is_dropped_on_the_way_out() -> None:
    """⚠️ VALIDATED OUTBOUND, not only inbound. These reach a third party, and
    "whatever the module put there" is not a thing to hand over."""
    out = P.build([_finding(severity="URGENT", kind="SOMETHING_NEW")],
                  audience="owner", cadence="weekly", period="P")
    assert "severity" not in out["findings"][0]
    assert "kind" not in out["findings"][0]


def test_an_unknown_audience_or_cadence_falls_back_rather_than_travelling() -> None:
    out = P.build([], audience="../../etc/passwd", cadence="hourly", period="P")
    assert out["audience"] == "owner" and out["cadence"] == "daily"


# ── the second opinion ──────────────────────────────────────────────────────

def test_audit_passes_a_clean_payload() -> None:
    out = P.build([_finding()], audience="owner", cadence="weekly", period="P")
    assert P.audit(out) == []


def test_audit_catches_a_key_reintroduced_after_build() -> None:
    """⚠️ `build` BEING CORRECT IS NOT `build` BEING CORRECT FOREVER. This walks
    the finished object, so a provider adapter that adds a key on the way out is
    caught by the thing that ships rather than by review."""
    out = P.build([_finding()], audience="owner", cadence="weekly", period="P")
    out["findings"][0]["entity_id"] = "sensor.house_pump_power"
    problems = P.audit(out)
    assert any("entity_id" in p for p in problems)


def test_audit_catches_an_entity_id_smuggled_inside_a_permitted_key() -> None:
    """The allow-list governs KEYS. This is the value check: a `label` copied
    from an entity id by a module that meant well."""
    out = P.build([_finding(label="sensor.bedroom_window")],
                  audience="owner", cadence="weekly", period="P")
    problems = P.audit(out)
    assert any("looks like an entity id" in p for p in problems)


def test_a_human_label_is_not_mistaken_for_an_entity_id() -> None:
    """A false positive here would block a legitimate report, so the shape test
    has to be tight: spaces, capitals and no dot are all disqualifying."""
    for good in ("Pump short-cycling", "Living room AC", "Bathroom VMC",
                 "Gym lights", "Lights - monitored rooms", "26.9% above"):
        assert not P._looks_like_entity_id(good), good
    for bad in ("sensor.house_pump_power", "light.a", "binary_sensor.leak_x"):
        assert P._looks_like_entity_id(bad), bad


def test_audit_rejects_an_unexpected_top_level_key() -> None:
    out = P.build([], audience="owner", cadence="weekly", period="P")
    out["inventory"] = {"devices": ["sensor.a"]}
    assert any("inventory" in p for p in P.audit(out))


# ── the shape of the guarantee ──────────────────────────────────────────────

def test_nothing_from_the_report_context_leaks_through_the_signature() -> None:
    """⚠️ THE PAYLOAD IS NOT `ReportContext`. That object carries discovery, the
    collector's state, the raw aggregation and every event the villa fired.
    `build` cannot be handed one — it takes findings and three strings — which
    is the structural half of the guarantee, not a runtime check."""
    import inspect
    params = set(inspect.signature(P.build).parameters)
    assert params == {"findings", "audience", "cadence", "period", "blind_spots"}


def test_a_real_aggregated_finding_passes_the_audit() -> None:
    """End to end against the aggregator's own output, not a hand-built dict —
    the same reason `test_sections` builds through `aggregate.aggregate`."""
    from reports import aggregate
    when = "2026-08-20T10:00:00+08:00"
    events = [{"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_idle_load", "rule_id": "ROI-01",
        "report_bucket": "Living room AC", "entities": ["climate.living"],
        "kwh": 1.4, "cost_local": 2380.0, "basis": "estimated",
        "timestamp": when}}]
    findings = [f.as_dict() for f in
                aggregate.to_findings(aggregate.group(
                    aggregate.normalise_all(events)))]
    out = P.build(findings, audience="owner", cadence="weekly", period="2026-W34")
    assert P.audit(out) == []
    import json
    assert "climate.living" not in json.dumps(out)


# ── the inspector shows the real object, not a description of it ────────────

def test_a_preview_carries_the_payload_that_would_actually_be_sent() -> None:
    """⚠️ THE WHOLE VALUE OF THE INSPECTOR IS THAT IT IS NOT A MOCK-UP.

    "Only numbers leave the villa" is a promise, and on a redistributable
    add-on the reader cannot audit the source to check it. So a preview carries
    the output of `payload.from_context` — the same function, on the same
    context, that a real narration transmits — plus `audit()`'s verdict on that
    exact object. A panel fed from a second, hand-kept list in the SPA would
    keep saying the right words after the backend changed, which is a privacy
    claim verified against the wrong thing.

    This pins the identity: what the preview exposes IS what narration sends.
    """
    from reports.narrate.base import ReportContext
    context = ReportContext(
        audience="owner", cadence="weekly", period="2026-W34",
        generated_at="2026-08-21T07:00:00+08:00",
        discovery={"reachable": True, "capabilities": [],
                   "capabilities_missing": ["energy_cost"],
                   "capability_absent": {"energy_cost": "No tariff is configured."}},
        findings=[_finding(entity_id="sensor.bedroom_window")],
    )
    shown = P.from_context(context)
    assert P.audit(shown) == []
    import json
    text = json.dumps(shown)
    assert "bedroom_window" not in text
    assert "No tariff is configured." in text, (
        "blind spots travel, so the provider cannot write confidently about "
        "something this property cannot measure")


def test_the_withheld_list_names_fields_and_never_values() -> None:
    """⚠️ THE HALF THAT CONVINCES. A list of PERMITTED names tells a reader what
    the policy says; a list of names it actually dropped on their own data shows
    it applying. Names only — printing the values would leak them into the panel
    whose purpose is to show they are not leaked."""
    from reports.narrate.base import ReportContext
    from reports.pipeline import _withheld_fields
    context = ReportContext(
        audience="owner", cadence="weekly", period="P", generated_at="",
        findings=[_finding(entity_id="sensor.bedroom_window",
                           detail="<firstname> said the pump is loud")],
    )
    withheld = _withheld_fields(context, P.from_context(context))
    assert "entity_id" in withheld and "detail" in withheld
    assert "label" not in withheld, "an allow-listed field is not withheld"
    for name in withheld:
        assert "bedroom_window" not in name and "<firstname>" not in name


def test_withheld_means_the_policy_dropped_it_not_that_it_was_empty() -> None:
    """⚠️ A FALSE PRIVACY CLAIM, ERRING IN THE DIRECTION THAT FLATTERS US.

    The first cut compared source keys against EMITTED keys, so an allow-listed
    field that happened to be blank on this property's data was reported as
    withheld. A live QA run printed `withheld: area, baseline, dedup_key, delta,
    horizon_days, window_days` — five of those six ARE permitted and were merely
    empty on blueprint-derived findings. Only `detail` and `dedup_key` were
    actually being kept back.

    Telling an owner we protect more than we do, in the one panel whose whole
    job is to be believed, is worse than telling them nothing.
    """
    from reports.narrate.base import ReportContext
    from reports.pipeline import _withheld_fields
    from reports.contracts import PAYLOAD_ALLOWED_FIELDS

    # `area` is allow-listed and empty here; `detail` is allow-listed nowhere.
    context = ReportContext(
        audience="owner", cadence="weekly", period="P", generated_at="",
        findings=[_finding(area="", baseline=None, delta=None,
                           detail="<firstname> said the pump is loud")],
    )
    withheld = _withheld_fields(context, P.from_context(context))
    assert "detail" in withheld, "the one field nobody can bound must be named"
    for permitted in ("area", "baseline", "delta"):
        assert permitted not in withheld, (
            f"{permitted} is on the allow-list — reporting it as withheld "
            f"claims a protection that does not exist")
    assert not (set(withheld) & set(PAYLOAD_ALLOWED_FIELDS)), (
        "nothing on the allow-list may ever be described as withheld")
