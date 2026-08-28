"""Who said this — the provenance vocabulary, and its two halves.

⚠️ THE TABLE IS IN TYPESCRIPT AND ITS COLOURS ARE IN CSS, CONNECTED BY NOTHING
BUT A STRING. That is this repository's most repeated defect shape (the store
envelope key, the agent wire map, the nginx location) and it fails the same way
here: a source with no `.source-*` rule renders a chip with **no colour at
all**, and a missing CSS class is not an error in any browser. The stylesheet
says so itself four lines above these rules, about `.cockpit-concern-sev` —
"reusing them would have emitted classes that do not exist: no colour at all,
and silently".

⚠️ BOTH SIDES ARE DERIVED FROM THE TREE. A test listing the six sources would
agree with itself forever and would not cover the seventh.
"""

from __future__ import annotations

import os
import re
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")
CHIP = os.path.join(SRC, "components", "common", "SourceChip.tsx")
STYLES = os.path.join(SRC, "styles.css")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _declared_tones() -> Set[str]:
    """The `tone:` of every entry in `SOURCES`, from the component itself."""
    source = _read(CHIP)
    block = source[source.index("export const SOURCES"):]
    block = block[:block.index("\n};")]
    return set(re.findall(r'tone:\s*"([a-z]+)"', block))


def _declared_sources() -> Set[str]:
    """The KEYS of `SOURCES` — one per producer the UI can label.

    ⚠️ NOT `_declared_tones()`, AND THE DIFFERENCE IS REAL (2026-08-29). The
    count-of-labels test below used the tone set as its stand-in for "how many
    sources are there", which held only while every source had a colour of its
    own. `addon` ("Written by VESTA") deliberately reuses `check`'s tone: both
    mean "VESTA's own deterministic work", they should look like one family,
    and a private colour would be a new CSS class carrying no new meaning. Two
    sources, one tone — so the proxy under-counted and the pin failed on a
    correct tree. The colour tests below still key on TONES, which is right:
    what needs a `.source-*` rule is a tone, not a source.
    """
    source = _read(CHIP)
    block = source[source.index("export const SOURCES"):]
    block = block[:block.index("\n};")]
    return set(re.findall(r"^  ([a-z]+):\s*\{", block, re.M))


def _styled_tones() -> Set[str]:
    r"""Every tone rule in the stylesheet — the ones that SET `--source-tone`.

    ⚠️ MATCHED BY WHAT THE RULE DOES, NOT BY ITS NAME, AND THIS TOOK TWO GOES.
    A bare `^\.source-(\w+)` also catches `.source-chip` and `.source-legend` —
    the base class and the key's layout, neither a source — and each new one
    would need its own `discard()`. This pin caught exactly that the day the
    legend shipped: it reported a source called "legend".

    ⚠️ AND "SETS IT" MUST BE DISTINGUISHED FROM "READS IT". `.source-chip`
    mentions `--source-tone` too, in `var(--source-tone, …)`, so a rule merely
    CONTAINING the property still matched and the pin then reported a source
    called "chip". The declaration is what a tone is, so the pattern requires
    the property to be DECLARED rather than dereferenced: every read of it is
    inside `var(` or `color-mix(`, so a `(` immediately before the name is the
    thing that separates the two, and a lookbehind says exactly that.
    """
    return set(re.findall(r"^\.source-([a-z]+)\s*\{[^}]*?(?<!\()--source-tone:",
                          _read(STYLES), re.M))


def test_the_anchors_still_find_something() -> None:
    """⚠️ THE VACUOUS-PASS GUARD. If either parser stops matching, the two
    comparisons below compare empty sets and report health forever — this
    project has had four counters read `0` for the exact case they existed to
    measure."""
    assert len(_declared_tones()) >= 6, "the SOURCES parser found nothing"
    assert len(_styled_tones()) >= 6, "the stylesheet parser found nothing"


def test_every_declared_source_HAS_a_colour() -> None:
    """A source with no rule renders an uncoloured chip, and silently."""
    missing = sorted(_declared_tones() - _styled_tones())
    assert not missing, (
        f"these sources are declared in SourceChip.tsx and have no "
        f"`.source-*` rule in styles.css, so they render with no colour at "
        f"all: {missing}")


def test_every_COLOURED_source_is_actually_declared() -> None:
    """The other direction: a rule for a source nobody emits is dead CSS that
    the next /dry-audit will re-adjudicate."""
    orphans = sorted(_styled_tones() - _declared_tones())
    assert not orphans, (
        f"styles.css colours these sources and SourceChip.tsx declares no "
        f"such entry: {orphans}")


def test_no_component_INVENTS_a_source_name() -> None:
    """⚠️ `source="…"` MUST NAME A DECLARED KEY. TypeScript already refuses an
    unknown one, so this exists for the case tsc cannot see — a name assembled
    at runtime, or a literal that drifts after a rename. Deriving the keys from
    the table means a rename lands here without an edit."""
    source = _read(CHIP)
    block = source[source.index("export const SOURCES"):]
    block = block[:block.index("\n};")]
    keys = set(re.findall(r"^  ([a-z]+): \{", block, re.M))
    assert keys, "the key parser found nothing"

    used: Set[str] = set()
    for root, _dirs, files in os.walk(SRC):
        for name in sorted(files):
            if not name.endswith(".tsx") or name == "SourceChip.tsx":
                continue
            for hit in re.findall(r'<SourceChip\s+source="([a-z]+)"',
                                  _read(os.path.join(root, name))):
                used.add(hit)
    assert used, "nothing renders a SourceChip — the vocabulary is unreachable"
    assert used <= keys, (
        f"a component names a source the table does not declare: "
        f"{sorted(used - keys)}")


def test_the_chip_EXPLAINS_itself_on_every_source() -> None:
    """⚠️ THE HINT IS THE FEATURE, NOT DECORATION. The chip's whole job is to
    answer "why am I being shown this, and by what?" — a coloured word with no
    explanation is a new piece of jargon rather than a removal of one."""
    source = _read(CHIP)
    block = source[source.index("export const SOURCES"):]
    block = block[:block.index("\n};")]
    labels = len(re.findall(r"^    label:", block, re.M))
    hints = len(re.findall(r"^    hint:", block, re.M))
    assert len(_declared_sources()) >= 6, "the SOURCES key parser found nothing"
    assert labels == hints == len(_declared_sources()), (
        f"{labels} label(s) and {hints} hint(s) across "
        f"{len(_declared_sources())} source(s) — every source needs both")
    assert "{spec.hint}" in source, (
        "the hint is declared and never rendered")
    # ⚠️ NOT THROUGH `title=`, WHICH IS THE POINT (2026-08-28). `InfoHint`'s own
    # header says a native tooltip needs a hover and the target is a
    # wall-mounted iPad, so every `title` written as an explanation is one a
    # touch user cannot reach. This component carried the hint that way for its
    # whole life, and the seven-row legend in another dialog existed to
    # compensate. The chip opens its own bubble now; the legend is deleted.
    assert "title={spec.hint}" not in source, (
        "the chip explains itself through `title` again — invisible on the "
        "device this app is built for")
    assert "InfoHint" in source, (
        "the chip no longer opens its explanation on tap, so on a tablet the "
        "vocabulary is unreadable and the legend has to come back")
