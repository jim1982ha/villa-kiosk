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

from reports import model as model_mod                      # noqa: E402
from reports import standing as standing_mod                 # noqa: E402
from reports.narrate import DeterministicNarrator, ReportContext  # noqa: E402
from reports.narrate.style import BULLET                    # noqa: E402
from reports.narrate import deterministic as det             # noqa: E402
from reports.narrate.style import SECTION_MARK               # noqa: E402

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
    rows = _rows()
    assert rows, "the `both` fixture is supposed to be full of problems"
    _, body = DeterministicNarrator().render(_context(rows))
    assert "nothing has been assessed" not in body, (
        "the brief announced it had found nothing directly above a list of "
        "what it found")


def test_the_title_marker_reflects_standing_state() -> None:
    """⚠️ THE TITLE IS OFTEN ALL THAT IS READ. A push notification shows it and
    two lines; a chat list shows it alone. A green tick over five offline
    devices is the whole message for most readers."""
    title, _ = DeterministicNarrator().render(_context(_rows()))
    assert title.startswith("\U0001F534"), f"expected a red mark, got {title!r}"


def test_a_clean_villa_still_reads_as_clean() -> None:
    """The mirror, and the easier half to break: an empty standing list must not
    start colouring healthy briefs."""
    title, body = DeterministicNarrator().render(_context([]))
    assert title.startswith("✅")
    assert "Right now" not in body, (
        "a section reading 'nothing is wrong right now' in every healthy brief "
        "is the line a reader learns to skip, and it takes the section with it")


def test_only_the_danger_kinds_reach_critical() -> None:
    """An overdue schedule must not paint the brief the same colour as a leak.
    ⚠️ AND THE SPLIT COMES FROM `standing.DANGER_KINDS`, which the kiosk's
    `villaHealthFrom` also expresses — a second opinion here would put the
    tablet on red and the notification on amber for one villa."""
    warn_only = [{"kind": "schedule", "title": "Pool service",
                  "detail": "Overdue", "room": "Pool"}]
    title, _ = DeterministicNarrator().render(_context(warn_only))
    assert title.startswith("\U0001F7E0"), f"expected an amber mark, got {title!r}"
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

def test_every_kind_the_builder_emits_has_a_heading() -> None:
    """⚠️ A KIND WITH NO HEADING PRINTS NO LINES AT ALL — it would be built,
    counted toward the title's severity, and then silently absent from the page.
    Derived from the builder rather than listed, so a fifth kind is covered on
    the day it is added."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "standing.py"), encoding="utf-8").read()
    emitted = set(re.findall(r'kind="(\w+)"', source))
    assert emitted, "could not read the emitted kinds — this test is blind"
    headed = {kind for kind, _ in det.KIND_HEADINGS}
    assert emitted <= headed, f"kinds with no heading: {sorted(emitted - headed)}"


def test_the_section_is_in_every_audience_and_leads() -> None:
    for audience, sections in det.SECTIONS_FOR.items():
        assert "standing" in sections, f"{audience} never sees standing state"
        assert sections[0] == "standing", (
            f"{audience} reads the period before the present; the actionable "
            f"half must lead")
    assert "standing" in det.ALL_SECTIONS


def test_the_section_has_its_own_marker() -> None:
    """⚠️ NOT THE SAME GLYPH AS `critical`. The two sit next to each other and
    answer different questions — what is wrong NOW against what went wrong THIS
    PERIOD — and a reader skimming a phone tells them apart by that character
    before reading either heading."""
    assert SECTION_MARK.get("standing")
    assert SECTION_MARK["standing"] != SECTION_MARK["critical"]


def test_a_long_list_summarises_per_kind_rather_than_truncating() -> None:
    """⚠️ FLAT TRUNCATION WOULD DROP WHICHEVER KIND SORTED LAST — losing the
    alarms to a list of offline sensors. "and N more" is a summary; a missing
    kind is a lie."""
    many = [{"kind": "unavailable", "title": f"Device {i}",
             "detail": "Unavailable", "room": ""} for i in range(20)]
    many.append({"kind": "alarm", "title": "Laundry leak",
                 "detail": "Leak detected", "room": "Laundry"})
    _, body = DeterministicNarrator().render(_context(many))
    assert "Laundry leak" in body, "the alarm was truncated away by the devices"
    assert "and 12 more" in body


# ── the privacy boundary ─────────────────────────────────────────────────────

def test_the_subject_never_crosses_into_the_renderer() -> None:
    """⚠️ `Item.subject` CARRIES AN ENTITY ID. It is what P3 deduplicates on and
    is server-side only; the rows the renderer receives are built without it, so
    "the data is not there" rather than "the filter is careful" — the same rule
    that makes `dedup_key` hash its subject and `Finding` carry no entity field.
    """
    pipeline = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
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


def test_right_now_groups_each_state_under_its_own_sub_heading() -> None:
    """⚠️ ASKED FOR WITH THE WANTED SHAPE WRITTEN OUT. The section was already
    grouped by kind INTERNALLY and printed flat, so the reader saw the kind
    repeated on every bullet — "LG webOS TV — Unavailable", "Timmerflotte 2623
    Temperature — Unavailable" — with no visible structure at all.

    Two consequences the shape forces: the label is not bulleted (it is not one
    of the things, it is what they are), and the state word drops off each line
    once the heading above says it.
    """
    rows = [
        {"kind": "unavailable", "title": "A device", "detail": "Unavailable",
         "room": ""},
        {"kind": "unavailable", "title": "Another device",
         "detail": "Unavailable", "room": ""},
        {"kind": "fault", "title": "Not working", "detail": "Open fault",
         "room": "Living Room"},
    ]
    body = DeterministicNarrator().render(_context(rows))[1]
    block = [l for l in body.split("Right now")[1].splitlines() if l.strip()]

    assert block[0] == "Unavailable devices:"
    assert not block[0].startswith(BULLET), (
        "the label is what the bullets ARE, not one of them")
    assert block[1] == f"{BULLET}A device", (
        "the state is on the heading now, so repeating it per line is the "
        "duplication this grouping removed")
    assert "Open ticket:" in block
    # A ticket's own detail is NOT the heading's word, so it survives.
    assert f"{BULLET}Not working — Open fault, Living Room" in block


def test_a_group_label_agrees_with_how_many_are_under_it() -> None:
    """⚠️ "(s)" IS A SHRUG, NOT A PLURAL. The worked example wrote "Unavailable
    device(s):" as shorthand for the SHAPE. `_plural` exists in this codebase
    because "2 categorys" reached a rendered report; printing "(s)" would be
    that lesson unlearned one line further out. The count is known here."""
    one = DeterministicNarrator().render(_context([
        {"kind": "unavailable", "title": "A device", "detail": "Unavailable",
         "room": ""}]))[1]
    assert "Unavailable device:" in one and "devices:" not in one
    assert "(s)" not in one
