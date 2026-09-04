"""The record: one ledger, filled the same way whichever way the switch is set.

⚠️ THE OWNER'S DESIGN (2026-08-30). The briefing reads this over its window, and
the Supervision switch is not consulted anywhere in the module — mode
transparency falls out of which sources happen to be writing. These pins hold
the four properties that make it trustworthy: it bounds, it windows, it never
copies a concern's state, and a flag and the concern it became are ONE story.
"""
from __future__ import annotations

import os
import sys
from typing import Any

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.adapters import record, store  # noqa: E402
from vesta.supervise.agent import contracts as agent_contracts  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any) -> Any:
    original = store.RECORD_FILE
    store.RECORD_FILE = str(tmp_path / "record.json")
    yield
    store.RECORD_FILE = original


def test_it_windows_and_never_returns_silence_on_a_bad_bound() -> None:
    """⚠️ AN UNPARSEABLE WINDOW RETURNS EVERYTHING, NOT NOTHING. A briefing that
    cannot read its own bound must be thin-but-honest; an empty section renders
    as "a quiet week", which is the lie this subsystem keeps being caught by."""
    record.append({"source": "agent", "subject": "old"}, now_iso="2026-01-01T00:00:00+00:00")
    record.append({"source": "agent", "subject": "new"}, now_iso="2026-08-30T00:00:00+00:00")

    assert [r["subject"] for r in record.since("2026-06-01T00:00:00+00:00")] == ["new"]
    assert len(record.since("")) == 2, "an empty bound must not silently window to nothing"
    assert [r["subject"] for r in record.since("2026-01-01T00:00:00+00:00",
                                               sources=["agent"])] == ["old", "new"]
    assert record.since("2026-01-01T00:00:00+00:00", sources=["triage"]) == []


def test_it_is_bounded(monkeypatch: Any) -> None:
    """⚠️ A LEDGER WITH NO CEILING IS A DISK THAT FILLS. Same discipline as the
    journal's ring; the newest survive.

    ⚠️ THE BOUND IS LOWERED FOR THE TEST, AND THAT IS THE POINT OF THE PIN, NOT
    A SHORTCUT. Filling the real bound took seven minutes — because `append`
    rewrites the whole file each time, a cost that lands on every automation
    firing in production. The measurement is why MAX_ENTRIES came down from
    20,000 to a number sized from the longest briefing window. What is being
    pinned is the TRIM, which is identical at any ceiling."""
    monkeypatch.setattr(record, "MAX_ENTRIES", 50)
    for i in range(record.MAX_ENTRIES + 25):
        record.append({"source": "automation", "subject": f"a{i}"})
    rows = record.read()
    assert len(rows) == record.MAX_ENTRIES
    assert rows[-1]["subject"] == f"a{record.MAX_ENTRIES + 24}", "the newest were trimmed"
    assert rows[0]["subject"] == "a25", "the trim kept the wrong end"


def test_an_agent_entry_points_at_its_concern_and_never_copies_its_state() -> None:
    """⚠️ `ref` IS A POINTER. If the entry carried `state`/`acknowledged_at`,
    pressing ✅ would leave this ledger contradicting the Reason tab — two
    answers to one question, which is this codebase's most repeated defect."""
    record.append({"source": "agent", "ref": "c17", "subject": "Pool pump",
                   "severity": "warning", "domain": "water"})
    row = record.read()[-1]
    assert row["ref"] == "c17"
    for owned_by_the_concern_store in ("state", "acknowledged_at", "delivered_at",
                                       "acknowledged_by", "outcome_of_concern"):
        assert owned_by_the_concern_store not in row, (
            f"{owned_by_the_concern_store!r} is the concern store's to answer; "
            "a copy here is a second truth that drifts on the first act")


def test_a_flag_and_the_concern_it_became_share_one_key() -> None:
    """⚠️ THIS IS WHAT STOPS DOUBLE COUNTING. The briefing groups by
    `subject_key`; a flag whose concern uses a DIFFERENT key would be counted
    twice, and 2.752.0 measured what a mismatched key costs — a Handover column
    reading 0 by construction."""
    key = agent_contracts.subject_key("sensor.pool_pump_power")
    record.append({"source": "triage", "subject_key": key, "subject": "Pool pump"})
    record.append({"source": "agent", "subject_key": key, "ref": "c17",
                   "subject": "Pool pump"})

    rows = record.since("")
    keys = {r["subject_key"] for r in rows}
    assert len(keys) == 1, "the flag and its concern must group as one story"

    assert record.stamp_outcome(key, "investigated → c17") == 1
    flag = [r for r in record.read() if r["source"] == "triage"][0]
    assert flag["outcome"] == "investigated → c17"


def test_stamping_resolves_the_newest_flag_only() -> None:
    """⚠️ A SUBJECT FLAGGED ON THREE PASSES HAS THREE ENTRIES, and the
    investigation that just finished resolves the flag that raised it — not the
    history. Stamping them all would rewrite what earlier passes did, which is
    the one thing a record exists to preserve."""
    key = agent_contracts.subject_key("sensor.x")
    for _ in range(3):
        record.append({"source": "triage", "subject_key": key, "subject": "x"})
    assert record.stamp_outcome(key, "investigated → c9") == 1
    stamped = [r for r in record.read() if r.get("outcome")]
    assert len(stamped) == 1, "an investigation rewrote earlier passes' history"
    assert record.read()[-1]["outcome"] == "investigated → c9", "the newest was not the one stamped"


def test_the_module_never_consults_the_supervision_switch() -> None:
    """⚠️ MODE TRANSPARENCY IS STRUCTURAL, NOT CONDITIONAL. The record is filled
    the same way in both positions; which SOURCES write is what differs. A
    branch on the switch in here would be the mode leaking into storage."""
    import inspect
    code = "\n".join(ln for ln in inspect.getsource(record).split("\n")
                     if not ln.lstrip().startswith("#"))
    for forbidden in ("supervision_enabled", "agent_config", "mode =="):
        assert forbidden not in code, (
            f"the record consults {forbidden!r} — it must record what arrives, "
            "never decide by mode")


def test_removing_an_entry_is_exact() -> None:
    record.append({"source": "automation", "subject": "keep"},
                  now_iso="2026-08-30T10:00:00+00:00")
    record.append({"source": "automation", "subject": "drop"},
                  now_iso="2026-08-30T11:00:00+00:00")
    assert record.remove("2026-08-30T11:00:00+00:00", "drop") is True
    assert [r["subject"] for r in record.read()] == ["keep"]
    assert record.remove("nope", "drop") is False


# ── tally_automations · one grouping for the brief and the document ─────────

def test_the_tally_groups_sums_and_counts_phases() -> None:
    """⚠️ FIGURES SUMMED, PHASES COUNTED, FIRINGS COUNTED ONCE. An incident
    that opened and later timed out is one firing with two rows."""
    from vesta.adapters import record as record_mod
    rows = [
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "opened"}},
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "timeout"}},
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "opened"}},
        {"source": "automation", "subject": "phase overload",
         "payload": {"phase": "cleared"}},
        {"source": "automation", "subject": "idle load",
         "payload": {"kwh": 0.3, "cost_local": 12}},
        {"source": "automation", "subject": "idle load",
         "payload": {"kwh": 0.4, "cost_local": 10}},
        {"source": "agent", "subject": "not an automation"},
    ]
    tally = record_mod.tally_automations(rows)
    assert set(tally) == {"phase overload", "idle load"}
    assert tally["phase overload"]["times"] == 2
    assert tally["phase overload"]["phases"] == {"opened": 2, "timeout": 1,
                                                 "cleared": 1}
    assert tally["idle load"]["times"] == 2
    assert abs(tally["idle load"]["kwh"] - 0.7) < 1e-9
    assert tally["idle load"]["cost"] == 22 and tally["idle load"]["phases"] == {}


def test_a_rule_that_sends_no_phase_tallies_by_count_alone() -> None:
    from vesta.adapters import record as record_mod
    rows = [{"source": "automation", "subject": "motion light"}] * 14
    assert record_mod.tally_automations(rows)["motion light"]["times"] == 14


def test_an_unknown_phase_is_neither_counted_nor_a_firing() -> None:
    """A payload the blueprint vocabulary does not name is not silently a
    firing; `PHASES` is the contract and `record` is its one reader."""
    from vesta.adapters import record as record_mod
    rows = [{"source": "automation", "subject": "x", "payload": {"phase": "maybe"}}]
    assert record_mod.tally_automations(rows)["x"]["times"] == 0
