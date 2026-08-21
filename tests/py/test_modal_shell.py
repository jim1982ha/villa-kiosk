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


#: ⚠️ `[^>]` CANNOT BE USED TO FIND A TAG'S END IN JSX, AND THIS PIN LEARNED IT
#: THE EXPENSIVE WAY. The first version matched
#: `<button[^>]*?\bprimary\b[^>]*?>(.{0,160}?)</button>` — which stops at the
#: `>` inside `onClick={() => …}`, i.e. inside the ATTRIBUTES of almost every
#: button in this codebase. It then captured 160 characters of handler body and
#: looked for a label there.
#:
#: So it saw `FaultsTab`'s `Save changes` not at all, and caught the defect it
#: was written for only because THAT button's label happened to fall within 160
#: characters of where the truncated match ended. A pin that works by luck
#: reports health on everything it cannot parse — which was most buttons.
#:
#: Found by /dry-audit Part 3 one release after it shipped: the docstring
#: claimed a check the code did not perform.
BUTTON_OPEN = "<button"
BUTTON_CLOSE = "</button>"

#: A label that commits a form. `Save changes` counts and `Saving…` does not —
#: the second is a busy state of the first, not a second button.
COMMIT_WORD = re.compile(r"\b(Save|Apply)\b")

#: ⚠️ THE APP'S OWN RECORD-SCOPED ACTION ROW. A tab may legitimately hold a
#: primary commit button when it belongs to ONE RECORD rather than to the
#: dialog — `FaultsTab`'s "Save changes" writes one ticket, `ScheduleEditor`'s
#: writes one maintenance job — and both already sit in `.modal-actions`, which
#: is what this codebase has always used to mean exactly that. So the exemption
#: is an existing convention read off the markup, not a list of file names that
#: would go stale.
RECORD_ROW = 'className="modal-actions'


def _primary_buttons(source: str) -> List[str]:
    """Every `<button …>…</button>` whose class list contains `primary`.

    Walks from each `</button>` back to the nearest `<button`, so an arrow
    function in the attributes cannot truncate the element — see BUTTON_OPEN.
    """
    out: List[str] = []
    at = source.find(BUTTON_CLOSE)
    while at >= 0:
        start = source.rfind(BUTTON_OPEN, 0, at)
        if start >= 0:
            element = source[start:at]
            if "primary" in element.split(">")[0] or 'btn primary' in element:
                out.append(element)
        at = source.find(BUTTON_CLOSE, at + 1)
    return out


def _in_record_row(source: str, element: str) -> bool:
    """Is this button inside a `.modal-actions` row that is still open?"""
    before = source[:source.find(element)]
    opened = before.rfind(RECORD_ROW)
    return opened >= 0 and before.rfind("</div>") < opened


def test_the_button_that_commits_a_form_is_in_the_footer() -> None:
    """⚠️ THE ONE BUTTON THAT COMMITS THE WORK WAS THE ONE YOU COULD NOT SEE.

    `ReportsModal`'s Save sat at the bottom of the Schedule tab's CONTENT —
    below the fold on a laptop, and under a section that unfolds further when
    ticked — while Close stayed pinned in the footer the whole time. Reported
    as: "a proper UX expects all the buttons to appear at the same spot".

    The footer is where this family puts its actions and every other dialog
    already did; there was nothing to violate but the convention, which is why
    nothing caught it. Now something does.

    ⚠️ WHAT IS ACTUALLY CHECKED, stated precisely because the first version of
    this docstring claimed more than the code did: a `<button>` whose class list
    contains `primary`, whose text mentions Save or Apply, which sits BEFORE the
    footer and OUTSIDE a `.modal-actions` row.

    ⚠️ `.modal-actions` IS THE EXEMPTION AND IT IS EARNED. A tab may hold a
    primary commit button when it belongs to ONE RECORD rather than to the
    dialog — `FaultsTab`'s "Save changes" writes one ticket, `ScheduleEditor`'s
    writes one maintenance job — and both already sit in that row, which is what
    this codebase has always used to mean a record-scoped action. Reading the
    convention off the markup beats a list of file names, which goes stale.
    """
    problems: List[str] = []
    for path, source in sorted(_dialogs().items()):
        for kid_path, kid in _family(path, source).items():
            cut = kid.index("settings-footer") if "settings-footer" in kid else len(kid)
            body = kid[:cut]
            for element in _primary_buttons(body):
                if not COMMIT_WORD.search(element):
                    continue
                if _in_record_row(body, element):
                    continue
                problems.append(
                    f"{kid_path}: a primary Save/Apply outside the footer and "
                    f"outside a .modal-actions row — "
                    f"{' '.join(element.split())[:70]}")
    assert not problems, "\n".join(problems)


def test_the_matcher_survives_an_arrow_function_in_the_attributes() -> None:
    """⚠️ THE REGRESSION THAT MADE THE PIN ABOVE A LIE, pinned so it cannot
    return. `[^>]*?` stops at the `>` inside `onClick={() => …}`, which is in
    the attributes of almost every button here — so the matcher saw a truncated
    tag and searched the handler body for a label."""
    markup = (
        '<div className="reports-pane">\n'
        '  <button className="btn primary" disabled={busy}\n'
        '          onClick={() => { const x = 1; save(x); }}>\n'
        '    <span>{busy ? "Saving…" : "Save"}</span>\n'
        '  </button>\n'
        '</div>')
    found = _primary_buttons(markup)
    assert len(found) == 1, "an arrow function in the attributes hid the button"
    assert COMMIT_WORD.search(found[0]), "the label was not reached"
    assert not _in_record_row(markup, found[0]), (
        "a bare pane is not a .modal-actions row")
