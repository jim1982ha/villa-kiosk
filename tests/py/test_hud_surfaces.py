"""A HUD entry must render on BOTH surfaces, or it is invisible on half the
devices this villa is operated from.

⚠️ THIS COST A RELEASE. v2.537.0 added the Briefings entry to the overflow menu
only. `.hud-overflow` is `display:none` at every width EXCEPT the phone tier, so
on the owner's laptop — and on the iPad the kiosk is mounted on — there was no
way to open the feature at all. It was found by the owner asking "where is
this?", three releases and one full QA pack after it shipped.

⚠️ AND `/phone-parity` DID NOT CATCH IT. That checklist was run against the diff
and every CSS rule it names was checked, including the one stating that
`.hud-overflow` is phone-only. What was never asked is "is this entry visible on
the device class the owner actually uses" — the checklist covers how a thing
renders, not whether it renders at all.

The rule existed in the code three times over — Facility, Cockpit and the view
switch each carry an inline button AND a menu item — and nowhere as a name. That
is precisely the shape /dry-audit's Part 4 exists to find: duplication with no
helper to violate, so no grep and no test could see a fourth reader miss it.

⚠️ READS SOURCE TEXT, like `test_nginx_routes` and `test_contract_parity`. The
applicable set is "handlers the HUD renders a button for", derived from the file
rather than listed here — listing them would rebuild the very bug this prevents.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Tuple

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUD_PATH = os.path.join(REPO_ROOT, "src", "components", "hud", "HUD.tsx")

#: The two containers, and what each is worth. Both are `.hud-group`s in the
#: same row; CSS decides which one exists at a given width.
INLINE = 'className="hud-right-inline hud-group"'
OVERFLOW = 'className="hud-group hud-overflow"'


def _regions() -> Tuple[str, str]:
    """The inline row and the overflow menu, as source text.

    ⚠️ THE OVERFLOW REGION ENDS WHERE THE MENU DOES, not at end-of-file.
    Modals are rendered after it — `CockpitModal` among them — and treating the
    tail of the file as "the menu" reports every callback threaded into a modal
    as a menu-only entry. That was this test's own first false positive.
    """
    with open(HUD_PATH, encoding="utf-8") as handle:
        source = handle.read()
    i_inline, i_over = source.index(INLINE), source.index(OVERFLOW)
    assert i_inline < i_over, "the inline row is expected before the menu"
    inline = source[i_inline:i_over]
    tail = source[i_over:]
    # The menu ends at the first modal rendered after it.
    end = min((tail.index(m) for m in ("<CockpitModal", "</header>", "</div>\n    </>")
               if m in tail), default=len(tail))
    return inline, tail[:end]


def _entries(region: str) -> List[str]:
    """Handlers this region renders an entry for.

    ⚠️ ANY REFERENCE INSIDE THE REGION COUNTS, and narrowing it to `onClick`
    was this test's SECOND false positive. The inline row renders the view
    switch as `<ViewControls onToggleViewMode={...} />` — a component that owns
    its own buttons — so an onClick-only rule reported it as menu-only when it
    is on both surfaces.

    A reference inside a region means it is rendered on that surface, which is
    the whole question. That is only safe because `_regions` now BOUNDS the
    overflow menu at the first modal: without that bound, every callback
    threaded into `CockpitModal` reads as a menu entry — which was the FIRST
    false positive. The two fixes are the same fix from opposite ends.
    """
    found: List[str] = []
    for name in re.findall(r"\bon(?:Open|Toggle)[A-Z]\w+", region):
        if name not in found:
            found.append(name)
    return found


def test_every_hud_entry_renders_on_both_surfaces() -> None:
    inline, overflow = _regions()
    on_inline, on_menu = set(_entries(inline)), set(_entries(overflow))

    assert on_inline, "no inline entries found — the region markers moved"
    assert on_menu, "no menu entries found — the region markers moved"

    menu_only = sorted(on_menu - on_inline)
    inline_only = sorted(on_inline - on_menu)

    assert not menu_only, (
        "invisible on desktop AND tablet — `.hud-overflow` is display:none "
        f"except on the phone tier: {menu_only}. Add an inline button beside "
        "Facility's, as Cockpit and the view switch already do.")
    assert not inline_only, (
        f"invisible on a phone — the inline row is display:none there: "
        f"{inline_only}. Add a menu item.")


def test_the_two_regions_are_still_findable() -> None:
    """⚠️ A SOURCE-READING TEST THAT CANNOT FIND ITS ANCHORS PASSES VACUOUSLY.
    If someone renames these class strings, the test above would compare two
    empty sets and report health forever."""
    with open(HUD_PATH, encoding="utf-8") as handle:
        source = handle.read()
    for marker in (INLINE, OVERFLOW):
        assert marker in source, (
            f"{marker} is gone from HUD.tsx — this test's anchors moved and it "
            f"would otherwise pass on an empty comparison.")


def test_the_probe_ignores_callbacks_threaded_into_modals() -> None:
    """The first version reported `onOpenEntity` as menu-only. It is handed to
    `CockpitModal` as a prop, is not a button on either surface, and is not an
    entry at all."""
    _, overflow = _regions()
    assert "onOpenEntity" not in _entries(overflow), (
        "a prop handed to a child component is being read as a HUD entry")


def test_every_entry_names_itself_for_a_screen_reader() -> None:
    """A HUD entry is an icon with no visible text on the inline surface, so
    `aria-label` is the only thing that names it."""
    inline, _ = _regions()
    offenders: Dict[str, str] = {}
    for block in re.findall(r"<button[^>]*?>", inline, re.DOTALL):
        if "onOpen" not in block and "onToggle" not in block:
            continue
        if "aria-label" not in block:
            handler = re.search(r"\bon(?:Open|Toggle)[A-Z]\w+", block)
            offenders[handler.group(0) if handler else "?"] = block[:80]
    assert not offenders, f"inline HUD buttons without an aria-label: {offenders}"
