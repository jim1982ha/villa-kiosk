"""A dialog in the `.settings-modal` family has three parts, and a hand-copied
shell carries only the parts the copier noticed.

⚠️ THIS SHIPPED. `ReportsModal` was assembled by copying `FacilityModal`'s
shell — backdrop, `.settings-modal`, header, tab strip, `.settings-body` — and
the `.settings-footer` with its Close button was not copied. The dialog had no
visible way out: only the backdrop click and Escape, neither of which is
discoverable on the wall-mounted tablet this product is operated from. The
owner reported it as an inconsistency and named the cause exactly — "I feel you
haven't used DRY practice to code this overall modal, else it would naturally
be here".

They are right, and the deeper point is the one this file pins. There is no
`<SettingsModalShell>` component to fail to use: the shell is a CONVENTION
expressed as five class names, so every dialog re-states it and every dialog
can re-state it incompletely. `/dry-audit`'s Part 1 cannot see this — its
question is "does every call site of a shared thing agree", and there is no
shared thing here to have call sites. This is Part 4's shape: duplication with
nothing to violate.

⚠️ WHY A TEST AND NOT A COMPONENT. Extracting a shell component is the better
fix in the abstract and the worse one here: these six dialogs differ in real
ways (tab strips, footer content, one has a second header, two render sibling
modals after the shell), so the component would need six props and every one of
them would be a place to pass the wrong thing. The convention is fine; what was
missing is anything that NOTICES a violation. A source-reading test is the
cheapest thing that notices — the same argument `test_hud_surfaces` and
`test_store_envelope` make.

⚠️ THE APPLICABLE SET IS DERIVED, NOT LISTED — `grep -L`, not `grep -l`, which
is the sentence /dry-audit opens with. Every file using `.settings-modal` is in
scope automatically, so the seventh dialog is covered on the day it is written.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COMPONENTS = os.path.join(REPO_ROOT, "src", "components")

#: The marker that puts a dialog in this family. `.modal.settings-modal` is a
#: centred card with a pinned header and footer and a scrolling body; a dialog
#: assembled any other way renders as a full-bleed top-anchored sheet on a
#: tablet, which is the trap both August 2026 dialogs had to be checked against.
FAMILY = "settings-modal"

#: The parts that make it that. ⚠️ THE FOOTER IS LOAD-BEARING, NOT DECORATION:
#: it is where Close lives, and `.settings-body` only scrolls correctly because
#: the header and footer are `flex: 0 0 auto` siblings holding it in place.
REQUIRED = ("settings-header", "settings-footer")


def _dialogs() -> Dict[str, str]:
    """Every component that renders a `.settings-modal`, as source text."""
    found: Dict[str, str] = {}
    for base, _dirs, files in os.walk(COMPONENTS):
        for name in files:
            if not name.endswith(".tsx"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                source = handle.read()
            if FAMILY in source:
                found[os.path.relpath(path, REPO_ROOT)] = source
    return found


def test_every_settings_modal_has_the_whole_shell() -> None:
    dialogs = _dialogs()
    assert dialogs, "no .settings-modal dialogs found — this test's anchor moved"

    problems: List[str] = []
    for path, source in sorted(dialogs.items()):
        for part in REQUIRED:
            if part not in source:
                problems.append(
                    f"{path} renders a .{FAMILY} without a .{part} — the shell "
                    f"was copied by hand and this part was dropped")
    assert not problems, "\n".join(problems)


def test_every_settings_modal_offers_a_visible_way_out() -> None:
    """⚠️ ESCAPE AND THE BACKDROP ARE NOT A WAY OUT ON A TABLET. `useModalA11y`
    gives every dialog both, and neither is discoverable by someone touching a
    wall-mounted screen — which is this product's primary device. A footer
    without a Close button is the same defect as no footer, one step later, so
    the presence of the class is not what is checked here."""
    problems: List[str] = []
    for path, source in sorted(_dialogs().items()):
        tail = source[source.index("settings-footer"):] if "settings-footer" in source else ""
        if not re.search(r">\s*Close\s*<", tail):
            problems.append(
                f"{path} has no Close button in its footer — Escape and the "
                f"backdrop are the only exits, and neither is visible")
    assert not problems, "\n".join(problems)


def test_every_settings_modal_traps_focus() -> None:
    """The rule `/dry-audit`'s sweep already checks for `.modal-backdrop`,
    restated for this family because a dialog can carry the family class
    without the backdrop line the sweep greps for."""
    problems: List[str] = []
    for path, source in sorted(_dialogs().items()):
        if "useModalA11y" not in source:
            problems.append(f"{path} has no useModalA11y — no focus trap, no "
                            f"Escape, no focus restore")
    assert not problems, "\n".join(problems)


def test_the_family_marker_still_matches_the_stylesheet() -> None:
    """⚠️ VACUOUS-PASS GUARD. If `.settings-modal` is renamed in the CSS, every
    check above starts comparing empty sets and reports health forever."""
    with open(os.path.join(REPO_ROOT, "src", "styles.css"), encoding="utf-8") as h:
        css = h.read()
    for part in (FAMILY,) + REQUIRED:
        assert f".{part}" in css, (
            f".{part} is not in styles.css — this test's anchors moved and it "
            f"would otherwise pass on an empty comparison")

#: A dialog's tab components live beside it. ⚠️ SCANNED TOO, because the defect
#: this pins was in a CHILD: `ReportsModal`'s footer had only Close while
#: `ScheduleTab` carried the Save at the bottom of its own content.
def _family(path: str, source: str) -> Dict[str, str]:
    """The dialog plus the sibling components it renders."""
    out = {path: source}
    folder = os.path.dirname(os.path.join(REPO_ROOT, path))
    for name in re.findall(r'from "\./(\w+)"', source):
        kid = os.path.join(folder, name + ".tsx")
        if os.path.exists(kid):
            with open(kid, encoding="utf-8") as handle:
                out[os.path.relpath(kid, REPO_ROOT)] = handle.read()
    return out


#: A primary button whose label commits the form.
COMMIT = re.compile(r'<button[^>]*?\bprimary\b[^>]*?>(.{0,160}?)</button>', re.DOTALL)
COMMIT_WORD = re.compile(r'>\s*(Save|Apply)\s*<|<span>\{[^}]*?["\'](Save|Saving)')


def test_the_button_that_commits_a_form_is_in_the_footer() -> None:
    """⚠️ THE ONE BUTTON THAT COMMITS THE WORK WAS THE ONE YOU COULD NOT SEE.

    `ReportsModal`'s Save sat at the bottom of the Schedule tab's CONTENT —
    below the fold on a laptop, and under a section that unfolds further when
    ticked — while Close stayed pinned in the footer the whole time. Reported
    as: "a proper UX expects all the buttons to appear at the same spot".

    The footer is where this family puts its actions and every other dialog
    already did; there was nothing to violate but the convention, which is why
    nothing caught it. Now something does.

    ⚠️ PRIMARY BUTTONS ONLY. A tab may perfectly well have a secondary,
    row-scoped action in its body — "Store key" writes a different file,
    "Raise fault" acts on one record. What must not be in the body is the
    button that commits the DIALOG's form.
    """
    problems: List[str] = []
    for path, source in sorted(_dialogs().items()):
        for kid_path, kid in _family(path, source).items():
            cut = kid.index("settings-footer") if "settings-footer" in kid else len(kid)
            for block in COMMIT.findall(kid[:cut]):
                if COMMIT_WORD.search(block) or COMMIT_WORD.search("><" + block + "</button>"):
                    problems.append(
                        f"{kid_path}: a primary Save/Apply outside the footer — "
                        f"{' '.join(block.split())[:60]}")
    assert not problems, "\n".join(problems)
