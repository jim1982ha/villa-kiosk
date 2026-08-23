"""The provider spend ledger.

⚠️ THE OWNER'S QUESTION IS "WHERE DID MY $0.65 GO", AND EVERY FAILURE MODE HERE
PRODUCES A CONFIDENT, WRONG, SMALLER NUMBER. A call site that forgets to record,
a cached prefix charged at the input rate, an unknown model priced at zero — all
three under-report, all three look like a healthy ledger, and the discrepancy is
discovered on the bill. That asymmetry is why the pins below lean the way they
do.
"""

from __future__ import annotations

import ast
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import usage as usage_mod  # noqa: E402

NOW = 1_760_000_000.0
DAY = 86400.0


@pytest.fixture()
def path(tmp_path):
    return str(tmp_path / "usage.json")


def _counts(inp=0, out=0, read=0, write=0):
    return {"input_tokens": inp, "output_tokens": out,
            "cache_read_input_tokens": read,
            "cache_creation_input_tokens": write}


# ── pricing ─────────────────────────────────────────────────────────────────
def test_a_known_model_is_priced_from_its_published_rate() -> None:
    # 1M in + 1M out on Opus 5 == $5 + $25.
    assert usage_mod.cost_of("claude-opus-5",
                             _counts(inp=1_000_000, out=1_000_000)) == 30.0


def test_a_DATED_snapshot_is_not_an_unknown_model() -> None:
    """`claude-opus-5-20260401` is the same price as `claude-opus-5`; charging
    it at the unknown rate would make a correctly-configured villa look like it
    had adopted something exotic."""
    assert usage_mod.price_of("claude-opus-5-20260401") \
        == usage_mod.price_of("claude-opus-5")


def test_an_UNKNOWN_model_costs_the_MOST_not_nothing() -> None:
    """⚠️ THE DIRECTION IS THE POINT. A model this table has not heard of
    costing zero would make the ledger under-report exactly when a new and
    probably dearer model was adopted. An over-estimate prompts a look; an
    under-estimate is found on the bill."""
    unknown = usage_mod.cost_of("some-future-model", _counts(inp=1_000_000))
    assert unknown > 0
    assert unknown >= max(p[0] for p in usage_mod.PRICES.values())


def test_a_CACHE_READ_is_charged_at_a_TENTH_and_is_not_added_to_input() -> None:
    """⚠️ THE MOST EXPENSIVE ARITHMETIC MISTAKE AVAILABLE HERE, IN BOTH
    DIRECTIONS. The provider reports `input_tokens` as what it charged at the
    input rate, with cached tokens broken out separately. Adding them would bill
    the stable prefix twice — and that prefix is the design decision the whole
    fifteen-minute cadence rests on, so the error would scale with the feature
    working correctly."""
    read_only = usage_mod.cost_of("claude-opus-5", _counts(read=1_000_000))
    input_only = usage_mod.cost_of("claude-opus-5", _counts(inp=1_000_000))
    assert read_only == pytest.approx(input_only * 0.1)
    both = usage_mod.cost_of("claude-opus-5",
                             _counts(inp=1_000_000, read=1_000_000))
    assert both == pytest.approx(input_only * 1.1)


def test_a_CACHE_WRITE_costs_MORE_than_plain_input() -> None:
    assert usage_mod.cost_of("claude-opus-5", _counts(write=1_000_000)) \
        > usage_mod.cost_of("claude-opus-5", _counts(inp=1_000_000))


# ── recording ───────────────────────────────────────────────────────────────
def test_a_recorded_request_carries_WHO_and_WHAT_FOR(path) -> None:
    usage_mod.record(source="chat", model="claude-opus-5",
                     counts=_counts(inp=100, out=50), actor="owner",
                     run_id="r1", path=path, now=NOW)
    rows = usage_mod.rows(path=path)
    assert len(rows) == 1
    assert rows[0]["actor"] == "owner" and rows[0]["source"] == "chat"
    assert rows[0]["run_id"] == "r1" and rows[0]["cost"] > 0


def test_since_filters_and_the_total_adds_up(path) -> None:
    usage_mod.record(source="triage", model="claude-haiku-4-5",
                     counts=_counts(inp=1000), path=path, now=NOW - 3 * DAY)
    usage_mod.record(source="chat", model="claude-opus-5",
                     counts=_counts(inp=1000), actor="owner", path=path,
                     now=NOW)
    assert len(usage_mod.rows(path=path)) == 2
    assert len(usage_mod.rows(since=NOW - DAY, path=path)) == 1

    whole = usage_mod.summary(path=path)
    assert whole["total"]["requests"] == 2
    assert whole["total"]["cost"] == pytest.approx(
        sum(r["cost"] for r in usage_mod.rows(path=path)), abs=1e-4)


def test_the_summary_splits_THREE_ways(path) -> None:
    """⚠️ "Why did it cost that" has three answers — who, what for, which model
    — and the owner does not know in advance which one they need."""
    usage_mod.record(source="chat", model="claude-opus-5",
                     counts=_counts(inp=1000), actor="owner", path=path, now=NOW)
    usage_mod.record(source="triage", model="claude-haiku-4-5",
                     counts=_counts(inp=1000), actor="system", path=path, now=NOW)
    got = usage_mod.summary(path=path)
    assert set(got["by_actor"]) == {"owner", "system"}
    assert set(got["by_source"]) == {"chat", "triage"}
    assert set(got["by_model"]) == {"claude-opus-5", "claude-haiku-4-5"}
    assert got["by_actor"]["owner"]["requests"] == 1


def test_every_total_is_marked_ESTIMATED(path) -> None:
    """⚠️ CARRIED IN THE DATA, NOT WRITTEN INTO ONE UI STRING, so any second
    reader inherits it. The provider's bill is the authority: prices change,
    promotional rates lapse, and a failed request may still be billed."""
    assert usage_mod.summary(path=path)["estimated"] is True


def test_an_EMPTY_WINDOW_is_distinguishable_from_NO_LEDGER(path) -> None:
    """⚠️ Zero spent and never recorded look identical in a total and mean
    opposite things — and on the release that adds this, every earlier request
    is in the second category."""
    assert usage_mod.summary(path=path)["recording_since"] == 0.0
    usage_mod.record(source="triage", model="claude-haiku-4-5",
                     counts=_counts(inp=10), path=path, now=NOW)
    got = usage_mod.summary(since=NOW + DAY, path=path)
    assert got["total"]["requests"] == 0
    assert got["recording_since"] == NOW


def test_the_ring_is_BOUNDED(path, monkeypatch) -> None:
    """⚠️ THE BOUND IS PATCHED DOWN RATHER THAN FILLED. `record` rewrites the
    whole ring each time, so filling the real 8,000 takes ~100s of quadratic
    I/O in the suite — a test slow enough that somebody eventually deselects it
    is a test that stops running. The behaviour under test is "oldest rows are
    dropped at the limit", which does not depend on the limit's value."""
    monkeypatch.setattr(usage_mod, "MAX_ROWS", 10)
    for n in range(25):
        usage_mod.record(source="triage", model="claude-haiku-4-5",
                         counts=_counts(inp=n), path=path, now=NOW + n)
    kept = usage_mod.rows(path=path)
    assert len(kept) == 10
    # ⚠️ AND THE SURVIVORS ARE THE NEWEST. A ring that dropped the newest would
    # also pass a length check, and would hide the most recent spend — which is
    # the half an owner is actually looking at.
    assert kept[-1]["at"] == NOW + 24
    assert kept[0]["at"] == NOW + 15


def test_recording_NEVER_RAISES_however_broken_the_store_is() -> None:
    """An accounting failure must not be able to fail the work it accounts
    for."""
    usage_mod.record(source="chat", model="claude-opus-5", counts={},
                     path="/proc/cannot/write/here.json", now=NOW)
    usage_mod.record(source="chat", model="claude-opus-5",
                     counts={"input_tokens": "not a number"}, now=NOW,
                     path="/proc/cannot/write/here.json")


def test_a_corrupt_store_reads_as_EMPTY_rather_than_raising(tmp_path) -> None:
    bad = str(tmp_path / "usage.json")
    open(bad, "w").write("{not json")
    assert usage_mod.rows(path=bad) == []
    assert usage_mod.summary(path=bad)["total"]["requests"] == 0


# ── the wiring, which is the failure that would be silent ───────────────────
def test_every_provider_call_site_RECORDS_usage() -> None:
    """⚠️ THE PIN THAT MATTERS. A ledger is only as complete as its call sites,
    and a missed one produces a smaller, confident, wrong number — the exact
    shape of failure this repo has shipped four times as a counter reading zero
    for the case it existed to measure.

    Two sites exist: the agent loop (one site for triage, reasoning and chat
    alike, by ARCH-012) and the brief narrator's adapter. This walks for a
    third rather than trusting that there is none.
    """
    roots = [os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent"),
             os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports")]
    callers, recorders = set(), set()
    for root in roots:
        for base, _dirs, names in os.walk(root):
            for name in names:
                if not name.endswith(".py"):
                    continue
                path = os.path.join(base, name)
                if os.path.basename(path) == "usage.py":
                    continue
                src = open(path, encoding="utf-8").read()
                tree = ast.parse(src)
                for node in ast.walk(tree):
                    if not isinstance(node, ast.Call):
                        continue
                    func = node.func
                    # A provider is reached by `provider.run(...)` in the loop
                    # or by posting to the messages endpoint in an adapter.
                    if isinstance(func, ast.Attribute) and func.attr == "run" \
                            and isinstance(func.value, ast.Name) \
                            and func.value.id in ("provider", "adapter"):
                        callers.add(path)
                if "api.anthropic.com/v1/messages" in src:
                    callers.add(path)
                if "usage.record(" in src or "usage_mod.record(" in src:
                    recorders.add(path)

    assert callers, "the call-site probe matched nothing — it has gone blind"
    missing = sorted(p for p in callers if p not in recorders)
    assert not missing, (
        f"these reach a provider and do not record usage: {missing}")


def test_the_agent_loop_records_on_a_DECLINED_turn_too() -> None:
    """A turn that was billed and came back unusable is precisely the spend an
    owner cannot otherwise account for, so the record must precede the decline
    branch — the same ordering `budget.spend` already has."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                            "registry.py"), encoding="utf-8").read()
    record_at = src.index("usage_mod.record(")
    decline_at = src.index("if turn.declined:")
    assert record_at < decline_at, (
        "usage is recorded after the decline branch, so a billed-but-refused "
        "turn would be invisible in the ledger")
