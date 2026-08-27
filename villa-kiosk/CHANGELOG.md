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

