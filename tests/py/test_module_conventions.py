"""A shared helper must have exactly one definition, and modules must use it.

⚠️ THESE TESTS READ SOURCE TEXT, NOT BEHAVIOUR, AND THAT IS THE POINT. A second
copy of a helper passes every behavioural test there is — it does the same
thing, which is precisely why it was copied. What it breaks is the next change:
one copy gets it and the other does not, and nothing anywhere fails. That is
`feedback_audit-applicable-set`, twice paid for in the SPA and once here.

Found by /dry-audit on 2026-08-20: `_label_for` existed byte-identically in
`standby_creep` AND `level_anomaly`, while `sensor_health` imported the
underscore-prefixed one out of `level_anomaly` — a private name crossing a
module boundary, which is the tell that a helper has no home. Three readers,
two definitions, no owner.

⚠️ THE APPLICABLE SET IS `analysis/modules/*.py`, NOT A LIST OF FILENAMES. A
module added tomorrow is covered without anyone remembering to add it here —
listing the files would rebuild the very bug these tests exist to catch.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Tuple

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# ⚠️ TWO ROOTS WHILE TASK-115 IS IN FLIGHT. The shared layer moved to
# vesta/ and the rest has not yet; every walker here must cover BOTH or the
# moved half silently leaves the applicable set — the exact under-roll this
# suite exists to catch. Collapses to one root when the move completes.
PACKAGE_DIR = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports")
VESTA_DIR = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
MODULE_DIR = os.path.join(VESTA_DIR, "shared", "analysis", "modules")


def _package_sources() -> List[Tuple[str, str]]:
    """Every .py in the reports package, as (repo-relative path, source).

    Wider than `_modules()` on purpose: the two rules below are about the
    PACKAGE, and both were broken outside `analysis/modules/`.
    """
    out: List[Tuple[str, str]] = []
    for pkg_root in (PACKAGE_DIR, VESTA_DIR):
      for root, _dirs, files in os.walk(pkg_root):
        if "__pycache__" in root:
            continue
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            full = os.path.join(root, name)
            with open(full, encoding="utf-8") as handle:
                out.append((os.path.relpath(full, REPO_ROOT), handle.read()))
    assert out, "no package sources found - the walk or the path is wrong"
    return out


def _modules() -> List[Tuple[str, str]]:
    """Every analysis module, as (filename, source). Never a hardcoded list."""
    out: List[Tuple[str, str]] = []
    for name in sorted(os.listdir(MODULE_DIR)):
        if not name.endswith(".py") or name == "__init__.py":
            continue
        with open(os.path.join(MODULE_DIR, name), encoding="utf-8") as handle:
            out.append((name, handle.read()))
    assert out, "no analysis modules found — the glob or the path is wrong"
    return out


def _strip_comments(source: str) -> str:
    """Drop whole-line comments so prose ABOUT a rule is not read as a USE.

    Three of eight /dry-audit hits on 2026-08-19 were exactly this mistake.
    """
    return "\n".join(
        line for line in source.splitlines()
        if not line.lstrip().startswith("#"))


def test_label_for_has_exactly_one_definition() -> None:
    """`analysis/base.py` owns it; no module may define its own.

    The label is what reaches the reader INSTEAD of an entity id, so a second
    copy is not merely untidy — it is a second place the privacy fallback can
    drift.
    """
    offenders: Dict[str, int] = {}
    for name, source in _modules():
        hits = len(re.findall(r"^def _?label_for\(", source, re.MULTILINE))
        if hits:
            offenders[name] = hits
    assert not offenders, (
        f"label_for is defined inside {sorted(offenders)}; it lives in "
        f"analysis/base.py and is imported. A helper needed by more than one "
        f"module belongs to neither of them.")


def test_no_module_imports_a_private_name_from_a_sibling() -> None:
    """A `_name` crossing a module boundary means the helper has no home.

    This is the signal that preceded the duplication above: `sensor_health`
    reached into `level_anomaly` for `_label_for` rather than either module
    admitting the thing was shared.
    """
    offenders: List[str] = []
    for name, source in _modules():
        for line in _strip_comments(source).splitlines():
            match = re.match(r"from \.(\w+) import (.+)", line.strip())
            if match and any(part.strip().startswith("_")
                             for part in match.group(2).split(",")):
                offenders.append(f"{name}: {line.strip()}")
    assert not offenders, (
        "a private name is being imported across sibling modules — promote it "
        f"to analysis/base.py instead:\n  " + "\n  ".join(offenders))


def test_no_module_derives_its_own_timezone() -> None:
    """`context.zone` is the one answer to "which zone do days bucket in".

    ⚠️ GETTING THIS WRONG IS SILENT. `getattr(ctx.now_local, "tzinfo", None)`
    returning None does not raise — it buckets every reading in UTC, which is a
    DIFFERENT SET OF DAYS, shifting readings across boundaries and quietly
    changing what "yesterday" contains. The scheduler already cost a release to
    exactly that shape of mistake (`"timezone": ""` commented "ask Home
    Assistant", and nothing asked).
    """
    offenders: List[str] = []
    for name, source in _modules():
        for number, line in enumerate(_strip_comments(source).splitlines(), 1):
            if "tzinfo" in line:
                offenders.append(f"{name}:{number}: {line.strip()}")
    assert not offenders, (
        "a module is deriving its own timezone; read `context.zone`:\n  "
        + "\n  ".join(offenders))


def test_every_module_resolves_thresholds_through_the_one_order() -> None:
    """No module may read `settings` directly for a numeric threshold.

    `resolve_threshold` owns the precedence — operator annotation, then a value
    learned from the equipment's own history, then a DIMENSIONLESS default. A
    bare `settings.get("sigma")` skips the learned step, which is the step that
    makes a module portable to a property whose equipment is nothing like this
    one's.
    """
    offenders: List[str] = []
    for name, source in _modules():
        for number, line in enumerate(_strip_comments(source).splitlines(), 1):
            if re.search(r"settings\.get\(|settings\[", line):
                offenders.append(f"{name}:{number}: {line.strip()}")
    assert not offenders, (
        "a module is reading settings directly; use resolve_threshold:\n  "
        + "\n  ".join(offenders))


def test_the_severity_ORDER_has_exactly_one_implementation() -> None:
    """`contracts.severity_rank` is the only reader of `SEVERITY`'s order.

    ⚠️ THE DECLARATION'S OWN COMMENT PROMISED THIS AND THE CODE DID NOT KEEP IT.
    It says the order is meaningful and to "INSERT IN PLACE rather than
    appending" — while `pipeline` carried `rank = {"info": 0, ...}` and
    `aggregate` carried `_SEVERITY_ORDER = (...)`. Inserting a level would have
    left both stale, so the instruction was unfollowable as written. The second
    copy was added the same day the first was found, which is how fast this
    reappears. Found by /dry-audit 2026-08-21.
    """
    offenders: List[str] = []
    for path, source in _package_sources():
        if path.endswith("contracts.py"):
            continue
        for number, line in enumerate(_strip_comments(source).splitlines(), 1):
            # ⚠️ AN ORDERING IS A TABLE OR A SEQUENCE, NOT A CHOICE. The first
            # cut flagged any line naming two levels, which caught
            # `severity="warning" if rise >= x else "notice"` in two modules —
            # a conditional PICK between two levels, which says nothing about
            # their order and is exactly what a module should be doing.
            if re.search(r'"(?:info|notice|warning|critical)"\s*:\s*\d', line) \
               or re.search(r'"(?:info|notice|warning|critical)"\s*,\s*'
                            r'"(?:info|notice|warning|critical)"', line):
                offenders.append(f"{path}:{number}: {line.strip()}")
    assert not offenders, (
        "a severity ORDER is written out here; call contracts.severity_rank:\n  "
        + "\n  ".join(offenders))


def test_the_day_key_format_is_parsed_only_by_its_owner() -> None:
    """`series.py` produces day keys with `day_key`, so it parses them too.

    ⚠️ A FORMAT IS AN INVARIANT BETWEEN A PRODUCER AND ITS READERS, and this one
    had no single reader: `weekday_of`, `pipeline._span_days` and
    `sensor_health._days_between` each carried their own
    `strptime(day, "%Y-%m-%d")`, so changing `day_key`'s output would have
    broken two modules silently.

    What each caller DOES with the parsed date is not shared and must not be —
    an inclusive window span and an exclusive day gap are different questions,
    with different answers when the input is unparseable.
    """
    offenders: List[str] = []
    for path, source in _package_sources():
        if path.endswith(os.path.join("analysis", "series.py")):
            continue
        for number, line in enumerate(_strip_comments(source).splitlines(), 1):
            # ⚠️ PARSING ONLY. `schedule.period_key` FORMATS `%Y-%m-%d` for a
            # daily period's idempotency key — a different question that happens
            # to share a format for one of its three cadences, and a producer
            # rather than a reader. The first cut of this pin flagged it, which
            # would have converged two things that are deliberately separate.
            if "strptime" in line:
                offenders.append(f"{path}:{number}: {line.strip()}")
    assert not offenders, (
        "the day-key format is parsed outside series.py; use parse_day:\n  "
        + "\n  ".join(offenders))





# ⚠️ `test_reports_never_imports_agent` MOVED TO `test_layering.py` (TASK-115,
# 2026-08-28). It guarded ONE edge — reports must not import agent — and that
# edge is now one cell of a five-layer lattice checked module by module, with
# the same ast-walk approach and the same vacuous-pass guard. Deleted rather
# than kept alongside: two owners of one boundary is how they drift, and the
# lattice strictly contains this pin (mutation-verified: a reports→agent import
# still goes red there). The prose worth keeping travelled with it — the chat
# wiring is where the boundary was nearly lost, and `Collector.on_event` is
# the callback that saved it.

# ⚠️ THREE PINS LEFT WITH TASK-071 (2026-08-27):
# test_aggregates_category_tables_use_real_contract_values,
# test_a_groups_display_name_has_one_derivation and
# test_a_groups_members_are_read_through_one_accessor all pinned internals of
# `reports/aggregate.py`, deleted with the blueprint-event taxonomy it parsed.
