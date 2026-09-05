"""The row shells are four different things, and their geometry has one home.

⚠️ THE COMPLAINT WAS REAL AND THE PROPOSED FIX WAS NOT (2026-09-06). An
architecture review found "four competing row shells for one visual concept"
and proposed collapsing them into a single `.row` with modifiers. Measuring
them first says otherwise — they differ in DIRECTION, ALIGNMENT and BORDER
TREATMENT, not merely in spacing:

    .fm-row                 row, wraps, centred, full hairline, --bg-card
    .reports-entry          COLUMN, left accent 3px, --bg-input
    .cockpit-attention-row  row, centred, NO border — it is a <button>
    .editable-row           row, NOWRAP, top-aligned, --bg-input

A bordered card, a stacked entry, a clickable row and a form row. Merging them
would change the appearance of every surface that uses one, on a wall tablet,
to satisfy a resemblance rather than a shared rule.

⚠️ WHAT WAS ACTUALLY WRONG IS THE PART THIS PINS. Each shell re-decided the
same geometry in raw literals, so "what a row looks like" had four homes and 21
of the last 120 commits landed on `styles.css`. The values now come from
`--row-*` tokens. Nothing rendered changed; what changed is that a row's
geometry can be edited in one place, and a shell that drifts off the family
fails here.

⚠️ THE TOKENS ARE NAMED FOR THE ROW, NOT BORROWED FROM A MATCHING VALUE.
`--radius-badge` is also 12px and several non-row controls also pad `10px 12px`.
Reusing those would mean a badge tweak reshapes every list. Same value is not
the same reason, and a test that only compared numbers would have encouraged
exactly that.
"""

from __future__ import annotations

import os
import re
from typing import Dict

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS = os.path.join(REPO_ROOT, "src", "styles.css")

#: The four shells and the property each must take from the family, rather than
#: from a literal. ⚠️ NOT AN EXHAUSTIVE STYLE PIN — only the geometry that was
#: duplicated. Colour, border treatment and direction stay each shell's own.
FAMILY: Dict[str, tuple] = {
    ".fm-row": ("padding", "border-radius", "gap"),
    ".reports-entry": ("padding", "border-radius"),
    ".cockpit-attention-row": ("padding", "border-radius", "gap"),
    ".editable-row": ("border-radius",),
}


def _css() -> str:
    with open(CSS, encoding="utf-8") as handle:
        return handle.read()


def _block(text: str, selector: str) -> str:
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\}", text, re.S)
    assert m, f"{selector} has no rule in styles.css"
    return m.group(1)


def test_every_row_shell_takes_its_geometry_from_the_family() -> None:
    text = _css()
    problems = []
    for selector, props in FAMILY.items():
        block = _block(text, selector)
        for prop in props:
            m = re.search(rf"(?:^|;)\s*{prop}:\s*([^;]+)", block)
            if not m:
                problems.append(f"{selector}: no {prop}")
                continue
            if "var(--" not in m.group(1):
                problems.append(
                    f"{selector}: {prop} is the literal {m.group(1).strip()!r}")
    assert not problems, (
        "row shell(s) hard-code geometry the family owns, so 'what a row "
        "looks like' has more than one home again:\n  " + "\n  ".join(problems))


def test_the_family_tokens_are_declared() -> None:
    text = _css()
    # ⚠️ THE RULE, NOT THE FIRST MENTION. `:root` appears in a comment near the
    # top of the file explaining the palette, so `index(":root")` found prose
    # and this test failed against a correct stylesheet — the same
    # measure-the-comment trap this suite has now hit three times.
    m = re.search(r"^:root\s*\{(.*?)^\}", text, re.S | re.M)
    assert m, "styles.css has no :root rule"
    root = m.group(1)
    for token in ("--row-radius", "--row-radius-tight", "--row-pad",
                  "--row-pad-tight", "--row-gap", "--row-gap-tight"):
        assert f"{token}:" in root, f"{token} is used but not declared"


def test_the_four_shells_stay_DISTINCT() -> None:
    """⚠️ THE GUARD AGAINST THE FIX THAT WAS REJECTED. If a later pass collapses
    these into one shell, that is a visible design decision for the owner to
    make on a tablet — not something to arrive at by quietly pointing four
    selectors at identical values. This fails if all four become the same
    shape, so the merge cannot happen by accident."""
    text = _css()
    shapes = {sel: _block(text, sel).split() for sel in FAMILY}
    assert shapes[".reports-entry"] != shapes[".fm-row"], (
        "the stacked entry and the bordered card are now identical — if that "
        "is deliberate, delete one and repoint its callers")
    assert "column" in " ".join(shapes[".reports-entry"]), (
        "`.reports-entry` is no longer a column, so it has stopped being a "
        "stacked entry")
    assert "nowrap" in " ".join(shapes[".editable-row"]), (
        "`.editable-row` learned to wrap — five components depend on it not "
        "doing that")


def test_this_check_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING. Every assertion above passes if the selectors stop
    resolving, and `_block` is one regex away from matching nothing."""
    text = _css()
    assert len(_block(text, ".fm-row")) > 40, "the .fm-row block came back empty"
    assert len(FAMILY) == 4
