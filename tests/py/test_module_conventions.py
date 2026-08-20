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
MODULE_DIR = os.path.join(
    REPO_ROOT, "rootfs", "usr", "bin", "reports", "analysis", "modules")


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
