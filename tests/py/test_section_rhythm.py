"""One heading class may not render two ways. The `--container-gap` contract.

⚠️ THE BUG THIS PINS WAS INVISIBLE BECAUSE IT WAS INCONSISTENT. Every rule that
attaches a hint or a field to the thing above it has to cancel whatever the
container already puts between two children — a `gap` in a flex column, nothing
at all in block flow. The shared rules assumed the flex case, so in
`.settings-body`, which is plain block flow, `calc(var(--hint-gap) -
var(--stack-gap))` was a bare -10px that COLLAPSED with the heading's own +6px
into **-4px**: the successor drawn four pixels on top of the heading.

Any call site whose next element happened to carry an inline `marginTop`
overrode that and looked right — so `RENDER QUALITY & LOOK` (followed by a row
with `marginTop: 12`) rendered correctly beside `DASHBOARD TITLE` (a bare
`<input>`) which overlapped, in the same dialog, from the same class. Reported
by the owner as exactly that: same text, two styles.

⚠️ SO THE ASSERTION IS NOT "THE SPACING IS 4px". It is that no call site is
allowed to decide the spacing at all — because a suite that only checked the
stylesheet would have passed on the day this was reported, with three inline
margins in `LegendModal` quietly holding one dialog together.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Dict, List, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS = os.path.join(REPO_ROOT, "src", "styles.css")

#: Containers that own a rhythm. ⚠️ DERIVED FROM THE STYLESHEET, NOT LISTED
#: HERE — a hand-kept list is what stops covering the container added next.
GAP_TOKEN = "--container-gap"


def _css() -> str:
    """The stylesheet with comments STRIPPED.

    ⚠️ NOT OPTIONAL HERE. Every rule this file explains is explained in a
    comment naming the token it is about, so a scan over the raw text matches
    the prose describing the rule as though it were the rule — the exact
    false positive /dry-audit opens by warning against, and the first run of
    the eyebrow check reported five English words as CSS selectors.
    """
    with open(CSS, encoding="utf-8") as handle:
        return re.sub(r"/\*.*?\*/", "", handle.read(), flags=re.S)


def _tsx_files() -> Dict[str, List[str]]:
    """Every tracked TSX file, by path. ⚠️ TRACKED — an uncommitted scratch file
    is not a call site, the rule `feedback_stage-before-gating` records."""
    out = subprocess.run(["git", "ls-files", "src/**/*.tsx"],
                         capture_output=True, text=True, cwd=REPO_ROOT)
    files: Dict[str, List[str]] = {}
    for rel in out.stdout.split():
        path = os.path.join(REPO_ROOT, rel)
        if os.path.exists(path):
            with open(path, encoding="utf-8", errors="ignore") as handle:
                files[rel] = handle.read().splitlines()
    return files


def test_every_container_that_is_cancelled_declares_its_own_gap() -> None:
    """⚠️ A MISSING TOKEN IS NOT A FALLBACK, IT IS AN INVALID DECLARATION.
    `calc(var(--hint-gap) - var(--container-gap))` with the token undefined is
    dropped by the parser, so the rule silently does nothing and the container
    reverts to whichever spacing its children happen to carry — the exact
    failure this whole contract replaces, arriving quietly."""
    css = _css()
    declared: Set[str] = set(
        re.findall(r"(\.[a-z0-9-]+)\s*\{[^}]*" + re.escape(GAP_TOKEN) + r"\s*:",
                   css))
    assert declared, "nothing declares the gap token; this test would be vacuous"

    consumers: Set[str] = set()
    for block in re.findall(r"([^{}]+)\{([^}]*)\}", css):
        selectors, body = block
        if GAP_TOKEN not in body or f"{GAP_TOKEN}:" in body:
            continue
        for selector in selectors.split(","):
            head = selector.strip().split(">")[0].strip()
            match = re.match(r"^(\.[a-z0-9-]+)", head)
            if match:
                consumers.add(match.group(1))

    missing = sorted(consumers - declared)
    assert not missing, (
        f"these containers cancel {GAP_TOKEN} without declaring it, so the "
        f"whole rule is invalid and dropped: {missing}. Declared: "
        f"{sorted(declared)}")


#: ⚠️ BOTH VARIANTS, BECAUSE THE COLLAPSIBLE ONE WAS THE THIRD RENDERING.
#: `.settings-section-toggle` carries `.settings-section-title` too and then
#: overrode its margin, so the same heading collapsed to -2px in one place and
#: -4px in another. Checking only the class that was reported is how a fix
#: covers the instance somebody noticed — `feedback_audit-applicable-set`.
HEADING_CLASSES = (".settings-section-title", ".settings-section-toggle")


def test_no_heading_variant_carries_a_bottom_margin() -> None:
    """⚠️ HALF THE FIX, AND THE HALF THAT IS EASY TO PUT BACK. A bottom margin
    collapses with the successor's negative margin in block flow and is added to
    the gap in a flex column — one quantity cannot do both, which is why the
    space below a heading belongs to the successor alone."""
    css = _css()
    for name in HEADING_CLASSES:
        match = re.search(re.escape(name) + r"\s*\{([^}]*)\}", css)
        assert match, f"{name} is not declared"
        body = match.group(1)
        shorthand = re.search(r"margin:\s*([^;]+);", body)
        assert shorthand, f"{name}: expected a margin shorthand, got: {body}"
        parts = shorthand.group(1).split()
        # top right bottom  |  top right-left  |  all
        bottom = parts[2] if len(parts) >= 3 else parts[0]
        assert bottom.rstrip("px") == "0", (
            f"{name} declares a bottom margin of {bottom}; the space under a "
            f"heading is owned by its successor, once, near {GAP_TOKEN}")
        assert "margin-bottom" not in body, name


def test_there_is_exactly_ONE_section_eyebrow() -> None:
    """⚠️ THE SAME DEFECT ONE LEVEL UP: two TYPOGRAPHIES for one heading.

    `.reports-h3` styled the Briefing dialog's section labels at --text-sm with
    0.04em tracking in --text-muted, while every other dialog used
    `.settings-section-title` at --text-xs with --tracking-eyebrow in
    --text-secondary. Same role, same kind of dialog, visibly different hand —
    and nothing connected them, so neither could be changed without the other
    silently disagreeing.

    ⚠️ THE TOKEN IS WHAT IS CHECKED, NOT THE CLASS NAME. `--tracking-eyebrow`
    is what makes a label an eyebrow; a second class reading it is a second
    definition whatever it is called, and a second class HARDCODING the value
    is the same thing hiding from the grep.
    """
    css = _css()
    users: Set[str] = set()
    for selectors, body in re.findall(r"([^{}]+)\{([^}]*)\}", css):
        if "--tracking-eyebrow" not in body or "--tracking-eyebrow:" in body:
            continue
        for selector in selectors.split(","):
            users.add(selector.strip().split()[-1])
    assert users == {".settings-section-title"}, (
        f"the section eyebrow must have exactly one definition; found {users}. "
        f"A second class in this role is what made the Briefing dialog label "
        f"its sections differently from every other dialog.")

    literal = re.search(r"letter-spacing:\s*0\.18em", css)
    assert not literal, (
        "a rule hardcodes the eyebrow tracking instead of reading "
        "--tracking-eyebrow, which is a second definition the grep above "
        "cannot see")


def test_NO_call_site_decides_the_space_under_a_heading() -> None:
    """⚠️ THE REGRESSION AS REPORTED. Three inline `marginTop`s in LegendModal
    and two in SettingsModal were the only reason some headings looked right,
    and they are what made the fault read as a rendering mystery rather than as
    one wrong formula: the same class, two spacings, per call site.

    An inline margin on the element under a heading is therefore a bug even when
    it looks correct — it is a second definition of a rhythm the stylesheet
    already owns, and the next one will be wrong."""
    offenders: List[str] = []
    for rel, lines in _tsx_files().items():
        for i, line in enumerate(lines):
            if "settings-section-title" not in line:
                continue
            # Walk to the end of the heading element, then to the next element
            # that is neither blank nor a comment — that is what the `+ *` rule
            # in the stylesheet selects.
            j = i
            while j < len(lines) - 1 and "</div>" not in lines[j]:
                j += 1
            for k in range(j + 1, min(j + 8, len(lines))):
                text = lines[k].strip()
                if (not text or text.startswith("{/*") or text.startswith("*")
                        or text.startswith("//") or text.startswith("*/")):
                    continue
                if "marginTop" in text:
                    offenders.append(f"{rel}:{k + 1}: {text[:70]}")
                break
    assert not offenders, (
        "these set the space under a section heading at the call site, which "
        "is how one heading class came to render two ways in one dialog — the "
        "stylesheet owns it:\n  " + "\n  ".join(offenders))
