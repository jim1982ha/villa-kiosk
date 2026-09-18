"""Reading how the property is SET UP — the third surface, once, for all domains.

⚠️ WHY THIS EXISTS, AND WHAT IT REPLACES. The model could read entities
(`ha_search`, `ha_get_state`) and call services (`call_read_only_service`) and
could not read CONFIGURATION. The Energy dashboard is configuration — not an
entity, not a service — so "which meters are top-level" was unreachable, and
every attempt to fix that produced another domain-shaped patch: a `read_energy`
tool, then a `read_weather` tool, then hand-written prose about electricity in
the villa document. That prose ignored the water and gas sitting in the same
configuration, which is the tell that it never generalised.

⚠️ THE GATE IS HOME ASSISTANT'S OWN NAMING, NOT A LIST. Core names readers
`get…`/`list` in the final segment. A permitted-command list would be the same
anticipation trap one level down and would go stale the first time Core added
one. A convention scales; a list does not.

⚠️ AND A DENY-LIST GUARDS THE CONVENTION, because a convention is weaker than a
declaration. Positive rule AND negative guard: either alone is one rename away
from letting something through.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent.sources import _is_read_command  # noqa: E402


@pytest.mark.parametrize("command", [
    "energy/get_prefs",                 # the one that started this
    "config/area_registry/list",
    "config/entity_registry/list",
    "get_services",
    "get_states",
    "get_config",
    "sensor/device_class_convertible_units/get",
    "lovelace/config/get",
])
def test_a_read_command_is_allowed(command):
    assert _is_read_command(command) is True


@pytest.mark.parametrize("command", [
    "call_service",                     # the whole point of the deny-list
    "energy/save_prefs",
    "config/area_registry/create",
    "config/area_registry/delete",
    "config/entity_registry/update",
    "subscribe_events",
    "fire_event",
    "homeassistant/restart",
    "hassio/addon/stop",
    "config/auth/create",
])
def test_anything_that_could_change_the_property_is_refused(command):
    assert _is_read_command(command) is False


@pytest.mark.parametrize("command", [
    "",
    "   ",
    "Energy/Get_Prefs",                 # case is part of the convention
    "energy/get prefs",                 # a space is not a command
    "energy/get_prefs; rm -rf /",
    "../../etc/passwd",
    "energy/get_prefs\nconfig/auth/create",
])
def test_a_malformed_command_is_refused(command):
    """⚠️ REFUSED, NOT SANITISED. The command is chosen by a model reading
    villa data; the only safe treatment of something that does not match the
    shape exactly is to decline it."""
    assert _is_read_command(command) is False


@pytest.mark.parametrize("command", [
    "config/thing/get_and_reset",       # reads AND mutates
    "config/thing/get_and_delete",
])
def test_the_deny_list_beats_the_prefix(command):
    """⚠️ THE CASE THE CONVENTION ALONE GETS WRONG. It starts with `get`, so
    the positive rule admits it; naming a mutating verb refuses it anyway.
    This is why both halves exist."""
    assert _is_read_command(command) is False


@pytest.mark.parametrize("command", [
    "homeassistant/ping",
    "render_template",
    "config/auth/sign_path",
    "hassio/addon/info",
])
def test_a_command_that_is_not_a_READER_is_refused_even_if_it_is_harmless(command):
    """⚠️ THE CASE ONLY THE POSITIVE RULE CATCHES, and without it the whole
    test set passed with that rule deleted — every other refusal here is caught
    by the deny-list, so the convention half was measuring nothing. Found by
    mutation.

    These name no changing verb and some are genuinely harmless. They are still
    refused: the gate admits what it RECOGNISES as a read, not everything it
    fails to recognise as a write. Fail closed."""
    assert _is_read_command(command) is False


def test_the_gate_names_no_domain_of_any_property():
    """⚠️ THE POINT OF THE EXERCISE. The moment 'energy' or 'weather' appears
    in this rule it is a catalogue of anticipated questions again."""
    from conftest import code_of
    from vesta.supervise.agent import sources
    src = code_of(sources)
    for named in ("energy/get_prefs", "get_forecasts", "weather"):
        assert named not in src, f"a domain reached the gate: {named}"
