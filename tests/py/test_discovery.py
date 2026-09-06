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

from vesta.adapters.discovery import ALL_CAPABILITIES, CAP_ENERGY_COST, CAP_ENERGY_GRID, CAPABILITY_MEANING, _device_stats, _duplicate_names, _grid_sources, _has_tariff
from vesta.adapters.discovery import CAPABILITY_ABSENT, missing_statistic_preflight
from vesta.adapters.hass import statistic_ids_of


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


# ── missing-statistic preflight ──────────────────────────────────────────────
# Extracted from discover() specifically so it can be tested without a live
# Home Assistant: the logic deciding how LOUD a finding is should not need a
# villa to exercise.

def test_no_finding_when_every_statistic_has_history() -> None:
    out = missing_statistic_preflight(
        [("grid", ["sensor.a"]), ("device", ["sensor.b"])], {"sensor.a", "sensor.b"})
    assert out == []


def test_all_missing_is_one_critical_not_many_warnings() -> None:
    """⚠️ The Phase 1 QA finding, reproduced at its real size.

    22 referenced statistics, none with history. That is ONE fault — a config
    left behind by a rename — not twenty-two meters going quiet, and reporting
    it as 22 warnings sends the reader to check 22 meters.
    """
    ids = [f"sensor.s{n}" for n in range(22)]
    out = missing_statistic_preflight([("device", ids)], set())
    assert len(out) == 1
    assert out[0]["code"] == "energy_config_stale"
    assert out[0]["severity"] == "critical"
    assert "22" in out[0]["detail"]


def test_some_missing_is_listed_individually() -> None:
    """A partially broken config really is several independent faults."""
    out = missing_statistic_preflight(
        [("device", ["sensor.a", "sensor.b", "sensor.c"])], {"sensor.a"})
    assert [o["code"] for o in out] == ["statistic_missing"] * 2
    assert all(o["severity"] == "warning" for o in out)
    assert any("sensor.b" in o["detail"] for o in out)


def test_a_long_partial_list_is_bounded() -> None:
    """A reader who needs more than ten names needs the dashboard, not a
    longer log line — but the remainder must still be COUNTED, never dropped."""
    ids = [f"sensor.s{n}" for n in range(40)]
    out = missing_statistic_preflight([("device", ids + ["sensor.ok"])], {"sensor.ok"})
    named = [o for o in out if o["code"] == "statistic_missing"]
    summary = [o for o in out if o["code"] == "statistic_missing_more"]
    assert len(named) == 10
    assert len(summary) == 1
    assert "30 further" in summary[0]["detail"]


def test_one_healthy_statistic_prevents_the_wholesale_claim() -> None:
    """The threshold is ALL, not a count — because that is what makes the
    'your configuration is stale' claim true rather than merely loud."""
    ids = [f"sensor.s{n}" for n in range(30)]
    out = missing_statistic_preflight([("device", ids)], {"sensor.s0"})
    assert all(o["code"] != "energy_config_stale" for o in out)


def test_an_empty_dashboard_produces_no_finding() -> None:
    """Nothing referenced is not the same as everything broken."""
    assert missing_statistic_preflight([("device", [])], set()) == []


def test_both_capability_voices_cover_every_capability() -> None:
    """Two tables, same keys. A capability added to one and not the other
    prints as a bare slug in whichever section reaches for the missing half —
    and the ABSENT table is the one a report shows to an owner."""
    assert set(CAPABILITY_ABSENT) == set(ALL_CAPABILITIES)
    assert set(CAPABILITY_MEANING) == set(CAPABILITY_ABSENT)


def test_the_two_voices_actually_differ() -> None:
    """Guard against the absent table being filled in by copy-paste — which is
    exactly how the bug it fixes would come back."""
    for capability in ALL_CAPABILITIES:
        assert CAPABILITY_ABSENT[capability] != CAPABILITY_MEANING[capability], (
            f"{capability} says the same thing in both voices")


# ── the parse_mode schema, read ONCE ────────────────────────────────────────

#: Schemas a service might declare, including the ones no service should.
#:
#: ⚠️ THE MALFORMED CASES ARE THE POINT. `_html_mode` and `_plain_mode` read the
#: SAME `parse_mode` selector and walked it differently — one guarded
#: `isinstance(options, list)` and the other did not, one required
#: `selector["select"]` to be a dict and the other called `.get` on whatever
#: was there. Measured before this test was written:
#:
#:   select is a string   _html_mode !! AttributeError   _plain_mode ''
#:   select is a list     _html_mode !! AttributeError   _plain_mode ''
#:   options is a dict    _html_mode 'html'              _plain_mode ''
#:
#: The crash is not local: the only handler around `_notify_targets` catches
#: `HassUnavailable`, so one malformed service schema anywhere in the villa
#: takes the whole discovery snapshot with it.
PARSE_MODE_SCHEMAS = {
    "html and plain, as strings":
        {"select": {"options": ["HTML", "plain_text"]}},
    "html and plain, as option objects":
        {"select": {"options": [{"value": "html"}, {"value": "plain"}]}},
    "neither offered": {"select": {"options": ["markdown"]}},
    "no options key": {"select": {}},
    "options is a string": {"select": {"options": "html"}},
    "options is a dict": {"select": {"options": {"html": 1}}},
    "options holds a number": {"select": {"options": [1, 2]}},
    "select is a string": {"select": "html"},
    "select is a list": {"select": ["html"]},
    "selector is a string": "html",
    "selector is a list": ["html"],
}


def _fields(selector):
    return {"parse_mode": {"selector": selector}}


def test_neither_parse_mode_reader_falls_over_on_a_schema_it_dislikes() -> None:
    """⚠️ A SERVICE'S SCHEMA IS NOT OURS TO TRUST. It is whatever an integration
    declared, and discovery walks every service the villa has."""
    from vesta.adapters import discovery as discovery_mod

    for name, selector in PARSE_MODE_SCHEMAS.items():
        for reader in (discovery_mod._html_mode, discovery_mod._plain_mode):
            try:
                out = reader(_fields(selector))
            except Exception as err:                     # noqa: BLE001
                raise AssertionError(
                    "%s raised %s on the %r schema — the only handler around "
                    "`_notify_targets` catches HassUnavailable, so this takes "
                    "the whole discovery snapshot with it"
                    % (reader.__name__, type(err).__name__, name)) from err
            assert isinstance(out, str), (reader.__name__, name, out)


def test_the_two_parse_mode_readers_agree_about_what_the_schema_IS() -> None:
    """⚠️ ONE SCHEMA, ONE TRAVERSAL. They ask different questions — "is html
    offered", "is a no-parsing option offered" — of the same selector, and a
    divergence in how they WALK it is not a difference of question.

    It matters because `deliver._payload_for` ranks them: `if html_mode and
    html_message: … elif plain_mode:`. So `_html_mode` outranks, and a schema
    the two read differently decides whether the villa's own device names are
    handed to a markup parser — which is the exact failure `_plain_mode` was
    written for: "the owner's delivered brief read `criticalschedule---poolpump`".
    """
    from vesta.adapters import discovery as discovery_mod

    for name, selector in PARSE_MODE_SCHEMAS.items():
        options = discovery_mod._parse_mode_options(_fields(selector))
        html = discovery_mod._html_mode(_fields(selector))
        plain = discovery_mod._plain_mode(_fields(selector))
        # A reader may only answer from an option the shared walk found.
        for answer, who in ((html, "_html_mode"), (plain, "_plain_mode")):
            assert answer == "" or answer in options, (
                "%s returned %r for the %r schema, and the shared walk found "
                "%r — the two are reading the selector differently"
                % (who, answer, name, options))


def test_the_readers_still_find_what_a_real_service_offers() -> None:
    """The converse: a walk that refuses everything would pass the two tests
    above and silently take every delivery back to the plain path."""
    from vesta.adapters import discovery as discovery_mod

    strings = _fields({"select": {"options": ["HTML", "plain_text", "markdown"]}})
    assert discovery_mod._html_mode(strings) == "HTML"
    assert discovery_mod._plain_mode(strings) == "plain_text"

    objects = _fields({"select": {"options": [{"value": "html"},
                                              {"value": "none"}]}})
    assert discovery_mod._html_mode(objects) == "html"
    assert discovery_mod._plain_mode(objects) == "none"

    assert discovery_mod._html_mode(_fields({"select": {"options": ["markdown"]}})) == ""
    assert discovery_mod._plain_mode(_fields({"select": {"options": ["markdown"]}})) == ""


def test_the_shared_walk_reads_a_LIST_of_options_and_nothing_else() -> None:
    """⚠️ A DICT IS NOT A LIST OF OPTIONS, and iterating one yields its KEYS.

    The old `_html_mode` had no `isinstance(options, list)` guard, so a service
    declaring `options: {"html": 1}` — a mapping, not a list — had its key read
    as an offered value and got HTML enabled. `_html_mode` outranks
    `_plain_mode` in `deliver._payload_for`, so that is the direction that
    hands the villa's device names to a markup parser.

    ⚠️ SHARING THE WALK DOES NOT COVER THIS. Both readers agree either way,
    because they agree BY CONSTRUCTION now — dropping the guard leaves them
    consistent and both wrong, which the agreement test cannot see. Measured:
    that mutation survived until this assertion existed.
    """
    from vesta.adapters import discovery as discovery_mod

    for shape in ({"html": 1}, "html", 7, None):
        assert discovery_mod._parse_mode_options(
            _fields({"select": {"options": shape}})) == [], shape
        assert discovery_mod._html_mode(
            _fields({"select": {"options": shape}})) == "", shape


def test_an_option_that_merely_CONTAINS_html_is_not_the_html_option() -> None:
    """⚠️ EXACT, NOT SUBSTRING. A service offering `not_html` or `html_legacy`
    is not offering the dialect the alert path proved on hardware. The old
    comparison was `== "html"` and nothing held it there; loosening it to a
    substring survived every other assertion in this file."""
    from vesta.adapters import discovery as discovery_mod

    for near_miss in ("not_html", "html_legacy", "xhtml", "html5"):
        assert discovery_mod._html_mode(
            _fields({"select": {"options": [near_miss]}})) == "", near_miss

    # ⚠️ AND CASE STILL DOES NOT MATTER — services write it both ways, and the
    # value returned is the one the service declared, not a normalised copy.
    assert discovery_mod._html_mode(_fields({"select": {"options": ["HTML"]}})) == "HTML"
    assert discovery_mod._html_mode(_fields({"select": {"options": ["html"]}})) == "html"
