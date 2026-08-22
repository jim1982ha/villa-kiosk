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
from agent.contracts import CONTRACT_SETS as AGENT_SETS
from agent.contracts import CONTRACT_VERSION as AGENT_VERSION

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TS_PATH = os.path.join(REPO_ROOT, "src", "reports", "reportsTypes.ts")
AGENT_TS_PATH = os.path.join(REPO_ROOT, "src", "agent", "agentTypes.ts")


def _ts_source() -> str:
    with open(TS_PATH, encoding="utf-8") as handle:
        return handle.read()


def _agent_ts_source() -> str:
    with open(AGENT_TS_PATH, encoding="utf-8") as handle:
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


# ── the agent's own contract, same rules ───────────────────────────────────
#
# ⚠️ A SECOND PAIR, NOT A SECOND MECHANISM. `agent/contracts.py` mirrors
# `src/agent/agentTypes.ts` under exactly the rules above, and reuses this
# module's parser — a second regex would be a second thing to break, and the
# one that broke would pass vacuously.
#
# ⚠️ THE AGENT SETS ARE DELIBERATELY NOT MERGED INTO `CONTRACT_SETS`. Doing so
# would require `reports` to import `agent`, which is the wrong direction:
# `reports` is dismantled in PH-5 and `agent` is what replaces it.


def test_agent_parser_finds_every_set() -> None:
    """The guard, for the agent pair. Fails identically whether the mirror is
    missing a set or the parser has stopped working — both mean nothing below
    is being compared."""
    ts_sets = _parse_ts_sets(_agent_ts_source())
    missing = sorted(set(AGENT_SETS) - set(ts_sets))
    assert not missing, (
        f"not found in agentTypes.ts: {missing}. Either the mirror is missing "
        f"these, or the declarations left the `export const NAME = [...] as "
        f"const;` shape — in which case every assertion below passes vacuously.")


def test_no_extra_sets_in_agent_typescript() -> None:
    ts_sets = _parse_ts_sets(_agent_ts_source())
    extra = sorted(set(ts_sets) - set(AGENT_SETS))
    assert not extra, (
        f"declared in agentTypes.ts but absent from agent/contracts.py: "
        f"{extra}. The Python side is the source of truth.")


@pytest.mark.parametrize("name", sorted(AGENT_SETS))
def test_agent_values_match_exactly(name: str) -> None:
    """Same values, same ORDER. SEVERITY is ordered least to most urgent and
    routing sorts by it, so a differently-ordered mirror would route a correct
    concern wrongly."""
    ts_sets = _parse_ts_sets(_agent_ts_source())
    assert name in ts_sets, f"{name} missing from agentTypes.ts"
    assert ts_sets[name] == AGENT_SETS[name], (
        f"{name} differs:\n"
        f"  agent/contracts.py {list(AGENT_SETS[name])}\n"
        f"  agentTypes.ts      {list(ts_sets[name])}")


def test_agent_contract_version_matches() -> None:
    match = re.search(r"export const AGENT_CONTRACT_VERSION\s*=\s*(\d+)",
                      _agent_ts_source())
    assert match, "AGENT_CONTRACT_VERSION not declared in agentTypes.ts"
    assert int(match.group(1)) == AGENT_VERSION


def test_the_two_severity_scales_are_IDENTICAL() -> None:
    """⚠️ P4 OF THE CONSISTENCY WORK FOUND THREE SEVERITY SCALES WITH NOTHING
    RELATING ANY TWO, and the agent adopting a fourth would reopen it. They are
    declared separately because `agent` must not import `reports` for a constant
    it would then be unable to change independently — so the duplication is
    deliberate and this is what stops it drifting."""
    assert AGENT_SETS["SEVERITY"] == CONTRACT_SETS["SEVERITY"], (
        "the agent and the report pipeline must agree on severity, or the "
        "tablet and the notification can disagree about how bad something is")
    assert AGENT_SETS["AUDIENCE"][:2] == CONTRACT_SETS["AUDIENCE"], (
        "the agent's audiences must EXTEND the report pipeline's, not diverge "
        "from them — it adds `ops`, it does not rename the other two")


def test_the_sender_roles_are_the_APPS_OWN_PROFILES() -> None:
    """⚠️ ONE PERSON, ONE NAME. `agent/contracts` listed the sender roles as
    `("owner", "facility", "ops")`, which named the Facility Manager TWICE —
    `facility` is an AUDIENCE word and `ops` is their profile id — and omitted
    `guest`, which is a real profile. It surfaced as a role picker offering a
    third profile that does not exist anywhere in the app.

    ⚠️ `supervisor-proxy.AUTH_ROLES` IS THE AUTHORITY. It is what the PIN flow
    mints and what every RBAC check compares against; anything else is a copy
    that can drift, and this one did.
    """
    import re

    from agent import contracts as agent_contracts

    proxy = _read(PROXY_PATH) if "PROXY_PATH" in globals() else open(
        os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                     "supervisor-proxy.py"), encoding="utf-8").read()
    match = re.search(r"AUTH_ROLES\s*=\s*\(([^)]*)\)", proxy)
    assert match, "AUTH_ROLES not found; this test is checking nothing"
    auth = tuple(re.findall(r'"([a-z]+)"', match.group(1)))
    assert auth, "AUTH_ROLES parsed empty"
    assert agent_contracts.SENDER_ROLE == auth, (
        f"the agent offers {agent_contracts.SENDER_ROLE} while the app's "
        f"profiles are {auth}")


def test_an_audience_is_NOT_a_role() -> None:
    """⚠️ `reports/contracts.py` states the rule and the agent broke it:
    audiences "are AUDIENCES, not roles … they intentionally do not map
    one-to-one onto `auth/permissions.ts` profiles". The owner may perfectly
    well read the facility brief, which is why neither set may be derived from
    the other — and why `ops` had no business being in the audience list."""
    from agent import contracts as agent_contracts
    from reports import contracts as reports_contracts

    assert agent_contracts.AUDIENCE == reports_contracts.AUDIENCE, (
        "the agent invented its own audience vocabulary")
    assert "ops" not in agent_contracts.AUDIENCE
    assert "facility" not in agent_contracts.SENDER_ROLE
