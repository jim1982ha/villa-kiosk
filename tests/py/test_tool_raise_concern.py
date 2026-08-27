"""TOOL-008 `raise_concern`, the one write on the reasoning path. TASK-053.

⚠️ HALF OF THIS FILE PINS THE CALLER, NOT THE TOOL, AND THAT IS DELIBERATE. The
defect TASK-053 exists to fix was never inside a function — every piece worked.
`concerns.raise_concern`, `render.enforce`, `policy.may_use_tool`
and `contracts.subject_key` were all correct, tested, and reachable by nobody.
A suite that exercised only this tool would have been green on the day the villa
produced zero concerns, which is exactly the shape `feedback_pin-the-caller`
records having been paid for twice already. So `test_investigate_*` drives the
real `runtime.investigate` against a scripted provider and asserts the tool is
built, registered, permitted and reached.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent import audit, budget, concerns, contracts, policy  # noqa: E402
from agent import runtime, triage  # noqa: E402
from agent.concerns import Concern  # noqa: E402
from agent.refs import RefTable  # noqa: E402
from agent.registry import Registry  # noqa: E402
from agent.tools.base import BaseTool, data  # noqa: E402
from agent.tools.concern import RaiseConcern, writer  # noqa: E402
from fake_provider import FakeProvider, asks, says  # noqa: E402

#: A device id shaped like a real one and belonging to no property.
#: ⚠️ INVENTED, per `feedback_the-real-id-i-keep-writing` — a real entity id has
#: reached tracked source twice in this repo, both times inside an explanation of
#: why ids must not travel.
DEVICE = "sensor.example_pump_power"

EVIDENCE = [{"tool": "read_state", "args_digest": "abc123",
             "summary": "power 340 W over 6 hours"}]


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """Every store on disk, in a temp directory, per test."""
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))
    monkeypatch.setattr(budget, "BUDGET_FILE", str(tmp_path / "b.json"))
    monkeypatch.setattr(audit, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(budget, "_BREAKER", None)


def _refs() -> RefTable:
    table = RefTable()
    table.ref_for(DEVICE, "Pool pump")
    return table


def _tool(*, cfg: Any = None, pol: Any = None, evidence: Any = None,
          refs: Any = None) -> RaiseConcern:
    run_policy = pol if pol is not None else policy.for_run(
        cfg, tier="reason", tool_names=["raise_concern"])
    return RaiseConcern(
        refs=_refs() if refs is None else refs,
        evidence_source=lambda: EVIDENCE if evidence is None else evidence,
        sink=writer(run_policy, cfg))


def _call(tool: RaiseConcern, **args: Any) -> List[Dict[str, Any]]:
    body = {"title": "Pool pump drawing more than usual",
            "body": "The pump has been at 340 W for 6 hours.",
            "severity": "warning", "ref": "d1"}
    body.update(args)
    return asyncio.run(tool.call(body))


def _err(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    assert blocks and "error" in blocks[0], f"expected a refusal, got {blocks}"
    return dict(blocks[0]["error"])


# ── the write itself ────────────────────────────────────────────────────────
def test_a_concern_is_recorded_and_readable() -> None:
    blocks = _call(_tool(cfg={"shadow": False}))
    assert "error" not in blocks[0], blocks
    rows = concerns.read()
    assert len(rows) == 1
    assert rows[0]["title"] == "Pool pump drawing more than usual"
    assert rows[0]["severity"] == "warning"
    assert rows[0]["state"] == "open"
    assert rows[0]["evidence"], "evidence must travel with the concern"


def test_the_subject_key_is_the_hash_of_the_entity_id() -> None:
    """⚠️ THE PROPERTY THE WHOLE SHADOW DIFF RESTS ON. Both layers must key one
    pump identically or the cutover evidence compares nothing."""
    _call(_tool(cfg={"shadow": False}))
    assert concerns.read()[0]["subject_key"] == contracts.subject_key(DEVICE)


def test_a_model_supplied_subject_key_is_ignored() -> None:
    """⚠️ IT HAS NO FIELD TO ARRIVE IN — the schema does not name it — so this
    pins that the extra argument is dropped rather than trusted."""
    _call(_tool(cfg={"shadow": False}), subject_key="deadbeefdeadbeef")
    stored = concerns.read()[0]["subject_key"]
    assert stored == contracts.subject_key(DEVICE)
    assert stored != "deadbeefdeadbeef"
    assert "subject_key" not in RaiseConcern.inputSchema["properties"]


def test_a_subject_that_is_not_a_device_gets_a_topic_key() -> None:
    """Triage escalates things with no entity behind them; refusing those would
    lose exactly the findings no blueprint can express."""
    blocks = _call(_tool(cfg={"shadow": False}), ref="",
                   subject="Monitoring Coverage")
    assert "error" not in blocks[0], blocks
    key = concerns.read()[0]["subject_key"]
    assert key == contracts.subject_key("topic:monitoring coverage")
    # ⚠️ AND IT CAN NEVER COLLIDE WITH A DEVICE KEY, which is what makes such a
    # concern honestly `agent only` in the diff forever.
    assert key != contracts.subject_key(DEVICE)


def test_the_same_topic_in_a_different_case_is_the_same_subject() -> None:
    tool = _tool(cfg={"shadow": False})
    _call(tool, ref="", subject="monitoring coverage")
    blocks = _call(tool, ref="", subject="  MONITORING   coverage  ")
    # Refused as a duplicate — which is the proof they hashed the same.
    assert "already open" in _err(blocks)["message"]


# ── what it refuses ─────────────────────────────────────────────────────────
class _Sink:
    """A sink that records what reached it. ⚠️ THE ONLY WAY TO SEE A GUARD THAT
    THE STORE WOULD ALSO HAVE CAUGHT.

    Mutation testing found two of this file's assertions unable to fail:
    deleting the tool's severity check and its evidence check left every test
    green, because `contracts.concern_errors` refuses both a moment later inside
    `concerns.raise_concern` and the model receives an `invalid_args` either
    way. The outcome is identical; what differs is whether the tool checked, and
    the only observable difference is whether the write was ATTEMPTED. Asserting
    on the message would have pinned prose; asserting that nothing reached the
    sink pins the guard.
    """

    def __init__(self) -> None:
        self.seen: List[Concern] = []

    def __call__(self, concern: Concern) -> Any:
        self.seen.append(concern)
        return True, ""


@pytest.mark.parametrize("severity", ["", "urgent", "INFO ", "sev1", None])
def test_an_unlisted_severity_is_refused_never_defaulted(severity: Any) -> None:
    """⚠️ NEVER DEFAULTED TO THE QUIETEST. `INFO ` is in the list once stripped
    and lowercased, so it is the case that separates 'normalised' from
    'accepted anything'."""
    sink = _Sink()
    tool = RaiseConcern(refs=_refs(), evidence_source=lambda: EVIDENCE, sink=sink)
    blocks = _call(tool, severity=severity)
    if str(severity or "").strip().lower() in contracts.SEVERITY:
        assert "error" not in blocks[0]
        assert sink.seen and sink.seen[0].severity == "info"
        return
    assert _err(blocks)["code"] == "invalid_args"
    assert not sink.seen, "an unlisted severity must not reach the store at all"
    assert not concerns.read(), "a refused concern must not be stored"


@pytest.mark.parametrize("audience", ["guest", "ops", "", "everyone"])
def test_an_unlisted_audience_is_refused(audience: str) -> None:
    """⚠️ `ops` IS THE CASE THAT MATTERS: it is a real profile id and NOT an
    audience, and `contracts.AUDIENCE` carries a note about the sixteen releases
    the two vocabularies were confused for."""
    sink = _Sink()
    tool = RaiseConcern(refs=_refs(), evidence_source=lambda: EVIDENCE, sink=sink)
    blocks = _call(tool, audience=audience)
    if not audience:
        assert "error" not in blocks[0], "an omitted audience defaults to owner"
        assert sink.seen[0].audience == "owner"
        return
    assert _err(blocks)["code"] == "invalid_args"
    assert not sink.seen


def test_a_ref_this_run_did_not_mint_is_refused() -> None:
    blocks = _call(_tool(cfg={"shadow": False}), ref="d47")
    assert _err(blocks)["code"] == "invalid_args"
    assert not concerns.read()


def test_neither_ref_nor_subject_is_refused() -> None:
    blocks = _call(_tool(cfg={"shadow": False}), ref="")
    assert _err(blocks)["code"] == "invalid_args"


def test_a_run_that_read_nothing_cannot_file_a_concern() -> None:
    """⚠️ ARCH-006. The store would refuse it too — so the assertion that can
    fail is that the write was never ATTEMPTED, not that it failed. See `_Sink`.
    """
    sink = _Sink()
    tool = RaiseConcern(refs=_refs(), evidence_source=lambda: [], sink=sink)
    blocks = _call(tool)
    assert _err(blocks)["code"] == "invalid_args"
    assert "evidence" in _err(blocks)["message"]
    assert not sink.seen, "a concern with no evidence must not reach the store"
    assert not concerns.read()


def test_an_unwired_tool_refuses_rather_than_doing_nothing() -> None:
    tool = RaiseConcern(refs=_refs(), evidence_source=lambda: EVIDENCE)
    assert _err(_call(tool))["code"] == "unavailable"


def test_a_missing_required_argument_is_refused_by_the_base_class() -> None:
    blocks = asyncio.run(_tool(cfg={"shadow": False}).call({"title": "x"}))
    assert _err(blocks)["code"] == "invalid_args"


def test_a_suppressed_subject_is_refused() -> None:
    """⚠️ `policy.is_suppressed` IS THE AUTHORITY, read from the frozen run
    snapshot — a person's 'stop telling me about this' must work reliably."""
    cfg = {"shadow": False,
           "suppressed_subjects": [contracts.subject_key(DEVICE)]}
    blocks = _call(_tool(cfg=cfg))
    assert _err(blocks)["code"] == "invalid_args"
    assert "stop raising" in _err(blocks)["message"]
    assert not concerns.read()


def test_a_second_concern_on_an_open_subject_must_supersede() -> None:
    tool = _tool(cfg={"shadow": False})
    _call(tool)
    blocks = _call(tool, title="Pool pump still high")
    assert "already open" in _err(blocks)["message"]

    ok = _call(tool, title="Pool pump still high", supersedes=["c1"])
    assert "error" not in ok[0], ok
    rows = {r["id"]: r for r in concerns.read()}
    assert rows["c1"]["state"] == "closed"
    assert rows["c2"]["supersedes"] == ["c1"]


# ── the evidence rule ───────────────────────────────────────────────────────
def test_an_unsourced_figure_is_stripped_and_the_model_is_told() -> None:
    """⚠️ THE COUNT COMES BACK. A silent strip teaches the model nothing and it
    writes the same unsourced sentence into the next concern."""
    blocks = _call(_tool(cfg={"shadow": False}),
                   body="The pump drew 340 W, up from 95 W last month.")
    said = str(blocks[0].get("text") or "")
    assert "REMOVED" in said and "95" in said
    stored = concerns.read()[0]["body"]
    assert "340 W" in stored, "a figure the run DID read must survive"
    assert "95 W" not in stored


def test_a_figure_past_the_summary_cutoff_is_still_sourced() -> None:
    """⚠️ THE RULE USED TO ACCUSE THE MODEL OF INVENTING WHAT IT HAD READ.
    Figures were checked against the 200-character `summary` a person reads on
    the concern, so a run that read a ranking of twenty-five devices could
    source a number from the first entry and nothing after it. Two fields now:
    `summary` for the reader, `cited` for the check (registry.CITED_CHARS)."""
    from agent import registry as reg_mod

    padded = "x" * (reg_mod.SUMMARY_CHARS + 50)
    row = [{"tool": "read_salient", "args_digest": "d",
            "summary": f"{padded}"[:reg_mod.SUMMARY_CHARS],
            "cited": f"{padded} the reading was 4180 W"}]
    blocks = _call(_tool(cfg={"shadow": False}, evidence=row),
                   body="It reached 4180 W.")
    assert "REMOVED" not in str(blocks[0].get("text") or ""), blocks
    assert "4180 W" in concerns.read()[0]["body"]


def test_the_whole_tool_result_is_not_stored_with_the_concern() -> None:
    """⚠️ `cited` IS FOR THE CHECK AND STAYS IN MEMORY. Up to 8 KB a row into a
    store bounded at 2,000 concerns is two orders of magnitude past what that
    bound was set against."""
    row = [{"tool": "read_salient", "args_digest": "d", "summary": "short",
            "cited": "y" * 5000}]
    _call(_tool(cfg={"shadow": False}, evidence=row))
    stored = concerns.read()[0]["evidence"][0]
    assert "cited" not in stored, stored
    assert stored["summary"] == "short"


# ── the delivery class ──────────────────────────────────────────────────────
def test_in_observe_mode_the_concern_is_live_and_INFORMATIONAL() -> None:
    """⚠️ ONE STORE SINCE 2026-08-28 (owner's ruling): observe-mode concerns
    land LIVE — visible on the Reason tab — stamped `informational`, which is
    what the outbox reads to deliver once and raise no job."""
    blocks = _call(_tool(cfg={"mode": "observe"}))
    assert "error" not in blocks[0], blocks
    rows = concerns.read()
    assert len(rows) == 1
    assert rows[0]["title"] == "Pool pump drawing more than usual"
    assert rows[0]["informational"] is True


def test_the_model_cannot_choose_the_delivery_class() -> None:
    """⚠️ THERE IS NO ARGUMENT FOR IT — an `informational: false` the model
    could send would be one hallucination away from an observe-mode villa
    chasing somebody. The stamp is wiring, read from config at the writer."""
    assert "informational" not in RaiseConcern.inputSchema["properties"]
    assert "shadow" not in RaiseConcern.inputSchema["properties"]
    _call(_tool(cfg={"mode": "observe"}), informational=False)
    rows = concerns.read()
    assert len(rows) == 1 and rows[0]["informational"] is True

    concerns._write([])
    _call(_tool(cfg={"mode": "live"}))
    assert concerns.read()[0]["informational"] is False


# ── the caller ──────────────────────────────────────────────────────────────
class _Reader(BaseTool):
    """A stand-in read tool, so the run has evidence to cite.

    ⚠️ ITS KEYS ARE ON `redact.ALLOWED_FIELDS` ON PURPOSE. A first version
    returned `{"power": …}`, which the scrub correctly deleted — leaving the
    figure check with nothing and every number stripped. That is the redaction
    boundary working, and a fake that trips it tests the fake.
    """

    name = "read_state"
    description = "A stand-in read tool, so the run has evidence to cite."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [data({"ref": "d1", "state": "340", "unit": "W",
                      "window_hours": 6})]


def _reason_registry() -> Registry:
    return Registry([_Reader()], refs=_refs())


ENABLED: Dict[str, Any] = {"enabled": True, "shadow": False,
                           "model_reason": "m", "model_triage": "m"}


def test_investigate_offers_the_write_tool_to_the_reasoning_tier() -> None:
    """⚠️ THE ASSERTION THAT WOULD HAVE FAILED BEFORE TASK-053. Everything below
    it existed; nothing built the tool."""
    provider = FakeProvider([says("nothing to add")])
    asyncio.run(runtime.investigate(
        provider=provider, system=[], messages=[], config=ENABLED,
        registry=_reason_registry(), tier="reason"))
    offered = {t["name"] for t in provider.calls[0]["tools"]}
    assert "raise_concern" in offered, offered


def test_investigate_records_a_concern_the_model_asks_for() -> None:
    """End to end: read, then write, through the real loop and the real gate."""
    provider = FakeProvider([
        asks("read_state", {}, "tu_1"),
        asks("raise_concern", {
            "title": "Pool pump drawing more than usual",
            "body": "The pump has been at 340 W for 6 hours.",
            "severity": "warning", "ref": "d1"}, "tu_2"),
        says("filed"),
    ])
    result = asyncio.run(runtime.investigate(
        provider=provider, system=[], messages=[], config=ENABLED,
        registry=_reason_registry(), tier="reason"))
    assert result.status == "answered", result.reason
    rows = concerns.read()
    assert len(rows) == 1, f"the run produced no concern: {result}"
    assert rows[0]["severity"] == "warning"
    # ⚠️ THE EVIDENCE IS THIS RUN'S, gathered before the write and cited by it.
    assert rows[0]["evidence"][0]["tool"] == "read_state"


def test_a_figure_the_run_never_read_does_not_reach_the_store() -> None:
    """The evidence rule, enforced through the real loop rather than in a unit."""
    provider = FakeProvider([
        asks("read_state", {}, "tu_1"),
        asks("raise_concern", {
            "title": "Pool pump drawing more than usual",
            "body": "It drew 340 W, against a 12000 kWh annual baseline.",
            "severity": "warning", "ref": "d1"}, "tu_2"),
        says("filed"),
    ])
    asyncio.run(runtime.investigate(
        provider=provider, system=[], messages=[], config=ENABLED,
        registry=_reason_registry(), tier="reason"))
    body = concerns.read()[0]["body"]
    assert "340 W" in body
    assert "12000" not in body


def test_triage_is_never_offered_the_write_tool() -> None:
    provider = FakeProvider([says("NOTHING")])
    asyncio.run(runtime.investigate(
        provider=provider, system=[], messages=[], config=ENABLED,
        registry=_reason_registry(), tier="triage"))
    offered = {t["name"] for t in provider.calls[0]["tools"]}
    assert "raise_concern" not in offered, offered


def test_triage_asking_for_it_anyway_is_refused_by_the_gate() -> None:
    """⚠️ THE SECOND, INDEPENDENT BARRIER. Not offering it is a prompt-level
    fact; `policy.may_use_tool` denying every WRITE to the triage tier is the
    one that holds when a model names a tool it was never shown."""
    verdict = policy.may_use_tool(
        policy.for_run(ENABLED, tier="triage", tool_names=["raise_concern"]),
        "raise_concern", RaiseConcern.mode)
    assert not verdict.allowed
    assert "triage" in verdict.reason


def test_the_triage_tier_still_sees_exactly_one_tool() -> None:
    """⚠️ THE COST GUARD. Widening triage is what turns ~$14/month into ~$200,
    and this feature adds a tool to the run path triage shares."""
    narrowed = triage.registry_for(_reason_registry().with_tool(_Reader2()))
    assert set(narrowed.names) <= set(triage.TRIAGE_TOOLS)


class _Reader2(BaseTool):
    name = "read_villa"
    description = "stand-in"
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [data({})]


# ── the ref table the tool has to share ─────────────────────────────────────
def test_the_built_registry_carries_the_table_its_tools_mint_into(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE TOOL RESOLVES A HANDLE ANOTHER TOOL MINTED, so there must be
    exactly ONE table per run. Two would silently disagree — `d3` is an index,
    not an identity (`refs.py`), so a second table built a moment later would
    resolve the same handle to whatever device happened to sit at that position,
    and the concern would be filed against the wrong equipment with no error
    anywhere. Found by a mutation that survived every other test in this file:
    `build_registry` dropping `refs=` changes nothing any of them can see.
    """
    from agent import registry as reg_mod
    from agent import sources

    monkeypatch.setattr(sources, "_journal_rows",
                        lambda: [{"id": DEVICE, "s": "340",
                                  "at": "2026-08-23T10:00:00Z"}])
    built = reg_mod.build_registry(config={"shadow": False})
    assert built.refs is not None, "the registry carries no ref table"
    assert built.refs.resolve("d1") == DEVICE


def test_adding_a_per_run_tool_keeps_the_ref_table() -> None:
    """⚠️ A PROPERTY OF `with_tool`, PINNED DIRECTLY BECAUSE NO BEHAVIOUR SHOWS
    IT TODAY. `runtime.investigate` reads `reg.refs` BEFORE calling `with_tool`,
    so dropping it here is invisible — until the next per-run tool is added
    after this one and silently gets `None`. A latent trap is worth one line.
    """
    table = _refs()
    grown = Registry([_Reader()], refs=table).with_tool(_Reader2())
    assert grown.refs is table


# ── the reader that makes deduplication possible ────────────────────────────
def test_read_concerns_is_wired_to_the_store_the_writes_go_to() -> None:
    """⚠️ `read_concerns` RETURNED `[]` FOREVER AND NOTHING NOTICED, because
    until this task nothing could write one. The tool's own description tells
    the model to check before raising, and `raise_concern` REFUSES a repeat that
    does not supersede — so an unwired reader is an instruction the model cannot
    comply with."""
    from agent import sources

    stored, _ = concerns.raise_concern(Concern(
        subject_key=contracts.subject_key(DEVICE), title="already open",
        severity="notice", audience="owner", evidence=list(EVIDENCE)))
    assert stored is not None

    tools = {t.name: t for t in sources.build_tools(config={"shadow": False})}
    blocks = asyncio.run(tools["read_concerns"].call({}))
    payload = blocks[0].get("json") or {}
    assert payload.get("count") == 1, payload
    assert payload["concerns"][0]["title"] == "already open"


def test_read_concerns_reads_the_ONE_live_store_in_every_mode() -> None:
    """⚠️ ONE STORE SINCE 2026-08-28. A concern raised in observe mode lands
    LIVE (stamped informational), so the model's dedupe read must see it from
    every mode — the shadow-aware split this test used to pin is gone, and a
    reader that filtered by mode would re-open the refused-supersede loop."""
    from agent import sources

    _call(_tool(cfg={"mode": "observe"}))
    for mode in ("observe", "live", "ask"):
        tools = {t.name: t for t in sources.build_tools(config={"mode": mode})}
        payload = asyncio.run(tools["read_concerns"].call({}))[0].get("json") or {}
        assert payload.get("count") == 1, (mode, payload)


def test_a_concern_records_WHICH_investigation_produced_it() -> None:
    """⚠️ THE LINK BACK TO THE FLAG, AND IT DID NOT EXIST UNTIL 2.780.0. A
    concern named its subject only as `subject_key` — a HASH of an entity id —
    so "did this flag turn into anything?" could be answered only by hashing an
    id the flag usually does not carry: the reference villa reports
    `0/3 identified`. The consequence was a screen that could only ever say
    "no concern", including when there was one, and a Handover column stuck at
    0 matched.

    ⚠️ FOUND BY MUTATION. Replacing `run_id=ident` with `run_id=""` at the
    construction site in `runtime.investigate` left all 1,917 tests green while
    breaking every one of those readers — `feedback_pin-the-caller` again, on
    the same day, for the same reason: the field existed and nobody checked
    that anything filled it.

    ⚠️ SET AT CONSTRUCTION, NEVER FROM ARGUMENTS. The model cannot influence it;
    it is the audit's own answer to "which run wrote this", not something the
    concern claims about itself.
    """
    import inspect

    from agent import runtime as runtime_mod

    class _Sink:
        def __init__(self) -> None:
            self.seen: List[Any] = []

        def __call__(self, concern: Any) -> Any:
            self.seen.append(concern)
            return True, ""

    sink = _Sink()
    tool = RaiseConcern(refs=_refs(), evidence_source=lambda: EVIDENCE,
                        sink=sink, run_id="scheduled1787751552-e2")
    _call(tool)
    assert sink.seen, "nothing was recorded; this test would be vacuous"
    assert sink.seen[0].run_id == "scheduled1787751552-e2", (
        "the concern does not carry the run that produced it, so nothing can "
        "pair it with the flag it came from")

    # ⚠️ AND THE CALLER MUST PASS IT. The tool honouring the argument proves
    # nothing if the one construction site hands it an empty string — which is
    # exactly the mutation that stayed green.
    # ⚠️ SCOPED TO THE `RaiseConcern(` CALL, NOT THE FUNCTION. The first
    # version of this assertion grepped the whole of `investigate` for
    # "run_id=ident" — which appears at FIVE other lines in it (every
    # `AgentResult`, and the two other tool constructions), so the mutation that
    # empties THIS one stayed green. A source-grep pin is only as strong as the
    # narrowest thing it can point at.
    src = inspect.getsource(runtime_mod.investigate)
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    start = code.index("RaiseConcern(")
    call = code[start:code.index("))", start)]
    assert "run_id=ident" in call, (
        "runtime.investigate no longer hands RaiseConcern the run id, so every "
        f"concern is written with an empty origin. The call reads: {call!r}")
