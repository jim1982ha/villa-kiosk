## 2.889.0

### Changed — repeated automations are one line with a count, and the record pages

A motion light fires dozens of times a day, so a line per firing made both the
screen and the briefing a wall nobody reads. Each automation is now one row —
which it is, how often, and the totals across those firings, summed rather than
sampled, because one firing's figure printed beside a count is wrong by the size
of the count. The record's table pages like every other, through one shared
control the delivery record now uses too: one page size for the app rather than
one per table. The briefing's own summary counts what a reader sees, not raw
entries.

## 2.888.0

### Changed — one tab per step, so the page stops scrolling past what you came for

Four steps, four tabs: what is watched, what happened, what it can see, the
briefing itself. Merging them onto one page was right while the page was short;
adding the record made it long enough that a reader scrolled past the thing they
opened the dialog for — and a single tab chip above a scrolling page is a
control that does nothing. What happened sits before what it can see, because
the events come first and the question of whether the property could have
measured them comes after.

## 2.887.0

### Changed — the record's field names are pinned across the language boundary

An audit of the two releases that built the record found the contract unguarded:
its fields are written by three Python writers and read by the browser, and
nothing checked the pair. A key the browser reads but nobody writes does not
fail — it renders empty, which on that screen is indistinguishable from a
period in which nothing happened. Now derived from both sides, so a fourth
writer is covered on the day it is written. Also removed one CSS rule left
behind when the history line moved out of the check cards, and corrected the
architecture document, which still described automations as never being read.

## 2.886.0

### Added — "What happened" on screen, and the dialog is one tab again

The record is now visible where it is read: everything the next briefing will
summarise, newest first, filtered by who reported it — your automations, the
VESTA Agent, or something it noticed but never investigated. Each row can be
deleted, and the wording says plainly that this deletes history rather than
ticking a job off a list. The Instant alerts tab is gone: it listed automation
families with no live data, and those same automations now appear as what they
actually did, with their own figures. A filter replaced a tab.

## 2.885.0

### Added — one record of what happened, and the briefing reads it

Automation firings, triage flags and the agent's alerts now land in a single
ledger, filled the same way whichever way the Supervision switch is set — the
switch is never consulted; what differs is which sources happen to be writing.
Home Assistant announces every automation itself, so nothing in your Home
Assistant had to change, and your blueprints' own figures (duration, kWh, cost)
are picked up where they send them. A flagged item and the alert it became
share one key, so the briefing tells one story rather than counting it twice,
and a flag that was never investigated finally has somewhere to say so.

## 2.884.0

### Fixed — the listening state is one sentence, so it is one line on a phone

Two short facts did not need two bordered cards. The previous attempt put them
in a two-column grid, which is still two lines at the width the dialog actually
has on a handset — so it did not answer the request at all. They are now a
single line, and the warning colour survives the merge: if nothing is listening,
or no briefing has ever been sent, the line still reads as a fault rather than
losing the signal to save a box.

## 2.883.0

### Fixed — coverage explains itself; briefings hyperlink where allowed; "Trend checks"

The check cards' height had one root cause: paragraphs carry margins Triage's
rows never had — the column now owns its rhythm. "Needs attention" is renamed
"Set-up warnings" and says why it is not an alert: configuration problems,
gone when fixed, nothing to acknowledge. The listening pair sits on one row.
Briefings now carry the same hyperlinked VESTA line as alerts wherever the
notify service itself declares an HTML option — one dialect, one escaper, no
platform names. The checks are "Trend checks" everywhere, ending the collision
with the VESTA Agent's "Check the villa now". Add-schedule rides the last row.

## 2.882.0

### Added — the As-Built technical authority, generated from the code and pinned

The architecture document is no longer a patched proposal: a new generator
reads every table from the code at build time — the four loops, every config
dial with its shipped default, the checks and their windows, the tools per
tier, the acts, the escalation bands, the routes and stores — so a figure that
drifts is a red build, not a wrong sentence. A tracked test pins every table
non-empty and spot-checks them against the live modules; its empty-table guard
caught the store parse finding nothing on its very first run. The old HLD
moves to the archive as the design-era record. No behaviour change.

## 2.881.0

### Fixed — the Briefing tab's cards, columns and duplicate blocks; one vocabulary

The check cards now use the same card shell as the Triage tab. The composition
list shares one label column across all rows instead of re-sizing per row. The
two "listening since" blocks left this tab — the coverage section was already
their home. "Adding your own checks" is gone as a section: it had no controls,
and in 2.879.0 its tooltip had silently received the checks' own (i) content
because two hints shared one label. Its facts moved into The checks' (i). The
UI now says "VESTA Agent" wherever it means the agent, and "Supervision is
ON/OFF" wherever it means the switch.

## 2.880.0

### Changed — the briefing's author is named for what it is, and the two alert views name each other

`agent/fallback.py` wrote every briefing yet was named for its rarest job; it
is `compose.py` now, with `brief` the author and `ladder` the genuine fallback
used only when the author raises. No behaviour change — the hooks, both
accurately named, are untouched. The Reflex tab and the Instant alerts tab now
say they are one list seen from two doors, and both state what the supervision
switch does and does not change: these automations run identically in either
mode; the switch decides only whether the agent also watches and investigates.

## 2.879.0

### Changed — the Briefing tab now says what a briefing is made of, and its cards match

The tab opens with the composition table the owner asked for: four ingredients,
each with when it is read and the window it covers — including the to-do items,
which are scanned across every list at composing time and carried only when
this system wrote them. "VESTA's own checks" is renamed "The checks", the
document's own word, and the (i) answers the question the old name invited:
not the agent's Observe step — Observe journals live changes, a check reads
weeks of history, and the agent may run these checks as a tool while
investigating. The history note left the wrapping title row, so sibling cards
render one shape. The dialog is now "Briefing & Instant alerts".

## 2.878.0

### Changed — comment only: the routing matrix no longer claims the villa cannot page the facility manager

`route.py`'s header said a critical's owner-AND-facility push "cannot be
expressed until a distinct facility target exists (DQ-04)" — false since the
People table shipped: each person carries a role and their own notify targets,
and the outbox merges the facility targets into a critical's push list. The
claim survived in the code and was copied into the architecture document as a
blocking gap, where the owner caught it. No behaviour change.

## 2.877.0

### Fixed — the Briefing tab's headings described the wrong sections; the page now reads top to bottom

Merging four tabs into one re-tagged the bodies without re-ordering them, so
the composed brief sat under "What is watched" and the checks under "What it
can see". The sections now follow the pipeline — what is watched, what it can
see, then one merged section for composing and sending: the test copy, the
schedules and the delivery record are one story. Every section has a title, a
one-line subtitle and an (i) with the detail; the delivery record shows five
rows a page. The second tab is renamed "Instant alerts" — "Automations" named
the machinery, and plain "Alerts" already means an agent alert one dialog over.

## 2.876.0

### Changed — a test that had quietly stopped measuring, and two comments describing a deleted rule

An audit of yesterday's release. One assertion guarding "the gate grew a second
way to stand a check down" was written when the gate had one refusal; it has
five now, so the check survived only because the word it looked for appears in
a comment explaining the arm was removed. It measured prose. It now reads the
code with comments stripped. The skip code that arm produced keeps its place in
the contract — stored analysis from before the change still carries it — but
both copies of its description said it was a live reason, which it has not been
since the arm went.

## 2.875.0

### Fixed — the checks run in both modes, so the briefing always has its analysis

Standing the three checks down when supervision is off assumed the automations
would feed the briefing instead. They never have: the briefing reads statistics,
live states and the to-do lists, and the one accessor that could have carried
automation events had no caller. So off-mode traded the briefing's only
analysis for nothing, however many automations were re-enabled. The stand-down
is deleted; supervision now means exactly one thing — whether the agent also
investigates. The event-dedupe and the unused accessor are deleted too, so
"the briefing never reads automations" holds by absence rather than by care.

## 2.874.0

### Changed — Briefings & automations is two tabs, split by what each thing is

An automation reacts the instant something happens and has already acted; a
briefing looks back over a period and summarises. Mixed on one screen, what your
automations did sat under what a briefing is built from. Briefing now holds that
question end to end — the checks, what the property can supply, the composed
brief and when it is sent. Automations is its own tab and follows the
supervision switch: off, every family you have; on, the ones still doing a job
with the superseded ones standing by. The event totals are gone — nothing has
fed them since the cutover, so they were a stopped clock shown as live status.

## 2.873.0

### Fixed — switching a check off now stops the agent using it too

It only ever stopped briefings. The toggle is read inside the briefing's own
loop and the agent calls the check directly, so one setting meant two things
depending on which side asked — while the screen said "switch it off". The
previous release reworded the screen instead of fixing it, which was the wrong
half: a switch meaning "off, except when it isn't" is the second flag this
subsystem already ruled out. The agent now honours that switch and nothing else
from the briefing's gate, since minimum history and audience are questions about
composing a brief. An unset or unreadable setting still means on.

## 2.872.0

### Fixed — "you can switch it off" promised more than the switch reaches

Yesterday's rename said a check is run by VESTA in every briefing and by the
agent when it investigates, then that you can switch it off. Both halves are
true and the join is not: the toggle gates what a briefing is built from, while
the agent's analysis tool builds its own context and never consults that gate —
deliberately, because a check reached that way was asked for by name about a
specific question. So a concern could arrive from a check the owner believed was
off, with the screen that said so still on the tablet. The wording now names
what the switch reaches, on the chip and on the row.

## 2.871.0

### Changed — the checks are named for whose they are, not where the code shipped from

"Built-in checks" said where they came from, which is the one thing a reader
does not need; the other half of that screen is "Your automations". They are
"VESTA's own checks" now — heading, chip and tooltip — and the copy says VESTA
runs them in every briefing and the agent runs the same ones when it
investigates. The rename exposed a chip carrying two meanings: the briefing's
title used "Built-in check" to say its wording was not written by AI, explained
as a calculation over history you can switch off. That is its own label now,
"Written by VESTA", the counterpart of "Written by AI".

## 2.870.0

### Changed — comments only: removed two counts that would go stale in silence

An audit of the previous three releases found the habit it had just recorded as
forbidden, committed inside the same session: the fix for the preview endpoint
explained itself as standing down "three" checks, and its test said the same.
Both were accurate and neither is checked by anything, so the day a fourth
check declares itself superseded they quietly become wrong. The rule is the set,
not its size. No behaviour change.

## 2.869.0

### Fixed — the previous release greyed a layer that was still working

A scan of every mode-dependent screen found the mistake in 2.868.0 first: it
dimmed the automations section whenever supervision was on, but what is left
there acts in under a second with no add-on and no model, plus the weekly proof
that alerts can still be delivered. Neither stops for that switch, and the two
families that do had already been removed from the list. Never presenting a
working layer as stopped is now a test rather than a paragraph three files away.
The scan found one genuinely idle setting: the to-do list, now greyed under
"Alert only", where nothing is ever added to it.

## 2.868.0

### Fixed — a preview stood down the three checks it should have run, and the screen said so

Reported from the tablet: the built-in checks read as superseded while
supervision was on. They were — but only in the preview. `run_report` takes the
supervision switch as its own parameter defaulting to off; the scheduler passed
it and the owner-only "run now / preview" endpoint never did, so every preview
AND every manual send dropped the three checks that stand down for an
automation, while the scheduled brief kept them. A valid default is why nothing
raised. The tab now greys whichever layer is not detecting — the automations
while supervision is on, a superseded check while it is off — and says which.

## 2.867.0

### Changed — comments only: four stale counts and a keyboard docstring that described a layout it no longer draws

No behaviour changes. `keyboard_for` still described three button rows and a
rating pair at the bottom, which it stopped drawing when the layout was settled
from a rendered mock-up — contradicted by its own comment eight lines below.
And "nothing happened has five causes, four of them fine" was restated in three
files against a function with eleven return sites; the same census had gone
wrong in the acts table a release earlier. The counts are deleted rather than
corrected: nothing goes red when a number in prose drifts.

## 2.866.0

### Fixed — the To-Do List tab said ticking an item only marks the alert "seen"

It closes the alert, since the previous release. The tab's help text still
promised the weaker outcome — the sentence an owner reads to decide whether
ticking in Home Assistant is enough. Found by a claim audit, with four more
stale descriptions of the same act: `reconcile_done`'s docstring said "marked
seen" directly above the code that closes, and the acts module claimed "three
of the five" when the table holds six and four are compound, crediting a thumb
with an acknowledgement the owner had removed. The census is deleted rather
than corrected — a count in prose beside a table that changes goes stale.

## 2.865.0

### Fixed — ticking a job in Home Assistant's own list left the alert open everywhere else

Checking the item off directly in the to-do panel removed it from the list and
changed nothing else: the Reason tab still showed the alert as open and the
Telegram message kept all of its buttons. Reconciliation was only
ACKNOWLEDGING the alert, which was the right half while Done and the closer
were two separate actions — since they were merged, ✅ ticks, records and
settles, so an acknowledgement alone left the alert open behind a job the
owner had plainly finished. The tick now runs the same act as the button, so
the tablet, the phone and Home Assistant's own list agree.

## 2.864.0

### Changed — every message opens the same way, and the daily job list waits for morning
Alerts, alert-only notices, escalations, briefings and the open-jobs reminder now
all begin with a coloured dot, a word and the subject — 🟠 WARNING · Pool pump.
The dot says how serious it is and the word says what is being asked, so an
alert-only notice keeps its real severity while still saying nothing is wanted.
It needs no formatting, so it looks the same however the message is delivered.
The reminder about open jobs was arriving minutes after midnight, because that
is when a new day starts; it now waits until quiet hours end.

## 2.863.0

### Changed — alerts are formatted, and VESTA is a real link at last
An alert now ends "Rate this alert in VESTA" with VESTA tappable and the address
hidden, because those messages are sent through the service that lets the add-on
choose how they are read — so it works the same on every villa rather than
depending on a setting. Three probes decided the format: the same message in
Markdown failed to send at all, since real device names and the villa's own
address contain underscores that Markdown treats as italics; in HTML everything
rendered and the names stayed intact. Briefings keep the plain address, because
their delivery service offers no such choice.

## 2.862.0

### Changed — every notification links to VESTA the same way
An alert now ends "Rate this alert in VESTA:" and a briefing "Open VESTA:",
both built by one function, so the same tap is never taught two ways. The word
VESTA is not a clickable link and cannot be: messages are sent with the
platform's parsing switched OFF — added because the villa's Telegram was
silently eating the underscores out of device names — and the characters a link
needs are stripped for the same reason, after a real name once cost a day of
failed deliveries. The address stays visible and stays tappable, which is what
makes it work at all with parsing off.

## 2.861.0

### Changed — one row of buttons, and the rating becomes a link in the message
The keyboard under an alert is now a single row — ✅ 🚫 🆘 — chosen by the owner
from rendered mock-ups after the two-row layout missed the mark. The ⬆️/⬇️
rating is no longer drawn as buttons: the message ends with a "Rate it ⬆️/⬇️ on
the Reason tab" line carrying the kiosk's own link, built by the module that
enforces the link rules (https-only, the owner's published address, no secrets)
and silently absent on a villa with no external URL — where the tablet still
offers the rating. Old rating buttons in chat history keep working; they are
only no longer offered on new messages.

## 2.860.0

### Changed — two ways to clear an alert, buttons on the escalation, instant sync
✅ and 🚫 both clear an alert the same way — job ticked, person recorded, no
more chasing — and differ only in the record: finished, or not needed. 🚫 never
makes that kind of alert rarer; only ⬇️ does. The pair takes the wide row on the
phone with 🆘 ⬆️ ⬇️ smaller beneath, the closest Telegram allows to the asked
3:1. The "Still open" escalation message now carries the same buttons — it is
the message most worth acting on and was the only one without them. And acting
from the VESTA screens updates the phone's message at once instead of within a
quarter-hour. Both screens draw the same symbols from one table.

## 2.859.0

### Changed — one row of symbols on the phone, and Done merged into the closer
An alert's buttons are ✅ 🆘 ⬆️ ⬇️ on a single line. "Done" and "Nothing more is
needed" both meant handled-and-stop-showing-it, so they are one button: it ticks
the job off, records who dealt with it, and closes the alert. The tablet's card
draws the same symbols from the same table, so neither screen can drift from the
other. A Done button in an older message still works; an older "Seen" is ignored
rather than repurposed, because closing on a press that promised to keep the
alert open would be worse than doing nothing.

## 2.858.0

### Changed — the alert's buttons are compact glyphs again
On the Reason tab the three controls on an alert card drop their words: the
closer is the slash icon alone, the rating pair is +1 and -1 alone, all three
round buttons. The words were added when the pair was two bare thumbs that said
nothing; +1 and -1 say what a thumb never did, so the labels had stopped earning
their width — the owner ruled them off from a screenshot. The full sentence
stays on hover and for screen readers, and the Telegram buttons keep their
words, since a chat button is text or nothing.

## 2.857.0

### Fixed — an alert's buttons came apart one at a time on a narrow screen
Each button carries its words, so on a phone they no longer fit beside the
alert's title — and as loose controls they wrapped individually, wherever the
row ran out of room, which looks like a layout that has broken rather than one
that has adapted. They are one group now: it moves to its own line intact,
right-aligned, and the +1 / -1 pair can never be split with one stranded above
the other. The Reason tab also offered the rating before the act, the opposite
of the phone and of the rule the code states — the act comes first on both
screens now.

## 2.856.2

### Fixed — a measurement in a comment that was taken for a different screen
Nothing on screen changes. The note explaining why an alert's row wraps on a
phone quoted a width measured when the row held two buttons; it has held two,
four and three since. The reason survives a relabelling and the arithmetic does
not, so the number is gone and the reason stays.

## 2.856.1

### Fixed — comments describing buttons that no longer exist
Nothing on screen changes. Three releases in one day reshaped the buttons on an
alert, and ten explanations next to that code still described the older set —
including the table a reader meets first and the note directly above the list of
what an alert offers. Each now says what the code does; the records of why the
older behaviour was wrong are kept, marked as history rather than reading as
today.

## 2.856.0

### Changed — one button ends an alert, instead of two that both did
"Seen — stop chasing" and "Dismiss completely" were pressed for the same reason
and a reader had to hold the difference. They are now one control — "Nothing
more is needed" — which records who dealt with it and closes it, doing both jobs
of the buttons it replaces. What stops a subject being raised again moves with
it: three "-1 Less like this" ratings, not three cancellations, because the
merged button is also pressed by somebody who simply has the work in hand, and
silencing a subject for that would be invisible and permanent.

## 2.855.0

### Changed — a rating can be given once, and the buttons say so by leaving
Pressing +1 or -1 left both buttons sitting there, so an alert could be rated
again and again and nothing said which way it had gone. They now withdraw as
soon as either is pressed, on the phone and on the tablet, replaced by a line
saying which was given. The message is redrawn without them rather than going
quiet. "Seen — stop chasing" also moves up beside "Done" and "Need help": those
three all leave the villa's problem standing, so they belong together, and
"Dismiss completely" keeps a row of its own where it cannot be hit while aiming
at a neighbour.

## 2.854.0

### Changed — rating an alert no longer decides what happens to it
The thumbs answered two questions at once: a thumb up marked the alert seen,
which takes it off the Reason tab, and a thumb down threw it away outright. So
saying how good an alert was quietly disposed of it. Rating is now +1 / -1 —
"more like this" and "less like this" — and both leave the alert exactly where
it was, with a line on the card confirming the press landed. Throwing one away
is its own control, labelled "Dismiss completely", the only irreversible act and
now the only one that says so. The Reason tab regains an explicit "Seen", which
the thumbs had been doing invisibly.

## 2.853.0

### Fixed — a job stayed on the list after its alert was dealt with
Only the Done button ever ticked a job off. So a thumbs-down, which dismisses
the alert, left the work on the facility manager's list for ever with no alert
behind it — and the same for a job whose alert was replaced by a newer one about
the same thing, or settled because the villa came right on its own. Ticking one
now happens for every alert that has been settled, whichever way it was settled:
the list is reconciled against the alerts on the same clock that already reads
it in the other direction. It sweeps what the store says is settled rather than
being called from each place that settles something.

## 2.852.0

### Changed — an alert now says it is on the To-Do List, and the thumbs say what they are
Nothing anywhere mentioned that every delivered alert puts a job on the list, so
an item appeared with nothing connecting it to the alert and its arrival was
read as something the buttons had done. The alert now says so itself — only
where a list is configured, and never on an alert-only notice, because neither
has a job. The two thumbs, until now bare glyphs sitting beside "Done" and "Add
to the To-Do List", were taken for a third thing that files something; they read
"Useful" and "Not useful" on both screens and change no list. On the tablet they
said this only in a hover tooltip, which a finger can never see.

## 2.851.0

### Fixed — pressing one button on the phone removed all the others
"Seen — stop chasing" only withdraws itself: the alert goes on offering Done,
Need help and the thumbs, and the tablet goes on showing them. But a press
removed the whole keyboard, so the phone offered nothing while the tablet
offered four — the same two screens disagreeing, the other way round. A press
now leaves whatever the alert still offers and takes the keyboard away only
when nothing is left, which is what a thumbs-down does. The message is rewritten
with what happened and who did it, and keeps the alert's own wording, so the
buttons left on it still say what they are for.

## 2.850.0

### Fixed — buttons pressed on the phone would have come back a few minutes later
Pressing a button strips it from the message, and the alert kept a note of that
message anyway. That was harmless while the tidy-up could only ever REMOVE
buttons; the redraw added in 2.849.0 made it live, because the note is what the
tidy-up works from — it would have drawn the buttons again, up to fifteen
minutes later, on a message somebody had just dealt with. A retired message is
now forgotten, and only that one: an alert sent to two chats keeps the copy
nobody has touched. A message Telegram refused to edit is still kept and tried
again, or its live buttons would never be corrected.

## 2.849.0

### Fixed — a Telegram alert kept offering a button that had already been used
Pressing the thumb and Done on the tablet left the phone's message showing all
five buttons, including "Seen — stop chasing" the alert no longer accepts. The
tidy-up asked one question — has this alert been settled? — and read every other
answer as "its buttons are fine". But being picked up does not settle an alert:
it withdraws that one button and keeps the other four, so the set changed
without emptying, which was the one case nothing handled. Each message now
remembers what it was sent with, and the buttons are redrawn — the wording left
alone — as soon as they stop matching. Messages already out are corrected once.

## 2.848.0

### Changed — the app's screens follow the same layers, completing the reorganisation
The browser half now mirrors the backend: the assistant's screens and client in
one folder, the briefing's in another, the shared vocabulary between them —
while the 3D kiosk, untouched by any of this, stays exactly where it was.
Thirty-three files moved with their history; the diff beyond the moves is
import paths only, and no screen changes by a pixel. This is the last step of
the reorganisation the owner asked for: what a future cutover deletes and what
a future export ships are now folders on both sides of the app, with the
backend boundary enforced by a test on every run.

## 2.847.0

### Changed — the assistant's web endpoints become its own, completing its independence
The nineteen endpoints the app uses to talk to the assistant — alerts, actions,
approvals, usage, the check button — moved verbatim into the assistant's own
folder, with the add-on's sign-in machinery handed to them at startup rather
than baked in. The add-on mounts the whole set in one line; a future external
deployment would mount the same set with its own sign-in. Every route answers
at the same address with the same permission checks — the security suite runs
against the mounted result unchanged, and deliberately removing one handler's
checks turns it red. This closes the backend half of the reorganisation.

## 2.846.0

### Changed — the export seams: the assistant's loops and addresses become its own
Three pieces of groundwork for the reserved capability of running the assistant
on an external server, none changing behaviour in the add-on. The one remaining
boundary violation is paid: the statistics fetcher moves to the layer that owns
the call it wraps, and the exception list in the boundary test is empty again.
The Home Assistant address, token and data directory can now be pointed
elsewhere by one startup call each — the add-on never makes it, so its path is
identical. And the assistant's four background loops start from one function in
its own folder; the add-on's server makes that one call where it used to start
each loop inline among its own.

## 2.845.0

### Changed — the assistant moves under one roof: last of the backend layer moves
The assistant and its observation record — 53 files — now live under the folder
a future external deployment would ship, completing the backend half of the
reorganisation: pure code, environment code, the deletable briefing and the
exportable assistant each in a folder that says what it is. Several checks that
had quietly widened their scope during the moves were re-scoped to what they
always covered — one was about to flag a deliberate difference between the two
halves as a duplicate. No behaviour changes anywhere; the same code runs from
its final addresses.

## 2.844.0

### Changed — the briefing layer moves: the deletable half is now one folder
The scheduled briefing — its pipeline, gating, narration adapters and task
reconciliation — now lives in a single folder whose header states the owner's
future plainly: this is the half that gets deleted wholesale once the assistant
supervises exclusively. The old reports folder no longer exists; that deletion
is now one folder plus a few wiring lines, instead of archaeology. Along the
way a test's own safety guard was found matching the digit 0 inside "40 source
files" — it now checks the number, not the substring. No behaviour changes.

## 2.843.0

### Changed — the environment layer moves: second of the layer moves
The fifteen modules that talk to the outside world — the disk store, the Home
Assistant connection, notify delivery, secrets, logging, discovery and their
kin — now live under the folder an external deployment would swap wholesale.
One correction fell out of the import graph: the statistics reader wraps Home
Assistant's recorder, so it belongs to this layer, not the briefing where the
plan had tabled it. What remains in the old folder is exactly the deletable
briefing half, which the boundary test now states as one line. No behaviour
changes; the same code runs from new addresses.

## 2.842.0

### Changed — the pure layer moves to its own home, first of the layer moves
The nine modules that touch no disk, no network and no Home Assistant — the
contracts, the text helpers, the message sanitiser and the three statistical
checks with their maths — now live under a folder that states exactly that, the
first of the layers from the reorganisation the owner asked for. Nothing
behaves differently: the same code runs from a new address, the boundary test
covers the new tree, and the purity rule is enforced where the files now sit.
Five test files that read the old paths were re-pointed; one wording file is
excluded from a renderer check by name now that its folder no longer hides it.

## 2.841.0

### Fixed — the layer check could not see relative imports, and the tree hid one
The boundary test added in the last release resolved `from ..x import` to a
bare name and dropped it, so a whole class of import was invisible — and a real
violation sat inside it: the three statistical checks registered themselves
into the briefing's registry at import time, making the exportable half depend
on the deletable half for a two-line side effect. The check now resolves
relative imports, the registry registers its own modules instead, and one
threshold helper moved to the shared set because a shared module needs it.
No behaviour changes: the same three checks register, from the other side.

## 2.840.0

### Added — the dependency layers, named and enforced before anything moves
Groundwork for reorganising the tree so that the old briefing half can one day
be deleted wholesale and the assistant can one day run on an external server.
Nothing moves yet: this release writes the layer model into the project's
specification and adds a test that derives every backend module's layer and
fails on any import pointing the wrong way — including the rule that the
assistant never imports the briefing. The one known violation is named with the
task that removes it, so anything else crossing that line fails today. The
boundary is now checked on every test run instead of remembered.

## 2.839.0

### Added — the items a check ran out of budget for are now listed, not just counted
Triage said "5 items flagged — 2 looked into, 3 waiting for the next check" and
showed two cards, because the three were never written down: the pass stopped at
its investigation limit and recorded only a number. They are recorded now and
appear as cards like the others, marked as waiting. Older checks start collapsed
with the newest open, so the tab is one check deep rather than fourteen. "Looked
into — all clear" now reads "Investigated at …: no alert needed", matching the
word used everywhere else. The To-Do List heading lost its subtitle to an (i)
that also says the list lives in Home Assistant.

## 2.838.0

### Fixed — notes in the code still calling the modes by their old names
The three supervision modes were renamed on 28 August. The screen was updated
that day and the owner's recorded decisions were updated after, but six notes
describing how the villa behaves right now kept the retired names, so anyone
reading them would look for words no screen says. Corrected, and a test now
allows a retired name only where it is explicitly marked as history — which is
what keeps the recorded decisions quotable. Two other notes described a field
and a count that no longer exist.

## 2.837.0

### Changed — "What is watched" now shows only what can still change
The tab listed six automation families with a count beside each, from a record
of everything ever heard. Two of those families were retired weeks ago, so
their totals were frozen history shown as live status; one acts and never
reports, so its cell could only read "nothing yet"; and one was not a family at
all. None of the six could rise again. Only the two that still fire remain. The
line claiming your automations take priority over the built-in checks was
backwards — supervision decides that, and while it is on all three checks run —
so it is gone, with the setting behind it that could only ever answer yes.

## 2.836.0

### Fixed — Observe said "nothing written down yet" above 51,579 changes
Yesterday's fix sent the journal's own clock to the screen under one name and
read it under another, so the field arrived and was ignored — which renders
exactly like having no data. A test now checks every key on that wire in both
directions. Also: the coloured source labels explain themselves when tapped,
instead of relying on a hover no tablet has, so the seven-row key that existed
to compensate — in a dialog showing none of them — is gone. And Act & Tell's
paragraph moved into an (i) beside its title; it restated the three values
printed directly beneath it.

## 2.835.0

### Fixed — Observe said "last change seen 34 h ago" on a villa changing constantly
It was reading the wrong clock: the chat and automation event stream, which is
legitimately near-silent now those automations are retired, rather than the
record of device changes the checks actually read. The tiles beside it were
right all along — 51,430 changes, 1,266 devices — so the banner contradicted
them. It now reports when a change was last written down. "Blueprint events not
seen" went with it: nothing has listened for those events since the cutover, so
naming them as unheard implied a watch that no longer exists, and one of the
names it printed was not a real event at all.

## 2.834.0

### Fixed — "Nothing judged yet" after judging something
Pressing a thumb on the drill alert recorded the verdict correctly and left
"What to raise more, or less" empty, saying nothing had been judged and blaming
alerts raised before the feature existed. Both wrong: the verdict was stored,
and the real reason is that a drill is about a topic rather than a device, so
there is no measurement to learn from — no thumb on one will ever teach
anything. The screen could not tell the two apart because the alert's kind was
never sent to it. It is now, so the panel says which case it is in, and the
tooltip names both.

## 2.833.0

### Fixed — a reference like "c7" on screen, and a tab listing the same work twice
"What it asked for" under Briefings showed to-do items as though the villa's
automations had raised them. The automations that did were switched off weeks
ago, so every row it could still show came from the assistant — already listed,
correctly, under Act & Tell — printed with its internal reference beside it and
duplicated once per to-do list. The tab is gone and that reference is gone from
the daily message too; nothing a person reads carries one now, and a test
refuses any that tries. To-Do List is no longer its own tab: it sits under Act
& Tell, beneath the rules it is produced under, with two paragraphs merged.

## 2.832.0

### Changed — one place to write a request, one place to say "Loading"
An audit found the three-line preamble every call to this add-on's own backend
must repeat had been copied nineteen times, and one copy — the sign-in call —
had dropped the line that attaches the session. It worked only because a browser
default happened to agree. All nineteen now go through one function, so a
twentieth cannot forget, and a test refuses any that tries. The "Loading…" line
was seven identical copies and is now one component. Four comments describing
machinery that changed underneath them were corrected.

## 2.831.0

### Added — buttons on an alert in the chat, and one definition of what each does
The Done and Need help buttons on a Telegram message came from a Home Assistant
automation, not from this add-on, so switching off its second chase ladder in
2.827.0 took them with it and an alert could only be acted on at the tablet.
They are back, and this time the add-on both sends and answers them: Done, Need
help, Seen, the thumbs and Add to the To-Do List all run the same code the
tablet runs, so the two cannot disagree. Done used to be two separate browser
requests, so a ticked job could sit beside an alert still being chased. A press
is checked as it arrives, and buttons are removed once an alert is dealt with.

## 2.830.0

### Fixed — the To-Do List promised a button that no longer exists
Its empty state told the reader an item leaves "with the Done button on the
message". Yesterday's change stopped the add-on firing the event that put that
button there, so the sentence described machinery retired hours earlier — the
one visible case of six. The others were comments: four still credited the
blueprint's Done button for work `task.reconcile_done` now does, and one
described the three modes by names the same day renamed. Each was true when
written and nothing checks a sentence, so none of them could go red.

## 2.829.0

### Fixed — a check said "5 items flagged" above two cards and explained neither
The heading counted what the check FLAGGED; the cards below showed only what it
LOOKED INTO. The rest were not lost — a check investigates at most two things,
to cap what it spends, and the others wait for the next one. Both numbers were
right and nothing on screen joined them, so the heading read as a miscount. It
now says "5 items flagged in this check — 2 looked into, 3 waiting for the next
check", read from the figure the check already recorded rather than worked out
by subtraction, so a check stopped for any other reason is not mislabelled.

## 2.828.0

### Changed — what the villa concludes is called an Alert, everywhere you read it
The screen said "Concern" while the thing it named was the one message that
reaches your phone, sitting beside a To-Do List that names the work. One word
for each half, consistently: the Reason tab heading and empty state, the
escalation and for-your-information notes, the settled counts, the flag row on
Triage, the tuning list, the To-Do List tooltips, and the prose in your briefing
and in the pipeline-test message. Nothing behind the screen moved — the stored
record, its states and every setting are untouched.

## 2.827.0

### Changed — an alert tells you, a to-do item records the work, and only one messages
Every finding used to send twice: once as a Concern from the add-on, and once
as a task from a Home Assistant automation that re-asked at 15 minutes and
escalated at 45 — a second chase the first knew nothing about, so saying "seen"
stopped one and not the other. Nothing fires that automation now, so the second
chase stops existing rather than being suppressed; `vesta_task_actions.yaml`
can be deleted. Open work is announced once a day instead, to the Facility
manager. The Jobs tab is now **To-Do List**, matching Home Assistant's own
word, and the modes are **Ask first**, **Alert only** and **Alert & chase**.

## 2.826.0

### Changed — the settled labels download their group, not the numbers
The press sat on the count, so the target was one or two characters wide on a
wall tablet and read as decoration. It is now the label. That also settles the
(i) beside "Fixed and confirmed": it used to sit inside the same element, so
making the label pressable would have nested one button in another — browsers
resolve that by giving the outer one the click. They are siblings now, so which
one you pressed is a fact of the markup rather than something a handler has to
work out.

## 2.825.0

### Fixed — the chase never had a clock, and a job finished on your phone did not stop it
The escalation steps are 15, 45 and 90 minutes, but the rule applying them ran
only at the end of a check — every six hours here — while the card promised a
time. It now has its own clock, set to the first step. Pressing Done in Telegram
also only ticked the job; the alert stayed on the wall and kept being chased, so
a ticked job now counts as seen however it was ticked. The Reflex tab's control
row said "nothing yet" for a family that emits nothing to count, and now reports
what those automations actually did. The settled counts on the Reason tab
download that group as a spreadsheet.

## 2.824.0

### Changed — a tuned kind shows its name and its number, and nothing else
Each row also carried "raised 20% less readily" beside 0.8 — a sentence
restating the number next to it — and a running tally of thumbs. The sentence
undid the point of holding a multiplier at all: the number needs no
translation, and the scale is explained once in the (i) rather than on every
row. The tally moves to the row's tooltip, where it is still readable and no
longer competes with the two things a reader came for.

## 2.823.0

### Changed — a wrong comment was keeping a dead function alive by hiding it
A comment in the dashboard credited a helper the code beside it does not call.
The audit probe that looks for functions nobody uses counts a mention as a use,
so that one sentence hid the real helper — which had never had a caller — from
the tool built to find exactly that. Both are fixed and the probe now ignores
comments, which brought six more unused exports into view; all six are the
documented mirror types and are now marked as such where they are declared. No
behaviour changes.

## 2.822.0

### Changed — saving a file has one owner, and the audit probe that should have caught that was broken
Five screens each hand-rolled the same seven lines to save an export, and the
reason it matters was written as a comment at exactly one of them: this add-on
must work with no internet, so an export cannot go through a service. That rule
now lives in the code every caller calls. It should have been caught by the
audit probe built to find duplication, which counted words where it meant
characters and so had reported "nothing found" since it was written. The taught
flag types also gained a test holding their two halves together, and two dead
CSS rules are gone.

## 2.821.0

### Changed — the score is now the multiplier itself, nudged by 0.1
2.820.0 stored a whole-number score and printed a sentence translating it
("ranked at a third of its novelty"), so the number on screen meant nothing on
its own. It is now the multiplier: 1.0 untouched, 1.1 raised 10% more readily,
0.8 raised 20% less, with + and − moving it by 0.1 and a thumb doing the same.
The dial stops at 0.1 and never reaches zero, so turning a kind down still
cannot mute it. And the empty list now says WHY it is empty — a kind is
recorded when a concern is raised, so judging one raised before this feature
existed records the verdict and teaches nothing.

## 2.820.0

### Added — the thumbs now teach the villa what kind of thing to raise
Their tooltips have promised "the villa raises this kind more readily" since
they shipped, and nothing implemented it: a verdict only counted toward
silencing one device after three dismissals. A thumb now also acknowledges the
concern — so the eye button is gone — and scores its KIND, which is a
measurement and a direction ("energy above baseline") rather than a device, so
one press teaches every device that measures the same thing. Settings & others
lists what you have taught, where a score can be tuned, removed, exported,
imported or cleared. A minus score re-ranks, it never mutes.

## 2.819.0

### Fixed — the Triage summary was hard to read, and finishing a check moved the button
Pressing "Check the villa now" added a second paragraph inside the summary's own
row, which re-divided the row and moved the button. It also quoted the scheduler
verbatim — "escalated 1 (investigated 1)" — where on this screen "escalated"
means chasing an unacknowledged concern, so it used the tab's most loaded word
to mean the opposite thing. A check that runs now says nothing extra: the
summary refreshes in place and the check appears in the list. That sentence is
rewritten in one vocabulary (check, flag, concern, escalation) and says a flag
raising no concern is not discarded — the reading behind it is assessed again in
the next briefing.

## 2.818.0

### Fixed — nothing could ever tell you whether a fix had worked
"Fixed and confirmed" on the Reason tab could only ever read zero: the check
behind it was written years ago and nothing ever ran it. It runs now, a week
after a concern is closed, and says one of three things — the fix held, it came
back (naming the concern it came back as), or the villa was not listening for
that week so it will not claim either. "Came back" is a new count beside it,
because a screen that can report success and not failure reports every fix as a
success. The agent can also read Home Assistant's log again; that tool shipped
finished and unconnected, so it had been withheld rather than left to refuse.

## 2.817.0

### Changed — the working documents were reorganised so the current state is one file
`docs/` had twenty top-level markdown files, seven of them finished checkpoint
records of the same kind, plus a nested folder of audit output. A new reader
had to open several to find out which were true today. There is now a single
`STATUS.md` that outranks the rest, live documents beside it, generated output
labelled as such, and finished records merged or moved to `archive/`. Nothing
was deleted but macOS junk files. No add-on behaviour changes.

## 2.816.0

### Fixed — task buttons that stopped working without saying so
The listener for Done and Need help lives inside the automation run, so once
a job had been sent, re-asked and escalated the run ended and every button it
had left went dead — still visible, still pressable, and doing nothing. Found
on the villa: a Done pressed 37 minutes after the run finished produced no
tick and no confirmation. Every message that carried buttons is now retired
when nothing more will listen, and says where to tick the job instead. The
owner's messages get the same instruction without the "these buttons no
longer work" line, since buttons only ever go to the facility manager.
⚠️ **Re-import the task blueprint** — it is delivered by hand.

## 2.815.1

### Changed — removed a leftover variable pointing at an input that no longer exists
The two critical blueprints still declared a `bucket` variable reading a
`bucket_input` that was deleted when their reporting fields were stripped.
Nothing read it and an undefined name is harmless, but it reads as a missing
input to anybody opening the file. No re-import needed — it changes nothing
observable.

## 2.815.0

### Changed — only the newest task message keeps its buttons
A job that went unanswered produced a second Telegram with its own Done and
Need help, leaving two live pairs for one job and no way to tell which was
current. The reminder now strips the buttons from the message it supersedes,
so exactly one pair is ever pressable. It is best-effort: if the id cannot be
learned the tidy-up is skipped and the job behaves as before, because losing
a reminder would cost the job while losing the tidy-up costs nothing.
⚠️ **Re-import the task blueprint** — it is delivered by hand.

## 2.814.0

### Changed — one word for chasing, and the reminder message says which job it is about
The app used "chased" and "escalated" for the same thing, on screens sitting
beside a mode called Investigate & Log +Escalation. Every visible mention is
now "escalated". And the "still open" reminder on Telegram repeated the task
text without its reference, so two of them on one chat could not be told
apart — it now carries the same Rule line as the first message.
⚠️ **Re-import the task blueprint** — it is delivered by hand.

## 2.813.1

### Fixed — the no-villa-data gate went red on a Home Assistant service name
`todo.update_item` is a service call, not a device, but it has the shape of an
entity id and the scan cannot tell them apart. Classified alongside
`todo.add_item`, which was already there for the same reason.

## 2.813.0

### Added — a Jobs tab, and Act & Tell now reports instead of configuring
A job the villa raised existed only on Home Assistant's own to-do panel, so
the Facility manager — whose work it is — had no view of it, and once the
concern was acknowledged the job was its last invisible trace. Jobs now have
their own tab in VESTA Agent, showing what was told, whether anybody has been
chased about it and whether it has been seen. Ticking one there also records
that the concern was seen, so nothing is chased about work already done.
And Act & Tell's three settings moved to Settings & others: the tab now
states what the villa is permitted to do rather than editing it, like the
four reporting tabs beside it.

## 2.812.0

### Added — every message says who it is for, and the People tab warns when the escalation ladder has one rung
One chat can carry both the household's alerts and the Facility manager's
work, and the chasing rule deliberately sends the same concern on to a second
person — so two messages arrived looking identical. Each now ends with a short
line naming the profile it was written for. And when nobody holds the Facility
manager profile, anything urgent goes straight to the Owner with no delay:
correct, but it looked like the chasing rule misfiring, so the People tab now
says so and explains what adding one would change.

## 2.811.0

### Fixed — a concern card promised a chase that could never arrive
A critical the villa had already escalated still showed "at 17:38 it is
re-sent to the same place". Nothing was going to happen at 17:38: the time
bands are the last question the escalation rule asks, and on a villa with
nobody in the Facility manager role an occupied property sends to the owner
immediately instead — a step the sweep then refuses to repeat. The card now
reports what the villa actually DID once it has chased, and only predicts
while nothing has been done. The "for your information" mark is shortened to
"Informational (nothing to do)", which fits its column without wrapping.

## 2.810.0

### Fixed — the test drill silenced itself after three runs, and two dead controls left the concern card
Re-running the drill needed the previous one settled, and the only button that
settles one is "not useful" — which is the dismissal that suppresses a subject
after three. The rig would have refused for ever on the third tidy-up, through
the mechanism built to silence noisy rules. A drill now replaces its own
previous run, so no dismissal is ever needed. The acknowledge button is back on
"for your information" concerns: hiding it was argued from escalation, but
acknowledging is what takes a card off the wall, so those had no way off it.
And the lifecycle chip is gone — nothing has ever moved a concern off "open",
so it read "Nothing done yet" on every card, contradicting "nothing to do".

## 2.809.0

### Changed — the Cockpit drops a source badge, and Settings & others opens on Settings
The "Home Assistant" chip beside "Needs attention" was added to separate that
list from the agent lists below it; those all moved to the Supervision tab in
2.724.0, so it had been labelling a contrast that is no longer on screen.
Settings & others opened on Cost because 2.759.0 moved Settings to the front
of the tab strip and left the opening tab behind — the strip highlighted one
tab and showed another's pane. It now derives from the strip, as its two
sibling dialogs already did, so reordering cannot desynchronise them again.

## 2.808.0

### Fixed — a thumbs-up made the concern card disappear
Marking a concern useful wrote `state: verified`, which is a settled state,
so agreeing with the assistant retired a concern nobody had acted on or even
acknowledged. One state had two writers meaning different things: the
verification path means "the condition did not recur", a claim about the
villa; a thumbs-up means "you were right to tell me", a claim about the
supervisor. It is now stamped beside the state, which is untouched — only
acknowledging takes a card off the wall, and an acknowledged concern that is
still open is counted below the list rather than dropped. A critical that
nobody has acknowledged now says on the card when it will be chased, and
"not useful" still dismisses, because that is the suppression signal.

## 2.807.0

### Added — a fire drill for the alerting path, so delivery can be tested on purpose
"Does a concern actually reach my phone and my to-do list?" was answerable
only by waiting for the villa to genuinely go wrong: triage and the
investigation both end in a model judgement, and both are told to conclude
nothing rather than speak weakly. `POST /agent-run-now {"drill": true}`
(owner-only) now raises one synthetic concern through the same sink the
model's own tool uses and runs the same routing, delivery, to-do and
escalation sweep a scheduled pass runs — no model, so it cannot decline and
costs nothing. Its title announces it as a test; it is topic-keyed so it can
never collide with a real device, and `severity: critical` is what exercises
the push and the escalation ladder.

## 2.806.0

### Changed — the Reason tab loses a redundant heading, and the assistant counts offline devices instead of naming them
"What came of them" announced a second section where there is only a footer
of counts, and its explanation became an inline (i) on the count it explains.
The offline block added in 2.805.0 is reverted to a single line — a count,
never names: naming them invited a paid investigation of devices the reflex
blueprints already alert on in real time and the briefing already lists, a
third message about one fact. It costs 8 tokens on a healthy villa. The
Triage summary no longer points at the deleted heading by name.

## 2.805.0

### Fixed — the assistant could not see a device that had gone offline
Found by taking a critical device offline: triage answered "nothing to
escalate" on a healthy 4,874-character document, because the document had
nowhere for it to appear. Everything in the delta is scored by salience,
which reads numbers and deliberately refuses `unavailable`, so an offline
device had no channel at all — while the kiosk, Readiness and the briefing
all showed it. The delta now carries a "Not reporting right now" block from
the same shared predicate those three use, built from the journal so a pass
stays local and cheap. It speaks when empty, names its truncation, and is
silent on a cold start rather than reporting the whole villa as down.

## 2.804.0

### Fixed — a check card and its own flags showed times eight hours apart
The Triage tab printed each check's heading in UTC (the raw stored stamp)
while the flag rows under it went through the local-time formatter, so on a
villa at UTC+8 a card headed `2026-08-27 03:35` carried items stamped
`27 Aug, 11:34`. Reported as the list being out of ORDER; it was not — the
checks were correctly newest-first, which is impossible to see when half a
card is on a different clock. Both now use the one formatter, pinned as "no
raw stamp reaches the screen" so a second raw render cannot reintroduce it.

## 2.803.0

### Fixed — a critical alert that never named the device it was about
`critical_watchdog` delivered `has been "unavailable" for over 0.2 minutes`
with no device in it, on a list where any of ten entities could be the one
that failed. The cause was `entity_name(...)`, which is not a Home Assistant
template function: it renders EMPTY instead of raising, so the automation
succeeded and the sentence had a hole in it. The same call sat at four more
sites in `critical_schedule`, whose rarer alerts were nameless too and had
never been reported. Both now use `state_attr` with the entity_id as a
fallback, and `test_blueprint_templates.py` scans for the call form.
⚠️ **Re-import both blueprints** — they are delivered by hand.

## 2.802.0

### Changed — "Investigate & Log Only" now shows and tells: its concerns reach the Reason tab and arrive once as an FYI
Observe mode hid concerns in a shadow store and delivered nothing — the
retired cutover-measurement design, which read as "the agent found nothing".
By the owner's ruling a concern raised there is now stamped informational: on
the Reason tab marked "for your information — nothing to do", sent once with
an FYI title, never pushed, escalated or turned into a to-do job;
`agent/shadow.py` is deleted. "Check the villa now" also moved onto the
summary line above "Cancel all", beside the totals its checks change.

## 2.801.0

### Changed — the flag card is one column, and the old record style is gone
The outcome line ("Looked into — all clear · date") now renders inside the
card's text, on its own line under the reason it concludes — only a waiting
flag's two action buttons stay on the right. And the old record form is fully
retired: checks recorded before flags carried an id are no longer listed, and
the fallback that printed flag names inline in the heading sentence is
deleted, so no check can render in the old layout again. Waiting flags from
that era stay actionable in their own card.

## 2.800.0

### Fixed — the checks total read as the newest check's yield, and Cancel all hid
"17 looked into, 2 raised as a concern" sat above the newest card, so the 2
read as that check's result — they were from checks two days earlier, both
dealt with since. The total now names its window and says where each kind
lives. And "Cancel all" appeared only when several flags waited: it is now
always visible, greyed with a tooltip that says why — flags only queue for it
in Flag & Ask; the other modes investigate them on the spot.

## 2.799.0

### Fixed — settled concerns vanished, new flags needed a reopen, phone cards crushed
Three screen defects from live use. The Reason tab said "No concerns" whenever
nothing was OPEN, hiding the settled record the Triage tab still counts — the
record now shows under "What came of them". A check started from the dialog
drew its card with no items until the dialog was reopened — the flag list now
reloads when a new check appears. And on a phone the flag's reason was crushed
into a narrow column beside the unbreakable status text — the row now wraps by
content, status on its own line when both no longer fit.

## 2.798.0

### Fixed — flags now identify their device, and a refused result names its tool
Two checks logged "0/5 identified": the assistant shortens labels ("Jacuzzi
Pump" for "Jacuzzi Pump Power"), and the match only worked the other way
round — the reverse containment now identifies the device, so a concern about
one carries a real key. A tool result the privacy audit refuses is logged
WITH the tool's name (twenty-eight leaked ids were reported without their
source). And read_coverage was built unwired, so it claimed "nothing is
unmeasured" about a property nobody had surveyed — it now reads the stored
survey and says "not surveyed yet" when there is none.

## 2.797.0

### Changed — the briefing is written by the agent's own plain author now
Phase 5 complete. The 2,124-line report renderer and the machinery that
parsed, counted and cross-checked blueprint events (~3,440 lines in all) are
deleted — the last producer of those events stopped this morning. Briefs now
come from the same author that writes the offline rungs: standing state
first, then concerns, findings and open jobs, severity-ordered, with the
provider still contributing at most one lead sentence. Every honesty rule of
the old renderer is re-pinned against the new one, and the offline ladder is
unchanged beneath it.

## 2.796.0

### Changed — the reflex blueprints stopped reporting into VESTA
TASK-067 is live on the reference villa: the six reporting critical_*
blueprints no longer carry rule_id, report_bucket or severity and no longer
emit a vesta event — they trigger, they push, and that is all, so they work
with the add-on stopped. All twelve critical automations verified still on.
The rest of Phase 5 is recorded as blocked on one remaining decision: the
weekly channel-test canary is the last thing emitting a VESTA event, and the
parser cannot be deleted while anything still produces one.

## 2.795.0

### Added — the assistant can now run the three statistical checks itself
TASK-070, the first step of the plan's Phase 5. Standby creep, level anomaly
and sensor health are exposed as tools the assistant calls when it wants them,
instead of only running inside the weekly briefing behind a gate. The
statistics are untouched — the tools call the same modules, and a new test
runs both over one fixture and asserts identical numbers. Also fixed on the
way: the registry never passed its Home Assistant session to the tool builder,
so any tool needing live statistics would have been born disconnected.

## 2.794.0

### Fixed — a flag doubled after Investigate, and said only its name
The audit records a flag's life as several rows sharing one id; the panel drew
one card per row, so pressing Investigate made the flag appear twice. Rows now
merge into one card that says why triage flagged it (its own recorded reason),
and — once settled — the outcome, the time, and whether it was your go-ahead
or the villa acting alone, in visible text rather than hover-only tooltips.
The Reason tab also says why an empty concern list is empty instead of
rendering nothing.

## 2.793.0

### Fixed — CI's mypy step has been failing since 2.755.0's sweep
That release's deletion took the module-level `_CONCERNS_SOURCE = None`
binding with it, leaving a `global` writer and two readers — a NameError
waiting on the one documented state ("agent off, source unset") whose own
docstring promises it is not an error, invisible to pyflakes because `global`
counts as a definition. The binding is restored with its original comment,
and CI's `mypy --strict reports/` gate now also runs locally as a test, so a
strict break is caught before the push instead of on the runner.

## 2.792.0

### Fixed — CI was still red after 2.791.0, on two environment gaps
Both latent, unmasked once collection succeeded. The kiosk/briefing parity
pin runs the shipped TypeScript through node and its imports reach real npm
packages — the CI job never installed them, so 25 parity tests failed with
ERR_MODULE_NOT_FOUND; the workflow now runs `npm ci` first. And one cost test
imports the gitignored `docs/refdata`, absent on CI by design (ADR-018) — it
now skips where `docs/` does not exist, like `test_docs_current` always has.

## 2.791.0

### Fixed — CI failed to collect the test suite on the deploy workflow
An f-string holding a multi-line expression is Python 3.12 syntax (PEP 701);
CI runs 3.11, so `test_ui_consistency.py` died at collection and took every
test in the file with it. The local venv is 3.12, which is why the gate here
stayed green. The expression is hoisted out, and a new gate compiles every
Python file under a real 3.11 interpreter so the grammar gap cannot recur.

## 2.790.0

### Added — a pin that keeps the agent's cost model structural
An audit of the agentic workflow confirmed exactly two places can ask a model
anything: the one agent loop and the brief's one-sentence narration overlay.
`test_llm_call_sites.py` now fails the suite if a third call site appears
anywhere in the backend, so a reviewer stage or a summarise-the-summary call
cannot arrive silently. No behaviour change.

## 2.789.0

### Fixed — the briefing's concern list crashed its own error handler
A dry-audit sweep found `_log(...)` — an undefined name since 2.696.0 — in the
one arm whose comment promises "a briefing must not fail for this"; it now uses
the shared `swallow`, and a new pyflakes pin fails the suite on any undefined
name in the backend. The same sweep deleted the renderer's never-called slot
enumeration, two dead locals, a duplicate document assembly on the run-now
preview, and ~30 unused imports.

## 2.788.0

### Fixed — a tooltip showed six literal characters instead of an apostrophe
A JSX attribute does not process backslash escapes, so "Don\u2019t investigate"
reached the screen exactly as written. Pinned for every attribute in the app.

## 2.787.0

### Changed — the two controls sit where they act
"Check the villa now" is on the heading's own line, icon-only on a phone, and
"Cancel all" moved into the pager row beside the page arrows.

### Fixed — two concern buttons had no tooltip
Thumbs up and thumbs down said nothing to anyone using a mouse. The intro above
them now says what a concern is and why it is on that screen, rather than
opening with a detail about escalation.

## 2.786.0

### Fixed — Observe was showing a different subsystem entirely
"Changes recorded" counted blueprint events, not entity state changes, so a
light turning on moved nothing. The tiles now read the journal — the record the
checks actually reason over — and say how many devices are watched and how much
history is held, with a warning when the record is full.

### Changed — Reflex lists only what acts by itself
Retired detection families were listed on the tier whose definition is "acts on
its own, in under a second". Only the rules that operate something appear now,
and the explanation sits above the table rather than after it.

## 2.785.0

### Fixed — the moon drew its own complement, so a full moon looked black
One inverted winding flag: a 97% lit gibbous rendered as a 3% sliver. The
astronomy was never wrong — it agrees with Home Assistant's own moon sensor.

### Fixed — "11 of 14 could not be cancelled"
The panel decided what was waiting by copying the server's rule instead of
asking it, and missed that an already-dismissed flag keeps its original row
forever. It now reads the server's own pending list.

### Changed — the checks are cards, each showing what its own mode allowed
One card per check with its flagged items and their actions on the right. Each
check records the mode it ran under, so a past check keeps the affordance that
matched at the time instead of being relabelled when the setting changes.

## 2.784.0

### Fixed — the card said 54 and the button said 14
The unmatched-flags card listed every flag whose check could not be identified;
the Cancel-all button counted only the ones still waiting. Forty of those were
already settled, carried no action, and displayed a state that is not true in
Flag & Ask mode. Both now count the same set.

## 2.783.0

### Changed — the device permission reads as one decision
The switch is now "Allow to control devices" and the list under it has no
heading, no note and no footer label of its own — it is the second half of the
same control, not a second section. The search box says what it does, the
chosen devices sit under it, and the whole list greys out and stops responding
while the switch is off. The Act & Tell tab no longer repeats itself in a
sentence above the sections.

## 2.782.0

### Fixed — flagged items were invisible on the Triage tab
Merging the two lists drew every flag inside the check that raised it, and a
check recorded before the previous release carries no id — so fourteen waiting
flags rendered nowhere while a button offered to cancel all of them. Anything
that cannot be matched now gets its own card saying why.

### Changed — a concern names the profile it reached, and every send
"Sent to Owner 26 Aug 14:27, then Facility manager 26 Aug 14:42" rather than a
notify entity id. Escalation adds a second entry instead of overwriting the
first. Cards read "3 items flagged in this check", ten to a page.

## 2.781.0

### Fixed — a concern said "sent" without saying who to
It routes by audience, so a villa with two Telegram chats can deliver every
concern successfully to the one nobody reads. The card now names the
destination, inline and in parentheses.

### Fixed — concerns were delivered nowhere when a profile had no destination
Briefings fall back to the shared notify list; concern delivery stopped at the
People table, so a villa could receive every briefing and no alert. It now uses
the same fallback and says so in the log.

### Changed — Observe and Reason use the same words as Triage
A check reads changes, raises flags, and a flag may become a concern. Redundant
spacing removed under section notes, and the devices section reordered so
nothing follows its footer label.

## 2.780.0

### Changed — flagged checks and recent checks are one list
A flag is now drawn inside the check that raised it, with an action that
follows the mode: Investigate or Cancel while it waits, a briefing mark once
it has been looked at, and whether a Concern came out of it. Cancel-all came
across with it. The modes are "Investigate & Log Only" and "Investigate & Log
+Escalation".

### Fixed — a concern recorded nothing about where it came from
It named its subject as a hash of an entity id that a flag usually does not
carry, so nothing could say whether a flag turned into anything. A check and
its flags now share an exact key, and a concern records the investigation that
produced it.

## 2.779.0

### Fixed — the mode tooltip contradicted the description under it
The tooltip said your briefing is written either way; the Flag & Ask
description said nothing reaches the briefing. The briefing is written in every
mode — what changes is whether the assistant's own findings are in it. The
tooltip now says only what is true of all three, and each description carries
only what its label does not already say.

## 2.778.0

### Changed — "Worth a closer look" is now "Flagged checks"
Both the populated and the empty state.

## 2.777.0

### Changed — the supervision modes are a ladder now, and named after their verbs
They are reordered least-to-most and renamed "Flag & Ask", "Investigate & Log",
"Investigate, Log & Escalate". Each step does everything the one before it does
and one thing more, so spend, autonomy and what reaches you all increase
together — with the old order the leftmost option was the most expensive. The
first is not named after the briefing because that mode produces none: nothing
is investigated until you approve it. Stored values are unchanged.

## 2.776.0

### Changed — the supervision modes are named after what you get
"Observe only" sounded like the cheap, do-less option and was the most
expensive: it investigates on every pass at the same price as "Live", and only
holds the message back. "Live" said nothing about what changes. They are now
"Briefing only", "Ask first" and "Alert me", the note no longer calls them a
ladder from cautious to live, and every description names the same three
things: does it investigate by itself, does it message you, does it chase you
until someone acknowledges. The stored values are unchanged.

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

