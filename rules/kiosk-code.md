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
