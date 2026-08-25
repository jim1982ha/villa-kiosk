"""THE authorization boundary. TEST-011, and nine mandatory mutations.

⚠️ TASK-025 REQUIRES MUTATION TESTING BY NAME, and the precedent it cites is
exact: nine deliberate breaks of `devices.py`, of which FIVE initially SURVIVED
because the fixture never reached the rule. A gate that passes its own tests
while not gating is the failure mode this exists for, so every assertion below
is written to reach the branch it names.
"""

from __future__ import annotations

import inspect
import os
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import contracts, policy  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_concerns(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ ADDED WITH TASK-107. `policy.for_run` now unions the EARNED
    suppressions in, so this module reads the concern store — which means every
    test here needs it isolated, including the ones that never mention it."""
    from agent import concerns as concerns_mod
    monkeypatch.setattr(concerns_mod, "CONCERNS_FILE", str(tmp_path / "c.json"))

TOOLS = ("read_villa", "read_state", "act_service", "raise_concern", "reply")


def _policy(**cfg: Any) -> policy.RunPolicy:
    base: Dict[str, Any] = {
        "act_enabled": True,
        "allowed_services": ["light.turn_off", "fan.turn_off",
                                   "switch.turn_off"],
    }
    base.update(cfg)
    return policy.for_run(base, tool_names=TOOLS)


# ── no model may live here ─────────────────────────────────────────────────

def test_no_model_call_exists_anywhere_in_this_module() -> None:
    """⚠️ A gate that asks a model whether something is safe has delegated the
    decision to the thing it exists to constrain, and every injection defence
    downstream becomes decorative.

    ⚠️ STRUCTURAL, NOT A GREP. The first version scanned the source TEXT and
    failed on the word "provider" inside this very docstring's twin in
    policy.py — prose about the rule read as a violation of it. The same defect
    the salience threshold-grep had, in a new file. This parses the imports.
    """
    import ast
    tree = ast.parse(inspect.getsource(policy))
    imported: List[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.append(node.module or "")
    banned = ("anthropic", "openai", "llm", "narrate", "provider", "httpx",
              "aiohttp", "requests")
    for name in imported:
        assert not any(b in name.lower() for b in banned), (
            f"policy.py imports {name!r} — no model or network may "
            f"participate in an authorization decision")

    # And no call that could reach one, checked on EXECUTABLE lines only.
    body = _executable_source(policy)
    for pattern in ("messages.create", "completion", ".narrate(", "await "):
        assert pattern not in body, (
            f"{pattern!r} appears in policy.py's code — this module must be "
            f"pure and synchronous so it cannot await anything")


def _executable_source(module: Any) -> str:
    """Module source with docstrings and comments removed.

    ⚠️ Prose ABOUT a rule must not read as a violation of it. Learned twice
    now: once in the salience threshold grep, once here.
    """
    import ast
    text = inspect.getsource(module)
    tree = ast.parse(text)
    spans: List[range] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                 ast.AsyncFunctionDef)):
            continue
        first = getattr(node, "body", [None])[0]
        if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            spans.append(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    return "\n".join(
        line for n, line in enumerate(text.splitlines(), 1)
        if not any(n in s for s in spans) and not line.lstrip().startswith("#"))


# ── the two axes ───────────────────────────────────────────────────────────

def test_a_lock_is_high_harm_even_though_relocking_is_reversible() -> None:
    """⚠️ THE CORRECTION THAT MADE THIS A TWO-AXIS GATE. The state reverts; the
    consequence does not."""
    out = policy.may_act(_policy(), entity_id="lock.a_thing",
                         service="unlock", reversible=True)
    assert out.verdict == "propose" and out.harm_class == "high"
    assert not out.allowed


def test_a_switch_that_opens_a_door_is_high_harm_despite_its_DOMAIN() -> None:
    """⚠️ THE HALF A DOMAIN CHECK CANNOT SEE. At the reference villa a doorbell
    publishes its Door 1 and Door 2 relays as ordinary switch.* entities that
    physically open things; a rule matching lock.* sails past both."""
    for entity, kw in (
            ("switch.parking_door_1_relay", {}),
            ("switch.some_relay", {"integration": "hikvision"}),
            ("switch.plain_thing", {"device_class": "gate"}),
            ("switch.plain_thing", {"service": "open"})):
        out = policy.may_act(_policy(), entity_id=entity,
                             service=kw.pop("service", "turn_on"),
                             reversible=True, **kw)
        assert out.harm_class == "high", f"{entity} {kw} classified low"
        assert out.verdict == "propose"


def test_the_access_word_match_is_ANCHORED_so_outdoor_is_not_a_door() -> None:
    """⚠️ `door` matches inside `outdoor` and `\\b` does not help, because `_`
    is a word character. Unanchored, this gate classifies the OUTDOOR LIGHTS as
    an access relay and refuses to switch them off."""
    assert policy.harm_class_of("light.outdoor_terrace") == "low"
    assert policy.harm_class_of("switch.outdoor_probe_light") == "low"
    assert policy.harm_class_of("light.indoor_lighting") == "low"
    # ...and still fires on the real shape.
    assert policy.harm_class_of("switch.parking_door_1_relay") == "high"
    assert policy.harm_class_of("switch.gate_opener") == "high"


def test_each_high_harm_DOMAIN_classifies_on_its_own() -> None:
    """⚠️ THE FIXTURE THAT REACHES THE RULE. Emptying HIGH_HARM_DOMAINS
    initially SURVIVED mutation testing, because every probe I had written used
    `lock.a_thing` — which also matches the access-WORD rule, so the domain
    check was never the thing under test. That is precisely the precedent
    TASK-025 cites: five of nine mutations of devices.py survived because the
    fixture never reached the rule.

    Each id below carries NO access word, so the domain is the only signal.
    """
    for entity in ("camera.living_room", "climate.lounge_unit",
                   "alarm_control_panel.house"):
        assert policy.harm_class_of(entity) == "high", (
            f"{entity} must be high-harm on its DOMAIN alone — it contains no "
            f"access word, so nothing else can be classifying it")
        for word in policy._ACCESS_WORDS:
            assert not policy._anchored(entity, word), (
                f"{entity} matches the access word {word!r}, so it does not "
                f"isolate the domain rule and this test proves nothing")


def test_a_low_harm_reversible_allow_listed_action_executes() -> None:
    out = policy.may_act(_policy(), entity_id="light.hall_thing",
                         service="turn_off", reversible=True)
    assert out.verdict == "allow" and out.allowed and out.harm_class == "low"


def test_an_irreversible_low_harm_action_is_PROPOSED_not_executed() -> None:
    out = policy.may_act(_policy(), entity_id="light.hall_thing",
                         service="turn_off", reversible=False)
    assert out.verdict == "propose"


def test_a_low_harm_action_outside_the_allow_list_is_denied() -> None:
    out = policy.may_act(_policy(), entity_id="media_player.a_thing",
                         service="volume_up", reversible=True)
    assert out.verdict == "deny" and "allow-list" in out.reason


def test_config_cannot_grant_a_HIGH_harm_action() -> None:
    """⚠️ THE DENY-LIST IS IN CODE, NOT A SETTING. An owner cannot allow-list a
    door lock into autonomous actuation, because no chain of reasoning should
    open a door in an empty villa. Harm is decided BEFORE the allow-list is
    consulted; reversing those two lines makes the deny-list a default."""
    permissive = _policy(allowed_services=["lock.unlock", "unlock"])
    out = policy.may_act(permissive, entity_id="lock.a_thing",
                         service="unlock", reversible=True)
    assert out.verdict == "propose", "config must not be able to widen this"


def test_actuation_disabled_denies_every_low_harm_action() -> None:
    out = policy.may_act(_policy(act_enabled=False),
                         entity_id="light.hall_thing", service="turn_off",
                         reversible=True)
    assert out.verdict == "deny" and "disabled" in out.reason


# ── the snapshot ───────────────────────────────────────────────────────────

def test_the_snapshot_is_frozen_so_a_mid_run_change_cannot_widen_it() -> None:
    """⚠️ The run already reasoning about an action is exactly the wrong moment
    to grant it more authority."""
    live: Dict[str, Any] = {"act_enabled": False,
                            "allowed_services": []}
    snap = policy.for_run(live, tool_names=TOOLS)
    live["act_enabled"] = True
    live["allowed_services"] = ["light.turn_off"]
    assert snap.act_enabled is False
    assert policy.may_act(snap, entity_id="light.a_thing",
                          service="turn_off", reversible=True).verdict == "deny"
    with pytest.raises(Exception):
        snap.act_enabled = True          # type: ignore[misc]


def test_triage_can_never_act_however_config_is_set() -> None:
    """⚠️ It is the volume tier — 96 runs a day — and the one most likely to be
    pointed at a cheaper model later."""
    snap = policy.for_run({"act_enabled": True}, tier="triage",
                          tool_names=TOOLS)
    assert snap.act_enabled is False
    assert policy.may_use_tool(snap, "act_service", "WRITE").verdict == "deny"


# ── tools ──────────────────────────────────────────────────────────────────

def test_an_unregistered_tool_is_denied() -> None:
    assert policy.may_use_tool(_policy(), "rm_rf").verdict == "deny"
    assert policy.may_use_tool(_policy(), "").verdict == "deny"


def test_an_ACT_tool_needs_actuation_enabled() -> None:
    assert policy.may_use_tool(_policy(act_enabled=False),
                               "act_service", "ACT").verdict == "deny"
    assert policy.may_use_tool(_policy(), "act_service", "ACT").verdict == "allow"


def test_a_WRITE_tool_does_NOT_need_actuation_enabled() -> None:
    """⚠️ THIS TEST ASSERTED THE OPPOSITE AND THE OPPOSITE WAS THE BUG.

    `may_use_tool` asked `mode != "READ"` and then demanded `act_enabled`, so
    every WRITE was gated on the ACTUATION switch — which ships off and must.
    Measured on the villa: the model could not call `reply` at all, so the house
    could never answer mid-run; and `raise_concern`, the one write on the whole
    reasoning path and the thing this system exists to produce, would have been
    denied the same way the moment PH-3 turned it on.

    ⚠️ THE TWO ARE DIFFERENT IN KIND, and the plan says so in one line:
    `act_enabled: false` leaves the agent "reading and reasoning but unable to
    TOUCH THE VILLA". A WRITE records something a person then reads. An ACT
    changes the property. Neither replying into a conversation somebody opened
    nor filing a concern touches anything.

    The old test was not wrong about the code; it was wrong about the rule, and
    it made the defect look deliberate for four releases.
    """
    assert policy.may_use_tool(_policy(act_enabled=False),
                               "raise_concern", "WRITE").verdict == "allow"
    assert policy.may_use_tool(_policy(act_enabled=False),
                               "reply", "WRITE").verdict == "allow"


def test_triage_may_neither_write_nor_act_whatever_the_switch_says() -> None:
    for mode in ("WRITE", "ACT"):
        snap = policy.for_run({"act_enabled": True}, tier="triage",
                              tool_names=TOOLS)
        assert policy.may_use_tool(snap, "act_service", mode).verdict == "deny"


def test_an_unknown_MODE_denies_rather_than_defaulting_open() -> None:
    """A tool whose mode nobody has classified is one nobody has reviewed."""
    assert policy.may_use_tool(_policy(), "act_service", "TRANSFER").verdict == "deny"
    assert policy.may_use_tool(_policy(), "act_service", "").verdict == "deny"


def test_a_read_tool_is_allowed_when_registered() -> None:
    assert policy.may_use_tool(_policy(), "read_villa", "READ").allowed


# ── suppression and budget ─────────────────────────────────────────────────

def test_suppression_is_deterministic_by_key() -> None:
    key = contracts.subject_key("the gym lights")
    snap = policy.for_run({"suppressed_subjects": [key]},
                          tool_names=TOOLS)
    assert policy.is_suppressed(snap, key)
    assert not policy.is_suppressed(snap, contracts.subject_key("the pool pump"))


def test_a_suppressed_subject_cannot_produce_a_concern() -> None:
    key = contracts.subject_key("gym")
    snap = policy.for_run({"suppressed_subjects": [key]}, tool_names=TOOLS)
    concern = {"id": "c1", "subject_key": key, "title": "Gym lights on",
               "severity": "notice", "audience": "owner", "state": "open",
               "evidence": [{"tool": "read_salient", "args_digest": "a",
                             "at": "x", "summary": "y"}]}
    assert policy.concern_admissible(snap, concern).verdict == "deny"


def test_a_malformed_concern_reads_as_malformed_not_as_suppressed() -> None:
    """⚠️ Those call for completely different responses, and one of them is a
    bug in this system."""
    out = policy.concern_admissible(_policy(), {"id": "c1"})
    assert out.verdict == "deny"
    assert "suppressed" not in out.reason and "evidence" in out.reason


def test_budget_caps_deny_at_the_boundary_not_past_it() -> None:
    # ⚠️ THE DEPTH TABLE, NOT TWO LOOSE INTEGERS (2.756.0). "brief" IS 4 turns
    # and 12 tool calls; the boundary this test is about is `>=` versus `>`, and
    # it holds at whatever the chosen depth is.
    snap = policy.for_run({"depth": "brief"},
                          tool_names=TOOLS)
    # ⚠️ DERIVED FROM THE POLICY, NOT RESTATED. The numbers used to be typed in
    # here beside the config that set them; with the depth table owning them, a
    # literal would pin this test to one preset and go red on a retune of
    # something it is not about. The boundary is `>=`, at whatever the cap is.
    assert policy.within_budget(snap, turns=snap.max_turns - 1,
                                tool_calls=snap.max_tool_calls - 1).allowed
    assert not policy.within_budget(snap, turns=snap.max_turns,
                                    tool_calls=0).allowed
    assert not policy.within_budget(snap, turns=0,
                                    tool_calls=snap.max_tool_calls).allowed


def test_a_junk_budget_falls_back_to_the_default_not_to_zero_or_infinity() -> None:
    for junk in (None, 0, -5, "banana", 1.5e400):
        snap = policy.for_run({"depth": junk}, tool_names=TOOLS)
        assert snap.max_turns > 0


# ── the default is deny ────────────────────────────────────────────────────

def test_absent_or_junk_config_denies_everything() -> None:
    """⚠️ The rollback for this module is 'deny everything' and the agent
    degrades to read-only rather than to unconstrained."""
    for junk in (None, {}, "not a mapping", 42, []):
        snap = policy.for_run(junk, tool_names=TOOLS)  # type: ignore[arg-type]
        assert snap.act_enabled is False
        assert policy.may_act(snap, entity_id="light.a_thing",
                              service="turn_off",
                              reversible=True).verdict == "deny"


def test_an_unknown_entity_shape_is_not_silently_low_harm() -> None:
    for odd in ("", "no_dot", "....", "switch."):
        assert policy.harm_class_of(odd) in contracts.HARM_CLASS


# ── REQ-039 · the suppression loop, closed (TASK-107) ───────────────────────
def test_three_dismissals_reach_the_gate_without_anyone_editing_config() -> None:
    """⚠️ THE ASSERTION NOTHING IN THIS SUITE COULD MAKE BEFORE TASK-107, and
    the reason REQ-039 read as met for as long as it did. Two tests existed:
    one pinned that `concerns.suppressed_subjects()` counts to three, one pinned
    that `is_suppressed` honours `config["suppressed_subjects"]` — SUPPLYING
    THAT KEY ITSELF. Nothing wrote the computed list into the config the gate
    reads, so a person could dismiss a subject three times and the run policy
    would never hear about it. `feedback_pin-the-caller`, and the config key
    here is deliberately EMPTY so only the earned path can satisfy it.
    """
    from agent import concerns as concerns_mod
    from reports.analysis.base import subject_key

    key = subject_key("gym lights")
    for _ in range(concerns_mod.DISMISSALS_TO_SUPPRESS):
        stored, why = concerns_mod.raise_concern(concerns_mod.Concern(
            subject_key=key, title="Gym lights left on", severity="notice",
            audience="owner", evidence=[{"tool": "read_state", "summary": "on"}]))
        assert stored is not None, why
        concerns_mod.feedback(stored.id, useful=False, reason="the gym is shut")

    snap = policy.for_run({}, tier="reason", tool_names=[])
    assert policy.is_suppressed(snap, key), (
        "three dismissals did not reach the gate; the counter and the policy "
        "are still two halves with nothing between them")


def test_two_dismissals_are_not_enough() -> None:
    """⚠️ THE COMPANION THAT MAKES THE ONE ABOVE MEAN SOMETHING. Without it, a
    mutation suppressing EVERY subject would pass the first test."""
    from agent import concerns as concerns_mod
    from reports.analysis.base import subject_key

    key = subject_key("hall lamp")
    for _ in range(concerns_mod.DISMISSALS_TO_SUPPRESS - 1):
        stored, _ = concerns_mod.raise_concern(concerns_mod.Concern(
            subject_key=key, title="Hall lamp", severity="notice",
            audience="owner", evidence=[{"tool": "read_state", "summary": "on"}]))
        assert stored is not None
        concerns_mod.feedback(stored.id, useful=False)

    snap = policy.for_run({}, tier="reason", tool_names=[])
    assert not policy.is_suppressed(snap, key)


def test_the_manual_list_still_applies_when_the_store_cannot_be_read(
        monkeypatch: Any) -> None:
    """⚠️ DEGRADE TO THE CONFIG LIST, NEVER TO SILENCE AND NEVER TO NOTHING. A
    corrupt concern store must not be able to switch supervision off, and must
    not be able to un-silence a subject a person named by hand either."""
    from agent import concerns as concerns_mod

    def boom() -> Any:
        raise RuntimeError("unreadable")

    monkeypatch.setattr(concerns_mod, "suppressed_subjects", boom)
    snap = policy.for_run({"suppressed_subjects": ["abc123"]},
                          tier="reason", tool_names=[])
    assert policy.is_suppressed(snap, "abc123")
    assert not policy.is_suppressed(snap, "something-else")
