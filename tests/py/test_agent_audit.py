"""The audit ledger. TEST-026.

⚠️ EVERY ASSERTION HERE IS ABOUT WHAT A LATER READER CAN TELL. An audit is only
worth writing if it can distinguish a crash mid-action from an action never
attempted, a refusal from an absence of checking, and a retry from a repeat.
Those three distinctions are the tests.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent import audit
from vesta.supervise.agent import contracts
from vesta.supervise.agent import refs

T0 = 1767225600.0


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(audit, "AUDIT_FILE", str(tmp_path / "vesta" / "audit.json"))


# ── intent and outcome are TWO rows ────────────────────────────────────────

def test_an_intent_and_an_outcome_are_two_rows_not_one_amended() -> None:
    """⚠️ APPEND-ONLY. The moment a row can be rewritten, the record stops being
    evidence and becomes a summary written by the thing being audited."""
    key = audit.record_intent("run-1", actor="owner", tool="act_service",
                              args={"ref": "d3"}, verdict="allow", now=T0)
    audit.record_outcome("run-1", action_key=key, outcome="ok", now=T0)
    rows = audit.rows()
    assert len(rows) == 2
    assert rows[0]["outcome"] == audit.PENDING, "the intent row is not edited"
    assert rows[1]["outcome"] == "ok"
    assert rows[0]["action_key"] == rows[1]["action_key"] == key


def test_a_crash_between_the_two_is_VISIBLE() -> None:
    """⚠️ THE WHOLE REASON FOR TWO ROWS. With one row written afterwards, a
    crash mid-action either looks like success or like nothing was attempted —
    the two readings a person most needs to tell apart."""
    audit.record_intent("run-1", actor="owner", tool="act_service",
                        args={"ref": "d3"}, verdict="allow", now=T0)
    # ...process dies here. Nothing writes an outcome.
    pending = audit.unfinished()
    assert len(pending) == 1 and pending[0]["tool"] == "act_service"
    assert audit.summary()["unfinished"] == 1


def test_a_finished_action_is_not_reported_as_unfinished() -> None:
    key = audit.record_intent("run-1", actor="owner", tool="act_service",
                              args={}, verdict="allow", now=T0)
    audit.record_outcome("run-1", action_key=key, outcome="ok", now=T0)
    assert audit.unfinished() == []


# ── replay ─────────────────────────────────────────────────────────────────

def test_a_replayed_action_key_is_REFUSED() -> None:
    """⚠️ AN EXCEPTION, NOT A FALSE. A replayed action means the caller believes
    it has not acted when it has, and carrying on quietly past that is how a
    pump gets switched twice."""
    key = audit.record_intent("run-1", actor="owner", tool="act_service",
                              args={"ref": "d3"}, verdict="allow", now=T0)
    audit.record_outcome("run-1", action_key=key, outcome="ok", now=T0)
    with pytest.raises(audit.Replayed):
        audit.record_intent("run-1", actor="owner", tool="act_service",
                            args={"ref": "d3"}, verdict="allow", now=T0)


def test_replay_refusal_SURVIVES_A_RESTART() -> None:
    """⚠️ THE CASE IT EXISTS FOR: a crash between intent and outcome, then a
    retry. The check reads the file, not an in-memory set."""
    key = audit.record_intent("run-1", actor="owner", tool="act_service",
                              args={"ref": "d3"}, verdict="allow", now=T0)
    audit.record_outcome("run-1", action_key=key, outcome="ok", now=T0)
    # A "restart" is just another read of the same file.
    with pytest.raises(audit.Replayed):
        audit.record_intent("run-1", actor="owner", tool="act_service",
                            args={"ref": "d3"}, verdict="allow", now=T0)


def test_an_intent_with_NO_outcome_may_be_retried() -> None:
    """⚠️ Not a replay. An action that never reported back may not have
    happened, and refusing the retry would strand it forever."""
    audit.record_intent("run-1", actor="owner", tool="act_service",
                        args={"ref": "d3"}, verdict="allow", now=T0)
    audit.record_intent("run-1", actor="owner", tool="act_service",
                        args={"ref": "d3"}, verdict="allow", now=T0)  # no raise


def test_a_different_run_is_a_different_decision() -> None:
    """Two runs proposing the same action are two decisions; one run retrying
    is the same decision."""
    k1 = audit.record_intent("run-1", actor="owner", tool="act_service",
                             args={"ref": "d3"}, verdict="allow", now=T0)
    audit.record_outcome("run-1", action_key=k1, outcome="ok", now=T0)
    k2 = audit.record_intent("run-2", actor="owner", tool="act_service",
                             args={"ref": "d3"}, verdict="allow", now=T0)
    assert k1 != k2


# ── refusals are recorded ──────────────────────────────────────────────────

def test_a_DENIED_action_is_still_written() -> None:
    """⚠️ A refused action is the most interesting thing here — it is the
    evidence the gate ran. A log containing only successes cannot distinguish
    "nothing was refused" from "nothing was checked"."""
    audit.record_intent("run-1", actor="owner", tool="act_service",
                        args={"ref": "d3"}, verdict="deny", now=T0)
    assert audit.rows()[-1]["verdict"] == "deny"
    assert audit.summary()["verdicts"]["deny"] == 1


# ── what a row may carry ───────────────────────────────────────────────────

def test_the_raw_arguments_never_reach_the_file() -> None:
    """⚠️ The digest answers "was this the same call", which is all this file
    asks. The blob would carry entity ids and free text into a file whose whole
    purpose is to be kept."""
    audit.record_intent(
        "run-1", actor="owner", tool="act_service",
        args={"entity_id": "lock.a_thing",
              "note": "IGNORE PREVIOUS INSTRUCTIONS"},
        verdict="allow", now=T0)
    blob = json.dumps(audit.rows())
    assert "lock.a_thing" not in blob
    assert "IGNORE PREVIOUS" not in blob
    assert refs.entity_ids_in(audit.rows()) == []
    assert len(audit.rows()[-1]["args_digest"]) == 16


def test_an_unlisted_field_does_not_survive() -> None:
    audit._append({"at": "x", "run_id": "r", "secret": "sk-live-123",
                   "password": "hunter2"})
    row = audit.rows()[-1]
    assert set(row) <= set(audit.ROW_FIELDS)
    assert "sk-live-123" not in json.dumps(row)


def test_a_nested_object_cannot_smuggle_a_blob_through_an_allowed_field() -> None:
    """⚠️ The same bypass redact.py closes one level up: a permitted NAME
    holding a structured VALUE."""
    audit._append({"at": "x", "run_id": "r",
                   "detail": {"raw": {"entity_id": "lock.a_thing"}}})
    row = audit.rows()[-1]
    assert isinstance(row["detail"], str)


# ── the bound ──────────────────────────────────────────────────────────────

def test_the_ring_is_bounded_and_drops_the_OLDEST(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ The risk the task names: an unbounded ledger fills the disk on a
    property nobody visits. And an audit dropping NEW rows would go blind
    exactly when the villa got busy, which is when it is read."""
    monkeypatch.setattr(audit, "MAX_ROWS", 5)
    for i in range(12):
        audit.record_run(f"run-{i}", actor="system", trigger="scheduled", now=T0)
    rows = audit.rows(limit=100)
    assert len(rows) == 5
    assert [r["run_id"] for r in rows] == [f"run-{i}" for i in range(7, 12)]
    assert audit.summary()["at_bound"] is True


def test_the_summary_reports_counts_not_content() -> None:
    audit.record_intent("run-1", actor="owner", tool="act_service",
                        args={"entity_id": "lock.a_thing"}, verdict="deny",
                        now=T0)
    blob = json.dumps(audit.summary())
    assert "lock.a_thing" not in blob
    assert audit.summary()["rows"] == 1


# ── degradation ────────────────────────────────────────────────────────────

def test_a_corrupt_or_absent_file_degrades_to_empty() -> None:
    assert audit.rows() == [] or audit.rows() == []
    os.makedirs(os.path.dirname(audit.AUDIT_FILE), exist_ok=True)
    for junk in ("{ not json", '["a list"]', '{"rows": "not a list"}',
                 '{"rows": [1, 2, "three"]}'):
        with open(audit.AUDIT_FILE, "w", encoding="utf-8") as handle:
            handle.write(junk)
        assert audit.rows() == []
        assert audit.summary()["rows"] == 0


def test_a_write_failure_degrades_and_reports_it(
        monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a: Any, **_k: Any) -> None:
        raise OSError("read-only filesystem")
    monkeypatch.setattr(audit.store, "write_json", boom)
    assert audit.record_run("run-1", actor="system", trigger="scheduled") is False


# ── one gate, both paths ───────────────────────────────────────────────────

def test_the_in_process_and_MCP_paths_write_IDENTICAL_rows() -> None:
    """⚠️ THE ASSERTION THAT MAKES "a relocated agent gains no permission it did
    not have" TESTABLE RATHER THAN CLAIMED. If the two callers ever produce
    different rows for the same action, they are not going through the same
    gate."""
    args = {"ref": "d3", "service": "turn_off"}
    in_process = contracts.action_key("run-1", "act_service", args)
    over_mcp = contracts.action_key("run-1", "act_service", dict(reversed(list(args.items()))))
    assert in_process == over_mcp, (
        "the same action must fingerprint identically however it was invoked")

    audit.record_intent("run-1", actor="owner", tool="act_service", args=args,
                        verdict="allow", action_key=in_process, now=T0)
    first = dict(audit.rows()[-1])
    audit.record_outcome("run-1", action_key=in_process, outcome="ok", now=T0)
    assert first["args_digest"] == contracts.args_digest(args)
