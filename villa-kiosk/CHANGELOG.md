## 2.775.0

### Added — "Dismiss all" on the closer-look queue, which could not empty itself
An `awaiting-approval` item is only ever written in "Ask me first" mode, and it
only leaves the list when its own run id is settled. So a villa that has since
moved to Observe or Live has a queue nothing can enter and nothing can drain —
the reference villa held twenty-four, four of them the same phase and four the
same pump. Clearing it meant one press per item. Dismiss only, never
"investigate all": one investigation is a full frontier run.

## 2.774.0

### Fixed — every facility manager job would have been lost on a Shopping List
Raising a job always sent a `description` with the to-do item. Home Assistant's
built-in Shopping List — the list most people already have, and the obvious one
to name — does not accept one, and answers HTTP 500, so the whole item was
refused and the failure was swallowed as "failed". The description is now sent
only where the list declares it accepts one, and omitted when that cannot be
read: a terser job is still a job, a rejected one does not exist.

## 2.773.0

### Fixed — "Check the villa now" said the check stopped every single time
The button reported success from the response's `ok` field, which the proxy
computes as "there is no reason" — and a pass returns a reason on every path,
including "nothing to escalate" and "escalated 3 (investigated 2)". So it was
false for every pass that had ever succeeded, and a run that escalated three
subjects and investigated two reported "The check stopped". It now says which
of the three things happened, using the same rule as the list above it.

## 2.772.0

### Fixed — two comments that described the code inaccurately
A note in the reports client counted ten sibling calls where there are eight,
and the new "Check the villa now" button claimed its permission was the one
gating every agent control. It gates one other; three use `manageFacility`
instead. That sentence would have sent the next reader to hide the facility
manager's own workspace from them. Comments only — no behaviour changed.

## 2.771.0

### Fixed — the escalation line counted concerns it then accounted for nowhere
The first end-to-end capture read `considered 2, sent 0, held 0, suppressed 0,
stood down 0` — five numbers explaining neither concern. A warning never
escalates and a recent critical is inside its first band; both verdicts were
correct and neither had a counter, so a sweep working perfectly looked like one
that had silently dropped two concerns. Each quiet outcome is now counted with
its reason.

### Changed — one CSV button on Recent requests, not two
The pager row carried a second button calling the same download as the toolbar
above it. The toolbar keeps it, beside the range picker that decides what an
export would contain.

## 2.770.0

### Changed — the third footer button is gone, and the other two say what they do
Cancel discarded a draft and closed without asking — a shortcut past the very
question Close raises, which already offers Save, Discard and Stay. On a clean
dialog it was indistinguishable from Close. Closing now always asks when there
is something unsaved, which is the standard behaviour and the only exit.

Save and Close carry their words on a desktop screen and stay icon-only at the
phone tier, where two labelled buttons beside the version string do not fit and
the row used to wrap.

## 2.769.0

### Fixed — there was no way to run a check on demand
"Check the villa now" lived on the Handover tab, and 2.756.0 deleted that page
along with its only button. The `/agent-run-now` route survived with nothing
calling it, and the Triage tab went on telling readers to press a button on a
tab that no longer existed. It is back, on Triage, beside the list of checks it
adds to. Owner-only, and the label says it spends a request.

### Fixed — two calls resolved their URL by luck
`reports-tasks` and `reports-tasks-complete` were fetched as bare relative
paths, which match the Home Assistant ingress base only because the SPA is
served with a trailing slash. Both now go through `ingressPath` like the other
ten calls beside them.

## 2.768.0

### Fixed — "Check the villa now" investigated, concluded, and told nobody
The button ran a triage pass directly, and the two delivery sweeps were the tail
of the SCHEDULED pass — so `outbox.sweep` had exactly one caller. A check an
owner started himself could mint a concern, record it and show it on the tablet
while sending no message and raising no facility manager job until the six-hourly
clock came round. Both halves were correct; nothing joined them.

### Added — a pass is now readable end to end in the add-on log
Every tier stamps its line with a shared pass id and reports even when it did
nothing, because "no line" and "nothing to do" read identically. The villa
document and the routing verdict had no voice at all; a document too thin to be
about a villa now warns instead of being a number nobody reads.

## 2.767.0

### Removed — a status helper nothing ever called
It was written three releases ago "for the settings screen" and never wired to
one; its only caller was the test that checked it existed. The question it was
meant to answer — whether the task loop is switched on — is already answered by
the field on Act & Tell, where an empty list is the off state.

## 2.766.0

### Changed — the app says Facility Manager everywhere, including the new parts
Your standing instruction is that this product calls that person the Facility
Manager. It was applied to the briefing, then missed once, and missed again in
the task feature shipped three releases ago — a settings field labelled
"Caretaker to-do list" and a whole module written around the word. The check that
forbids it only ever scanned the briefing code, which is where the rule was born
rather than where it applies; it now covers the assistant's own modules and the
app, and both go red under mutation. The blueprints' `caretaker_todo_list` input
keeps its name deliberately: renaming it would break every automation already
built on it.

## 2.765.0

### Changed — the actuation switch now sits with the list it depends on
Its description had to end by pointing at a list on another tab, and since the
Settings move, another dialog: "there is no list and the text is not clear about
it". The switch is on Act & Tell now, directly above the devices it governs, so
the cross-reference is gone rather than reworded. A concern row also stacks its
four labels into one narrow column instead of laying them across the line, which
gives the sentence the width it needed. And the concerns list now says what gets
chased — only a critical concern is re-sent; a warning is told to you once and
then waits, which is why a delivered warning sits at "nothing done yet".

## 2.764.0

### Fixed — nginx served requests before the backend was listening
Every restart logged a pair of "connection refused" errors on the two things a
kiosk page requests the moment it loads. s6 starts nginx as soon as the backend
process has spawned, not when it has bound a socket — and the backend makes two
Supervisor round trips before it serves anything, so there is a real window where
one is accepting and the other is refusing. nginx now waits for the backend,
bounded to ten seconds, and starts anyway if it never comes up: it serves the
diagnostics that would explain such a failure, so refusing to start would hide it.

## 2.763.1

### Fixed — a failing test shipped because the gate was piped
The hard-rules check went red on an unclassified placeholder in the new test file
and 2.763.0 was committed anyway: the verification command ended in a pipe, so the
shell reported the exit status of `tail`, not of pytest. Nothing about the feature
is affected — the placeholder is a one-letter stand-in in a test — but the gate
was not a gate.

## 2.763.0

### Added — a finding the villa sends you can become a job somebody ticks off
Retiring the maintenance, ROI and audit automations kept their detection and
silently dropped the other half of what they did: raising a facility manager task, then
chasing whoever is responsible until somebody answers. The assistant could not
write a to-do item at all, so a finding was something to read and never something
anybody was asked to do. Name a to-do list under Act & Tell and every finding the
villa sends you is added to it, carrying the finding's reference so one tick
counts on the tablet, on the list and in the next briefing. With the VESTA task
automation installed it also arrives on Telegram with a Done button.

## 2.762.0

### Removed — a trigger nothing could fire
The agent's settings offered three triggers and one of them, `event`, had no
producer anywhere: no code path ever started a pass on a villa event. It was
never in the interface either, which is the only reason it never misled anyone —
switching it would have changed nothing in either direction. Wiring it was the
alternative and was refused: a villa event waking the agent means a full
investigation every time something trips, and the safety automations that would
trip it already alert you directly in under a second. A test now checks that
every trigger an owner can switch on has something able to fire it.

## 2.761.0

### Fixed — the Home Assistant switch described the wrong difference
The first two rewrites both implied that "off" means no Home Assistant access.
It does not: the assistant reads device state, history and automation traces from
Home Assistant either way. What "off" restricts is reach — it can examine any
device the villa already knows about, and cannot go looking for one nobody has
mentioned. That is what the description now says, and it drops the tool counts,
which were our plumbing rather than anything a reader can act on. The test that
required the count is now conditional: it stops a stated number drifting, and no
longer insists the number be stated.

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

