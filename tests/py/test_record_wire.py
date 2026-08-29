"""The record's field names cross a process boundary, so they are pinned.

⚠️ /dry-audit Part 5, shape (a), found 2026-08-30 — the run after the record
shipped. Its keys are written by THREE Python writers, stored as JSON, served
over HTTP and read by a TypeScript client, and nothing checked the pair. That
is the store-envelope-key defect one level down, and its failure mode is the
same one: a client key the writers never emit does not crash — it renders
EMPTY, which on this screen is indistinguishable from "nothing happened".

⚠️ THE APPLICABLE SET IS DERIVED FROM BOTH SIDES, NEVER LISTED HERE. A test
naming today's ten keys is `grep -l` wearing a test's clothes: the eleventh is
added by whoever writes the fourth writer, and this file must cover it on the
day it is written.
"""
from __future__ import annotations

import os
import re
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: Every module that WRITES a record entry. ⚠️ Derived by grep, not trusted to
#: this list: the assertion below fails if a writer appears that is not here,
#: so the list cannot silently go stale.
WRITERS = (
    ("vesta", "adapters", "collect.py"),
    ("vesta", "supervise", "agent", "scheduler.py"),
    ("vesta", "supervise", "agent", "tools", "concern.py"),
    ("vesta", "adapters", "record.py"),
)
CLIENT = os.path.join(REPO_ROOT, "src", "vesta", "brief", "reportsApi.ts")


def _py(*parts: str) -> str:
    with open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", *parts),
              encoding="utf-8") as fh:
        return fh.read()


def _written_keys() -> Set[str]:
    """Keys any writer puts into a record entry."""
    keys: Set[str] = set()
    for parts in WRITERS:
        src = _py(*parts)
        # `record_mod.append({...})` bodies, plus `row["key"] =` assignments
        for block in re.findall(r"append\(\{(.*?)\}\)", src, re.S):
            keys |= set(re.findall(r'"([a-z_]+)":', block))
        keys |= set(re.findall(r'row\["([a-z_]+)"\]\s*=', src))
        keys |= set(re.findall(r'\.setdefault\("([a-z_]+)"', src))
    return keys


def _client_keys() -> Set[str]:
    with open(CLIENT, encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("export async function fetchRecord")
    end = src.index("export async function deleteRecordEntry")
    # ⚠️ `[A-Za-z_]+`, NEVER `[a-z_]+` — the symbol-truncation trap /dry-audit
    # step 7 names (`signedArea2` read as unused, `useModalA11y` as
    # `useModalA`). With the lowercase class, renaming `row.fidelity` to
    # `row.fidelityLevel` still PARSED as "fidelity", so the orphan check
    # passed on a client reading a key nobody writes. Found by mutation, not
    # by review — the pin was measuring a prefix.
    return set(re.findall(r"row\.([A-Za-z_]+)", src[start:end]))


def test_every_key_the_browser_reads_is_written_by_somebody() -> None:
    written, read = _written_keys(), _client_keys()

    # ⚠️ VACUOUS-PASS GUARDS on both sides: two empty sets satisfy any subset
    # assertion, which is how a source-reading pin reports health forever.
    assert len(written) >= 8, f"only parsed {sorted(written)} from the writers"
    assert len(read) >= 8, f"only parsed {sorted(read)} from the client"

    orphans = sorted(read - written)
    assert not orphans, (
        f"the browser reads {orphans}, which no writer emits — those fields "
        "render EMPTY, and an empty row on this screen is indistinguishable "
        "from a period in which nothing happened")


def test_the_writers_are_all_declared_here() -> None:
    """⚠️ A FOURTH WRITER MUST NOT BE INVISIBLE TO THIS FILE. Anything calling
    `record.append` is a writer; if one exists that WRITERS does not name, the
    key check above is measuring a subset and would pass while the new writer's
    keys went unpinned."""
    declared = {parts[-1] for parts in WRITERS}
    found = set()
    for dirpath, _dirs, files in os.walk(
            os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")):
        if "__pycache__" in dirpath:
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
                body = fh.read()
            if re.search(r"record(_mod)?\.append\(", body):
                found.add(name)
    assert found, "no record writer found at all — the anchor has moved"
    assert found <= declared, (
        f"these write to the record and are not declared in WRITERS: "
        f"{sorted(found - declared)}")


def test_the_id_pair_that_prevents_double_counting_is_written_by_both_sides() -> None:
    """⚠️ `subject_key` IS THE JOIN, AND IT IS WRITTEN IN TWO PLACES — the
    triage flag and the concern that resolves it. If either stops writing it,
    the briefing silently counts one story twice; nothing else would notice,
    because both rows render perfectly well on their own."""
    triage = _py("vesta", "supervise", "agent", "scheduler.py")
    concern = _py("vesta", "supervise", "agent", "tools", "concern.py")
    assert '"subject_key"' in triage, "the triage writer dropped the join key"
    assert '"subject_key"' in concern, "the concern writer dropped the join key"
    assert "subject_key(" in triage or "_subject_key_of" in triage, (
        "the flag's key is no longer computed from the shared hash — a "
        "hand-spelled copy is how the two sides stop matching")


def test_both_sides_group_repeated_firings_rather_than_listing_them() -> None:
    """⚠️ ONE RULE, TWO LANGUAGES, PINNED AS A PAIR (2026-08-30, owner: "without
    this we see a very long list of automations that triggered and it's not
    user friendly"). A motion light fires dozens of times a day; one line per
    firing makes both the tablet's list and the briefing unreadable.

    The SPA cannot call the composer, so the rule genuinely exists twice — which
    is exactly the shape Part 5 exists to hold together. What is asserted is
    that neither side has quietly gone back to listing: each must group and each
    must SUM the figures rather than sample one firing's, because "0.3 kWh"
    printed beside "14 times" is wrong by a factor of fourteen.
    """
    composer = _py("vesta", "supervise", "agent", "compose.py")
    with open(os.path.join(REPO_ROOT, "src", "vesta", "brief", "components",
                           "RecordTab.tsx"), encoding="utf-8") as fh:
        tab = fh.read()

    assert "tally" in composer and 'held["times"] += 1' in composer, (
        "the composer lists every firing again instead of grouping by automation")
    # ⚠️ THE CALL, NOT THE NAME. Asserting `"sumFigures" in tab` passed when the
    # function was renamed `sumFiguresUnused` — a substring match on a symbol,
    # the same trap this file's own client parser was fixed for one commit
    # earlier. A name proves a definition exists; only a call proves it runs.
    assert "held.times += 1" in tab, (
        "the tablet lists every firing again instead of grouping")
    assert "sumFigures(held, row)" in tab, (
        "the tablet no longer sums a grouped row's figures — one firing's "
        "number beside a count is wrong by the size of the count")

    for side, src in (("composer", composer), ("tablet", tab)):
        assert "kwh" in src and "cost_local" in src, (
            f"the {side} stopped carrying the blueprint's own figures")
