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


def _styled_tones() -> Set[str]:
    """Every `.source-x` rule in the stylesheet, minus the base class."""
    found = set(re.findall(r"^\.source-([a-z]+)\b", _read(STYLES), re.M))
    found.discard("chip")
    return found


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
    assert labels == hints == len(_declared_tones()), (
        f"{labels} label(s) and {hints} hint(s) across "
        f"{len(_declared_tones())} source(s) — every source needs both")
    assert 'title={spec.hint}' in source, (
        "the hint is declared and never rendered")
