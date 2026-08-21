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

