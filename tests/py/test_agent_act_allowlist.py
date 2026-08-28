"""The actuation allow-list, and the wiring that makes `act_service` exist.

⚠️ TWO DEFECTS, ONE FILE, BOTH FOUND ON 2026-08-24 WHILE SIZING A COST FIX.

(1) `act.build()` had exactly one caller in the whole tree and it was its own
test, so `act_enabled: true` on a villa with a populated allow-list produced no
`act_service` tool at all. A switch that did nothing, with TASK-082 marked
COMPLETE.

(2) The allow-list was keyed on the model's per-run HANDLE. `refs.py` states in
its own docstring that handles are sequential, meaningless and deliberately
unstable — `d1` in one run and `d1` in the next are unrelated — so a stored
`["d1"]` authorised whichever device the model happened to read FIRST.

⚠️ AND (2) SURVIVED BECAUSE THE ONE TEST THAT POPULATED THE LIST BUILT IT FROM
THE RUN'S OWN REF TABLE. A list derived from the table agrees with that table by
construction; it can only ever agree with itself, so no single-run test could
express the failure. `feedback_mutation-testing`: a test is unproven until it has
gone red, and this one has to span TWO runs before it can.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from typing import Any, Dict, List, Mapping

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import config as agent_config, runtime  # noqa: E402
from agent.refs import RefTable  # noqa: E402
from agent.tools import act as act_mod  # noqa: E402

#: Two devices of the same villa. ⚠️ Placeholders, classified in
#: `test_hard_rules.ILLUSTRATIVE` — this repository is public.
LAMP = "light.x"
LOCK = "lock.foo"


def _table(*entity_ids: str) -> RefTable:
    table = RefTable()
    for entity_id in entity_ids:
        table.ref_for(entity_id)
    return table


# ── the allow-list names a DEVICE, not a position ──────────────────────────

def test_the_SAME_stored_list_authorises_the_SAME_device_in_ANY_run() -> None:
    """⚠️ THE PIN THAT WOULD HAVE CAUGHT IT, AND IT NEEDS TWO RUNS TO EXIST.

    Before 2.718.0 the stored value was a handle, and the handle a device gets
    depends only on the order this run happened to read things. Measured then:
    one stored line authorised the pool pump in one run and the front door in
    the next.
    """
    stored = {"act_enabled": True, "actuable_entities": [LAMP]}

    # the two runs differ ONLY in the order the model read the two devices
    first = _table(LAMP, LOCK)
    second = _table(LOCK, LAMP)
    assert first.resolve("d1") == LAMP and second.resolve("d1") == LOCK, (
        "the fixture is not exercising the instability it exists to pin")

    for table in (first, second):
        for ref in table.known():
            entity_id = table.resolve(ref)
            allowed = agent_config.may_act(stored, entity_id)
            assert allowed is (entity_id == LAMP), (
                f"{ref} -> {entity_id} was {'allowed' if allowed else 'refused'}"
                " — the allow-list is following the handle, not the device")


def test_a_HANDLE_in_the_list_authorises_NOTHING() -> None:
    """⚠️ THE OLD CONTENT MUST NOT KEEP WORKING. If a stored `d1` still passed,
    a villa configured before this release would carry the defect forward
    silently — the worst outcome, because the editor would show a list that
    reads correct and behaves as it did."""
    stored = {"act_enabled": True, "actuable_entities": ["d1"]}
    table = _table(LAMP, LOCK)
    for ref in table.known():
        assert agent_config.may_act(stored, table.resolve(ref)) is False


def test_the_list_is_TRIMMED_and_case_insensitive_because_a_person_types_it() -> None:
    stored = {"act_enabled": True, "actuable_entities": [f"  {LAMP.upper()} "]}
    assert agent_config.may_act(stored, LAMP) is True
    # ⚠️ BOTH SIDES, and asserting only the stored one left the incoming side
    # unpinned — a mutation dropping its `.lower()` survived this test.
    assert agent_config.may_act(
        {"act_enabled": True, "actuable_entities": [LAMP]},
        f" {LAMP.upper()} ") is True
    # ⚠️ FORGIVING A TYPO IS NOT ADMITTING A STRANGER.
    assert agent_config.may_act(stored, LOCK) is False
    assert agent_config.may_act(stored, "") is False


def test_an_EMPTY_list_authorises_nothing_even_with_the_switch_ON() -> None:
    """The two are AND-ed: turning actuation on does not authorise one device."""
    assert agent_config.may_act(
        {"act_enabled": True, "actuable_entities": []}, LAMP) is False
    assert agent_config.DEFAULTS["actuable_entities"] == []


# ── the tool is actually built ─────────────────────────────────────────────

def test_investigate_BUILDS_the_actuator_when_the_policy_allows_it() -> None:
    """⚠️ PIN THE CALLER. `act.build` was correct, tested and unreachable; a
    test of the tool stayed green for every release the switch did nothing."""
    src = inspect.getsource(runtime.investigate)
    assert "act_mod.build(" in src, "nothing constructs the actuator"
    assert "if policy.act_enabled:" in src, (
        "the actuator must be built from the POLICY's flag — `for_run` already "
        "AND-s the setting with `tier != 'triage'`, and re-deriving it here is "
        "how the volume tier eventually gets an actuator")
    assert "names.append(act_mod.ActService.name)" in src, (
        "the name must enter `allowed_tools` BEFORE the policy snapshot, or "
        "`may_use_tool` refuses the tool it just registered")


def test_a_MISSING_caller_is_a_stated_fault_never_a_silent_success() -> None:
    """⚠️ THE WORST AVAILABLE FAILURE WOULD BE A NO-OP CALLER: it would report
    every action DONE and write `outcome="done"` into the audit ledger for
    something that never happened, making the record of what the villa did
    fiction. `sources.service_caller` returns None without a session, and this
    is what the tool does with that."""
    from agent import policy as policy_mod
    from agent import sources

    assert sources.service_caller(None) is None

    table = _table(LAMP)
    config: Dict[str, Any] = {"act_enabled": True,
                              "actuable_entities": [LAMP],
                              "allowed_services": ["light.turn_off"]}
    tool = act_mod.build(
        refs=table, caller=None,
        policy=policy_mod.for_run(config, tier="reason",
                                  tool_names=["act_service"]),
        config=config, run_id="r1", actor="owner")
    blocks: List[Dict[str, Any]] = asyncio.run(tool.call(
        {"ref": next(iter(table.known())), "service": "turn_off",
         "why": "testing"}))
    assert blocks[0]["error"]["code"] == "unavailable"
    assert "no service caller" in blocks[0]["error"]["message"]
    assert tool.performed == [], "an unwired action must not be recorded as done"


def test_the_caller_sends_the_service_HA_would_recognise() -> None:
    """The domain comes from the ENTITY when the service is a bare verb, which
    is the form `REVERSIBLE_SERVICES` and `policy.may_act`'s key both use."""
    from agent import sources

    sent: List[Dict[str, Any]] = []

    class _Hass:
        def __init__(self, session: Any) -> None:
            pass

        async def __aenter__(self) -> "_Hass":
            return self

        async def __aexit__(self, *exc: Any) -> None:
            return None

        async def command(self, kind: str, **payload: Any) -> None:
            sent.append({"kind": kind, **payload})

    import vesta.adapters.hass as hass_mod
    original = hass_mod.HassClient
    hass_mod.HassClient = _Hass                    # type: ignore[assignment]
    try:
        call = sources.service_caller(object())
        assert call is not None
        asyncio.run(call(LAMP, "turn_off", {"transition": 2}))
        asyncio.run(call(LAMP, "light.turn_on", None))
    finally:
        hass_mod.HassClient = original             # type: ignore[assignment]

    assert sent[0] == {"kind": "call_service", "domain": "light",
                       "service": "turn_off", "target": {"entity_id": LAMP},
                       "service_data": {"transition": 2}}
    assert sent[1]["domain"] == "light" and sent[1]["service"] == "turn_on", (
        "a fully-qualified service must work too — it is the spelling a model "
        "that has read Home Assistant's own schemas will reach for")


# ── the wire name matches on both sides ────────────────────────────────────

def test_the_SPA_no_longer_maps_the_OLD_key() -> None:
    """⚠️ THE HALF THE DERIVED PIN CANNOT SEE, AND ONLY THAT HALF.

    "the SPA names every key the store defines" is already owned by
    `test_store_envelope.test_the_agent_wire_map_covers_every_setting`, which
    DERIVES the expected set from `config.DEFAULTS` — so it covers this key the
    day it was added and would cover the next one too. This file asserted the
    same thing by hand for one release, which is the hand-kept copy that
    "agrees with itself forever" that pin exists to replace; /dry-audit found it.

    What that pin cannot catch is a STALE entry: it checks
    `DEFAULTS - mapped`, so a wire map holding BOTH `actuable_entities` and the
    dead `actuable_refs` passes. A stale name is not inert here — the store
    keeps unknown keys so a newer add-on's settings survive a downgrade, so the
    SPA would save a key `validate_config` accepts and the agent never reads,
    and the editor would report success while authorising nothing.
    """
    path = os.path.join(REPO_ROOT, "src", "agent", "agentApi.ts")
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    assert "actuable_refs" not in source, (
        "the SPA still maps the OLD key, which the store will accept and the "
        "agent will never read")
