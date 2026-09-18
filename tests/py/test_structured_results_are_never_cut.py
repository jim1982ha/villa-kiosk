"""A JSON result is refused when it is too big. It is never cut in half.

⚠️ THE SAME DEFECT, TWICE, THROUGH TWO DOORS — WHICH IS WHY THE RULE MOVED.
2.990.0 found it in `read_configuration`: ~294,000 characters truncated at
8,000, a zero read out of the broken prefix, and the owner told their main meter
had stopped and its wiring should be checked. The meter was fine. I wrote the
fix INSIDE `tools/ha.py`, where the two tools I was looking at could reach it.

On 2026-09-18 at 21:20 the owner asked, in French, how many lights were on and
how much electricity had been used since 5pm. The lights were right. The figure
came back as 6,67 kWh; the recorder's own hourly `change` rows for that window
sum to 3.06 kWh. The run's trace read:

    chat chat1789737609 answered in 7 turn(s), 11 tool call(s); tools used:
      ha_searchx4 ha_get_historyx2 ha_get_statex2 read_configurationx2 …

`ha_get_history` is an UPSTREAM tool, and `UpstreamTool.run` called `truncate`.
That meter reports once a minute, so 17:00→21:20 is 267 state rows — roughly
45,000 characters against a cap of 8,000. The reader was told, correctly, that
5,251 characters had gone unread; that is no defence at all against a number
which looks finished.

⚠️ THE LESSON IS THE ROLLOUT, NOT THE BUG. A shared rule must be rolled out by
everything it APPLIES to, not by the call sites in front of me when I wrote it.
"""

import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import limits as limits_mod  # noqa: E402
from vesta.supervise.agent import upstream  # noqa: E402
from vesta.supervise.agent.tools.base import (  # noqa: E402
    DEFAULT_MAX_RESULT_CHARS, is_structured, refuse_if_oversized, truncate)


# ── the predicate ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("body", [
    '{"energy_sources": []}',
    '[{"start": 1, "change": 0.5}]',
    '   \n  {"padded": true}',
])
def test_a_body_that_opens_a_brace_is_a_structure(body):
    assert is_structured(body) is True


@pytest.mark.parametrize("body", [
    "",
    "2026-09-18 21:20:01 WARNING something happened",
    "The villa has three floors.",
    "sensor.example_meter is 5546.93",
])
def test_prose_is_not_a_structure(body):
    """⚠️ PROSE MAY STILL BE CUT, AND THAT MUST KEEP WORKING. Half a log
    excerpt is half true and a model can act on it; refusing one would make
    `read_logs` useless on any busy property."""
    assert is_structured(body) is False


def test_the_predicate_reads_the_CONTENT_not_the_producer():
    """⚠️ THE FIRST CUT OF THIS RULE WOULD HAVE MISSED THE REAL BUG. It is
    tempting to key off which branch of `upstream._flatten` produced the body —
    MCP `structuredContent` versus the server's text blocks. But Home
    Assistant's MCP server puts JSON *in* those text blocks, so that test
    answers False for a payload every bit as unsafe to cut. A body is a
    structure because of what it contains."""
    from_text_block = json.dumps({"entities": [{"state": "5546.93"}]})
    assert is_structured(from_text_block) is True


# ── the rule ────────────────────────────────────────────────────────────────
def test_a_structure_that_fits_is_not_refused():
    assert refuse_if_oversized("x" * DEFAULT_MAX_RESULT_CHARS) is None


def test_an_oversized_structure_is_refused_with_its_size_and_a_way_out():
    refusal = refuse_if_oversized("x" * (DEFAULT_MAX_RESULT_CHARS + 1),
                                  hint="period, statistic_types")
    assert refusal is not None
    assert refusal["error"]["code"] == "too_large"
    message = refusal["error"]["message"]
    assert "8,001 characters" in message, "the model cannot narrow without the size"
    assert "period, statistic_types" in message, (
        "the refusal must name arguments the called tool actually publishes, or "
        "the model re-asks the identical question")


def test_the_refusal_reaches_the_PERSON_as_well_as_the_model():
    """The management bubble is how the owner judges an answer's exhaustivity."""
    with limits_mod.scope() as run:
        refuse_if_oversized("x" * 20_000)
        assert any(row["kind"] == "too_large" for row in run.collected())


# ── the door the villa's wrong number came through ──────────────────────────
def _upstream_answering(payload_text):
    """An `UpstreamTool` whose server returns `payload_text`."""
    async def fake_rpc(session, url, method, params):
        return {"content": [{"type": "text", "text": payload_text}]}

    spec = {"name": "ha_get_history", "description": "",
            "inputSchema": {"type": "object", "properties": {
                "entity_ids": {}, "period": {}, "statistic_types": {}}}}
    tool = upstream.UpstreamTool(spec, "http://x", lambda: object(), None)
    original = upstream.rpc
    upstream.rpc = fake_rpc  # type: ignore[assignment]
    try:
        return asyncio.run(tool.run({"entity_ids": "sensor.example_meter"}))
    finally:
        upstream.rpc = original  # type: ignore[assignment]


#: The real shape, at the real size. One row per minute for 4h20m is what the
#: villa's meter actually returned; the ids are invented placeholders.
def _history_like(rows):
    return json.dumps({"entities": [{"entity_id": "sensor.example_meter",
                                     "states": [
        {"state": f"{5543.83 + i * 0.011:.5f}",
         "last_changed": f"2026-09-18T17:{i % 60:02d}:00+08:00"}
        for i in range(rows)]}]})


def test_an_oversized_UPSTREAM_structure_is_refused_not_truncated():
    """⚠️ THE EXACT CALL THAT PRODUCED 6,67 kWh. Before this, the block below
    came back as text: the first ~8,000 characters of a JSON array, ending
    mid-object, with a note saying the rest was not shown."""
    body = _history_like(267)
    assert len(body) > DEFAULT_MAX_RESULT_CHARS, "the fixture must be oversized"

    out = _upstream_answering(body)

    assert "error" in out[0], (
        "an upstream tool cut a structure — the model will read a figure out "
        "of an arbitrary prefix and report it as the answer")
    assert out[0]["error"]["code"] == "too_large"
    assert "5543" not in json.dumps(out[0]), (
        "no fragment of the structure may survive into the refusal")


def test_the_refusal_names_arguments_THIS_tool_publishes():
    """Derived from the upstream `inputSchema`, so a tool added upstream
    tomorrow gets correct advice with no change here."""
    message = _upstream_answering(_history_like(267))[0]["error"]["message"]
    assert "period" in message and "statistic_types" in message
    assert "entity_ids" not in message, (
        "advising a narrowing by an argument the call already passed is advice "
        "the model cannot act on")


def test_an_upstream_structure_that_FITS_comes_back_whole():
    """⚠️ THE OTHER HALF, AND THE ONE A CARELESS FIX BREAKS. Refusing anything
    structured would take `ha_search` and `ha_get_state` — the model's two
    commonest reads — away from it entirely."""
    body = _history_like(3)
    assert len(body) <= DEFAULT_MAX_RESULT_CHARS
    out = _upstream_answering(body)
    assert "error" not in out[0]
    assert out[0]["text"] == body
    assert "more characters not shown" not in out[0]["text"]


def test_oversized_upstream_PROSE_is_still_truncated():
    """A server that answers in sentences keeps the old, correct behaviour."""
    out = _upstream_answering("The villa is calm. " * 900)
    assert "error" not in out[0]
    assert "more characters not shown" in out[0]["text"]


# ── the guard that travels with the function ────────────────────────────────
def test_cutting_a_structure_announces_itself_in_the_log():
    """⚠️ A TEST COVERS THE TOOLS THAT EXIST TODAY; THIS COVERS THE NEXT ONE.
    Both times this defect shipped, nothing anywhere said a structure had been
    cut — the reader was told characters were missing, the operator was told
    nothing, and the cause was found by reading the villa's recorder by hand.
    `truncate` now names it the first time it happens."""
    from vesta.adapters import log as log_mod
    seen = []
    original = log_mod.log
    log_mod.log = lambda msg, *a, **k: seen.append(str(msg))  # type: ignore[assignment]
    try:
        truncate("[" + "x" * 20_000)
        assert any("STRUCTURED" in line for line in seen), (
            "a structure was cut and the log said nothing")
        seen.clear()
        truncate("plain prose. " * 2000)
        assert not any("STRUCTURED" in line for line in seen), (
            "cutting prose is correct and must stay quiet")
    finally:
        log_mod.log = original  # type: ignore[assignment]


def test_one_rule_with_two_callers_not_two_rules():
    """⚠️ PINNED BECAUSE THE DUPLICATE IS WHAT FAILED. `tools/ha.py` held this
    rule privately for six days while every upstream tool went on cutting JSON.
    Both callers are driven here against the same body, and must agree."""
    from vesta.supervise.agent.tools import ha as ha_tools

    body = _history_like(267)
    ours = ha_tools._json_or_refuse(body, "configuration")
    theirs = _upstream_answering(body)[0]
    assert "error" in ours and "error" in theirs
    assert ours["error"]["code"] == theirs["error"]["code"] == "too_large"
