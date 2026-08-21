"""A className in the markup must name a rule that exists.

⚠️ THIS SHIPPED A VISIBLE DEFECT AND THE OWNER SCREENSHOTTED IT. The Briefings
schedule used `<label className="fm-check">` — a class that does not exist
anywhere in `styles.css`. `.fm-check-icon` DOES exist and is for readiness
status glyphs, which is exactly what made the invention feel safe. With no rule,
the label got no flex layout and the checkbox fell back to the browser's native
rendering: a white square floating above its own text.

The same probe found `className="spin"` on the "Composing…" indicator — the
`@keyframes spin` existed, `.spinner` used it, and there was no class to put on
an inline icon, so it sat perfectly still.

⚠️ NEITHER IS CATCHABLE BY `tsc`, BY REVIEW, OR BY ANY TEST OF BEHAVIOUR. A
className is a string; every one of them type-checks, and a component with an
invented class renders happily and wrongly. The only thing that can see it is a
comparison against the stylesheet, which is what this is.

⚠️ AND IT IS THE INVERSE OF /dry-audit's PART 4d. That probe asks "is this CSS
rule still referenced"; this asks "does this reference name a rule". They are
the two halves of one question and only one of them was being asked.

## Reading a hit

A class that sits ALONGSIDE a styled base class — `icon-btn cam-next`,
`modal-backdrop first-run-backdrop` — is a semantic hook and renders correctly;
it is dead weight rather than a defect. A class that STANDS ALONE carries all of
that element's layout, and when it does not exist the element has none. Both
kinds are listed below; only the second kind is urgent.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Dict, List, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS_PATH = os.path.join(REPO_ROOT, "src", "styles.css")

#: Classes referenced in markup that `styles.css` does not define, each one
#: verified BY HAND on 2026-08-21 as a semantic hook riding a styled base class.
#: Named individually, with what carries them, so the list cannot go blind — the
#: same discipline `/dry-audit`'s sweep uses for its known-good sites.
#:
#: ⚠️ ADDING A NAME HERE IS A DECISION, NOT A FORMALITY. Each of these renders
#: correctly today because something else styles the element. A NEW name that
#: needs adding is far more likely to be the `.fm-check` case, where nothing
#: else does.
KNOWN_HOOKS: Dict[str, str] = {
    "cam-prev": "rides .icon-btn (CameraPanel)",
    "cam-next": "rides .icon-btn (CameraPanel)",
    "fs-btn": "rides .icon-btn (CameraPanel)",
    "close": "rides .icon-btn (CameraPanel)",
    "cockpit-modal": "rides .modal.settings-modal.modal-fixed-height",
    "first-run-backdrop": "rides .modal-backdrop.panel-modal-backdrop",
    "legend-modal": "rides .modal (LegendModal)",
    "room-choice-modal": "passed to BasePanel, applied beside its own classes",
    "modal-header": "structural div inside .modal (FaultStage/GuestReport)",
    "modal-body": "rides .fm-stack (FaultStage/GuestReport)",
    # ⚠️ THE ONLY ONE WHERE ABSENCE IS ARGUABLY THE POINT. `.tone-on`,
    # `.tone-warn` and `.tone-off` each ADD an underline; `tone-neutral` having
    # no rule means "no underline", which reads as deliberate. Listed rather
    # than resolved because that is a design question, not an audit's to answer.
    "tone-neutral": "sibling of .tone-on/.tone-warn; absence = no underline",
    # ⚠️ NAMED ONLY IN A COMMENT, which is why it appears here at all: stripping
    # CSS comments (see `_defined`) is what stopped the probe reading prose as a
    # definition, and this is the one case where that prose was the ONLY mention.
    # It rides `.modal.panel-modal`, both styled, so it renders correctly.
    "badge-color-modal": "rides .modal.panel-modal (BadgeColorModal)",
}


def _defined() -> Set[str]:
    """Every class `styles.css` defines, however it is written.

    ⚠️ ANY `.name` ANYWHERE IN A RULE, including inside a compound or
    descendant selector. `.summary-tile.tone-on` defines `tone-on`, and a
    parser that only read the start of a rule would report it missing.

    ⚠️ AND COMMENTS ARE STRIPPED FIRST, which this test's own vacuity check
    caught within a minute of being written. The fix for the original defect
    added a comment to `styles.css` explaining that `.fm-check` was invented —
    and that sentence made `fm-check` look DEFINED, so the probe would have
    stopped seeing the very class it exists to catch. Prose ABOUT a class is
    not a definition of it, exactly as prose about a rule is not a use of it
    (`_strip_comments`, test_module_conventions).
    """
    with open(CSS_PATH, encoding="utf-8") as handle:
        css = handle.read()
    css = re.sub(r"/\*.*?\*/", " ", css, flags=re.DOTALL)
    return set(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]*)", css))


def _referenced() -> Dict[str, List[str]]:
    """Every LITERAL className token in the app, and where it is used.

    ⚠️ LITERALS ONLY — `className={...}` is skipped. A template like
    `tone-${t.tone}` or `cockpit-health-${level}` cannot be resolved statically,
    and reporting those was 6/6 false when /dry-audit's Part 4d first tried the
    mirror of this check.
    """
    files = subprocess.run(
        ["git", "ls-files", "src/**/*.tsx"],
        capture_output=True, text=True, cwd=REPO_ROOT).stdout.split()
    out: Dict[str, List[str]] = {}
    for rel in files:
        with open(os.path.join(REPO_ROOT, rel), encoding="utf-8") as handle:
            source = handle.read()
        for match in re.finditer(r'className="([^"{}]+)"', source):
            for token in match.group(1).split():
                out.setdefault(token, []).append(os.path.basename(rel))
    assert out, "no classNames found — the glob or the regex moved"
    return out


def test_every_class_in_the_markup_exists_in_the_stylesheet() -> None:
    defined = _defined()
    offenders = {
        token: sorted(set(where))
        for token, where in _referenced().items()
        if token not in defined and token not in KNOWN_HOOKS
    }
    assert not offenders, (
        "these classNames name no rule in styles.css, so the element gets "
        "whatever the browser does by default:\n  "
        + "\n  ".join(f"{t}  {w}" for t, w in sorted(offenders.items()))
        + "\n\nIf it rides a styled base class it is a hook — add it to "
          "KNOWN_HOOKS with what carries it. If it stands alone, it is the "
          "`.fm-check` case and the element has no styling at all.")


def test_the_known_hooks_list_does_not_go_stale() -> None:
    """⚠️ A SUPPRESSION LIST THAT OUTLIVES ITS ENTRIES GOES BLIND. If someone
    later writes the rule, or deletes the markup, the name here starts
    silencing nothing — and the next real hit could hide behind it."""
    defined = _defined()
    referenced = _referenced()
    now_defined = sorted(k for k in KNOWN_HOOKS if k in defined)
    now_unused = sorted(k for k in KNOWN_HOOKS if k not in referenced)
    assert not now_defined, (
        f"now defined in styles.css — remove from KNOWN_HOOKS: {now_defined}")
    assert not now_unused, (
        f"no longer referenced in any markup — remove from KNOWN_HOOKS: "
        f"{now_unused}")


def test_the_probe_can_actually_see_the_defect_it_was_written_for() -> None:
    """⚠️ A SOURCE-READING TEST THAT FINDS NOTHING PASSES VACUOUSLY. Assert it
    would have caught `.fm-check` — the class that shipped the white square."""
    defined = _defined()
    assert "toggle" in defined, "the shared checkbox row must exist"
    assert "fm-check" not in defined, (
        "if `.fm-check` were ever defined, the original defect would not have "
        "been visible to this probe at all")
    assert "spin" in defined, "the inline spinner utility must exist"
