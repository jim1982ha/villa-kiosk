## 2.760.0

### Fixed — tooltips that read as one long shouted sentence
The Home Assistant tools hint ran three ideas together with bold words inside
them, and was reported twice. It is now short sentences, one idea per paragraph.
Two other hints had the same shape and were rewritten with it. The measure is
sentence length, not total length: the fixed tools hint is longer than the
version that was reported and reads far more easily, because its longest sentence
went from 32 words to 16 — a word budget would have forced the wrong edit,
cutting content instead of cutting clauses. Hint paragraphs also gained a spacing
rule; the browser default is 1em, which is enormous inside a small bubble.

## 2.759.0

### Fixed — the speed/AI/offline row said one thing and drew another
Both glyphs were fixed regardless of the value, so a struck wifi sat beside
"Needs internet" and a plain sparkle beside "No AI" — on three of the five tabs
the picture negated the words next to it. Each now follows its value, with one
strike rule rather than a second icon, since lucide has no struck sparkle and
that is this app's AI mark everywhere else. The row also moved directly under the
step number and name: it is a header, not a footnote after the description. And
Settings moved into the advanced dialog, now "Settings & others".

## 2.758.0

### Fixed — the Home Assistant tools switch never said what it does, and its number was wrong
The description opened on instruction sheets and tokens and never told you, in
your own terms, what the assistant can do differently when it is on. It now leads
with that: either way it reads each device's recorded history, its own earlier
findings and your maintenance record; on adds searching Home Assistant for a
device by name, reading an integration's details or checking system health. And
"about five times cheaper" was wrong — five times is what is SENT each step, but
an investigation is about twice as cheap, because the conversation and the
answer do not shrink with the tool list.

## 2.757.0

### Changed — the last "open" architecture gap was measured and was never real
"Two report generators over overlapping facts" had been carried forward for
months as the final divergence item, and I proposed a redesign of the report
composer on the strength of it before measuring. There is one renderer: it holds
114 f-strings, 44 bullets and 60 headings and dispatches every section from a
table, while the synthesis layer has 15 f-strings and no rendering vocabulary. Its
three input shapes exist because a blueprint incident, a statistical finding and
an investigated concern are three different kinds of fact — collapsing them would
delete fields four sections render. A test now checks that boundary.

## 2.756.0

### Changed — four settings became two, and the cutover page is gone
`shadow` + `investigate_mode` were two stored values for one three-position
choice, and "stay silent AND ask first" was reachable — the state this villa
spent its whole observation period in, producing an empty column that read as a
verdict on the assistant. It was a verdict on the settings. Now one `mode`.
`max_turns` + `max_tool_calls` became one `depth`, since two free integers could
hold a pair that cannot happen. Older settings migrate on read. The chat
sub-ceiling is gone — three ceilings for one budget, only one of them priceable.
The Handover tab and its diff are deleted: that cutover is decided.

## 2.755.0

### Changed — one switch now decides which layer watches the villa
Supervision on: the assistant supersedes your automations and every built-in
check runs. Off: your automations do the job. That replaces a six-outcome gate
weighing whether a blueprint was installed, whether it had ever fired, how long
the collector had listened, a 45-day grace window and an override flag — one
branch of which could never be reached, so a switched-off automation kept its
replacement switched off permanently while the briefing promised the check would
run "after 45 days". Gone with it: `agent_owns_analysis` and its toggle,
`covered_but_silent`, and the per-device dedupe. A villa deliberately running
both layers on one device now hears about it twice, which is true.

## 2.754.0

### Changed — five agent components were named after a page that never rendered them
`CockpitQueue`, `CockpitConcerns`, `CockpitProposals`, `CockpitMemories` and
`CockpitReview` sat in `components/cockpit/` and were imported only by the VESTA
Agent modal; the Cockpit imports none of them, and every one of them imports only
from `@/agent/*`. The name cost a real misunderstanding — explaining why the
Triage tab was blank read as though a Cockpit setting reached into the agent.
It does not, and nothing in the Cockpit ever has. Renamed to `Agent*` and moved,
with a pin that fails if an agent surface imports from the cockpit folder again.

## 2.753.0

### Changed — rationale moved into (i) tooltips, and the Triage tab stopped being blank
Six paragraphs of "why" sat on screen where a line plus a tooltip does the job; a
scan found every body paragraph over two lines without one. The Triage tab
rendered a step header over nothing on a villa running Live — its approval queue
is correctly empty there, but the tier's real output was only visible under
Advanced. Also: `.fm-list` was the one list class not resetting its bullet; the
segmented control's height is a token now, tighter for a mouse and the full 44px
for a finger; a field's name sits under its own control; Act & Tell asks who
decides before when to interrupt; the source key moved to Advanced.

## 2.752.0

### Fixed — supervision cost $8.55/day because 84% of every request was tools it never called
Measured, not estimated: the investigation prefix was 52,108 tokens per turn, of
which 43,700 were 44 tool schemas — Home Assistant's whole catalogue, folded in
for chat and inherited by the scheduled tiers, which its own trace shows reached
for one of them. The autonomous tiers now carry the ten they use (`ha_tools`
puts the rest back); turns 8→4 and investigations per pass 3→2, both of which
bound every time and so were multipliers, not ceilings; plus a daily dollar
ceiling, since a request count spans 37x in price. An escalated device also
carries its entity id now, so its concern can match what an automation reported.

## 2.751.0

### Fixed — "not matched yet (24)" read as a verdict when it was arithmetic
Every finding lands in that list when the other column is empty, so the count
says nothing about the assistant — one that has raised nothing produces exactly
the page one that is failing produces. 2.750.0 dropped that guard while removing
five other instances of the same defect; it is back, with the pair that says
where the money went (investigated → raised). /dry-audit: the pass reason is
prose parsed by three readers in two languages and nothing joined them (pinned);
CLAUDE.md's journal bound and store-factory count were stale; `badge` is muted.

## 2.750.0

### Changed — the handover tab reported technically and gave no usable insight
It argued a decision the move to agent-owned supervision had closed, headlining
"24 things your automations caught and the villa did not". Rebuilt as progress:
is it looking, was it handed anything to read, how much has it matched. Lists
now group by check with a count — the diff keys on equipment, so four devices
failing one check drew four identical rows — a pass that never ran no longer
reports as quiet, and the per-row doc/model fields moved into the CSV.
Supervision off dims the three tabs that stop; its header control is an icon.

## 2.749.0

### Changed — a master switch in the header, advanced in the footer, and a precedence stated as fixed

The one setting that stops all spending was the first row of the fifth tab; it is now a switch in the
dialog header, visible from every tab and no longer duplicated below. "Cost, people and advanced" moved
into the footer for the same reason — it was reachable from one tab out of six. Two blueprint families,
control and vesta, rendered a blank role beside a real count, which reads as "this does nothing" rather
than "nobody described it"; both are now named, and an unlisted one says so. Both legitimately show no
events — the control family operates devices and never reports, and the vesta entry only listens.
Finally the briefings tab asserted that your automations are the primary layer and the checks a
fallback, which is the opposite of what happens once the assistant owns detection; it now says
whichever is true.

