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
    opener = re.search(r"const openAttention = \(\) => \{(.*?)\n  \};", hud, re.DOTALL)
    assert opener, "the alert icon's open path moved — this test is blind"
    body = opener.group(1)
    assert "onOpenFacility" in body and "setCockpitOpen(true)" in body, (
        "the alert icon must send a Facility-capable profile to the tab and "
        "everyone else to the standalone dialog; it now does only one of the two")


def test_the_alert_icon_lands_on_the_tab_its_badge_counts() -> None:
    """⚠️ ONLY WHEN THERE IS SOMETHING TO SHOW (2.570.0). The badge counts the
    rows the Cockpit tab lists, so a tap on a non-zero badge must land there.
    At zero it must NOT: Cockpit then reads "everything looks fine" in front of
    the work board somebody opened Facility to reach."""
    hud = _code(HUD)
    assert 'onOpenFacility(attention > 0 ? "cockpit" : undefined)' in hud


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


# ── one attention entry, one count (2.570.0) ─────────────────────────────────
#
# ⚠️ 2.569.0 MOVED THE REDUNDANCY INSTEAD OF REMOVING IT. Cockpit became a
# Facility tab and the alert icon was pointed at it, so an owner had a triangle
# and a clipboard side by side opening the SAME dialog — reported as "I see 2
# Facility modals (with 2 different icons)". I had argued the two icons were
# justified because they carried different badges. They did: 5 and 1, about one
# villa, on one bar, one a strict subset of the other and neither labelled.

def test_the_top_bar_has_one_attention_button() -> None:
    """Two buttons that open the same dialog is the reported bug. The glyph is
    chosen, not duplicated — `AttentionIcon` is the single element."""
    hud = _code(HUD)
    assert "const AttentionIcon = onOpenFacility ? ClipboardList : TriangleAlert;" in hud, (
        "the attention glyph must be ONE element whose icon depends on the "
        "profile, not two buttons rendered side by side")
    assert hud.count("<AttentionIcon size=") == 2, (
        "expected exactly two renders — the inline top-bar button and the "
        "phone overflow row; a third is a surface that can drift")


def test_the_badge_counts_every_kind_of_problem() -> None:
    """⚠️ EXHAUSTIVE, BY THE OWNER'S REQUEST: "make sure the badge in the icons
    is exhaustively considering the full number of major issues". That is
    `buildAttentionItems`' four kinds — unavailable devices, open faults,
    overdue schedules and active alarms — never a subset."""
    hud = _code(HUD)
    assert "const attention = attentionItems.length;" in hud
    assert "facilityAttention" not in hud, (
        "the second count is back. It re-derived late tasks + open faults "
        "inline, which is both a subset of the badge beside it and a second "
        "definition of 'an open fault'")


def test_the_hud_no_longer_re_derives_facility_state() -> None:
    """The inline copy read `scheduleBoard` and `fmData.tickets` — the same two
    loops `buildAttentionItems` runs. One source or it drifts; that drift has
    already shipped once, as "the menu says 4 but the modal says 5"."""
    hud = _code(HUD)
    for symbol in ("scheduleBoard", "useFmData"):
        assert symbol not in hud, (
            f"HUD reads {symbol} again — attention state has one owner, "
            f"`useVillaAttention`")


def test_the_landing_tab_follows_the_badge() -> None:
    """The icon said "5 things need attention", so the tap must show those five.
    With nothing to show, Cockpit is a page reading "everything looks fine" in
    front of the board somebody opened Facility to reach."""
    hud = _code(HUD)
    assert 'onOpenFacility(attention > 0 ? "cockpit" : undefined)' in hud


# ── briefing coverage on the tablet (2.572.0, P5) ────────────────────────────

def test_the_coverage_block_is_gated_the_same_way_briefings_is() -> None:
    """⚠️ NOT BY LETTING A 403 DECIDE. `/reports-diagnostics` is owner-only
    server-side whatever the browser sends, so asking as a guest is a pointless
    request per open AND puts "the briefing subsystem exists" in front of a
    profile that cannot act on it.

    ⚠️ THE SURFACE MOVED IN v2.700.0 AND SO DID THIS TEST, rather than being
    deleted with the block. The fact it protects did not move: the gate now
    belongs to the Briefing dialog's owner-only tabs, and the Cockpit must no
    longer reach that endpoint at all — which is a STRONGER statement than the
    one this made before, and is what makes the move checkable rather than
    merely done."""
    tab = _code(COCKPIT_TAB)
    assert "fetchReportsDiagnostics" not in tab, (
        "the Cockpit still probes the owner-only diagnostics endpoint; that "
        "block moved to the Briefing dialog's Coverage tab")
    # ⚠️ THE ANCHOR MOVED AGAIN ON 2026-08-29, AND THE FACT DID NOT. The dialog
    # went from four tabs to two, so "coverage" is no longer a tab id — it is a
    # SECTION of the Briefing tab. What must stay true is that whatever tab
    # renders `CoverageTab` is owner-gated, so this now reads the gate off the
    # tab that mounts it rather than off a name that can be renamed again.
    modal = _code(os.path.join(SRC, "vesta", "brief", "components", "ReportsModal.tsx"))
    assert "<CoverageTab" in modal, "the dialog no longer renders the Coverage block"
    mount = modal[modal.index("<CoverageTab") - 400:modal.index("<CoverageTab")]
    tab_id = mount.rsplit('tab === "', 1)[-1].split('"')[0]
    assert tab_id, "could not read which tab mounts CoverageTab"
    entry = modal[modal.index(f'id: "{tab_id}"'):]
    entry = entry[:entry.index("}")]
    assert "configure: true" in entry, (
        f"the tab mounting CoverageTab ({tab_id!r}) is not owner-gated, so the "
        "briefing subsystem is visible to a profile that cannot act on it")


def test_the_briefing_dialog_reads_the_live_listening_field() -> None:
    """⚠️ `onlineSince` IS PERSISTED AND ANSWERS A DIFFERENT QUESTION — "has
    this villa ever had a listener", which reads true forever after the first
    connect. That is the precise lie `connected` was added to replace, and
    carrying the block to a new surface is exactly when it would come back."""
    # ⚠️ ANCHORED ON THE SUBJECT, NOT THE FUNCTION NAME (2026-08-30). This read
    # `function listeningFindings`, which vanished when the two cards became one
    # sentence — the guard fired rather than passing blind, which is the guard
    # working, but a pin that breaks on a rename it does not care about costs a
    # release. Any function whose name carries "listening" is the block.
    tab = _code(os.path.join(SRC, "vesta", "brief", "components", "CoverageTab.tsx"))
    block = re.search(r"function \w*[Ll]istening\w*\((.*?)\n}", tab, re.DOTALL)
    assert block, "no listening block in CoverageTab — this test is blind"
    assert "collector.connected" in block.group(1), (
        "liveness must come from `connected`, not from a persisted timestamp")
    # ⚠️ THE LIVENESS TEXT ITSELF, NOT A POSITIONAL HEURISTIC. The first cut
    # asserted `onlineSince` appeared nowhere before `connected` — false by
    # construction, since the date is FORMATTED first and only then does
    # `connected` choose the wording. What matters is which field decides:
    # the line that picks "Listening" vs "Not listening" must read `connected`.
    decider = [ln for ln in block.group(1).split("\n")
               if "listening =" in ln or "listening=" in ln]
    assert decider, "no liveness decision found in the block"
    assert "connected" in decider[0], (
        f"liveness is decided by {decider[0].strip()!r} — it must be "
        "`connected`, the live socket, not a persisted timestamp")


def test_the_last_briefing_is_the_NEWEST_entry() -> None:
    """⚠️ THE BUG THE MERGE FOUND, AND IT HAD BEEN ON SCREEN FOR RELEASES.
    `fetchReportsHistory` reverses the stored ring and returns NEWEST FIRST; the
    Cockpit block read `[length - 1]` and so printed the FIRST briefing ever
    sent under the words "Last briefing". Two readers of one array is what made
    it visible, which is the argument for merging rather than copying."""
    modal = _code(os.path.join(SRC, "vesta", "brief", "components", "ReportsModal.tsx"))
    assert "history[0].at" in modal, (
        "the newest entry is [0] — fetchReportsHistory returns newest first")
    assert "history[history.length - 1]" not in modal


def test_an_unreachable_addon_says_so_rather_than_reading_as_healthy() -> None:
    """Three kinds of empty, again: "not listening", "listening and quiet" and
    "could not ask" mean different things and the last must not render as the
    second."""
    tab = _code(os.path.join(SRC, "vesta", "brief", "components", "CoverageTab.tsx"))
    assert "!diagnostics.reachable" in tab
    assert "could not be reached" in tab
