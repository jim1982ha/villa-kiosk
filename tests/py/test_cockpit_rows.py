"""A Cockpit "needs attention" row must open what it IS, not what it mentions.

⚠️ THIS SHIPPED AND WAS REPORTED. Every row called `onOpenEntity(item.entityId)`
whatever its kind — and on a FAULT or a SCHEDULE, `entityId` is the DEVICE the
record is linked to, not the record. So tapping "Not working · Open fault ·
Living Room" opened the television's device panel instead of the ticket:

    "I see the device detail, whereas I expect to see the ticket details from
     the Facility menu. Note that it is OK to see the device detail modal to
     open, for the cards that show a device."

The owner drew the line exactly where it belongs. Two of the four kinds ARE
devices (`unavailable`, `alarm`) and must keep the device panel; the other two
stand for a Facility record and must open it.

⚠️ WHY A TEST AND NOT A TYPE. `AttentionItem` is one flat interface for all four
kinds, so `entityId` is legitimately present on a fault — it IS the linked
device, and the fault form uses it. Nothing about the type can say "present, but
not what this row opens". A discriminated union would say it, and would rewrite
every consumer of a list that is deliberately uniform for rendering. The
cheapest thing that notices is a test that reads both files and checks they
agree about which kinds are records.

⚠️ DERIVED FROM THE BUILDER, so a fifth kind is covered on the day it is added.
Listing the kinds here would rebuild the very bug it pins: a rule stated in one
place and applied from memory in another.
"""

from __future__ import annotations

import os
import re
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COCKPIT = os.path.join(REPO_ROOT, "src", "components", "cockpit")
DATA = os.path.join(COCKPIT, "cockpitData.ts")
# ⚠️ THE ROW LIVES IN THE TAB, NOT THE MODAL (2.569.0). Cockpit became a
# Facility tab and `CockpitModal` is now a thin shell around `CockpitTab`;
# this test failed on the move, which is it working — the dispatch it reads
# is the whole point and a path that silently found nothing would pass.
MODAL = os.path.join(COCKPIT, "CockpitTab.tsx")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _record_kinds() -> Set[str]:
    """Kinds whose builder sets `recordId` — i.e. that stand for a record.

    Reads the `items.push({...})` blocks: a block naming both `kind:` and
    `recordId:` is a record row.
    """
    source = _read(DATA)
    kinds: Set[str] = set()
    for block in re.findall(r"items\.push\(\{(.*?)\}\);", source, re.DOTALL):
        kind = re.search(r'kind:\s*"(\w+)"', block)
        if kind and re.search(r"\brecordId:", block):
            kinds.add(kind.group(1))
    return kinds


def _device_kinds() -> Set[str]:
    source = _read(DATA)
    kinds: Set[str] = set()
    for block in re.findall(r"items\.push\(\{(.*?)\}\);", source, re.DOTALL):
        kind = re.search(r'kind:\s*"(\w+)"', block)
        if kind and not re.search(r"\brecordId:", block):
            kinds.add(kind.group(1))
    return kinds


def test_the_builder_still_declares_both_families() -> None:
    """⚠️ VACUOUS-PASS GUARD. If the push blocks are refactored away, every
    check below compares empty sets and reports health forever."""
    records, devices = _record_kinds(), _device_kinds()
    assert records, "no record-backed rows found — this test's anchor moved"
    assert devices, "no device-backed rows found — this test's anchor moved"
    assert not (records & devices), "a kind cannot be both"


def test_every_record_kind_is_routed_to_its_record() -> None:
    """The dispatch in `CockpitAttentionRow` must name exactly the kinds whose
    builder sets a `recordId`. A kind that gains one and is not added here goes
    on opening its linked device — the shipped defect, one kind later."""
    dispatch = _read(MODAL)
    guard = re.search(r"const record = \((.*?)\)\s*\n?\s*\?", dispatch, re.DOTALL)
    assert guard, (
        "the row's record guard moved — this test can no longer see which "
        "kinds it routes, so it would pass on anything")
    named = set(re.findall(r'item\.kind === "(\w+)"', guard.group(1)))
    missing = sorted(_record_kinds() - named)
    assert not missing, (
        f"these kinds stand for a Facility record but the row does not route "
        f"them, so tapping one opens the device it is linked to: {missing}")


def test_a_device_kind_is_not_routed_to_a_record() -> None:
    """⚠️ THE OWNER NAMED THIS HALF TOO: "it is OK to see the device detail
    modal to open, for the cards that show a device." Routing an unavailable
    device or a live alarm into Facility would be the same mistake mirrored —
    and worse, because those rows are the urgent ones."""
    dispatch = _read(MODAL)
    guard = re.search(r"const record = \((.*?)\)\s*\n?\s*\?", dispatch, re.DOTALL)
    assert guard
    named = set(re.findall(r'item\.kind === "(\w+)"', guard.group(1)))
    wrong = sorted(named & _device_kinds())
    assert not wrong, (
        f"these kinds ARE devices and must open the device panel: {wrong}")


def test_a_row_with_nothing_to_open_is_not_a_button() -> None:
    """A `button` that does nothing is worse than plain text: it invites the
    tap. A fault with no device and no handler must render inert — which is
    also what happens for a profile that may not manage the facility, since
    `onOpenRecord` is then never passed."""
    source = _read(MODAL)
    assert "const tappable = !!open;" in source, (
        "tappability must be derived from whether there IS something to open, "
        "not from whether the item happens to carry an entity id")
    assert 'const Row = tappable ? "button" : "div";' in source
