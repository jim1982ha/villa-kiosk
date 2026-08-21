## 2.571.0

### Added — the briefing now reports what the kiosk is showing, and a test proves they agree

A brief could report nothing while the Cockpit listed four offline devices,
because the report pipeline had never read the kiosk's device configuration and
`ReportContext` carried no live state and no maintenance record. Briefings now
open with a "Right now" section — offline devices, alarms, open faults, overdue
maintenance — built from the same rules the tablet uses, including the owner's
own labels and dismissals. A parity harness runs the kiosk's real code and the
add-on's over four deployment shapes and fails on any difference.

## 2.570.0

### Fixed — one attention button on the top bar, and its badge counts everything

2.569.0 pointed the alert icon at Facility's new Cockpit tab and left the
Facility icon beside it, so two different glyphs opened the same dialog. Worse,
they carried different numbers: 5 from the shared attention list (offline
devices, open faults, overdue maintenance, active alarms) against 1 from a
second, narrower count re-derived inside the HUD. There is now one button — a
clipboard into Facility, or a triangle into Cockpit for a profile that has no
Facility — and one count, the exhaustive one.

## 2.569.0

### Changed — Cockpit is a tab of the Facility workspace, not a second modal beside it

Two icons on the top bar opened two dialogs that answer the same question, which
is what an owner sees because they can open both. Cockpit is now Facility's
first tab and the alert icon lands on it. The standalone dialog stays for the
profiles Facility is closed to — a guest holds no `manageFacility` and Cockpit
was never gated, so deleting it would have removed the villa's only status view
from the person most likely to be at the tablet. One implementation, two shells.

## 2.568.0

### Fixed — a brief said "your own automations already cover this" about a rule that had never fired

The Cockpit listed four unavailable devices while the brief sent minutes later
mentioned none of them, because the built-in "Meters that stopped reporting"
check stands down wherever a blueprint layer exists — and the blueprint covering
it had `last_triggered: null` on every instance since installation. The
stand-down was decided per CATEGORY, which read healthy because other
maintenance rules were busy. Coverage is now tracked per blueprint, and a check
that stood down for a rule which has never reported says so and names it.

## 2.567.0

### Changed — a briefing result no longer pushes the tab body down to say "sent"

"Sending…" and "Sent to 1 recipient(s)." rendered as a full-width banner above
the tab, so a one-word outcome moved every control under it twice per send. The
result is now a single icon beside the Briefings title, with the wording in its
tooltip. A FAILURE still opens the full sentence in the body, because a tooltip
is mouse-only and this is operated from a tablet; tapping the icon toggles it.

## 2.566.0

### Changed — the briefing says the same things in fewer, plainer words

The monitoring section repeated one ninety-eight character sentence three times,
once per check that stood down, and hedged another line with twenty words that
amounted to "unknown". Checks that stood down for the same reason now share a
line, a silent category is named instead of counted, and the older-format notice
leads with what to change. Two headings that ran together without a gap are
separated.

