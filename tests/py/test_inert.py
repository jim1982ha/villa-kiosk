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
from agent import fallback as agent_fallback                  # noqa: E402

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


def test_the_composed_body_is_inert_end_to_end() -> None:
    """⚠️ RE-POINTED AT THE BRIEF'S NEW AUTHOR (TASK-073). The property is
    identical: whoever writes the body, the pipeline sanitises the finished
    message once, and this feeds the composer a context whose every
    human-supplied string is hostile and checks the two agree."""
    rows: List[Dict[str, Any]] = [
        {"kind": "unavailable", "title": BROKE_IT, "detail": "Unavailable",
         "room": "Bedroom_2"},
        {"kind": "fault", "title": "Gate motor *grinding*", "detail": "Open fault",
         "room": "Entrance [north]"},
    ]
    body = agent_fallback.brief(
        standing=rows,
        concerns=[{"title": "Pump `odd`", "severity": "warning",
                   "body": "cycling <fast>"}],
        findings=[{"label": "AC_unit", "detail": "draw ~rising~"}]).text
    clean_body = style.inert(body)
    for character in ("_", "*", "`", "[", "]", "<", ">", "~"):
        assert character not in clean_body, f"{character!r} survived into the body"
    # The names are still readable, which is the other half of the requirement.
    assert "Timmerflotte 8343 Temperature" in clean_body
    assert "Gate motor grinding" in clean_body
    assert "Entrance (north)" in clean_body
    assert "Pump 'odd'" in clean_body  # a backtick becomes an apostrophe


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
    # ⚠️ THE PROVIDER'S LEAD IS HANDED TO THE COMPOSER NOW (TASK-073), so the
    # anchors are: narrate, then compose, then inert, then deliver. The property
    # is unchanged: whatever the provider contributes reaches `body` BEFORE
    # `inert` runs, or the narrated path ships unsanitised.
    overlay = source.index("provider.narrate")
    composed = source.index("compose_brief(")
    deliver = source.index("deliveries = ([] if preview")
    assert overlay < composed < call < deliver, (
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
    # ⚠️ THE AUTHOR MOVED (TASK-073): `agent/fallback.py` writes every brief
    # and every rung now, so it is the tree this claim is checked against.
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                               "fallback.py"), encoding="utf-8").read()
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

    "there is no mention to `Facility manager` in the Kiosk UI: change it consistently
    (and everywhere it has to) to **Facility Manager**, as this is how it is
    referenced in the VESTA Kiosk UI." It was applied to the renderer and missed
    `verify.EVIDENCE_TASK`, so a delivered brief still read "the facility manager
    marked the job done" — and the owner had to ask a second time, worried it
    had not been done fully. It had not.

    ⚠️ STRING LITERALS ONLY, AND DOCSTRINGS ARE FOUND BY THE AST, NOT GUESSED.
    `facility manager` is the right word for a READER; `caretaker` survives in ~20
    docstrings; the blueprints' own input is literally `caretaker_todo_list` and
    renaming it would break every property's YAML. The rule is about what a
    READER sees. The first cut tried to spot docstrings by their leading
    whitespace and flagged eight of them — a filter that guesses is how the real
    one hides in the noise.
    """
    # ⚠️ IT WALKED `reports/` ALONE, AND THAT IS HOW THE RULE WAS BROKEN AGAIN.
    # 2.763.0 added `agent/task.py` and a settings field labelled "Caretaker
    # to-do list", neither of which this test could see — so the owner reported
    # the same wrong word a THIRD time, in a feature built while the pin that
    # forbids it was green. A rule enforced where it was WRITTEN rather than
    # where it APPLIES is `feedback_audit-applicable-set`, and this is its
    # textbook shape: the scan root was the file the rule was born in.
    roots = [os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports"),
             os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent")]
    offenders: List[str] = []
    for root in roots:
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
                 and "skipping facility manager tasks" not in o
                 and "could not read the facility manager list" not in o]
    assert not offenders, (
        "these strings can reach a delivered brief and say 'caretaker'; the "
        "kiosk calls that role the Facility Manager everywhere, so a second "
        "word reads as a second person:\n  " + "\n  ".join(offenders))


# ── a friendly name is not automatically prose ───────────────────────────────

def test_a_home_assistant_name_is_humanised_before_it_is_printed() -> None:
    """⚠️ THE OWNER READ THIS IN A DELIVERED BRIEF (2026-08-22, v2.601.0):

        • Critical automation health 'critical doorbell---parking gate'

    Half-humanised, by the wrong function. `readable_label` has collapsed
    `-{2,}` to an em-dash since v2.568.0 (the function itself is v2.556.0 — the
    em-dash rule landed twelve releases later), and this name never reached it:
    both readers of the HA label map wrapped only their FALLBACK
    (`prettify_entity_slug`), on the assumption that a value Home Assistant
    supplied is already prose. It is not — this villa's automations are NAMED
    `critical_doorbell---parking_gate` — so the identifier travelled verbatim to
    `inert()`, whose job is markup safety, not readability. It turned the
    underscores into spaces and left the `---`, which is the exact string above.

    Two properties, because fixing only the first is how a real label gets
    damaged in the name of tidiness (see `readable_label`'s own docstring).
    """
    from reports.text import readable_label

    assert readable_label("critical_doorbell---parking_gate") == (
        "Critical doorbell — parking gate")
    assert "---" not in readable_label("critical_schedule---pool_pump")

    # ⚠️ AND A NAME A PERSON WROTE IS RETURNED BYTE FOR BYTE. Whitespace is the
    # tell; a single hyphen inside a real label must survive.
    for human in ("House Pump Power", "Lights - monitored rooms",
                  "Timmerflotte_8343 Temperature"):
        assert readable_label(human) == human

    # ⚠️ AND IT MUST STAY FALSY ON A MISS, or `readable_label(x) or fallback`
    # silently stops falling back and prints "" for an unlabelled entity.
    assert not readable_label(None)  # type: ignore[arg-type]
    assert not readable_label("")


def test_both_readers_of_the_label_map_humanise_it() -> None:
    """The applicable set, not the reported line — `grep -L`, not `grep -l`.

    Three sites read a Home-Assistant-supplied name into prose. Pinned by SHAPE
    so a fourth reader added later fails here rather than in a brief: any
    `.get(` on a label map that is NOT wrapped in `readable_label`.
    """
    import re

    targets = [
        "rootfs/usr/bin/reports/analysis/base.py",
    ]
    offenders = []
    for rel in targets:
        with open(os.path.join(REPO_ROOT, rel), encoding="utf-8") as handle:
            for number, line in enumerate(handle, 1):
                if re.search(r"_?labels\.get\(", line) and "readable_label" not in line:
                    offenders.append(f"{rel}:{number}: {line.strip()[:80]}")
    assert not offenders, (
        "a Home Assistant name reaches prose without `readable_label`, so an "
        "identifier-shaped friendly name prints as one:\n  "
        + "\n  ".join(offenders))
