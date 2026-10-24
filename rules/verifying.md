# Verifying a claim

How to know something is true before saying it or shipping it. Most entries here were learned from a confident claim
that turned out false.

## Ask where the user sees it

After building anything, ask where the person sees it. Two halves that are each correct and each tested, joined by
nothing, is the most repeated defect here: a setting with no consumer, a consumer with no setting, a helper nobody
calls, a function whose callers pass no arguments.

**Why:** thirteen instances, most found by a person rather than a test: a unit test of a helper passes whether or not
anything calls it, and an unwired part returns a well-formed empty answer, not an error.

**How to apply:** find one output that could ONLY exist if the whole path ran. Ask the code, not the task list.

## Pin the caller

When a fix adds wiring (an argument, a call, a prop), at least one test drives the PRODUCTION path that supplies it,
not the function that takes it. Mutation-test by reverting the actual historical bug.

**Why:** seven tests of a new builder could not catch the original bug, which was that callers passed nothing; a
mechanical rename inside a function broke every script's arguments while 400 tests stayed green.

**How to apply:** a source-text pin is only as strong as the narrowest thing it points at: extract the specific call,
then assert inside it. A prop the component honours and nobody passes is the same defect in the UI.

## A test must have gone red

A test is a claim until it has failed. After writing a check, break the code it guards (`npm run mutate` on the Kiosk,
`tools/mutate.py` on the Agent), watch it go red, then restore.

**Why:** many checks here passed during the bug they were written for.

**How to apply:**
- Assert over EVERY member of the applicable set, never "at least one".
- Compare the SET, never its size: a count survives a swap.
- A mutation that did not apply looks like one that survived: assert the target occurs exactly once first; mind type
  annotations on constants.
- Make the fixture reach the guard under test, and keep fixtures absolute, never derived from the value tested.
- Never deduplicate in an assertion about how many; check the negative too.
- A test that only sees a fake cannot check the adapter: assert the real payload in the adapter's own test.
- Judge a run by the runner's own verdict (failed count, exit status), never by grepping for an exception name.
- Name tests in full (`file::test_name`): a misspelled `-k` selects nothing, silently.
- Python mutations: run with `PYTHONDONTWRITEBYTECODE=1` and `-B`; a same-length mutant can be served from stale
  bytecode.
- A pin over source text strips comment blocks first and anchors on the declaration, not a token.
- Only a whole-suite run is evidence about the whole suite.

## Validate as the reader

To validate a delivered report or message, check every line as the person receiving it: is it TRUE (traced to its
source), does it NAME its subject, can the reader ACT on it, does it duplicate a line above?

**Why:** asked whether a report was exhaustive, only coverage was checked and it was called clean; the owner then found
five defects in the lines that were there.

**How to apply:** read the traces of the automations a report quotes, not only their state. Read the rendered output,
not the assertion that passed: a substring assertion cannot see a duplication.

## The screen can describe the wrong thing

Type checks and tests cannot see a screen that reads wrong. Trace a number to its source before labelling it; two
figures on one screen count the same set or say they do not; after writing UI text, read the whole panel as the reader
sees it.

**Why:** a counter labelled as one subsystem counted another; a card listed 54 items over a button offering to cancel
14; two paragraphs contradicted each other; an actionable item rendered nowhere.

**How to apply:** pin the RENDER, not the computation: a value computed and never drawn type-checks perfectly.

## Measure the claim, not the comment

A comment, a header, a note or an earlier statement describes intent at one moment. Before acting on "X does Y", count
it in the code; before telling someone a thing cannot be done, enumerate every path that could do it.

**Why:** a module was called "pre-rendering prose" from its header (it was not); a hyperlink was refused twice from one
service's schema while the other transport supported it.

**How to apply:** after changing a named set (an enum, a button row), grep the tree for the old member's name. A
constraint learned from one call site is a fact about that call site. When a well-supported "no" meets a user who
remembers otherwise, run the experiment.

## Run the artefact

Never run a procedure by retyping it from prose: execute the file on disk. Context, notes, skill text and earlier
statements are snapshots; the repository is the truth.

**Why:** a check transcribed from a skill's text "found" a bug fixed hours earlier, and it was reported twice.

**How to apply:** before reporting that a documented mechanism is broken, open the file it lives in. Every probe prints
its denominator, so silence can only mean "measured, found nothing".

## Measure before optimising

A plausible performance cause is worth nothing until measured: instrument, read, then cut what dominates.

**Why:** six obvious causes were argued and disproved in one session; a shipped optimisation made loading 4 s slower;
three of the session's own metrics reported wrong numbers.

**How to apply:** check the anchor of every derived metric; trust the user's stopwatch over your numbers; verify a
shipped optimisation in the field before believing it.

## Instrument before the fix

Ship an instrument at least one release ahead of the fix it will judge, or make it report the before-value too. First
try to reproduce the number offline: an exact reproduction beats an instrument.

**Why:** a counter shipped with its fix read "fine" and could not tell "the fix worked" from "this was never the
cause".

## Instruments never skip

An instrument reports on every branch, its own failures included: never `if (x) report()`, never an early return that
reports nothing. Bucket an expected category on its own line; never drop it.

**Why:** field dumps arrived with no row at all and four explanations could not be told apart; a counter skipped the
very case the owner was complaining about and read 0 while a screenshot showed the defect.

**How to apply:** ask what a field CANNOT see and whether it could look healthy while the thing is broken. A gate must
fail, never raise: a missing subject is a red check, and the rest still runs. Judge a suite by its check count. When an
instrument says 0 and a screenshot says otherwise, believe the screenshot.

## Check the instrument backwards

When a setting or bug would distort future measurements, ask at once what it did to the measurement already on screen,
the one a decision is about to rest on.

**Why:** a comparison read zero by construction and was used to retire working automations; the correction then
overstated the damage without checking.

**How to apply:** before an irreversible action justified by a measurement, read the measurement itself and ask what
would make it read exactly this way if its subject were absent.

## Absence is not evidence

An absence of activity is a question. Before calling something broken, inert or dead, read the definition (the config,
the blueprint, the declaration), not the trace.

**Why:** a fast trace was read as a watchdog that never checks; "never triggered" was a correct automation whose
threshold was never crossed; the villa's system keeps only a few traces per automation.

**How to apply:** separate "did not fire", "could not fire" and "was not recorded". A missing symbol is not a missing
mechanism: grep the concept, not the identifier.

## Zero is not missing

A reading of zero is not a missing reading: much equipment reads zero most of the day. Before agreeing a device went
quiet, compare against what the villa recorded.

**Why:** an alert said a duty-cycled sensor had "zero readings in 72 hours" while it had recorded over a thousand
changes.

## A run is not an alert

An automation's run is not an alert. Before counting anything as an event, open one trace and see what the run did.

**Why:** a report counted 71 "critical alerts" in a week from runs; the phone had received one message in ten days.

## The live system is not the repository

A fact about the live villa (a version, an add-on's state, a setting) is read at the moment it is needed, never
transcribed into notes or docs and quoted later. Store the method, never the answer.

**Why:** a remembered version was stated, was wrong, and became the premise of a confident wrong conclusion.

## Read the registry, not the id

Before explaining which devices something picked, read their area and name from the villa's registry. An entity id is
history (the name at pairing), not its room.

**Why:** a room was inferred from the word in an id; the registry said otherwise and the code was the suspect.

## Fixtures come from the property

Write fixtures from the shapes of the real data a function will meet, not from the mechanism being built. Before
trusting a matcher, resolver or parser, run the shipped function on real inputs and print the result.

**Why:** a matcher mutation-tested seven ways identified zero devices on the villa: the invented labels exercised only
the half that never fires there. A shape-alike fixture is not villa data.

## Check the type, not only the name

Accept every plausible shape of a value you have not captured whole, and log the type and a clipped repr when present
and unreadable. A validator asserts the good shape rather than listing bad ones.

**Why:** a date field had the right name and the wrong type for the life of a feature; a menu parsed any string ending
an id and offered a non-person as a person.

**How to apply:** a guard that refuses names which rule refused. When a flag has a companion timestamp, the timestamp is
the state. When a stored value is impossible, read what wrote it before calling it corruption.

## A green subsystem is not a working one

A subsystem that starts, logs normally and produces plausible but empty output may be doing nothing. Prove it with one
output that could only exist if the whole path ran.

**Why:** five subsystems in one day each reported healthy while broken: a missing argument, a wrong type, a missing
permission.

**How to apply:** ask what the failure path logs; grep every caller of a shared object; a default argument nobody passes
is a constant.

## One owner per predicate

If the server already computes an answer, the client asks for it; it never re-implements the rule.

**Why:** a copied predicate agreed on the common case and diverged on the one the original handled: "11 of 14 could not
be cancelled".

**How to apply:** before writing a filter, grep the server for the same question; if a copy is unavoidable, pin the two
against each other.

## A boundary is not a gap

"Component X cannot see Y" is a fact about one component; "that is a gap" is a claim about the whole system. Before
proposing work, check whether another layer already owns it by design.

**Why:** a capability absent by design was "fixed", which would have produced a third message about one fact.

**How to apply:** ask "who else already tells the owner about this?" and state the architecture back before coding a
change that crosses layers.

## Audit the applicable set

When rolling out a shared feature, enumerate every case it APPLIES to, not every case that already uses it; put the
feature in the shared place so the default is "has it", and make an opt-out explicit.

**Why:** two releases audited the panels that had a history chart and missed the ones that had none; owner: "Make sure
you always enforce DRY and apply consistently any feature to all similar and applicable use case."

**How to apply:**
- `grep -L` (files without a match) finds this class; `grep -l` hides it.
- A config value compared inline in more than one place is already a bug waiting for its next reader.
- A count is the weakest pin: pin the set, the shape, or make it true by construction.
- A corrected claim has an applicable set too: grep the sentence.
- When the same shape is fixed twice, stop fixing sites and count the copies.
- A rename's applicable set is every entity of the device, not the id typed.
- A test written from the same mental list as the change inherits its omissions: derive the set from the tree.

## Find the caller first

Before fixing a flood of calls, find the caller from evidence (the app's log around those times, the run's steps, an
offline reproduction). Say "suspect" until then.

**Why:** a cap was put on the AI's tool while the real caller was a skill's script; the next run did the same.

## Widening a default is a load test

Before widening what a feature applies to, ask what is now proportional to N and what a message now says N times;
after shipping, read the system's logs, not only the app's.

**Why:** "watch everything" raised 69 incidents in one minute and starved the socket; the evidence was only in the
Supervisor's log.

## State the direction

When a request says "derive A from B", write the direction as one sentence with an arrow and check it against the
owner's own words before coding.

**Why:** a feature was built target → profile, fully tested, when the request said profile → targets; a control the
owner wants greyed and labelled is a control that stays.

## Read before promising a size

Do not call a change "small", "a deletion" or "a cleanup" until the code it touches has been read. Describe the
behaviour change and say the size is unknown, or read first.

**Why:** a redesign sold as a net deletion added hundreds of lines and had to be retracted mid-work.

## Close, don't chase

Once the structural causes are fixed, a small residual below what a person can see is covered with a margin and
closed. Before asking the owner for another manual measurement, ask whether the answer would change what ships.

**Why:** five releases chased a debug counter after the owner's reported symptom was already fixed: "Can't you be a bit
more decisive based on all the information you already have?"

## Visual bugs need a target

For anything visual, the instrument is the first commit: read the drawn geometry before changing a number. Get the
target first (an element to match, a marked-up screenshot): "centred" is not a criterion.

**Why:** six fixes for one alignment were derived from a mental model; an instrument destroyed the model in one capture.

**How to apply:** identify a visual object by evidence before explaining it; a request to hide "this thing" removes
that thing, never the feature it was believed to be. Say which open problem is being worked and finish it.

## Simulate the pose space

For anything placed relative to the camera, write the owner's rules as properties, drive the pure placement through
the app's real camera over the whole pose space (headings, tilts, zooms, pans, screen shapes, the time axis), assert
every property including continuity, then render the real model.

**Why:** fixing one recorded pose at a time broke an unrecorded one each time; a full simulation found nine defects
before the first render.
