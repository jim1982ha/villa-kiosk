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

The rule existed in the code four times over at that moment — Facility,
Settings, the view switch and Cockpit each carrying an inline button AND a menu
item — and nowhere as a name. (Briefings made it five, which is why the count is
tied to the release that measured it rather than left in the present tense: the
probe below derives the set, and this paragraph is a record of one day.) That is precisely the shape /dry-audit's Part 4 exists to find:
duplication with no helper to violate, so no grep and no test could see a fifth
reader miss it.

⚠️ THE FIRST DRAFT OF THIS PARAGRAPH NAMED THREE, AND NAMED THE WRONG THREE —
"Facility, Cockpit and the view switch", omitting Settings and including Cockpit,
which the first version of the probe could not even see. Written by generalising
from the sites in view, which is the `HOLD_MS_HUD` failure verbatim. Found by
/dry-audit's Part 3 one release later.

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

#: The THREE containers, and what each is worth at a given width:
#:   .hud-center        every width (some children hidden on the phone tier)
#:   .hud-right-inline  desktop and tablet only
#:   .hud-overflow      phone only
CENTRE = 'className="hud-center"'
INLINE = 'className="hud-right-inline hud-group"'
OVERFLOW = 'className="hud-group hud-overflow"'

#: ⚠️ THE MENU'S OWN TOGGLE IS NOT AN ENTRY IN IT. `setMenuOpen` opens and
#: closes the overflow menu; demanding it appear on both surfaces is asking the
#: button to contain itself.
NOT_AN_ENTRY = {"setMenuOpen"}


def _regions() -> Tuple[str, str, str]:
    """The centre row, the inline row and the overflow menu, as source text.

    ⚠️ THERE ARE THREE SURFACES, NOT TWO, AND MODELLING TWO MADE THIS PIN BLIND.
    `.hud-center` is visible at every width; `.hud-right-inline` is desktop and
    tablet; `.hud-overflow` is phone. So the map colour legend, which lives in
    the centre row on a roomy screen and in the menu on a phone, read as
    "menu only" — a false positive that would have made a real one unbelievable.
    The rule is about the inline/overflow PAIR: an entry whose desktop home is
    the centre row needs no inline twin.

    ⚠️ THE OVERFLOW REGION ENDS WHERE THE MENU DOES, not at end-of-file.
    Modals are rendered after it — `CockpitModal` among them — and treating the
    tail of the file as "the menu" reports every callback threaded into a modal
    as a menu-only entry. That was this test's own first false positive.
    """
    with open(HUD_PATH, encoding="utf-8") as handle:
        source = handle.read()
    i_centre, i_inline, i_over = (
        source.index(CENTRE), source.index(INLINE), source.index(OVERFLOW))
    assert i_centre < i_inline < i_over, "regions are expected in source order"
    centre = source[i_centre:i_inline]
    inline = source[i_inline:i_over]
    tail = source[i_over:]
    # The menu ends at the first modal rendered after it.
    end = min((tail.index(m) for m in ("<CockpitModal", "</header>", "</div>\n    </>")
               if m in tail), default=len(tail))
    return centre, inline, tail[:end]


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

    ⚠️ AND A LOCAL OPENER COUNTS — THE FOURTH TIME THIS PATTERN WAS NARROWER
    THAN ITS OWN DESCRIPTION. 2.570.0 merged the alert and Facility buttons into
    one attention entry whose two surfaces both call a local `openAttention()`,
    and the pattern matched neither: the inline row went blind while the menu
    row still matched `onOpenFacility` inside its label ternary, so the pair
    read as menu-only. The entry was on both surfaces the whole time. Widened
    rather than special-cased, because "a function named open*" is what a HUD
    entry's handler looks like when it is not a prop.

    ⚠️ LOCAL STATE COUNTS TOO. Cockpit and the legend are opened by
    `setCockpitOpen` / `setLegendOpen`, not by a prop — so a pattern matching
    only `on(Open|Toggle)X` could not see two of the app's own HUD entries, and
    the first version of this pin was blind to Cockpit while its own docstring
    cited Cockpit as the example to follow. That is the third false reading this
    small function has produced, and every one of them was the region model or
    the pattern being narrower than the thing it describes.
    """
    found: List[str] = []
    for name in re.findall(r"\b(?:on(?:Open|Toggle)|set|open)[A-Z]\w*", region):
        if name in NOT_AN_ENTRY or name in found:
            continue
        if name.startswith("set") and not name.endswith("Open"):
            continue
        found.append(name)
    return found


def test_every_hud_entry_renders_on_both_surfaces() -> None:
    centre, inline, overflow = _regions()
    on_centre = set(_entries(centre))
    on_inline, on_menu = set(_entries(inline)), set(_entries(overflow))

    assert on_inline, "no inline entries found — the region markers moved"
    assert on_menu, "no menu entries found — the region markers moved"

    # An entry whose desktop home is the always-visible centre row needs no
    # inline twin — see `_regions`.
    menu_only = sorted(on_menu - on_inline - on_centre)
    inline_only = sorted(on_inline - on_menu - on_centre)

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
    for marker in (CENTRE, INLINE, OVERFLOW):
        assert marker in source, (
            f"{marker} is gone from HUD.tsx — this test's anchors moved and it "
            f"would otherwise pass on an empty comparison.")


def test_the_probe_ignores_callbacks_threaded_into_modals() -> None:
    """The first version reported `onOpenEntity` as menu-only. It is handed to
    `CockpitModal` as a prop, is not a button on either surface, and is not an
    entry at all."""
    _, _, overflow = _regions()
    assert "onOpenEntity" not in _entries(overflow), (
        "a prop handed to a child component is being read as a HUD entry")


def test_every_entry_names_itself_for_a_screen_reader() -> None:
    """A HUD entry is an icon with no visible text on the inline surface, so
    `aria-label` is the only thing that names it."""
    _, inline, _ = _regions()
    offenders: Dict[str, str] = {}
    for block in re.findall(r"<button[^>]*?>", inline, re.DOTALL):
        if "onOpen" not in block and "onToggle" not in block:
            continue
        if "aria-label" not in block:
            handler = re.search(r"\bon(?:Open|Toggle)[A-Z]\w+", block)
            offenders[handler.group(0) if handler else "?"] = block[:80]
    assert not offenders, f"inline HUD buttons without an aria-label: {offenders}"
