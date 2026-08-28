"""The agent's settings and its kill switches. REQ-061.

⚠️ THE TWO ASSERTIONS THAT MATTER MOST ARE ABOUT EMPTINESS. `allowed_senders`
with an entry is an open bot; `actuable_entities` with an entry is an agent acting
on a device nobody authorised. Both must be filled in by a person, once,
deliberately — so a "helpful" seed has to fail the build.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent import config


# ── the seeds that must stay empty ─────────────────────────────────────────

@pytest.mark.parametrize("key", config.MUST_BE_EMPTY)
def test_the_security_seeds_ship_EMPTY(key: str) -> None:
    """⚠️ A seed here is a security bug, not a convenience."""
    assert not config.DEFAULTS[key], (
        f"{key} must ship empty — a default entry is an open bot or an "
        f"agent acting on a device nobody authorised")
    assert not config.view({})[key], "and an unconfigured read must be empty too"


def test_every_kill_switch_ships_OFF() -> None:
    """⚠️ An add-on that begins reasoning about a villa the moment it is
    installed — before anybody set a budget or a recipient — spends money
    nobody agreed to."""
    fresh = config.view({})
    assert fresh["enabled"] is False
    assert fresh["act_enabled"] is False
    # ⚠️ EVERY TRIGGER EXCEPT THE CLOCK, DERIVED RATHER THAN LISTED. This named
    # `chat` and `event` individually, so deleting the dead `event` trigger in
    # 2.762.0 turned it red for a reason that had nothing to do with the
    # property — and a test that must be edited to follow an intended deletion
    # is measuring the edit. `scheduled` is the one that ships ON, because the
    # cadence IS the product; it spends nothing until `enabled` is also true.
    for name, on in fresh["triggers"].items():
        if name != "scheduled":
            assert on is False, f"the {name} trigger ships ON"


# ── defaults are never persisted ───────────────────────────────────────────

def test_defaults_are_applied_at_READ_time_and_never_written() -> None:
    """⚠️ `AppConfig`'s merge-on-load RESURRECTED entries the operator had
    deleted, and the report was "stale entities I can't delete". A sparse
    overlay means an absent key reads as its default and a DELETED key stays
    deleted."""
    stored: Dict[str, Any] = {"enabled": True}
    seen = config.view(stored)
    # ⚠️ DERIVED FROM THE SHIPPED DEFAULT, NEVER RESTATED. This held a literal
    # 8 and went red when 2.752.0 cut the turn cap to 4 — a test that has to be
    # edited to follow an intended change is measuring the edit, not the code.
    assert seen["enabled"] is True
    assert seen["depth"] == config.DEFAULTS["depth"]
    assert stored == {"enabled": True}, "view() must not mutate the stored doc"


def test_an_operator_can_express_an_EMPTY_list() -> None:
    """The exact resurrection bug: emptying a list must stay empty."""
    assert config.view({"actuable_entities": []})["actuable_entities"] == []
    assert config.view({"suppressed_subjects": []})["suppressed_subjects"] == []


def test_the_default_dicts_are_copied_not_shared() -> None:
    """Otherwise one caller's edit leaks into every later read."""
    a = config.view({})
    a["triggers"]["chat"] = True
    a["actuable_entities"].append("light.x")
    assert config.view({})["triggers"]["chat"] is False
    assert config.view({})["actuable_entities"] == []


# ── triggers merge one level, and only triggers ────────────────────────────

def test_turning_ONE_trigger_off_does_not_turn_the_others_off() -> None:
    """⚠️ THE DELIBERATE EXCEPTION TO SHALLOWNESS. Its members are independent
    kill switches; an operator disabling `chat` must not have to restate
    `scheduled` to keep it — and forgetting one would turn a switch ON, which
    is the wrong direction to fail."""
    seen = config.view({"triggers": {"chat": False}})
    assert seen["triggers"]["scheduled"] is True
    assert seen["triggers"]["chat"] is False


def test_an_unknown_key_is_KEPT_so_a_downgrade_does_not_delete_settings() -> None:
    seen = config.view({"a_future_setting": 42})
    assert seen["a_future_setting"] == 42


# ── the two gates ──────────────────────────────────────────────────────────

def test_act_enabled_ALONE_authorises_nothing() -> None:
    """⚠️ AND-ed. Turning actuation on with an empty list is the correct
    behaviour for a switch somebody flipped to see what happens."""
    assert config.may_act({"act_enabled": True}, "d3") is False
    assert config.may_act({"act_enabled": True, "actuable_entities": ["light.x"]}, "light.x") is True
    assert config.may_act({"act_enabled": True, "actuable_entities": ["light.x"]}, "lock.foo") is False


def test_the_list_ALONE_authorises_nothing_either() -> None:
    assert config.may_act({"actuable_entities": ["light.x"]}, "light.x") is False


def test_enabled_false_stops_every_trigger() -> None:
    cfg = {"enabled": False, "triggers": {"scheduled": True, "chat": True}}
    for name in ("scheduled", "chat", "event"):
        assert config.trigger_enabled(cfg, name) is False


def test_a_trigger_flag_stops_only_its_own_entry_point() -> None:
    cfg = {"enabled": True, "triggers": {"scheduled": True, "chat": False}}
    assert config.trigger_enabled(cfg, "scheduled") is True
    assert config.trigger_enabled(cfg, "chat") is False
    assert config.trigger_enabled(cfg, "nonsense") is False


# ── validation ─────────────────────────────────────────────────────────────

def test_an_unknown_SENDER_ROLE_is_refused_not_defaulted() -> None:
    """⚠️ Defaulting would grant SOME access to a typo, and this map is the
    only thing between the villa and anyone who finds the bot."""
    problems = config.errors({"allowed_senders": {"123": "admin"}})
    assert any("admin" in p and "owner" in p for p in problems)
    # ⚠️ THE APP HAS THREE PROFILES AND `facility` IS NOT ONE OF THEM. This
    # fixture accepted it, which is how one person came to have two names: the
    # Facility Manager's profile id is `ops` (see `src/auth/roles.ts`), and
    # `facility` is the AUDIENCE word from `reports/contracts.py`, which that
    # file explicitly says is not a role. Reported from the role picker, where
    # it offered a profile that exists nowhere in the app.
    assert config.errors({"allowed_senders": {"123": "facility"}}), (
        "an audience word was accepted as a profile")
    for real in ("guest", "owner", "ops"):
        assert config.errors({"allowed_senders": {"123": real}}) == [], real


def test_a_non_boolean_kill_switch_is_refused() -> None:
    """A switch set to the STRING "false" is truthy, and would read as ON."""
    assert config.errors({"enabled": "false"})
    assert config.errors({"act_enabled": 1})
    assert config.errors({"triggers": {"chat": "yes"}}) 


def test_negative_and_non_numeric_limits_are_refused() -> None:
    assert config.errors({"monthly_limit": -1})
    assert config.errors({"triage_minutes": "fifteen"})
    assert config.errors({"depth": "deep"}), "an unknown depth is refused"


def test_junk_shapes_are_refused_without_raising() -> None:
    assert config.errors("not an object")
    assert config.errors({"allowed_senders": ["not", "a", "map"]})
    assert config.errors({"actuable_entities": "light.x"})
    assert config.errors(None)


def test_a_valid_config_has_no_errors() -> None:
    assert config.errors({
        "enabled": True, "act_enabled": False,
        "triggers": {"scheduled": True, "event": False, "chat": True},
        "monthly_limit": 2000, "allowed_senders": {"765979167": "owner"},
        "actuable_entities": ["light.x"], "suppressed_subjects": [],
    }) == []


# ── the store is on the shared factory ─────────────────────────────────────

def test_the_store_uses_the_existing_factory_not_a_bespoke_pair() -> None:
    """⚠️ The factory exists for this. A fork would be a fourth place for the
    revision check, the write lock and the 409 handling to drift."""
    proxy = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
    with open(proxy, encoding="utf-8") as handle:
        source = handle.read()
    assert "agent_config_get_handler, agent_config_put_handler = _json_store_handlers(" \
        in source
    # ⚠️ REGISTRATION MOVED INTO THE API TABLE (TASK-115 step 6): the factory
    # pair is INJECTED via bind() and mounted by `web.put` in supervise/api.py.
    # Both hops pinned — the injection here, the mount in the table.
    assert 'config_get=agent_config_get_handler' in source
    assert 'config_put=agent_config_put_handler' in source
    api = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta",
                       "supervise", "api.py")
    with open(api, encoding="utf-8") as handle:
        table = handle.read()
    assert 'web.put("/agent-config", deps.config_put)' in table


def test_the_stored_empty_is_a_bare_dict_not_the_defaults() -> None:
    """⚠️ Persisting DEFAULTS is the resurrection bug. The store's empty must be
    `{}` so an absent key stays absent on disk."""
    proxy = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
    with open(proxy, encoding="utf-8") as handle:
        source = handle.read()
    block = source[source.index("agent_config_get_handler"):]
    block = block[:block.index(")")]
    assert '"config", {}' in block, (
        "the agent store's empty document must be {} — writing DEFAULTS would "
        "resurrect keys the operator deleted")
    assert "DEFAULTS" not in block


def test_the_agent_config_store_actually_validates_on_write() -> None:
    """⚠️ `config.errors` WAS WRITTEN, TESTED, AND CALLED BY NOBODY — found by
    `test_reachability` (TASK-109), not by any test of this module. The store
    went on the generic `_json_store_handlers` factory, which checks the
    envelope and the size and knows nothing of this document's vocabulary, so
    every rule below was dead: `investigate_mode: "banana"` returned 200 and
    then read as `approve`.

    This pins the WIRE, not the validator — the validator's own tests were
    green throughout. `feedback_pin-the-caller`, ninth instance."""
    import re as _re

    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                            "supervisor-proxy.py"), encoding="utf-8").read()
    guard = _re.search(r"agent_config_get_handler, agent_config_put_handler = "
                       r"_json_store_handlers\((.*?)\)", src, _re.S)
    assert guard, "the agent-config store handlers moved; re-point this test"
    assert "write_guard=" in guard.group(1), (
        "/agent-config's PUT has no write_guard, so agent.config.errors is "
        "never called and every validation rule in it is dead")
    assert "agent_config.errors(" in src, (
        "the guard exists but does not call the validator")
