"""The As-Built authority document cannot go stale — the pin (2026-08-30).

⚠️ THE OWNER'S RULING, after four review rounds each caught the patched HLD
lying: the authority document must be "the exact ground truth of what we have
coded", so `docs/tools/build_asbuilt.py` INTROSPECTS every table from the code and
this file holds it to that. A table that comes back empty is the classic
silent-instrument failure — a document that renders beautifully while
describing nothing — so every one is guarded, and a handful of spot equalities
tie the document's data layer to the live modules it claims to read.

⚠️ SKIPS WHEN docs/ IS ABSENT: the tree is gitignored by design (ADR-018), so
a fresh clone has no generator and that is not a failure — the same shape as
`test_task_loop`'s blueprint skip.
"""
from __future__ import annotations

import importlib.util
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEN = os.path.join(REPO_ROOT, "docs", "tools", "build_asbuilt.py")

if not os.path.isfile(GEN):
    pytest.skip("docs/ is gitignored and absent here", allow_module_level=True)

sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
spec = importlib.util.spec_from_file_location("build_asbuilt", GEN)
asbuilt = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(asbuilt)


def test_every_introspected_table_is_populated() -> None:
    f = asbuilt.facts()
    for key in ("loops", "checks", "acts", "reason_tools", "agent_defaults",
                "depth", "report_defaults", "bands", "roles", "severity",
                "skip_reasons", "routes", "stores"):
        assert f.get(key), (
            f"facts()[{key!r}] is empty — the document would render a heading "
            "over nothing, which is exactly the silent staleness this "
            "generator exists to end")
    assert f["version"] and f["version"][0].isdigit(), "no add-on version read"
    assert f["journal_max"] > 0 and f["salience"]["min_samples"] > 0


def test_the_document_reads_the_live_modules_not_a_copy() -> None:
    """Spot equalities: if these drift, facts() is transcribing, not reading."""
    from vesta.brief.registry import registered
    from vesta.supervise.agent.actions import ACTS
    from vesta.supervise.agent.config import DEFAULTS

    f = asbuilt.facts()
    assert [c["name"] for c in f["checks"]] == [m.name for m in registered()]
    assert [a[0] for a in f["acts"]] == [a.id for a in ACTS]
    assert f["agent_defaults"] == dict(DEFAULTS)
    assert ("GET", "/agent-config") in f["routes"], (
        "the route parse no longer finds the agent surface")


def test_the_pdf_builds(tmp_path) -> None:
    out = asbuilt.build(str(tmp_path / "asbuilt.pdf"))
    # ⚠️ RECALIBRATED after the owner rejected the 2-page first edition: the
    # expanded document measures ~17 KB over 6 pages; an empty shell ~2 KB.
    # The floor sits at the midpoint of "skeleton" (~9 KB, the rejected
    # edition) and the real one, so a regression to bare tables goes red.
    assert os.path.getsize(out) > 13_000, (
        "the PDF built but has collapsed back toward the rejected skeleton")
