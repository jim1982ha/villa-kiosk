# Rules

The owner's standing rules for this repository, Kiosk and Agent alike, each said once. `CLAUDE.md` holds the
commands, the branches and the hard safety rules; this file holds the rest. A new rule goes here (on `dev2`), never
only into a private memory. Nothing villa-specific goes in.

## Working with the owner

### Decided means decided
Approval means build it. An objection goes to the owner before the work, never in a closing note. If new facts change
the answer mid-work, say so first in the next message and ask.

### Ship, don't ask
Once the cause is found, implement and ship. Ask only for a real choice between two behaviours the owner wants.

### Time matters
Ship each fix as soon as it is ready; don't hold one piece of work for another. Measure only what a decision rests
on. Do small, located fixes directly; use a sub-agent only for a real investigation, with the files already named.

### The owner installs updates
Shipping ends at "published". Never install or update an app on the villa, and tell every agent you start the same.

### The owner verifies by screenshots
Never drive a browser to verify UI work: say where on which screen to look.

### Speak in UI terms
Use the screen's words (tab, button label, chip text, message). No file, function, key, record id or version number
unless the owner's decision depends on it, and then say what it means. No table whose cells are identifiers.

### Short plain questions
At most three questions per round, each answerable in one word, about what the owner will see. Decide mechanisms and
obvious defaults yourself and state them in one line.

### Check before you report
Don't call something done, open or failed without having looked at it.

### Review pages
Plain English, never French, for the owner, not a programmer. Each card, in order: what the owner sees today (drawn as
a chat, a page or a report), what they would see after, why in one sentence without code words, the cost (effort,
risk). File names and design terms go in a folded "For the developer" box. Send the page as a file.

### Report prose
- A number carries its unit (from the reading's own unit); a bare count carries its noun ("6 transitions").
- Quote names of automations, blueprints and files with apostrophes ('like this'): Telegram eats brackets.
- One glyph per heading; group repeated lines on a reason code; write whole sentences, never assembled clauses.
- The role is "Facility Manager", never "caretaker".

## Words a person reads

### Automation, never rule
The villa's automations and blueprints are "automations" (or "VESTA automations"). For the Agent's policy, name the
setting as its page does ("VESTA's Allowed actions", "Acting on the villa"), never "your Rules". Code may say "rule".

### Every number is a setting
A role, duration, window, priority or threshold in text is built from its setting, never written by hand. An open
alert is judged against the automation's current values.

### Durations are joined
"30s", "10min", "1h 30min", "2d 3h" on every surface, through the shared duration words (`fmtDuration`, the Agent's
duration words, the agreement's duration cases). Never format by hand.

### No long dash
Never " — " in text a person reads: use a colon, a comma or a new sentence.

## Design

### One of everything
- One mechanism per job (store, channel, settings file, input). Before adding a field, flag, store or card, find the
  mechanism already doing that job and widen it. Merging two designs never keeps both.
- Every list, value, rule and text is defined once (shared module, YAML anchor). Never a second copy "kept equal".
- When one use of a shared component misbehaves, fix the shared component, not the caller.
- A shared window behaves the same from every entry point: derive behaviour inside it, never from a per-caller flag.

### No half features
A feature nobody can reach (seed emptied, screen never built, caller removed) is removed with its code in the same
change.

### No exceptions
Never an exception for one device, entity or case in a check, rule or alert. Fix the logic for every device.

### Telegram and the tablet alike
One alert is one card updated in place, named the same everywhere ("#91-P2"): Telegram, the tablet's card, its ticket
and open issue, the digest, the assistant. A name or format both sides write lives in the agreement
(`agent-contract.json`) and one function per side (`messaging.incident_tag`, `fmEngine.alertLabel`).

### One line per problem
A repeated problem is one line with a count ("(6 times)") on every surface; the writer never opens a second record for
an open problem.

## Screens

### iPhone and Android alike
Every change works on both. Check Safari availability of an API and ship a fallback; anything raising peak memory needs
an iOS answer. Controls that stop fitting a phone row wrap as a group; never strip their words.

### Forms, charts and lists
- Every chart has a Y axis with grid lines and values.
- A value from a known set is picked from a searchable dropdown, never typed. Who does the work ("Done by") is the
  exception: typed every time, never offered from earlier records or the browser's memory.
- Long lists are pages of ten rows; pages follow Light / Auto / Dark; long names never overflow.
- An outage seen in a step of a finer chart (1h, 24h) stripes the step holding it in every coarser one (1w, 1m, 1y),
  however short, with the same tooltip words. All outages come from the one history reader (`src/ha/historySource.ts`).

### Fill, don't paint
When the owner shows an empty band, make the app use that space; never recolour it.

### Cards
Every card (Cockpit, Inbox, Tickets, Settings, Advanced Settings) has the same anatomy, folded or open, in this order:
- The strip: source icons, alert name, the thing's name (two lines at most), its time at the right, in the state's
  colour. Icons, chip and time never shrink. A remove is a small round icon at the strip's right end (a bin deletes,
  an ✕ takes off a list), never a word in the bar; the Cockpit's cards have none.
- The state: the first line, its words joined " · ", bold, in the strip's tone (red act now, amber a fault, green
  handled, grey quiet or closed); its next check a pill at that line's right, "checked live" when only watched live. An
  unmoved open fault says "New fault". A state never repeats the card's words and never appears elsewhere.
- One quiet line (room, then tags), the words saying what is wrong, the who line, then the bar (main action first,
  green).

A time comes from `beganAt` or the record, never a per-kind blank. One card per device in Open issues and Watch. Never
add a condition to the shared card that makes one kind read differently: ask the owner first. In Settings,
each list has one field (`SearchOrAdd`) and fields start at one column (`--card-field-label`); a device of Devices is
never folded and has no room line.

### One status vocabulary
Status colours come only from `STATUS_COLOR`; meanings from the shared helpers (`alertStateFor`). Red means "needs
attention" only, counts included. An unknown state falls back to idle, never lost-contact. The legend reads the same
constant.

## Decided: do not re-propose

Unless the owner raises it, or new evidence changes the facts (say so before any work).

- Branches: only `main`, `dev2`, `agent-dev`; never the old `dev`/`ai` branches.
- The model's grey, soft baked look is accepted: no environment, HDRI or IBL work.
- KTX2 textures: measured +500% size, no gain. Closed.
- Ceilings show while walking and hide in the overview; a roof uses the plan's per-room "Display ceiling".
- The order-independent badge placement fix stays.
- Sun and moon follow the real clock on one placement rule; no side-switching or screen-edge placement.
- The ~1.2s freeze was measured with no app code running: not ours.
- Calling the door intercom from Telegram: declined.
- No Agent SDK sub-agents without new cost figures.
- Asleep devices are one list, in the Kiosk's Advanced Settings; the Agent reads it.
- The bake pipeline's `_BAKE_JOBS` table is the owner's: never reset or move it.
- Automation descriptions: one or two plain sentences; history in the HISTORY file.
- The night message keeps its English words beside a translated Status.

### Nothing on the map overlaps
No badge, card or room chip is drawn over another, whatever the pose. The `?debug=place` check counts every overlap
as a failure; a category it may skip is listed in `ALLOWED_FINDINGS` with one of these headings, and only the owner
adds one.

### Badges group only when they touch
Badges merge into a card, and a room into its chip, only when their drawn boxes meet: no margin, no centre floor.

### Badges behind a wall hide while walking
In the walking view a badge whose device is behind a wall is hidden; the check counts them apart (`byWall`).

## Kiosk code

### Checks drive values
Oracles (`tests/oracles/*.mjs`) drive values through pure modules or draw the component (`tests/consistency/`), never
match source text. A fix comes with a normal test that fails without it.

### Babylon side-effect imports
Several Babylon APIs are patched on by a sibling module at import time; a missing import type-checks and fails at
runtime, often silently. Add the bare import in every file that uses the behaviour; grep the built bundle to check.

### Animations own their clock
Never `engine.getDeltaTime()`: measure `performance.now()`, clamp, express rates per second.

### Node green, browser dead
Never store a window function as a field or default (`= setTimeout`, `= fetch`): call it through an arrow.

### Debug text can crash
No `!` on a value a debug line formats: debug lines run on every load.

### A badge on a chip is an unresolved room
Check the room resolver's id set, the device's area, and its anchor inside a room outline before touching placement.

### Rename a key when its default changes
`saveConfig` writes the whole config, so a new default does nothing on an existing install: rename the key. Never
cite a gitignored file in a tracked comment.

### Performance instruments
Answer performance questions from telemetry: the on-device probe (Settings › Advanced › Device telemetry), the freeze
spans (`cover` 0 = no app code ran), the leak watch (`scene`). Never add an unthrottled reporter.

## The villa's system

### The MCP tools only
Read and change the villa only through the session's MCP tools: never from a script, never by reading the client's
config for its address or token, never repeating a secret.

### Edit the villa's copy, with the tool
Read a blueprint from the villa, edit that text, save with the blueprint tool (overwrite), read it back and compare.
Never hand the owner a file to paste. After any blueprint change, check its consumers ("used by", none unavailable)
and the system log.

### Blueprint texts are short
Descriptions say what it is for in three lines at most; history goes in `HISTORY.md` beside the blueprints. Layout: an
open "Common" section, then one collapsed "<X> mode" section per mode. Input names and defaults never change.

### Helpers live in package files
Every helper is defined in a `packages/` file named for its feature, one prefix per feature; never created through the
UI or the storage API.

### Know what a reload resets
A template reload resets every template's "last changed". Say the side effect before a reload; when behaviour is
unchanged, let the next restart apply it.

### Fetch what you know
Fetch the one blueprint, entity or short history window by its path or id; never list everything first. Read the
logbook in 24-hour windows with an explicit end.

### The suffix is not the duplicate
The `_2` registration may be the live one: compare versions and last real change before deleting, then re-check every
person that tracked it.

### Use the platform's own features
Consume the villa system's API (history, activity, alerts) before building your own.

### An alert is VESTA's
A villa message reporting a problem (an alert stage, "⚠️ New alert") sends a `vesta_critical_event` (`phase: opened`,
its entities, and a `claim` template true while the problem holds) in the same run, tested with `ha_eval_template`. A
notice (doorbell, camera picture, weekly test) never uses an alert stage.

### App packaging facts
The watchdog uses the Docker `HEALTHCHECK`; the add-on linter refuses keys at their default; changing a default port
changes every install on update; base images float, guarded by CI's start-up test.

## Agent code

### Skills before code
What a skill can define (thresholds, sections, wording, prompts, scripts, which automations are alerts, routes) lives
in the skill, never the engine.

### Skill folders are hands-off
Change a skill's files only when the request names that change; a test skill is its own folder.

### Tools follow the asker
The asker's role alone decides the tools; a skill never limits them; a scheduled job gets everything switched on.

### The engine delivers what must be seen
Photos and files a person must see are sent by the engine from what the run did; an action nobody asked for is gated
by the engine. In a conversation the AI only offers a ticket.

### Never in the critical path
A critical alert reaches Telegram and the tablet without the Agent or the Kiosk app: the villa's system sends it with a
plain fallback, to the chats its own sensor names (an empty list sends to more, never none). For every change on that
path, say what still arrives with the Agent stopped, the Kiosk stopped, and a list empty.

### Format changes need migrations
Migrate what the Agent wrote, refuse loudly what the owner wrote, rebuild nightly artefacts at start-up.

### Test the real argument path
Test the caller with real wiring, not only the helper it calls.
