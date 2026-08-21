"""A delivered brief may not contain anything a platform can read as markup.

⚠️ THIS WAS AN OUTAGE, NOT A COSMETIC DEFECT. Every delivery to the owner's
telegram target failed for a day:

    telegram.error.BadRequest: Can't parse entities:
    can't find end of the entity starting at byte offset 400

Home Assistant returns that to the caller as HTTP 500, so the History tab showed
`failed  HTTP 500: Server got itself in trouble` and the brief reached nobody.

The cause was one underscore in a real device name — `Timmerflotte_8343
Temperature`, a Home Assistant friendly name on the reference villa. It has a
space, so it is not a raw slug and `displayLabelFor` shows it verbatim, which is
CORRECT. To a platform configured with `parse_mode: markdown` it opens an italic
that never closes.

⚠️ AND THE RULE ALREADY EXISTED, IN PROSE, SINCE `style.py` WAS WRITTEN: emoji
are the only formatting that survives every destination, and the fix for a
markup-active character is to remove it rather than escape it. Nothing enforced
it. It held only because every string the deterministic renderer printed came
from somewhere already sanitised — until 2.571.0 put device names into prose,
and the new section leads, so the first one landed at byte 400.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports.narrate import style                              # noqa: E402
from reports.narrate import DeterministicNarrator, ReportContext  # noqa: E402

#: The exact name that broke it, kept as the regression case.
BROKE_IT = "Timmerflotte_8343 Temperature"


def test_the_name_that_broke_delivery_is_inert() -> None:
    assert "_" not in style.inert(BROKE_IT)
    assert style.inert(BROKE_IT) == "Timmerflotte 8343 Temperature", (
        "an underscore becomes a SPACE — what a person would have written. "
        "Deleting it gives `Timmerflotte8343`, a different name")


@pytest.mark.parametrize("character", ["_", "*", "`", "~", "[", "]", "<", ">"])
def test_no_markup_active_character_survives(character: str) -> None:
    """⚠️ THE UNION OF THE MODES, because the add-on does not choose the parse
    mode — the platform's own configuration does, and `discovery._plain_mode`
    can only turn one off where the service publishes a field for it. Legacy
    Markdown breaks on `_ * ` [`; MarkdownV2 adds `~`; HTML breaks on `< >`.

    ⚠️ `[` AND `]` WERE TAKEN OUT IN 2.577.0 AND PUT BACK IN 2.578.0. The
    reasoning was that only `_ * ` and a backtick OPEN an entity, so a bare
    bracket would print — and the delivered message came back with every one
    stripped. Telegram consumes them as link syntax with or without a `(url)`.
    The report quotes with apostrophes now; see `style.name_of`."""
    assert character not in style.inert(f"a {character} b")


def test_it_leaves_everything_else_alone() -> None:
    """⚠️ INCLUDING THE EMOJI AND THE BULLET, which are this file's entire
    formatting budget. A sanitiser that ate them would fix the delivery by
    deleting the design."""
    keep = f"{style.BULLET}Front gate — Unavailable, Entrance 🔴 🔔 ✅ 100% (n=3)"
    assert style.inert(keep) == keep


def test_the_deterministic_body_is_inert_end_to_end() -> None:
    """The renderer is not asked to sanitise per site — the pipeline does it
    once on the finished message. This checks the two agree by rendering a
    context whose every human-supplied string is hostile."""
    rows: List[Dict[str, Any]] = [
        {"kind": "unavailable", "title": BROKE_IT, "detail": "Unavailable",
         "room": "Bedroom_2"},
        {"kind": "fault", "title": "Gate motor *grinding*", "detail": "Open fault",
         "room": "Entrance [north]"},
    ]
    context = ReportContext(
        audience="owner", cadence="daily", period="2026-08-21",
        generated_at="2026-08-21T17:40:00+08:00",
        discovery={"reachable": True, "capabilities": [], "capabilities_missing": [],
                   "capability_absent": {}, "preflight": []},
        standing=rows)
    title, body = DeterministicNarrator().render(context)
    clean_title, clean_body = style.inert(title), style.inert(body)
    for character in ("_", "*", "`", "[", "]", "<", ">"):
        assert character not in clean_body, f"{character!r} survived into the body"
        assert character not in clean_title
    # The names are still readable, which is the other half of the requirement.
    assert "Timmerflotte 8343 Temperature" in clean_body
    assert "Gate motor grinding" in clean_body
    assert "Entrance (north)" in clean_body


def test_the_reports_own_quoting_is_not_markup_anywhere() -> None:
    """⚠️ THE ONE DELIMITER THAT SURVIVES EVERY PLATFORM. Brackets were tried
    and eaten; an apostrophe is not markup in Markdown, MarkdownV2 or HTML, and
    the preflight line has been delivering one intact for months."""
    quoted = style.name_of("Roi baseline deviation")
    assert quoted == "'Roi baseline deviation'"
    assert style.inert(f"covered by {quoted}") == "covered by 'Roi baseline deviation'"


# ── the boundary ─────────────────────────────────────────────────────────────

def test_the_pipeline_sanitises_after_both_narrators() -> None:
    """⚠️ AFTER THE PROVIDER OVERLAY, NOT BEFORE. A model's prose is human-ish
    text too and `_flatten` is a different, narrower function; sanitising the
    deterministic body and then letting a provider replace it would leave the
    narrated path exactly as broken as the one being fixed."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "pipeline.py"), encoding="utf-8").read()
    call = source.index("style_mod.inert(title)")
    overlay = source.index("body, narration_mode = prose, provider.name")
    deliver = source.index("deliveries = ([] if preview")
    assert overlay < call < deliver, (
        "the sanitiser must sit between the provider overlay and delivery")


def test_history_records_what_was_sent() -> None:
    """⚠️ THE SAME STRING, OR THE HISTORY TAB IS A DIFFERENT DOCUMENT FROM THE
    NOTIFICATION. Sanitising inside `deliver` would have been the smaller change
    and would have left the stored copy carrying markup the reader never saw."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "pipeline.py"), encoding="utf-8").read()
    call = source.index("style_mod.inert(title)")
    entry = source.index('entry["_body"]') if 'entry["_body"]' in source \
        else source.index("append_history")
    assert call < entry


def test_the_renderer_does_not_emit_markup_of_its_own() -> None:
    """⚠️ WHAT MAKES A WHOLE-MESSAGE PASS SAFE. If any section deliberately
    emitted `*bold*`, sanitising the finished message would silently delete it —
    so the claim that there is nothing to damage has to be checked, not assumed.
    `style.py`'s heading rule already forbids it; this is the enforcement."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "narrate", "deterministic.py"), encoding="utf-8").read()
    # ⚠️ THE `{...}` HALF OF AN f-STRING IS CODE, NOT OUTPUT. The first version
    # of this flagged `{singular[:-1]}ies` and `{names[0]}` — a subscript inside
    # an interpolation, which never reaches the message as a bracket. Step 7 of
    # /dry-audit, in a test I had just written.
    emitted = [re.sub(r"\{[^}]*\}", "", literal)
               for literal in re.findall(r'f?"([^"\n]{2,})"', source)]
    # ⚠️ BRACKETS ARE NOT ON THIS LIST. The renderer emits them ON PURPOSE to
    # quote a rule name, and `inert` keeps them — see the module header. What a
    # whole-message pass WOULD eat is still forbidden here.
    offenders = [s for s in emitted
                 if any(c in s for c in ("**", "__", "`", "<b>"))]
    assert not offenders, f"the renderer emits markup a whole-message pass would eat: {offenders}"
