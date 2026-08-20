"""Capability detection and preflight, against synthetic deployments.

⚠️ EVERY FIXTURE HERE IS INVENTED. The logic was developed against a real
deployment read live over MCP, but this repository is PUBLIC and its owner's
entity ids name their rooms and their family's devices. The fixtures reproduce
the SHAPE that mattered — a grid source with null cost fields, a device tree
rolled up via `included_in_stat`, notify services with a broadcast target and a
name collision — and nothing that identifies anyone.

That is also the stricter reading of the project's hard rule: villa-specific
data may exist in tests, but "may" is not "should", and a shape is all a test
needs.
"""

from __future__ import annotations

from typing import Any, Dict, List

from reports.discovery import (
    ALL_CAPABILITIES,
    CAP_ENERGY_COST,
    CAP_ENERGY_GRID,
    CAPABILITY_MEANING,
    _device_stats,
    _duplicate_names,
    _grid_sources,
    _has_tariff,
)
from reports.hass import statistic_ids_of


def _grid(**overrides: Any) -> Dict[str, Any]:
    """A grid source with every tariff route unconfigured — the shape a real
    Energy dashboard has when the owner never entered a price."""
    source: Dict[str, Any] = {
        "type": "grid",
        "stat_energy_from": "sensor.meter_import",
        "stat_energy_to": "sensor.meter_export",
        "stat_cost": None,
        "entity_energy_price": None,
        "number_energy_price": None,
    }
    source.update(overrides)
    return source


def test_grid_sources_ignores_other_types() -> None:
    prefs = {"energy_sources": [_grid(), {"type": "solar"}, "junk"]}
    assert len(_grid_sources(prefs)) == 1


def test_no_tariff_when_every_route_is_null() -> None:
    """The observed real-world default: metered, but no price anywhere."""
    assert _has_tariff([_grid()]) is False


def test_tariff_by_cost_statistic() -> None:
    assert _has_tariff([_grid(stat_cost="sensor.meter_cost")]) is True


def test_tariff_by_flat_rate() -> None:
    """The commonest of the three, and the one a `stat_cost`-only check misses.

    A flat rate of 0 is still a configured tariff, but 0.0 is falsy — hence the
    explicit numeric test rather than a truthiness check.
    """
    assert _has_tariff([_grid(number_energy_price=0.28)]) is True
    assert _has_tariff([_grid(number_energy_price=0.0)]) is True


def test_tariff_ignores_a_boolean_price() -> None:
    """`isinstance(True, int)` is True in Python, so a JSON `true` would read
    as a configured price of 1."""
    assert _has_tariff([_grid(number_energy_price=True)]) is False


def test_tariff_by_price_entity() -> None:
    assert _has_tariff([_grid(entity_energy_price="sensor.tariff")]) is True


def test_statistic_ids_drops_nulls() -> None:
    """An unconfigured field is present-and-None, not absent — so a plain
    `.get()` yields a list containing None and every downstream set operation
    silently carries it."""
    ids = statistic_ids_of([_grid()], "stat_cost")
    assert ids == []
    assert statistic_ids_of([_grid()], "stat_energy_from") == ["sensor.meter_import"]


def test_device_rollup_is_detected() -> None:
    """`included_in_stat` means the child is ALREADY counted in the parent.
    Summing every device double-counts unless the tree is honoured."""
    prefs = {"device_consumption": [
        {"stat_consumption": "sensor.a", "included_in_stat": "sensor.total"},
        {"stat_consumption": "sensor.b", "included_in_stat": "sensor.total"},
        {"stat_consumption": "sensor.total"},
    ]}
    devices = _device_stats(prefs)
    rolled = {d["stat_consumption"]: d["included_in_stat"]
              for d in devices if d.get("included_in_stat")}
    independent = sorted(set(statistic_ids_of(devices, "stat_consumption")) - set(rolled))
    assert rolled == {"sensor.a": "sensor.total", "sensor.b": "sensor.total"}
    assert independent == ["sensor.total"], "the parent is the only independent meter"


def test_duplicate_notify_names_are_reported() -> None:
    """The operator picks from a list of NAMES; two identical ones are
    indistinguishable until the report reaches the wrong person."""
    targets: List[Dict[str, Any]] = [
        {"service": "notify.a", "name": "Mobile App"},
        {"service": "notify.b", "name": "mobile app"},
        {"service": "notify.c", "name": "Tablet"},
    ]
    assert _duplicate_names(targets) == ["mobile app"]


def test_distinct_notify_names_are_clean() -> None:
    assert _duplicate_names([{"service": "notify.a", "name": "Phone"},
                             {"service": "notify.b", "name": "Tablet"}]) == []


def test_every_capability_has_an_operator_facing_meaning() -> None:
    """A missing capability is shown to the operator. "energy_cost: absent" is
    not actionable; the sentence beside it is what makes it so — and a new
    capability added without one would display as a bare slug."""
    for capability in ALL_CAPABILITIES:
        assert capability in CAPABILITY_MEANING, f"{capability} has no explanation"
        assert CAPABILITY_MEANING[capability].strip().endswith("."), capability


def test_meaning_table_has_no_extras() -> None:
    assert set(CAPABILITY_MEANING) == set(ALL_CAPABILITIES)


def test_metered_without_a_tariff_is_the_case_that_must_be_reported() -> None:
    """The exit criterion, as a property: a deployment that meters energy but
    has no price must end up with the grid capability and WITHOUT the cost one,
    which is what triggers the `no_tariff` preflight notice."""
    grid = _grid_sources({"energy_sources": [_grid()]})
    assert statistic_ids_of(grid, "stat_energy_from"), "grid should be detected"
    assert not _has_tariff(grid), "cost should not be detected"
    assert CAP_ENERGY_GRID in ALL_CAPABILITIES and CAP_ENERGY_COST in ALL_CAPABILITIES
