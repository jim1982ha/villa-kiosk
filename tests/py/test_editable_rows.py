"""The editable-row list: same shape, two callers, one set of conventions.

⚠️ PINNED RATHER THAN EXTRACTED, DELIBERATELY. `/dry-audit`'s own rule is to
converge when copies are genuinely the same THING and to pin when they are the
same SHAPE with different content. Briefings' schedules and Advanced Settings'
people are the same shape — a flat list of small records edited in place, with
an Add button — and different content: a schedule carries a cadence, a time and
a press-and-hold send; a person carries a name, a chat, destinations and a
profile. A shared component would need a prop for each difference, and every
prop is a new place to pass the wrong thing.

⚠️ WHAT WENT WRONG WITHOUT IT: the second caller used `.icon-btn` — the app's
neutral glass chrome — for its delete, so the one destructive control in the row
was the only delete in the app that did not read as destructive. `styles.css`
had said otherwise since before that panel existed (`.editable-row > .btn.danger`
sits beside the row rules) and nothing checked it. Reported from the screen.

⚠️ THE APPLICABLE SET IS DERIVED, NEVER LISTED. A third caller is covered on the
day it is written, which is the difference between a pin and `grep -l` wearing
a test's clothes.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")
STYLES = os.path.join(SRC, "styles.css")


def _tsx() -> List[tuple]:
    out: List[tuple] = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".tsx", ".ts")):
                path = os.path.join(base, name)
                with open(path, encoding="utf-8") as handle:
                    out.append((os.path.relpath(path, REPO_ROOT), handle.read()))
    return out


def _no_comments(source: str) -> str:
    """⚠️ Or a test matches the prose explaining itself — the failure this
    project has now hit three times in as many days."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"//[^\n]*", "", source)


def _callers() -> Dict[str, str]:
    """Every component that renders an editable-row list, from the tree."""
    return {path: _no_comments(source) for path, source in _tsx()
            if 'className="editable-row"' in _no_comments(source)}


def _styles() -> str:
    with open(STYLES, encoding="utf-8") as handle:
        return handle.read()


def test_the_walk_finds_both_known_callers() -> None:
    """⚠️ THE VACUOUS-PASS GUARD. If the class is renamed or the markup shape
    changes, every assertion below runs over an empty dict and reports health
    forever — this project has had four counters read 0 for the exact case they
    existed to measure."""
    found = _callers()
    assert len(found) >= 2, (
        f"only {len(found)} editable-row callers found: {sorted(found)}. "
        f"Briefings' schedules and the people panel are both this shape.")
    assert any("ScheduleTab" in p for p in found)
    assert any("PeoplePanel" in p for p in found)


def test_every_row_delete_is_the_DESTRUCTIVE_treatment() -> None:
    """⚠️ `btn danger icon-only`, NOT `.icon-btn`.

    Removing a schedule, or somebody's access to the villa, is exactly the
    action that must look different from everything beside it. The neutral
    glass chrome is for navigation and toggles.
    """
    offenders = []
    for path, source in _callers().items():
        if "Trash2" not in source:
            continue
        if "btn danger icon-only" not in source:
            offenders.append(path)
    assert not offenders, (
        f"{offenders} render a delete inside an editable row without the "
        f"destructive treatment. Use `className=\"btn danger icon-only\"` — "
        f"styles.css states it at `.editable-row > .btn.danger`.")


def test_no_editable_row_caller_uses_the_NEUTRAL_icon_button_for_delete() -> None:
    """The inverse, because absence of the right class and presence of the
    wrong one are different failures and only one of them is obvious."""
    offenders = []
    for path, source in _callers().items():
        for match in re.finditer(r'className="icon-btn"', source):
            window = source[match.start():match.start() + 400]
            if "Trash2" in window:
                offenders.append(path)
    assert not offenders, f"{offenders} use .icon-btn for a row delete"


def test_the_fields_are_grouped_so_the_delete_cannot_wrap_away() -> None:
    """⚠️ A PHONE-PARITY RULE PAID FOR ON HARDWARE. All the controls used to be
    siblings in one wrapping row, so on a 390px screen the last field dropped to
    a second line and took the delete with it, where it read as an action on the
    whole card rather than on that record. `.editable-row-fields` is what keeps
    the button on the first line, and a caller that skips it loses that."""
    # ⚠️ THE CLASS, NOT THE WHOLE ATTRIBUTE. A caller may add a variant beside
    # it — `editable-row-fields editable-row-tight` keeps a person's three
    # fields on one line where the schedule row's five deliberately wrap — and
    # an exact-string match reported that as a MISSING group, which is the
    # opposite of what it is.
    offenders = [path for path, source in _callers().items()
                 if not re.search(r'className="[^"]*\beditable-row-fields\b',
                                  source)]
    assert not offenders, (
        f"{offenders} use .editable-row without grouping their fields in "
        f".editable-row-fields; the delete button will wrap on a phone.")


def test_the_shared_block_still_states_both_rules() -> None:
    """If the CSS moves, the assertions above are checking a convention the
    stylesheet no longer backs."""
    # ⚠️ COMMENTS STRIPPED — the rename note in styles.css says the words
    # "renamed from .reports-schedule", and the last assertion below matched
    # that prose. THIRD time in this session a test has matched the sentence
    # explaining the thing it checks; the lesson is that `_no_comments` belongs
    # on every source a test reads, not only on the ones where it bit first.
    css = _no_comments(_styles())
    assert ".editable-row > .btn.danger" in css
    assert ".editable-row-fields > select" in css
    assert ".editable-row-fields > button" in css
    assert "reports-schedule" not in css, (
        "the old feature-specific names came back; two names for one thing is "
        "the drift the rename removed")
