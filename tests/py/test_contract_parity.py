"""The Python↔TypeScript contract must not drift.

`reports/contracts.py` is the source of truth and `src/reports/reportsTypes.ts`
mirrors it. Nothing in either language can enforce that: TypeScript types are
erased before runtime, and Python never sees the `.ts` file at all. So the
check is textual, and it runs in CI.

The failure this prevents is SILENT, which is why it is worth a whole test
module. A backend emitting `"critical"` against a frontend union that stops at
`"warning"` does not crash — it renders an unstyled severity or drops the
finding, on a wall-mounted tablet nobody is watching.

⚠️ THIS TEST MUST BE UNABLE TO PASS VACUOUSLY. A regex that stops matching (a
`.ts` reformat, a rename, a moved file) would otherwise report success while
comparing nothing at all — four counters in this project have already read `0`
for exactly the case they existed to measure. `test_parser_finds_every_set`
below is the guard: it fails if any set is missing from the TypeScript side,
which is the same condition a broken parser produces.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Tuple

import pytest

from reports.contracts import CONTRACT_SETS, CONTRACT_VERSION

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TS_PATH = os.path.join(REPO_ROOT, "src", "reports", "reportsTypes.ts")


def _ts_source() -> str:
    with open(TS_PATH, encoding="utf-8") as handle:
        return handle.read()


def _parse_ts_sets(source: str) -> Dict[str, Tuple[str, ...]]:
    """Extract every `export const NAME = [...] as const;` as a tuple.

    Deliberately a narrow regex rather than a TypeScript parser: the alternative
    is a Node toolchain in a Python test, and the declarations it reads are
    written to one fixed shape which this module's docstring in the `.ts` file
    states explicitly. If someone writes one differently, the guard test below
    fails rather than this silently skipping it.
    """
    found: Dict[str, Tuple[str, ...]] = {}
    pattern = re.compile(
        r"export const (?P<name>[A-Z_][A-Z0-9_]*)\s*=\s*\[(?P<body>.*?)\]\s*as const",
        re.DOTALL,
    )
    for match in pattern.finditer(source):
        values = re.findall(r'"([^"]*)"', match.group("body"))
        found[match.group("name")] = tuple(values)
    return found


def test_parser_finds_every_set() -> None:
    """The guard: every Python set must be FOUND in the TypeScript file.

    Fails identically whether the mirror is missing a set or the parser has
    stopped working — both mean the comparison below is not happening, and both
    must stop the build.
    """
    ts_sets = _parse_ts_sets(_ts_source())
    missing = sorted(set(CONTRACT_SETS) - set(ts_sets))
    assert not missing, (
        f"not found in reportsTypes.ts: {missing}. Either the mirror is missing "
        f"these, or the declarations are no longer in the "
        f"`export const NAME = [...] as const;` shape this test can read — in "
        f"which case every other assertion here is passing vacuously."
    )


def test_no_extra_sets_in_typescript() -> None:
    """Drift in the other direction: a set the backend does not know about."""
    ts_sets = _parse_ts_sets(_ts_source())
    extra = sorted(set(ts_sets) - set(CONTRACT_SETS))
    assert not extra, (
        f"declared in reportsTypes.ts but absent from contracts.py: {extra}. "
        f"contracts.py is the source of truth; add it there (and to "
        f"CONTRACT_SETS) or remove it here."
    )


@pytest.mark.parametrize("name", sorted(CONTRACT_SETS))
def test_values_match_exactly(name: str) -> None:
    """Same values, same ORDER.

    Order is not pedantry: SEVERITY is ordered least to most urgent and report
    sections sort by it, so a mirror listing the same four strings differently
    would render a correct report in the wrong order.
    """
    ts_sets = _parse_ts_sets(_ts_source())
    assert name in ts_sets, f"{name} missing from reportsTypes.ts"
    assert ts_sets[name] == CONTRACT_SETS[name], (
        f"{name} differs:\n"
        f"  contracts.py    {list(CONTRACT_SETS[name])}\n"
        f"  reportsTypes.ts {list(ts_sets[name])}"
    )


def test_contract_version_matches() -> None:
    match = re.search(r"export const CONTRACT_VERSION\s*=\s*(\d+)", _ts_source())
    assert match, "CONTRACT_VERSION not declared in reportsTypes.ts"
    assert int(match.group(1)) == CONTRACT_VERSION


def test_payload_allow_list_excludes_identifiers() -> None:
    """The privacy boundary, asserted rather than assumed.

    Phase 6 sends this payload to a third-party LLM. These particular names are
    the ones a future module would most plausibly reach for, and each is barred
    for a stated reason: entity IDs carry room and person names
    (`sensor.bedroom_window`), photographs are evidence of the villa's
    interior, and raw logs carry occupancy patterns.

    Pinned here, not only in review, because the allow-list is one line to edit
    and its consequence is invisible at the diff.
    """
    forbidden = {
        "entity_id", "entity_ids", "entityId",
        "photo", "photos", "photo_ids", "photoIds", "image", "images",
        "user", "users", "person", "presence", "location", "gps",
        "log", "logs", "events", "raw",
        "api_key", "apiKey", "token", "secret", "password",
        "note", "notes", "description", "comment",
    }
    allowed = set(CONTRACT_SETS["PAYLOAD_ALLOWED_FIELDS"])
    leaked = sorted(allowed & forbidden)
    assert not leaked, (
        f"these must never leave the villa but are in the payload allow-list: "
        f"{leaked}"
    )


def test_severity_order_is_ascending_urgency() -> None:
    """The one set whose ORDER carries meaning, pinned as such."""
    assert CONTRACT_SETS["SEVERITY"] == ("info", "notice", "warning", "critical")


def test_parser_actually_reads_values() -> None:
    """Prove the extractor is not returning empty tuples for everything.

    Without this, a body regex that matched nothing would make every
    `test_values_match_exactly` comparison `() == ()` for a Python set that is
    also empty — impossible today, but the shape of it is exactly how an
    instrument goes blind. Uses a fixture string, not the real file, so it
    tests the PARSER rather than the current contents.
    """
    sample = 'export const THING = ["a", "b"] as const;\nexport type T = 1;'
    parsed: Dict[str, Tuple[str, ...]] = _parse_ts_sets(sample)
    assert parsed == {"THING": ("a", "b")}

    empty: List[str] = sorted(
        name for name, values in _parse_ts_sets(_ts_source()).items() if not values
    )
    assert not empty, f"parsed as empty from reportsTypes.ts: {empty}"
