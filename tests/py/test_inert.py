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

import ast
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
    # ⚠️ THE OVERLAY IS A RE-RENDER NOW, NOT AN ASSIGNMENT. v2.592.0 made the
    # provider fill the LEAD SLOT and re-ran the renderer, so the old anchor
    # (`body, narration_mode = prose, …`) no longer exists. The property is
    # unchanged and is what this asserts: whatever the provider contributes
    # reaches `body` BEFORE `inert` runs, or the narrated path ships unsanitised.
    overlay = source.index('context.slots = {"lead": lead}')
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


def test_no_module_quotes_a_name_by_hand() -> None:
    """⚠️ THE APPLICABLE SET, NOT THE CALL SITES. `name_of` was written for the
    renderer, and two audits converged the sites that already looked like it.
    A third — `discovery`'s missing-statistic preflight line — carried its own
    pair of apostrophes and was found by grepping for the SHAPE of the problem
    instead of the name of the solution, which is `feedback_audit-applicable-set`
    in one sentence.

    This scans the shipped source rather than any call site, so site four is
    caught on the day it is written. It looks for an apostrophe-wrapped
    interpolation in an f-string — the exact thing `name_of` returns.
    """
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports")
    pattern = re.compile(r"'\{[A-Za-z_][A-Za-z0-9_.\[\]()]*\}'")
    offenders = []
    for folder, _, files in os.walk(root):
        for name in sorted(f for f in files if f.endswith(".py")):
            path = os.path.join(folder, name)
            for number, line in enumerate(
                    open(path, encoding="utf-8").read().splitlines(), 1):
                if line.lstrip().startswith("#"):
                    continue
                if pattern.search(line):
                    offenders.append(f"{os.path.relpath(path, REPO_ROOT)}:"
                                     f"{number}: {line.strip()}")
    # Two exemptions, each named, each with its reason at the filter — the
    # dry-audit rule about suppressions that cannot go blind.
    offenders = [
        o for o in offenders
        # `name_of` itself is the one place the literal belongs.
        if "text.py" not in o
        # providers.py quotes the BULLET GLYPH inside the LLM prompt. That is
        # not a name and its audience is not a reader: `name_of` says "this
        # word is a rule, not prose", and a prompt instruction saying which
        # character to start a line with is a different question entirely.
        and "providers.py" not in o]
    assert not offenders, (
        "these quote a name by hand instead of calling `reports.text.name_of`, "
        "so a change of quoting style would reach every site but these:\n  "
        + "\n  ".join(offenders))


def test_no_reader_ever_sees_the_word_caretaker() -> None:
    """⚠️ A STANDING OWNER RULE THAT WAS BROKEN AFTER BEING ACCEPTED.

    "there is no mention to `Caretaker` in the Kiosk UI: change it consistently
    (and everywhere it has to) to **Facility Manager**, as this is how it is
    referenced in the VESTA Kiosk UI." It was applied to the renderer and missed
    `verify.EVIDENCE_TASK`, so a delivered brief still read "the caretaker
    marked the job done" — and the owner had to ask a second time, worried it
    had not been done fully. It had not.

    ⚠️ STRING LITERALS ONLY, AND DOCSTRINGS ARE FOUND BY THE AST, NOT GUESSED.
    `caretaker` is the right engineering word here and appears in ~20
    docstrings; the blueprints' own input is literally `caretaker_todo_list` and
    renaming it would break every property's YAML. The rule is about what a
    READER sees. The first cut tried to spot docstrings by their leading
    whitespace and flagged eight of them — a filter that guesses is how the real
    one hides in the noise.
    """
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports")
    offenders: List[str] = []
    for folder, _, files in os.walk(root):
        for name in sorted(f for f in files if f.endswith(".py")):
            path = os.path.join(folder, name)
            tree = ast.parse(open(path, encoding="utf-8").read())
            docstrings = set()
            for node in ast.walk(tree):
                if isinstance(node, (ast.Module, ast.ClassDef,
                                     ast.FunctionDef, ast.AsyncFunctionDef)):
                    body = getattr(node, "body", [])
                    if (body and isinstance(body[0], ast.Expr)
                            and isinstance(body[0].value, ast.Constant)
                            and isinstance(body[0].value.value, str)):
                        docstrings.add(id(body[0].value))
            for node in ast.walk(tree):
                if (isinstance(node, ast.Constant)
                        and isinstance(node.value, str)
                        and id(node) not in docstrings
                        and "caretaker" in node.value.lower()):
                    offenders.append(
                        f"{os.path.relpath(path, REPO_ROOT)}:{node.lineno}: "
                        f"{node.value[:70]!r}")
    # `caretaker_todo_list` is the blueprints' own input name — operator YAML,
    # not prose. Log text reaches the add-on log, never a reader.
    offenders = [o for o in offenders
                 if "caretaker_todo_list" not in o
                 and "skipping caretaker tasks" not in o
                 and "could not read the caretaker list" not in o]
    assert not offenders, (
        "these strings can reach a delivered brief and say 'caretaker'; the "
        "kiosk calls that role the Facility Manager everywhere, so a second "
        "word reads as a second person:\n  " + "\n  ".join(offenders))
