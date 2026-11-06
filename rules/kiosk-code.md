# Kiosk code

Rules specific to the VESTA Kiosk (React, TypeScript, Babylon.js). The commands and hard rules are in `CLAUDE.md`.

## Checks drive values

Oracles (`tests/oracles/*.mjs`) drive values through pure modules or draw the component (`tests/consistency/screen.mjs`,
`tests/consistency/jsx.mjs`), rather than matching source text. Prove each new check red with `npm run mutate`. Before
shipping, `npm run oracles:changed` runs the checks naming a changed file in seconds; `ship` still runs them all.

**Why:** checks that pinned the exact wording of the code failed four releases in one day (2026-10-24) on harmless
rewrites, while missing real behaviour changes.

## Babylon side-effect imports

Several Babylon APIs are patched onto a class by a sibling module at import time; deep imports do not pull it in, and
the types cannot tell. A missing import type-checks and fails at runtime, often as a silent no-op.

**Why:** picking, animations, outlines, collisions and shadows each broke this way; collisions threw on every movement
frame and read as a performance problem for two releases.

**How to apply:** add the bare side-effect import in every file that uses the behaviour. To check, grep the BUILT bundle
for the class name; Babylon's own `_WarnImport` throw sites list the candidates. A Node oracle on a NullEngine throws
the same error and is the cheapest detector.

## Animations own their clock

Never drive an animation from `engine.getDeltaTime()`: it is tick-to-tick, not render-to-render, and the app caps
frames. Measure `performance.now()` between steps, clamp the delta, and express rates per second, never per frame.

**Why:** fans and pulses ran at half speed while idle and surged on interaction.

## Node green, browser dead

Never store a window function as a field or default (`= setTimeout`, `= fetch`, `= requestAnimationFrame`): call it
through an arrow. Oracles run in Node; a browser throws "Illegal invocation".

**Why:** for seven releases no state reached the 3D view on the wall while every check was green.

**How to apply:** when an oracle must cover a browser rule, enforce the rule in the oracle. When "nothing works" on the
wall, read the add-on log for a telemetry flood or socket churn, then the platform's logbook to tell "never sent" from
"never shown".

## Debug text can crash

Never use a non-null assertion (`!`) on a value a debug line formats: debug lines run on every load, inside effects, and
an exception there takes the whole app down.

**Why:** a debug line formatting a null value stopped the app opening on every device one evening; the crash-loop report
pointed at memory and cost an hour.

**How to apply:** a new state the code allows needs every reader of that state checked, reports included.

## One status vocabulary

Status colours are defined once in `STATUS_COLOR` (`utils/stateColors`); anything painting a status reads from there.
Derive the meaning with the shared helpers, never a per-domain helper or a hand-written ternary.

**Why:** a surface that invented its own colour made the map legend a lie.

**How to apply:**
- An unrecognised state falls back to idle, never to the lost-contact colour.
- Red means "needs attention" only, on every surface, counts included; one summary gives one health answer.
- A sensor's badge, its window pill, its history bar and the Cockpit answer with one rule (`alertStateFor`).
- The legend reads the same constant: change it in the same change.

## A badge on a chip is an unresolved room

A device badge sitting on a collapsed room chip means the device has no resolved room. Check, in order: is its id in
the set the room resolver walks, does the platform carry its area on the device, is its anchor inside a room outline.
Only then look at placement.

**Why:** a fix to placement was made first, while the cause was a device bound through a mesh never reaching the
resolver.

## Rename a key when its default changes

`saveConfig` writes the whole config, so changing a default does nothing on an existing install. When a setting's
meaning or default changes, rename its key. Never cite a gitignored file in a tracked comment: CI's citation check
fails there and passes locally.

**Why:** camera beam angles were wrong until the heading and tilt settings were renamed with their new defaults.

## Performance instruments

Performance questions are answered from telemetry, never from argument. The surviving instruments are the on-device
probe (Settings › Advanced › Device telemetry), the freeze spans (`cover` is the verdict: 0 means no app code ran), and
the leak watch (`scene` is the verdict). Telemetry is a small ring shared by every device: never add an unthrottled
reporter.

## Measure on the real model offline

A visual or placement change is measured on the real villa model before the owner checks it: the model can be loaded
headless in Node through the app's real scene modules. Those probes name the villa's model and stay gitignored.

For badge placement, measure on the owner's own pose: with `?debug=place`, the debug box's "Copy placement report"
copies the last layout pass (its whole input and the check's findings), and a failing pass reaches Settings ›
Advanced › Device telemetry as a `placement` row (copy it from there on any device). Save it under `.scratch/` and
replay it with `node tools/placement-probe.mjs <report.json>`: the real pass and check on the device's values;
`--focus`, `--no-focus` and `--suppress` test another tapped room.

**Why:** validation steps written for a case the villa barely had could not be done; a probe showed nothing changed.
Two overlap fixes (2.496.552-553) were made without the phone's pose, the second cause still an inference.

## A card's state is one pill

Every Cockpit card says its state only on its first line (RecordCard's `status`), under the strip: its words joined
" · ", bold, in the tone of the strip above it (red act now, amber a fault, green handled, grey quiet or closed); its
next check is a pill at that line's right, under the strip's time (CheckPill, owner 2026-11-06); a problem only watched
live says "checked live" (faultTiming.cardCheck: a card with a VESTA fault says the fault's, a live part of it its own). Every card that can
have a state has one: an open fault nobody moved says "New fault", its stage words from `fmEngine.STAGE_WORDS`
(owner, 2026-11-06: an unmoved maintenance-check fault's card began with its quiet line). The strip names the thing (`title`) and says when. A line of text says what is wrong,
never the state; who moved it is the who line (`who`, faultNotes.moveWho), never its stage or its time again. Never add
a case to a shared format that makes one kind of card read differently.

**Why:** owner, 2026-11-01: "Missing, #100-P1" was a special case inside the shared code, so one kind of card had its own
format; the same code path does not mean the same format. Owner, 2026-11-05 ("Status on top", then the second card the
same day): the name and the time in the strip, then the state, then where, then what, then who, then the buttons, the
same on every card.

**How to apply:** before adding a condition to anything every card goes through, ask whether it creates a second format;
if so, ask the owner first. `tests/oracles/cockpit_cards.mjs` fails on a state said twice, in the bar or in a line's words.

## A row's every field, on every kind of card

A card's anatomy is the same whatever kind of problem it is: the strip (its source icons, its alert's name, the thing's
name, its time at the right; the name wraps to two lines at most, the icons, chip and time never shrink and stay on its
first line), the state its first line (its next check a pill at its right), one quiet line (room, then its tags, " · " between them), its
words, who moved it, its bar (the main action first and green). A notification's or a report's name is its title's first
sentence, the rest its first line (announcements.titleSentences). A new field, or a change to one, is proven on EVERY
kind (offline, Missing, red device, late task, fault, ticket, Watch), not on the kinds the change touched; a time comes
from `beganAt` or the record, never a per-kind blank. A card with no status and no icon still has its strip, its name
and its time.

**Why:** owner, 2026-11-01: an offline camera's row had no time. The review after the one-pill change compared state and
words only, and the time existed on faults alone, so "consistent everywhere" was claimed over a field nobody had asked.

**How to apply:** `tests/oracles/every_card_row.mjs` draws the real card of each kind through the real path and fails when
a kind of line is not in its table; add a new field there, and prove it red on one kind. The Inbox's card and the card
drawn alone draw the same strip, first line and quiet line.

Every `RecordCard` in the tree counts, not only the Inbox's: its strip its name and time, its first line its state, its quiet line its room
(`useCardRoom`, "Other" with none) first. The check derives the cards from the source tree, so a card on another tab
cannot be skipped; a card with no place is listed there with why. Before saying "every card", name the tabs that were
checked; never accept a gap by describing it.

Settings' and Advanced Settings' records are the same card (owner, 2026-11-06): a device group and a suggested one, a
bound 3D object, an object bound to nothing, an entity no object shows, an asleep device, a device of Devices, a 3D
object whose entity is gone, a full-screen announcement, a chat. Its main action (Bind, Create this group, Point it there)
is a segment of its bar; its remove is never a word in the bar but a small round icon at its strip's right end
(RecordCard's `remove`, owner 2026-11-06), a bin when it deletes the thing (a group, a device's settings, an
announcement), an ✕ when it takes it off a list or undoes a link (a chat, an asleep device, an unbind), its tooltip and
name saying what goes ("Delete the group …", "Take … off the Asleep list"); a card whose bar holds nothing has none. The
Cockpit's cards never use it. A control (On | Off, a slider, a setting line) stays a setting line, a log (Device telemetry) a
list. A device of Devices is never folded and has no room line (owner, 2026-11-06: redundant); on a phone its "Confirm
before toggling" is a line of its own under its id, the box and the id always on one line. A card's fields start at
one x (one name column, `--card-field-label`; on a phone the name above its control). Each list has ONE field
(`SearchOrAdd`): it narrows the list and, where the list takes devices, offers them saying where each already is. A bound 3D object's card is its entity's (name, room · id), saying
"<object> is bound to <entity>". `tests/oracles/settings_cards.mjs` draws each kind through its real section.
