"""The agent's vocabulary and its MCP-shaped tool protocol. TEST-007.

⚠️ THE REGISTRATION GUARD IS THE POINT OF THIS FILE. `reports/contracts.py`
carries a comment saying every set must be in `CONTRACT_SETS`, and `ZONE` and
`TREND_DIRECTION` still shipped a release unregistered — two lines below that
very sentence. So here it is mechanical: the module is WALKED for every
tuple-of-strings and any that is not registered fails. A set nobody registered
is a set nobody checks, and the failure is silent.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import contracts  # noqa: E402
from agent.tools import ALL_TOOLS  # noqa: E402
from agent.tools import base as tools_base  # noqa: E402
from agent.tools import read as read_tools  # noqa: E402
from observe import snapshot  # noqa: E402


def _run(coro: Any) -> Any:
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


# ── the registration guard ──────────────────────────────────────────────────

def test_every_enum_in_the_module_is_registered_in_CONTRACT_SETS() -> None:
    """⚠️ WALKS THE MODULE rather than trusting the dict. Registration by hand
    is how two sets went a release unchecked in the sibling file, immediately
    below the comment warning about it."""
    found = {
        name: value for name, value in vars(contracts).items()
        if name.isupper() and isinstance(value, tuple) and value
        and all(isinstance(v, str) for v in value)
        and name != "CONTRACT_SETS"
    }
    unregistered = sorted(set(found) - set(contracts.CONTRACT_SETS))
    assert not unregistered, (
        f"tuple-of-strings constants missing from CONTRACT_SETS: "
        f"{unregistered}. An unregistered set is mirrored by nothing and "
        f"checked by nothing.")


def test_CONTRACT_SETS_has_no_entry_pointing_at_nothing() -> None:
    for name, value in contracts.CONTRACT_SETS.items():
        assert getattr(contracts, name, None) is value, (
            f"{name} in CONTRACT_SETS is not the module constant of that name")


def test_no_enum_value_is_empty_or_duplicated() -> None:
    for name, values in contracts.CONTRACT_SETS.items():
        assert all(v.strip() for v in values), f"{name} has an empty value"
        assert len(set(values)) == len(values), f"{name} has a duplicate"


# ── keys and digests ────────────────────────────────────────────────────────

def test_subject_key_is_stable_and_unprefixed() -> None:
    """⚠️ UNPREFIXED IS THE WHOLE POINT — `dedup_key` cannot serve, because it
    is prefixed by the MODULE, so two layers describing one pump would never
    match. This key asks "is this the same equipment"."""
    key = contracts.subject_key("sensor.pool_pump_power")
    assert len(key) == 16 and key.isalnum()
    assert key == contracts.subject_key("sensor.pool_pump_power")
    assert key != contracts.subject_key("sensor.house_pump_power")
    assert ":" not in key and "_" not in key


def test_subject_key_is_the_SAME_EXPRESSION_as_the_report_pipeline_s() -> None:
    """⚠️ ONE EXPRESSION, NOT TWO THAT AGREE. The join key only works if both
    detection layers compute it identically, and `analysis/base.py`'s own
    docstring records why prose cannot hold two spellings together: one cut at
    16 and one at 12 is the shape of bug this subsystem keeps paying for.

    This asserts DELEGATION, not equality of output — two independent copies
    that happen to agree today pass an equality test and drift the moment
    either is touched."""
    from reports.analysis import base as canonical
    import inspect
    source = inspect.getsource(contracts.subject_key)
    assert "from reports.analysis.base import subject_key" in source, (
        "agent.subject_key must delegate to the canonical implementation, not "
        "restate the hash")
    for probe in ("sensor.x", "House pump", "", "a" * 200):
        assert contracts.subject_key(probe) == canonical.subject_key(probe)


def test_args_digest_is_canonical_across_key_order() -> None:
    """⚠️ Without sort_keys the same call fingerprints differently depending on
    dict ordering, and the idempotency guard silently stops guarding."""
    a = contracts.args_digest({"b": 2, "a": 1})
    b = contracts.args_digest({"a": 1, "b": 2})
    assert a == b
    assert a != contracts.args_digest({"a": 1, "b": 3})


def test_args_digest_survives_unserialisable_values() -> None:
    class Odd:
        pass
    assert len(contracts.args_digest({"x": Odd()})) == 16


def test_action_key_is_scoped_to_the_run() -> None:
    """Two runs proposing the same action are two decisions; one run retrying
    after a timeout is the same decision and must not act twice."""
    same = contracts.action_key("run-1", "act_service", {"ref": "d3"})
    assert same == contracts.action_key("run-1", "act_service", {"ref": "d3"})
    assert same != contracts.action_key("run-2", "act_service", {"ref": "d3"})
    assert same != contracts.action_key("run-1", "act_service", {"ref": "d4"})


# ── validation ──────────────────────────────────────────────────────────────

def test_an_unrecognised_severity_becomes_warning_never_info() -> None:
    """⚠️ A kind nobody has classified must not arrive as the QUIETEST thing in
    the document — that is how a real problem goes unread. The report subsystem
    already learned this once."""
    assert contracts.coerce_severity("banana") == "warning"
    assert contracts.coerce_severity(None) == "warning"
    assert contracts.coerce_severity("") == "warning"
    assert contracts.coerce_severity("critical") == "critical"
    assert contracts.coerce_severity("info") == "info"


def _concern(**over: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "id": "c1", "subject_key": contracts.subject_key("x"),
        "title": "Pool pump drawing more than usual", "body": "...",
        "severity": "warning", "audience": "facility",
        "evidence": [{"tool": "read_salient", "args_digest": "abc",
                      "at": "2026-08-22T10:00:00Z", "summary": "8.4 sigma"}],
        "confidence": 0.8, "opened_at": "2026-08-22T10:00:00Z", "state": "open",
        "supersedes": [],
    }
    base.update(over)
    return base


def test_a_well_formed_concern_has_no_errors() -> None:
    assert contracts.concern_errors(_concern()) == []


def test_a_concern_with_no_evidence_is_REFUSED() -> None:
    """⚠️ EVIDENCE IS REQUIRED, NOT ENCOURAGED. Every figure must resolve to a
    tool result, and the only way that holds is refusing here rather than
    trusting the producer to behave."""
    errors = contracts.concern_errors(_concern(evidence=[]))
    assert any("evidence is empty" in e for e in errors)
    assert any("evidence is empty" in e
               for e in contracts.concern_errors(_concern(evidence=None)))


@pytest.mark.parametrize("field", ["id", "subject_key", "title"])
def test_an_empty_required_field_is_refused(field: str) -> None:
    assert any(field in e for e in contracts.concern_errors(_concern(**{field: ""})))


def test_an_invalid_enum_names_what_was_allowed() -> None:
    errors = contracts.concern_errors(_concern(severity="urgent"))
    assert any("'urgent'" in e and "critical" in e for e in errors)


def test_an_action_must_carry_both_axes_of_the_gate() -> None:
    """⚠️ Reversibility alone is not a safety test — unlocking a door is
    reversible and the harm is instantaneous. Both fields are required."""
    errors = contracts.concern_errors(_concern(
        action={"kind": "turn_off", "target_ref": "d3", "reversible": True}))
    assert any("harm_class" in e for e in errors)
    errors = contracts.concern_errors(_concern(
        action={"kind": "turn_off", "target_ref": "d3", "harm_class": "low"}))
    assert any("reversible" in e for e in errors)
    assert contracts.concern_errors(_concern(
        action={"kind": "turn_off", "target_ref": "d3",
                "reversible": True, "harm_class": "low"})) == []


def test_confidence_must_be_a_fraction_and_a_bool_is_not_one() -> None:
    for bad in (-0.1, 1.1, "high", True):
        assert any("confidence" in e
                   for e in contracts.concern_errors(_concern(confidence=bad)))


def test_junk_is_refused_without_raising() -> None:
    for junk in (None, "", 42, [], "a string"):
        assert contracts.concern_errors(junk)


# ── the tool protocol ───────────────────────────────────────────────────────

def test_every_tool_declares_the_MCP_shape() -> None:
    """CTR-017. name, description, inputSchema — what MCP already publishes,
    so the extraction seam needs no translation layer."""
    for cls in ALL_TOOLS:
        tool = cls()
        assert tool.name and " " not in tool.name
        assert len(tool.description) > 40, (
            f"{tool.name}'s description is what the model reads to decide "
            f"whether to call it — one line is not enough")
        schema = tool.inputSchema
        assert schema.get("type") == "object"
        assert isinstance(schema.get("properties"), dict)
        described = tool.describe()
        assert set(described) == {"name", "description", "inputSchema"}


def test_every_tool_property_documents_itself() -> None:
    """A property the model cannot understand is a property it guesses at."""
    for cls in ALL_TOOLS:
        for name, spec in cls().inputSchema.get("properties", {}).items():
            assert spec.get("description"), (
                f"{cls().name}.{name} has no description")
            assert spec.get("type"), f"{cls().name}.{name} has no type"


def test_tool_names_are_unique() -> None:
    names = [cls().name for cls in ALL_TOOLS]
    assert len(set(names)) == len(names)


def test_every_BaseTool_subclass_reaches_ALL_TOOLS_or_is_a_stated_exception() -> None:
    """⚠️ `agent/tools/__init__.py` HAS CLAIMED THIS TEST EXISTED SINCE IT WAS
    WRITTEN, AND IT DID NOT. Nothing walked the package; the assertion was in a
    docstring. A tool that exists but is registered nowhere is one the model
    never learns about, which fails silently and looks exactly like a model
    choosing not to call it — invisible in a capture. Found by dry-audit Part 3
    while adding the first tool that must NOT be collected.

    ⚠️ AND THE EXEMPTION IS NAMED HERE, NOT INFERRED. `ReplyTool` is bound to
    one conversation at construction and has no zero-argument form that can
    reach anybody; collected into `ALL_TOOLS` it would be offered to every
    scheduled run as a verb the model cannot use.
    """
    import importlib
    import pkgutil

    from agent.tools.base import BaseTool

    #: name -> why it is not collected. Anything else must be in ALL_TOOLS.
    EXEMPT = {
        "ReplyTool": "bound to one conversation at construction; an unbound "
                     "instance can reach nobody, so offering it to a scheduled "
                     "run teaches a verb that cannot work",
        "ActService": "bound to one run at construction — it needs a policy, a "
                      "service caller and a run id, and an unbound instance "
                      "could act on nothing while appearing in the registry the "
                      "MCP server filters, where its exclusion should never "
                      "have to be relied upon",
        "RaiseConcern": "bound to one RUN at construction — this run's ref "
                        "table, this run's evidence accumulator and this run's "
                        "frozen policy snapshot. An unbound instance would "
                        "resolve no handle, cite no evidence and write to no "
                        "store, so collecting it would teach every scheduled "
                        "run a verb that always refuses",
        "AnalysisTool": "the abstract base of the three statistical checks "
                        "(TASK-070). Its `check` is empty, so it names no "
                        "module and could only refuse; the three subclasses "
                        "that DO name one are in ANALYSIS_TOOLS and are "
                        "collected",
        "BaseTool": "the base class itself",
    }

    collected = {cls.__name__ for cls in ALL_TOOLS}
    found: Dict[str, str] = {}
    package = importlib.import_module("agent.tools")
    for info in pkgutil.iter_modules(package.__path__):
        module = importlib.import_module(f"agent.tools.{info.name}")
        for attr in vars(module).values():
            if (isinstance(attr, type) and issubclass(attr, BaseTool)
                    and attr.__module__ == module.__name__):
                found[attr.__name__] = module.__name__

    assert found, "the package walk found no tools; this test is vacuous"
    unregistered = sorted(n for n in found
                          if n not in collected and n not in EXEMPT)
    assert not unregistered, (
        f"BaseTool subclass(es) that never reach ALL_TOOLS: {unregistered}. "
        f"Add them to their module's export tuple, or to this test's EXEMPT "
        f"map with the reason.")
    stale = sorted(n for n in EXEMPT if n != "BaseTool" and n not in found)
    assert not stale, (
        f"EXEMPT names a tool that no longer exists: {stale}. An exemption for "
        f"a deleted class is an exemption nobody notices is doing nothing.")


def test_the_reply_tool_cannot_be_told_who_to_reply_to() -> None:
    """TOOL-010. ⚠️ THE ABSENCE IS THE ENFORCEMENT.

    A tool that took a recipient and validated it would be one validation bug
    away from an agent that can message anybody it can name. A tool with no
    vocabulary for a recipient is not.
    """
    from agent.tools import reply as reply_mod

    tool = reply_mod.build(targets=["notify.a"], thread_key="telegram:1")
    props = set(tool.inputSchema.get("properties", {}))
    assert props == {"text"}, f"reply exposes more than text: {props}"
    for forbidden in ("to", "target", "targets", "chat_id", "recipient",
                      "entity_id", "channel"):
        assert forbidden not in props
    # ⚠️ AND TWO CONVERSATIONS MUST NOT SHARE A RECIPIENT. If the target were a
    # class attribute rather than set at construction, the second person to
    # message the villa would be answered into the first person's chat.
    other = reply_mod.build(targets=["notify.b"], thread_key="telegram:2")
    assert tool._targets == ("notify.a",) and other._targets == ("notify.b",)


def test_every_read_tool_is_declared_READ() -> None:
    """The registry enforces the mode; no tool is trusted to behave."""
    for cls in read_tools.READ_TOOLS:
        assert cls().mode == "READ"


# ── base behaviour ──────────────────────────────────────────────────────────

class _Boom(tools_base.BaseTool):
    name = "boom"
    description = "x" * 50
    inputSchema = {"type": "object", "properties": {},
                   "required": ["needed"]}

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        raise RuntimeError("exploded")


def test_a_raising_tool_returns_an_error_block_rather_than_ending_the_run() -> None:
    """⚠️ A tool error is DATA. Raising past it ends the run and throws away
    every turn already paid for."""
    out = _run(_Boom().call({"needed": 1}))
    assert out[0]["error"]["code"] == "internal"
    assert "boom" in out[0]["error"]["message"]


def test_a_missing_required_argument_is_named() -> None:
    out = _run(_Boom().call({}))
    assert out[0]["error"]["code"] == "invalid_args"
    assert "needed" in out[0]["error"]["message"]


def test_non_object_arguments_are_refused() -> None:
    assert _run(_Boom().call("nope"))[0]["error"]["code"] == "invalid_args"  # type: ignore[arg-type]


def test_an_unknown_error_code_becomes_internal() -> None:
    """A code outside the contract is a bug in the tool; letting it through
    teaches the model a vocabulary nothing else speaks."""
    assert tools_base.fail("banana", "x")["error"]["code"] == "internal"
    assert tools_base.fail("not_found", "x")["error"]["code"] == "not_found"


def test_truncation_SAYS_it_truncated() -> None:
    """⚠️ THE NOTE IS THE WHOLE VALUE. A silently cut result is a model
    reasoning confidently about the half it happened to receive."""
    body = "x" * 200
    out = tools_base.truncate(body, 50)
    assert out.startswith("x" * 50)
    assert "150 more characters not shown" in out
    assert tools_base.truncate("short", 50) == "short"


# ── the four read tools do something ────────────────────────────────────────

def test_read_villa_returns_a_document_with_a_cache_prefix() -> None:
    tool = read_tools.ReadVilla(
        document_source=lambda hours=None: snapshot.villa_document(
            profile_text=snapshot.profile(floors=["1F"]),
            delta_text=snapshot.delta()))
    blocks = _run(tool.call({}))
    assert blocks[0]["type"] == "text" and "VILLA PROFILE" in blocks[0]["text"]
    assert blocks[1]["json"]["cache_prefix_chars"] > 0


def _salient_fixture():
    from observe import salience as sal
    rows = [{"day": f"2026-08-{i + 1:02d}", "value": v}
            for i, v in enumerate([10, 12, 8, 11, 9, 10, 13, 7])]
    return [sal.score_numeric(rows, 95.0, entity_id="sensor.loud"),
            sal.score_numeric(rows[:2], 5.0, entity_id="sensor.thin")]


def test_read_salient_ranks_and_can_report_the_unscorable() -> None:
    """⚠️ ROWS CARRY A HANDLE, NEVER AN ENTITY ID — AND THIS TEST ASSERTED THE
    OPPOSITE UNTIL 2.650.0, WHICH IS WHY THE DEFECT SHIPPED.

    `salience.Item.as_dict` emits `entity_id`; every other tool emits the
    `ref`/`label` pair, and the scrub on the way into the transcript removes raw
    ids. So the rows arrived with their only naming field stripped and the model
    received a ranking of anonymous rows. The villa's own agent reported it:
    "the anomaly ranking came back without device handles, so the top rows
    aren't attributable to a named room or device."

    A contract test that pins the wrong contract is worse than none — it makes
    the defect look deliberate to everybody who reads it afterwards.
    """
    from agent.refs import RefTable
    table = RefTable()
    table.ref_for("sensor.loud")
    table.ref_for("sensor.thin")

    tool = read_tools.ReadSalient(scorer=_salient_fixture, refs=table)
    blocks = _run(tool.call({"limit": 5}))
    top = blocks[0]["json"]["salient"][0]
    assert "entity_id" not in top, "a raw entity id reached the transcript"
    assert top["ref"] == table.describe("sensor.loud")["ref"]
    assert top["label"]
    assert len(blocks) == 1, "unscorable is opt-in"

    blocks = _run(tool.call({"include_unscorable": True}))
    thin = blocks[1]["json"]["unscorable"][0]
    assert "entity_id" not in thin
    assert thin["ref"] == table.describe("sensor.thin")["ref"]
    assert thin["reason"]


def test_read_salient_SAYS_SO_when_it_has_no_ref_table() -> None:
    """⚠️ A MISSING NAME MUST BE A STATED FACT, NOT A MISSING FIELD. Without a
    table the row is genuinely unattributable, and `unattributable: true` is
    something the model can report — where a silently absent name is something
    it has to infer from the shape of the gap, which is exactly what it had to
    do before this was fixed."""
    tool = read_tools.ReadSalient(scorer=_salient_fixture)
    top = _run(tool.call({"limit": 5}))[0]["json"]["salient"][0]
    assert "entity_id" not in top
    assert top["unattributable"] is True


def test_read_concerns_hides_closed_by_default() -> None:
    rows = [{"id": "a", "state": "open"}, {"id": "b", "state": "dismissed"},
            {"id": "c", "state": "closed"}]
    tool = read_tools.ReadConcerns(store=lambda: rows)
    assert _run(tool.call({}))[0]["json"]["count"] == 1
    assert _run(tool.call({"include_closed": True}))[0]["json"]["count"] == 3


def test_read_coverage_states_the_conclusion_rather_than_implying_it() -> None:
    """⚠️ A model handed `complete: false` may or may not draw the right
    conclusion. A sentence cannot be misread."""
    tool = read_tools.ReadCoverage(discovered=lambda: {
        "capabilities_missing": ["energy_water"],
        "capability_absent": {"energy_water": "Water use is not metered."}})
    payload = _run(tool.call({}))[0]["json"]
    assert payload["structural"] == ["Water use is not metered."]
    assert "INCOMPLETE" in payload["note"] or "complete" in payload["note"]


def test_limits_are_clamped_rather_than_trusted() -> None:
    tool = read_tools.ReadSalient(scorer=lambda: [])
    for junk, want in ((0, 1), (99999, read_tools.MAX_SALIENT_LIMIT),
                       ("banana", read_tools.DEFAULT_SALIENT_LIMIT),
                       (None, read_tools.DEFAULT_SALIENT_LIMIT)):
        assert _run(tool.call({"limit": junk}))[0]["json"]["limit"] == want


def test_an_UNWIRED_tool_REFUSES_rather_than_returning_empty() -> None:
    """⚠️ `feedback_instruments-never-skip`, MEASURED ON THE VILLA.

    A tool built with no data source returned `{"salient": []}` and
    `{"lines": []}` — identical to "this villa has nothing unusual" and "no log
    lines in seven days", which are the OPPOSITE facts. The agent, asked about a
    pump on a property journalling 17,845 entries, had to infer the difference
    from the shape of the silence: "getting neither scored nor unscorable
    entities is unusual in itself". It was right, and it should never have had
    to guess.

    ⚠️ `read_ledger` IS THE EXCEPTION AND IS NOT A BUG: it falls back to reading
    the real module, so unwired it still answers truthfully. That asymmetry is
    exactly why one paragraph of that reply had content and the rest did not.
    """
    import asyncio

    from agent.tools import logs as logs_mod
    from agent.tools import read as read_mod

    for tool in (read_mod.ReadSalient(), logs_mod.LOG_TOOLS[0]()):
        blocks = asyncio.run(tool.call({"window_hours": 24}))
        assert blocks and "error" in blocks[0], (
            f"{tool.name} returned {blocks!r} with no source — indistinguishable "
            f"from a quiet villa")
        assert blocks[0]["error"]["code"] == "unavailable"
        assert "not connected" in blocks[0]["error"]["message"]
