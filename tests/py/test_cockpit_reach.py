"""Merging Cockpit into Facility must not gate it behind `manageFacility`.

⚠️ THE REQUEST WAS ABOUT ONE PERSON'S SCREEN. "Can you merge Cockpit as a tab in
Facility, seeing 2 distinct icons / modals feels redundant" — and it is
redundant, for an OWNER, who holds every capability and can open both. A guest
holds neither `manageFacility` nor `editConfig`; Cockpit was never gated, so the
obvious merge (delete the modal, add a Facility tab) would have removed the
villa's only status view from the profile most likely to be standing in front of
the wall tablet, in the course of tidying somebody else's screen.

So the redundancy is resolved per PROFILE, not per FILE: `CockpitTab` is the one
implementation, `CockpitModal` is a thin shell for the profiles Facility is
closed to, and the HUD's alert icon chooses between them. Nobody sees both.

These are source-reading tests for the same reason `test_cockpit_rows` is: the
property is a relationship between three files that no type can express, and it
is invisible to review precisely because each file looks right on its own.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")
HUD = os.path.join(SRC, "components", "hud", "HUD.tsx")
COCKPIT_TAB = os.path.join(SRC, "components", "cockpit", "CockpitTab.tsx")
COCKPIT_MODAL = os.path.join(SRC, "components", "cockpit", "CockpitModal.tsx")
FACILITY = os.path.join(SRC, "components", "fm", "FacilityModal.tsx")
PERMISSIONS = os.path.join(SRC, "auth", "permissions.ts")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _code(path: str) -> str:
    """The file with its COMMENTS REMOVED.

    ⚠️ TWO OF THE TESTS BELOW FAILED ON THEIR FIRST RUN AGAINST PROSE. The
    header of `CockpitModal` explains why it is not gated on `manageFacility`,
    and the header of `FacilityModal` says where `CockpitModal` went — so a bare
    substring search found the word it was asserting the absence of, in the very
    sentence explaining the absence. /dry-audit step 7 names this exact shape;
    a test that reads source has to read CODE.
    """
    text = _read(path)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
    return text


def test_a_profile_without_facility_still_has_a_cockpit() -> None:
    """The HUD keeps the standalone dialog, and reaches it when Facility is
    absent. `onOpenFacility` is undefined exactly when the profile lacks
    `manageFacility` (see Dashboard), so that branch IS the RBAC rule."""
    hud = _code(HUD)
    assert "CockpitModal" in hud, (
        "the standalone Cockpit was deleted — a guest now has no status view "
        "at all, which is not what 'merge the two modals' asked for")
    opener = re.search(r"const openCockpit = \(\) => \{(.*?)\n  \};", hud, re.DOTALL)
    assert opener, "the alert icon's open path moved — this test is blind"
    body = opener.group(1)
    assert "onOpenFacility" in body and "setCockpitOpen(true)" in body, (
        "the alert icon must send a Facility-capable profile to the tab and "
        "everyone else to the standalone dialog; it now does only one of the two")


def test_the_alert_icon_lands_on_the_tab_its_badge_counts() -> None:
    hud = _code(HUD)
    assert 'onOpenFacility("cockpit")' in hud, (
        "the icon's badge counts the rows the Cockpit tab shows, so opening "
        "Facility on any other tab answers a different question from the tap")


def test_cockpit_is_gated_nowhere() -> None:
    """⚠️ THE POINT OF THE WHOLE ARRANGEMENT. If a capability check appears in
    either shell's open path, the merge has quietly become a restriction."""
    modal = _code(COCKPIT_MODAL)
    assert "manageFacility" not in modal, (
        "CockpitModal must not require the capability it exists to work around")
    assert "manageFacility" not in _code(COCKPIT_TAB)
    # The one capability it does read is about CONTROLS inside the drill-down
    # panel, not about reaching the view — and it lives in the shell.
    assert 'hasCapability(role, "controlEntities")' in modal


def test_there_is_exactly_one_cockpit_implementation() -> None:
    """Two shells, one body. A second copy is how the HUD badge and the modal
    came to disagree about what 'needs attention' meant the first time round —
    see `useVillaAttention`'s own docstring."""
    for host in (COCKPIT_MODAL, FACILITY):
        assert "<CockpitTab" in _code(host), f"{host} does not render the shared tab"
    # The pivot rows, the attention list and the activity feed each appear once.
    for marker in ("cockpit-pivot-row", "cockpit-attention-list", "cockpit-activity-list"):
        hits = [p for p in (COCKPIT_TAB, COCKPIT_MODAL, FACILITY)
                if marker in _code(p)]
        assert hits == [COCKPIT_TAB], (
            f"{marker} is rendered from {hits} — the body must live in "
            f"CockpitTab alone")


def test_facility_does_not_nest_the_cockpit_modal_inside_itself() -> None:
    """It used to open the whole dialog from its Readiness tab. A modal inside a
    modal is two backdrops, and the inner one's click-to-close bubbles."""
    facility = _code(FACILITY)
    assert "CockpitModal" not in facility
    assert 'setTab("cockpit")' in facility, (
        "Readiness' 'N offline' link must switch tabs now, not open a dialog")


def test_the_drill_down_panel_is_a_sibling_not_a_child() -> None:
    """⚠️ BOTH HOSTS, AND THE REASON IS THE SAME IN EACH. SummaryGroupPanel
    brings its own `.modal-backdrop`; nested, a click meant to dismiss just the
    panel closes the workspace behind it. `CockpitTab` therefore renders no
    panel at all and asks through `onOpenGroup`."""
    tab = _code(COCKPIT_TAB)
    assert "<SummaryGroupPanel" not in tab, (
        "the tab renders the panel itself, so inside Facility it would be "
        "nested two backdrops deep")
    assert "onOpenGroup" in tab
    for host in (COCKPIT_MODAL, FACILITY):
        assert "<SummaryGroupPanel" in _code(host)


def test_the_tab_hint_never_overrides_a_record_request() -> None:
    """A caller asking for a specific fault or schedule has named a RECORD; a
    tab hint that won would drop it silently."""
    facility = _code(FACILITY)
    initial = re.search(r"useState<FacilityTab>\((.*?)\);", facility, re.DOTALL)
    assert initial, "the initial-tab expression moved — this test is blind"
    order = initial.group(1)
    assert order.index("openFaultId") < order.index("openTab")
    assert order.index("openScheduleTab") < order.index("openTab")


def test_guest_holds_neither_capability() -> None:
    """⚠️ THE PREMISE OF EVERY TEST ABOVE, CHECKED RATHER THAN ASSUMED. If a
    guest ever gains `manageFacility`, the standalone shell has no audience and
    this whole arrangement should be revisited — not left standing unread."""
    perms = _read(PERMISSIONS)
    guest = re.search(r"guest: \{(.*?)\n  \},", perms, re.DOTALL)
    assert guest, "the permission matrix moved — this test is blind"
    assert "manageFacility" not in guest.group(1)
