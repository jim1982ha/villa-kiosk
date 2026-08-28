"""The briefing's present tense — and the ways it can quietly stop agreeing.

⚠️ ADDING A SECTION IS NOT ADDING A FACT. The first render of this one printed
"No automated checks are configured yet, so nothing has been assessed" directly
above a list of eight things that were wrong, under a title marked with a green
tick — because `_found_anything` and `_worst` judge the report as a whole and
neither had been taught about standing state. One message contradicting itself
in two places, which is the exact failure the whole exercise is about, committed
while fixing it. Both are pinned below.
"""

from __future__ import annotations

import json
import os
import re
import struct
import sys
import tempfile
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.adapters import model as model_mod
from vesta.brief import standing as standing_mod
from vesta.supervise.agent import fallback as agent_fallback
from vesta.brief.narrate import ReportContext
from vesta.shared.style import BULLET                    # noqa: E402
from vesta.shared.style import SECTION_MARK               # noqa: E402

FIXTURES = os.path.join(REPO_ROOT, "tests", "consistency", "fixtures")


def _rows(fixture: str = "both") -> List[Dict[str, Any]]:
    with open(os.path.join(FIXTURES, f"{fixture}.json"), encoding="utf-8") as fh:
        fx = json.load(fh)
    config = dict(fx["deviceConfig"])
    config["resolvedRooms"] = fx.get("resolvedRooms") or {}
    items = standing_mod.build(fx["states"], config, fx["fmData"],
                               fx["meshEntityIds"])
    return [{"kind": i.kind, "title": i.title, "detail": i.detail, "room": i.room}
            for i in items]


def _context(standing: List[Dict[str, Any]], audience: str = "owner") -> ReportContext:
    return ReportContext(
        audience=audience, cadence="daily", period="2026-08-21",
        generated_at="2026-08-21T16:00:00+08:00",
        discovery={"reachable": True, "capabilities": [], "capabilities_missing": [],
                   "capability_absent": {}, "preflight": []},
        standing=standing)


# ── the report must not contradict itself ────────────────────────────────────

def test_a_brief_with_standing_state_has_found_something() -> None:
    """⚠️ RE-POINTED AT THE NEW COMPOSER (TASK-073). The property is the one
    the 2.530.0 defect paid for — a brief must never announce emptiness above
    a list of problems — and it belongs to whoever writes the brief, which is
    `agent/fallback.brief` now."""
    rows = _rows()
    assert rows, "the `both` fixture is supposed to be full of problems"
    body = agent_fallback.brief(standing=rows).text
    assert "Nothing needs your attention" not in body, (
        "the brief announced it had found nothing directly above a list of "
        "what it found")
    assert "need attention right now" in body


def test_a_clean_villa_still_reads_as_clean() -> None:
    """The mirror, and the easier half to break: an empty standing list must
    not start colouring healthy briefs with a section a reader learns to
    skip."""
    body = agent_fallback.brief(standing=[]).text
    assert "Nothing needs your attention" in body
    assert "Needs attention right now" not in body


def test_only_the_danger_kinds_reach_critical() -> None:
    """An overdue schedule must not paint the brief the same colour as a leak.
    ⚠️ AND THE SPLIT COMES FROM `standing.DANGER_KINDS`, which the kiosk's
    `villaHealthFrom` also expresses — a second opinion here would put the
    tablet on red and the notification on amber for one villa."""
    # ⚠️ THE RENDER HALF OF THIS TEST DIED WITH ITS RENDERER (TASK-073) — the
    # title-marker glyphs were the old document's; what survives is the table
    # agreement the kiosk still depends on.
    # ⚠️ THIS USED TO ASSERT IDENTITY ON A NAME THE RENDERER NO LONGER USES.
    # P4 switched the call to `severity_of`, orphaning the `DANGER_KINDS` import
    # — and this line kept it alive, so a test was the only reason a dead import
    # survived. What matters is that the two tables agree, which is the property
    # the title marker actually depends on.
    for kind in standing_mod.SEVERITY_OF_KIND:
        assert (standing_mod.severity_of(kind) == "critical") \
            == (kind in standing_mod.DANGER_KINDS), (
                f"{kind} is ranked and coloured differently")


# ── the section itself ───────────────────────────────────────────────────────

def test_every_kind_the_builder_emits_reaches_the_page() -> None:
    """⚠️ THE 2.530.0 PROPERTY, RE-PINNED AGAINST THE NEW COMPOSER (TASK-073).
    The old renderer routed each kind through a heading table, and a kind
    missing from it was built, counted, and silently absent from the page.
    `fallback.brief` has no table — every standing row prints — and this pin
    is what notices if a table ever comes back: one row of EVERY kind the
    builder emits, each title required on the page."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "brief",
                               "standing.py"), encoding="utf-8").read()
    emitted = sorted(set(re.findall(r'kind="(\w+)"', source)))
    assert emitted, "could not read the emitted kinds — this test is blind"
    rows = [{"kind": k, "title": f"Thing {i}", "detail": "d", "room": ""}
            for i, k in enumerate(emitted)]
    body = agent_fallback.brief(standing=rows).text
    for i in range(len(emitted)):
        assert f"Thing {i}" in body, (
            f"kind {emitted[i]!r} was built and never printed")


def test_standing_leads_the_brief() -> None:
    """The old rule "every audience sees standing first" survives its renderer:
    the standing section must come before concerns and findings on the page."""
    body = agent_fallback.brief(
        standing=[{"kind": "alarm", "title": "STANDROW", "detail": "", "room": ""}],
        concerns=[{"title": "CONCROW", "severity": "warning"}],
        findings=[{"label": "FINDROW", "detail": ""}]).text
    assert body.index("STANDROW") < body.index("CONCROW") < body.index("FINDROW")


# ── the privacy boundary ─────────────────────────────────────────────────────

def test_the_subject_never_crosses_into_the_renderer() -> None:
    """⚠️ `Item.subject` CARRIES AN ENTITY ID. It is what P3 deduplicates on and
    is server-side only; the rows the renderer receives are built without it, so
    "the data is not there" rather than "the filter is careful" — the same rule
    that makes `dedup_key` hash its subject and `Finding` carry no entity field.
    """
    pipeline = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "brief",
                                 "pipeline.py"), encoding="utf-8").read()
    builder = re.search(r'return \[\{"kind": i\.kind.*?\]', pipeline, re.DOTALL)
    assert builder, "the standing row builder moved — this test is blind"
    assert "subject" not in builder.group(0)
    assert "entity_id" not in builder.group(0)
    for row in _rows():
        assert "subject" not in row and "entity_id" not in row


# ── reading mesh names out of the model ──────────────────────────────────────

def _glb(gltf: Dict[str, Any]) -> bytes:
    body = json.dumps(gltf).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)     # glTF requires 4-byte chunks
    return (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(body))
            + struct.pack("<II", len(body), 0x4E4F534A) + body)


def test_mesh_names_that_are_entity_ids_are_read() -> None:
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as fh:
        fh.write(_glb({"nodes": [
            {"name": "light.kitchen"},
            {"name": "cover.blind__open"},          # a pose variant
            {"name": "Structure_L1_primitive3"},    # a wall
            {"name": "Wall_2_2"},
            {"name": "NotAnEntity"},
            {"name": "LIGHT.SHOUTY"},               # not lower-case: not one
        ], "meshes": [{"name": "lock.front"}]}))
        path = fh.name
    try:
        assert model_mod.mesh_entity_ids(path) == [
            "cover.blind", "light.kitchen", "lock.front"]
    finally:
        os.unlink(path)


def test_no_model_is_an_answer_not_a_failure() -> None:
    """⚠️ A FRESH INSTALL HAS NO MODEL. Empty must fall back to the entity map
    alone — which is exactly what the kiosk does — rather than read as an
    error."""
    assert model_mod.mesh_entity_ids("/nonexistent/villa.glb") == []
    assert model_mod.model_present("/nonexistent/villa.glb") is False


def test_a_file_that_is_not_a_glb_is_refused_quietly() -> None:
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as fh:
        fh.write(b"this is not a GLB at all, not even close")
        path = fh.name
    try:
        assert model_mod.mesh_entity_ids(path) == []
    finally:
        os.unlink(path)



