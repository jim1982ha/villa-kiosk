"""The villa memory store. TASK-093, TEST-032, TEST-033.

⚠️ THE FOUR RULES IN `memory.py`'s DOCSTRING ARE WHAT THIS FILE PINS, and each
of them guards a failure that is INVISIBLE once it happens: a wrong claim is
re-asserted into every future prompt, and nothing in the output says "this came
from a memory". A test suite that only checked round-tripping would pass while
the store quietly poisoned every report.
"""

from __future__ import annotations

import ast
import os
import sys
import time

import pytest

#: ⚠️ THREE `dirname`s: this file is `<repo>/tests/py/…`. Two resolves to
#: `<repo>/tests`, and the resulting `rootfs/usr/bin` does not exist — which is
#: SILENT, because `conftest.py` has already put the real one on `sys.path`, so
#: the import succeeds and only a path built from this constant is wrong. That
#: is how the first version of the wiring test below "proved" the shipped
#: playbooks were missing from a prompt that contained them.
REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import memory as memory_mod  # noqa: E402

DAY = 86400.0
NOW = 1_760_000_000.0
SOURCE = "concern/01J9XABCDEF"
KEY = "a7f3c21e9b04d5f8"
OTHER = "bb01c21e9b04d5f9"


@pytest.fixture()
def root(tmp_path):
    return str(tmp_path / "memory")


# ── rule 1: provenance ──────────────────────────────────────────────────────
def test_a_claim_without_a_SOURCE_is_refused(root) -> None:
    """⚠️ The refusal IS the feature. An unattributed claim cannot be audited,
    re-derived or argued with, and a store of them is indistinguishable from a
    store of hallucinations after a month."""
    assert not memory_mod.write(KEY, claim="the pump runs at dawn", source="",
                                confidence=0.9, root=root, now=NOW)
    assert memory_mod.read(KEY, root=root) is None


def test_a_claim_without_a_CLAIM_is_refused(root) -> None:
    assert not memory_mod.write(KEY, claim="  ", source=SOURCE, root=root)
    assert memory_mod.read(KEY, root=root) is None


def test_a_written_memory_NAMES_its_investigation(root) -> None:
    assert memory_mod.write(KEY, claim="the supply pump runs twice daily",
                            source=SOURCE, confidence=0.8, root=root, now=NOW)
    got = memory_mod.read(KEY, root=root)
    assert got is not None and got.source == SOURCE
    assert got.claim == "the supply pump runs twice daily"
    assert got.learned_at == "2025-10-09"


# ── rule 2: expiry ──────────────────────────────────────────────────────────
def test_a_memory_past_its_review_date_STOPS_being_asserted(root) -> None:
    """⚠️ Without this, a claim true in one month is still being asserted in the
    next. `review_after` is a FIELD, not a policy somebody has to remember."""
    memory_mod.write(KEY, claim="the annexe is unoccupied", source=SOURCE,
                     confidence=0.9, review_days=30, root=root, now=NOW)
    assert memory_mod.read(KEY, root=root).asserted

    assert memory_mod.expire(root=root, now=NOW + 10 * DAY) == []
    assert memory_mod.expire(root=root, now=NOW + 31 * DAY) == [KEY]

    got = memory_mod.read(KEY, root=root)
    assert got.state == "retired"
    assert not got.asserted
    assert KEY not in memory_mod.index(root)


def test_expiry_RETIRES_and_never_deletes(root) -> None:
    """The claim stops being asserted and stays readable — why it was made is
    evidence even after it is stale."""
    memory_mod.write(KEY, claim="the annexe is unoccupied", source=SOURCE,
                     confidence=0.9, review_days=1, root=root, now=NOW)
    memory_mod.expire(root=root, now=NOW + 2 * DAY)
    got = memory_mod.read(KEY, root=root)
    assert got is not None and got.claim == "the annexe is unoccupied"
    assert got.source == SOURCE


# ── rule 3: a human correction outranks ─────────────────────────────────────
def test_a_correction_is_never_OVERWRITTEN_by_re_derivation(root) -> None:
    """⚠️ THE RULE THIS STORE EXISTS FOR. A run that re-derived the same wrong
    conclusion would otherwise silently reinstate what a person overrode — and
    nothing downstream would show that it had happened."""
    memory_mod.write(KEY, claim="the pool pump runs mornings only",
                     source=SOURCE, confidence=0.9, root=root, now=NOW)
    assert memory_mod.correct(KEY, by="owner", text="it runs at night in the "
                              "wet season, deliberately", root=root, now=NOW)

    assert not memory_mod.write(KEY, claim="the pool pump runs mornings only",
                                source="concern/LATER", confidence=0.95,
                                root=root, now=NOW + DAY)
    got = memory_mod.read(KEY, root=root)
    assert got.state == "corrected"
    assert got.source == SOURCE, "re-derivation rewrote a corrected memory"
    assert any("wet season" in c for c in got.corrections)


def test_a_correction_APPENDS_and_keeps_the_original_claim(root) -> None:
    memory_mod.write(KEY, claim="the gate is left open on delivery days",
                     source=SOURCE, confidence=0.9, root=root, now=NOW)
    memory_mod.correct(KEY, by="fm", text="no, that is the cleaner",
                       root=root, now=NOW)
    got = memory_mod.read(KEY, root=root)
    assert got.claim == "the gate is left open on delivery days"
    assert got.corrections and "cleaner" in got.corrections[0]
    assert "fm" in got.corrections[0]


def test_a_corrected_memory_is_EXEMPT_from_expiry(root) -> None:
    """⚠️ Expiry forces the agent to re-derive ITS OWN conclusions. Expiring a
    human's would delete rule 3 after one quarter — quietly, on a timer."""
    memory_mod.write(KEY, claim="the annexe is unoccupied", source=SOURCE,
                     confidence=0.9, review_days=1, root=root, now=NOW)
    memory_mod.correct(KEY, by="owner", text="it is let seasonally",
                       root=root, now=NOW)
    assert memory_mod.expire(root=root, now=NOW + 400 * DAY) == []
    assert memory_mod.read(KEY, root=root).asserted


def test_correcting_a_memory_that_does_not_exist_is_refused(root) -> None:
    assert not memory_mod.correct(KEY, by="owner", text="x", root=root)


def test_corrections_survive_a_rewrite_of_an_UNCORRECTED_memory(root) -> None:
    """A person may annotate without overriding; losing that on the next
    re-derivation would discard the most valuable text in the file."""
    memory_mod.write(KEY, claim="first", source=SOURCE, confidence=0.9,
                     root=root, now=NOW)
    path = memory_mod._path(root, KEY)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\nCorrections:\n- 2026-01-01 (owner): worth noting\n")
    assert memory_mod.read(KEY, root=root).corrections

    memory_mod.write(KEY, claim="second", source=SOURCE, confidence=0.9,
                     root=root, now=NOW)
    got = memory_mod.read(KEY, root=root)
    assert got.claim == "second"
    assert any("worth noting" in c for c in got.corrections)


# ── rule 4: no write path from a tool result ────────────────────────────────
def test_NO_TOOL_can_reach_the_memory_store() -> None:
    """⚠️ THE INJECTION BOUNDARY, ASSERTED STRUCTURALLY RATHER THAN BY POLICY.

    Tool results carry text written by other people — device names, guest fault
    reports, log lines. A write path from there into a store that is re-asserted
    into every future prompt is permanent poisoning by a stranger, and it would
    look exactly like the agent having learned something.

    This walks the imports rather than trusting the absence of a write tool,
    because the defect would arrive as a convenience import in one tool file.
    """
    tools = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent", "tools")
    offenders = []
    for base, _dirs, names in os.walk(tools):
        for name in names:
            if not name.endswith(".py"):
                continue
            with open(os.path.join(base, name), encoding="utf-8") as handle:
                tree = ast.parse(handle.read())
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == "agent":
                    if any(a.name == "memory" for a in node.names):
                        offenders.append(name)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    if node.module.endswith("agent.memory"):
                        offenders.append(name)
                elif isinstance(node, ast.Import):
                    if any(a.name.endswith("memory") for a in node.names):
                        offenders.append(name)
    assert not offenders, (
        f"{offenders} can reach the memory store — a tool result is untrusted "
        f"text and this is a write path into permanent state")


def test_there_is_NO_write_tool_at_all() -> None:
    """The other half: not merely that no tool imports it, but that none of the
    registered tool names offers writing a memory."""
    from agent.tools import ALL_TOOLS
    names = {t.name for t in ALL_TOOLS}
    assert not any("memor" in n for n in names), names


# ── the store's own safety ──────────────────────────────────────────────────
def test_the_subject_key_cannot_TRAVERSE(root) -> None:
    """⚠️ A model chooses this value. `/data/reports-secrets.json` is two
    directories from the memory tree, so the key is validated as the hash it is
    rather than sanitised as a path."""
    for bad in ("../../etc/passwd", "a/b", "..", "", "A" * 200, "not-hex!"):
        assert not memory_mod.write(bad, claim="x", source=SOURCE, root=root)
        assert memory_mod.read(bad, root=root) is None


def test_a_low_confidence_claim_is_HELD_and_not_asserted(root) -> None:
    """⚠️ `proposed` exists so a weak conclusion is visible to a person and
    invisible to the next run. The cost of a wrong asserted memory is paid on
    every future cycle, so the bar is deliberately high."""
    memory_mod.write(OTHER, claim="probably a failing capacitor", source=SOURCE,
                     confidence=0.3, root=root, now=NOW)
    got = memory_mod.read(OTHER, root=root)
    assert got.state == "proposed" and not got.asserted
    assert "capacitor" not in memory_mod.index(root)


def test_the_index_FRAMES_claims_as_claims_and_carries_no_date(root) -> None:
    """⚠️ Two failures in one block. Prose that presents past conclusions as
    established fact is how a guess becomes a premise; and a DATE above the
    cache breakpoint ends prompt caching every day at midnight, with the bill
    as the only symptom."""
    memory_mod.write(KEY, claim="the supply pump runs twice daily",
                     source=SOURCE, confidence=0.9, root=root, now=NOW)
    text = memory_mod.index(root)
    assert "the supply pump runs twice daily" in text
    assert "not established facts" in text
    assert "trust what you can see" in text
    import re
    assert not re.search(r"\d{4}-\d{2}-\d{2}", text), "a date reached the prompt"


def test_a_corrected_claim_is_MARKED_as_outranking_in_the_prompt(root) -> None:
    memory_mod.write(KEY, claim="the pool pump runs mornings only",
                     source=SOURCE, confidence=0.9, root=root, now=NOW)
    memory_mod.correct(KEY, by="owner", text="nights in the wet season",
                       root=root, now=NOW)
    assert "outranks your own reasoning" in memory_mod.index(root)


def test_an_absent_store_yields_an_EMPTY_index_rather_than_raising() -> None:
    """Every fresh install. A villa with no learned claims must build the same
    prompt minus one block, never fail to build one."""
    assert memory_mod.index("/nonexistent/vesta/memory") == ""
    assert memory_mod.all_memories("/nonexistent/vesta/memory") == []


def test_the_memory_index_REACHES_THE_PROMPT(root) -> None:
    """⚠️ THE WIRING, WHICH IS WHAT /dry-audit FOUND MISSING LAST TIME. The
    shipped playbooks were written, CI-gated and loaded by nobody for several
    releases while every test about their CONTENT passed. This asserts the
    learned half is assembled into the prompt, not merely stored."""
    from agent import playbooks
    memory_mod.write(KEY, claim="the supply pump runs twice daily",
                     source=SOURCE, confidence=0.9, root=root, now=NOW)
    shipped = os.path.join(REPO_ROOT, "rootfs", "usr", "share", "vesta",
                           "playbooks")
    text = playbooks.system_prompt("owner", root=shipped, memory_root=root)
    assert "the supply pump runs twice daily" in text
    assert "competent facility manager" in text, "the shipped half went missing"
