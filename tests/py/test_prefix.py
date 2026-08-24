"""The prefix instrument. It measures the one number that multiplies.

⚠️ EVERY TEST HERE EXISTS BECAUSE AN INSTRUMENT THAT LIES IS WORSE THAN NO
INSTRUMENT. Four counters in this project have read `0` for the exact case they
were built to measure, and this file pins against three ways this one could
join them: a token total that ignores the cached counters (which reads SMALLER
the better caching works), a block the labeller silently drops, and a
measurement nothing calls.
"""

from __future__ import annotations

import inspect
import os
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import playbooks, prefix, registry as registry_mod  # noqa: E402


def _blocks() -> List[Dict[str, Any]]:
    return playbooks.system_blocks("owner", instructions="I" * 100,
                                   document="D" * 400)


def _tools() -> List[Dict[str, Any]]:
    return [{"name": "ha_get_state", "description": "x" * 500,
             "inputSchema": {"type": "object"}},
            {"name": "read_villa", "description": "y" * 50,
             "inputSchema": {"type": "object"}}]


# ── the labels are a contract, not a guess ─────────────────────────────────

def test_the_block_NAMES_match_what_the_builder_actually_emits() -> None:
    """⚠️ `feedback_guessed-field-shapes`. Reading the blocks positionally and
    naming them from memory is how a label slides by one the day somebody
    inserts a block — and it slides SILENTLY, because every count still adds up.
    `system_blocks` fixes the order for the cache boundary's sake; this pins
    that this module's names are that same order."""
    assert prefix.SYSTEM_BLOCK_NAMES == ("playbook", "instructions", "document")
    built = playbooks.system_blocks("owner", instructions="I", document="D")
    assert len(built) == len(prefix.SYSTEM_BLOCK_NAMES)
    assert built[-1]["text"] == "D", (
        "the document must stay LAST — stable first, volatile last, or every "
        "block after it becomes uncacheable")
    assert "cache_control" in built[1], (
        "the stable boundary sits after the instructions; without it the villa "
        "document re-writes every tool schema on every journal row (2.714.0)")


def test_a_FOURTH_system_block_is_reported_rather_than_dropped() -> None:
    """An instrument that ignores what it does not recognise under-reports the
    very total it exists to explain."""
    extra = _blocks() + [{"type": "text", "text": "Z" * 250}]
    out = prefix.measure(system=extra, tools=[], messages=[])
    names = [p.name for p in out.parts]
    assert "system[3]" in names
    assert out.chars >= 250


def test_the_document_being_ABSENT_shifts_no_label() -> None:
    """`system_blocks` omits the document on a villa with no profile, so the
    zip must be over what arrived — never padded to three."""
    out = prefix.measure(
        system=playbooks.system_blocks("", instructions="I", document=""),
        tools=[], messages=[])
    names = [p.name for p in out.parts]
    assert "document" not in names
    assert names[:2] == ["playbook", "instructions"]


# ── the arithmetic ─────────────────────────────────────────────────────────

def test_every_character_lands_in_exactly_one_part() -> None:
    out = prefix.measure(system=_blocks(), tools=_tools(),
                         messages=[{"role": "user", "content": "hi"}])
    assert out.chars == sum(p.chars for p in out.parts)
    assert sum(out.share(p) for p in out.parts) == 1.0


def test_the_TOOL_slice_is_the_sum_of_its_tools() -> None:
    out = prefix.measure(system=[], tools=_tools(), messages=[])
    tools_part = [p for p in out.parts if p.name == "tools"][0]
    assert tools_part.items == 2
    assert tools_part.chars == sum(p.chars for p in out.tools)
    assert out.tools[0].name == "ha_get_state", "largest first"


def test_the_TOKEN_TOTAL_COUNTS_THE_CACHED_READS() -> None:
    """⚠️ THE INSTRUMENT THAT LIES BEST. `input_tokens` alone excludes the
    cached prefix, so a fully-cached 68,000-token request reports ~100 — and the
    BETTER the cache works the smaller the number looks. That is the shape of
    counter that says 0 for the case it was built to measure."""
    fully_cached = {"input_tokens": 104, "cache_read_input_tokens": 68_023,
                    "cache_creation_input_tokens": 0, "output_tokens": 157}
    assert prefix._input_tokens(fully_cached) == 68_127
    on_a_write = {"input_tokens": 104, "cache_read_input_tokens": 0,
                  "cache_creation_input_tokens": 68_023}
    assert prefix._input_tokens(on_a_write) == 68_127, (
        "a cache WRITE is the expensive request; excluding it hides the 38% of "
        "one morning's bill that 2.714.0 was about")
    assert prefix._input_tokens({}) == 0
    assert prefix._input_tokens(None) == 0


def test_tokens_are_ATTRIBUTED_from_the_provider_total_never_estimated() -> None:
    """A part's tokens are its character share of the number the provider
    reported — so the split moves with the real bill rather than with a
    hardcoded divisor nobody can audit."""
    out = prefix.measure(system=_blocks(), tools=_tools(), messages=[])
    snap = prefix.snapshot(out, {"cache_read_input_tokens": 10_000})
    assert snap["tokens"] == 10_000
    # ⚠️ THE PARTS MUST SUM BACK TO THE TOTAL, give or take one token per part
    # for rounding. A split that does not add up is a split that has lost a
    # slice — which is the whole failure this instrument replaces.
    assert abs(sum(p["tokens"] for p in snap["parts"]) - 10_000) <= len(
        snap["parts"])
    biggest = max(snap["parts"], key=lambda p: p["chars"])
    assert biggest["tokens"] == max(p["tokens"] for p in snap["parts"])
    # And it tracks the REPORTED total: double the bill, double every part.
    doubled = prefix.snapshot(out, {"cache_read_input_tokens": 20_000})
    for was, now in zip(snap["parts"], doubled["parts"]):
        assert abs(now["tokens"] - 2 * was["tokens"]) <= 1, was["name"]


def test_the_LOG_LINE_and_the_DATA_are_one_computation() -> None:
    """⚠️ Two renderings of one request that recompute independently are two
    numbers that drift — the store-envelope defect, one level down. `report`
    formats `snapshot`; it does not repeat its arithmetic."""
    src = inspect.getsource(prefix.report)
    assert "snapshot(breakdown, usage)" in src
    assert "_input_tokens" not in src, (
        "report must take the totals from snapshot, not recompute them")


def test_CHARACTERS_separate_a_content_change_from_a_TOKENISER_change() -> None:
    """⚠️ THIS IS THE PROPERTY THE 50k -> 68k JUMP NEEDS. Two conversations
    ninety seconds apart reported 50,481 and 68,127 tokens with `read_only_mode`
    unchanged. Characters are model-independent: equal characters beside
    unequal tokens means the CONTENT did not change and the model did. A line
    carrying only tokens cannot tell those two apart."""
    one = prefix.measure(system=_blocks(), tools=_tools(), messages=[])
    two = prefix.measure(system=_blocks(), tools=_tools(), messages=[])
    assert one.chars == two.chars
    haiku = prefix.report(one, model="claude-haiku-4-5", kind="chat",
                          usage={"cache_read_input_tokens": 50_481})
    sonnet = prefix.report(two, model="claude-sonnet-5", kind="chat",
                           usage={"cache_read_input_tokens": 68_127})
    assert f"{one.chars:,} chars" in haiku[0]
    assert f"{two.chars:,} chars" in sonnet[0]
    assert "50,481 tok" in haiku[0] and "68,127 tok" in sonnet[0]


# ── the line says what it does not know ────────────────────────────────────

def test_a_MISSING_token_count_is_stated_not_omitted() -> None:
    """A declined turn has no usage. Printing the character line alone would
    read as a prefix that cost nothing."""
    out = prefix.measure(system=_blocks(), tools=_tools(), messages=[])
    line = prefix.report(out, model="m", kind="chat", usage=None)[0]
    assert "no token count" in line
    assert "chars" in line


def test_the_line_NAMES_the_parts_the_cost_question_is_about() -> None:
    out = prefix.measure(system=_blocks(), tools=_tools(),
                         messages=[{"role": "user", "content": "hi"}])
    line = prefix.report(out, model="claude-sonnet-5", kind="chat",
                         usage={"cache_read_input_tokens": 68_127})[0]
    for name in ("playbook", "instructions", "document", "tools", "messages"):
        assert name in line, f"{name} is one of the four the backlog asked for"
    assert "claude-sonnet-5" in line
    # ⚠️ THE BREAKPOINT IS ON THE LINE because its PLACEMENT was the 2.714.0
    # bug, and a placement nobody can read regresses in silence.
    assert "[cache]" in line


def test_the_biggest_TOOLS_are_named_individually() -> None:
    """`tools 168,930c` says the schemas dominate; it does not say which of the
    seventy-eight to argue with."""
    lines = prefix.report(prefix.measure(system=[], tools=_tools()),
                          kind="chat", usage={"input_tokens": 1})
    assert len(lines) == 2
    assert "ha_get_state" in lines[1]


# ── it may not break a run, and it may not go quiet under load ─────────────

def test_the_measurement_never_raises_on_an_unserialisable_block() -> None:
    class Odd:
        def __repr__(self) -> str:
            return "odd" * 10

    out = prefix.measure(system=[{"type": "text", "text": Odd()}],
                         tools=[], messages=[])
    assert out.chars > 0


def test_ONCE_is_per_run_not_per_process() -> None:
    """⚠️ A module-level flag would let the first run of the day silence every
    later one — an instrument that goes quiet under concurrency, which is
    exactly when the prefix is worth watching."""
    a, b = prefix.Once(), prefix.Once()
    assert a.take() is True and a.take() is False
    assert b.take() is True


def test_the_RUN_LOOP_actually_logs_it() -> None:
    """⚠️ PIN THE CALLER. A measurement nothing calls is this repository's
    thirteen-times defect: `prefix.py` would be correct, tested and silent."""
    src = inspect.getsource(registry_mod.run)
    assert "prefix_mod.report(" in src and "prefix_mod.measure(" in src
    assert "prefix_once.take()" in src, (
        "the prefix must be logged ONCE per run; per turn is eight copies of "
        "one fact")
    assert "tools=published" in src, (
        "it must measure the list actually SENT — measuring the unfiltered "
        "registry would report a prefix nobody was billed for")
