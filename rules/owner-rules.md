# The owner's rules

Standing rules the owner set for how work is done and shipped. They apply to every contributor and every agent working
in this repository. Dates are when the owner said it.

## Branches and backport

Kiosk work is committed and shipped on `dev2`; Agent work on `agent-dev`. `main` changes only by a backport the owner
asks for, in that prompt, and a backport request covers that prompt only: the next change goes to `dev2` alone.

**Why:** `main` is the release the villa runs; the owner tries every `dev2` release on the wall before it becomes the
product (2026-09-16, restated 2026-10-12: "only bring update to DEV2, and forget about MAIN unless I explicitly mention
it in the prompt").

**How to apply:**
- Backport only with `npm run backport -- --owner-asked` from the `dev2` worktree, never by hand. The flag is the
  owner's word: never pass it on your own.
- CI itself writes `chore(...-channel)` manifest commits on `main`: that is how the store finds a release, not a merge.
- The local guards (pre-commit, pre-push) refuse commits and pushes to `main`; `VK_ALLOW_MAIN=1` is the backport's own
  escape hatch, never yours.

## Shipped means published

A release is done only when the add-on store offers it. Use the release command (`npm run ship -- -F msg` on `dev2`,
`agent-host/tools/release.py ship -F msg` on `agent-dev`); its exit 0 is the only "shipped". Never `git push` and
report done.

**Why:** 2026-09-21, after releases were reported shipped while a red CI job meant nothing reached the store (12
releases lost one way, 6 another): "You should fundamentally change the way you are pushing new version".

**How to apply:** exit 3 means pushed but not published: read the CI run. The only evidence by hand is the channel's
`config.yaml` on `origin/main` naming the version. Match CI runs on the commit's `head_sha`, never "the newest run".

## The owner installs updates

Releasing ends at "published". Installing or updating an app on the villa is always the owner's step: no install or
update from you or from any agent you start.

**Why:** 2026-10-17, a background agent installed a release itself; automatic updates are off on purpose.

**How to apply:** every prompt to an agent that ships says "do not install it on the villa". After shipping, say the
version is offered; if a check needs it running, ask the owner to install it.

## Nothing villa-specific ships

No entity id, room name, device count, villa dimension, per-site tuning value, business or contract value (currency
amounts, clause references, company names) may be written into shipped code. Derive from live data, match through
generic lookups, and prefer an empty default to a seeded one for any user-editable list.

**Why:** such a value works on the machine it was written against and silently breaks every other install; two real
ones were found after the codebase was believed clean (a seeded threshold list and a contract's maintenance clauses).

**How to apply:**
- Reading the villa's real data to debug is fine; it never becomes a literal, a default or a fixture.
- Explaining the rule, write a shaped placeholder (`<domain>.<room>_window`), never a real id.
- A seed spread under stored config resurrects deleted entries on reload: start empty.
- Asked "are you sure nothing is hardcoded?": grep the diff and show the evidence.
- `tests/hard-rules.py` freezes the ids in tracked source; it scans TRACKED files only, so stage a new file first.

## No internet dependency

The app must work fully with no internet: the target is a wall tablet with only a local link to the villa's system.

**Why:** owner's must-have, 2026-08-02. Anything fetched from a third-party host works on a desk and is missing on the
wall, the worst failure because it only shows at the site.

**How to apply:** no webfont, CDN script, remote image or lazily fetched asset. Before using any Babylon feature, check
whether it fetches lazily (loading screen, default environment, lens flares, KTX2 transcoder defaults).

## Never name the platform

Never write "Home Assistant" or "HA" in anything a person reads: Kiosk screens, tooltips and errors, the Agent's
messages, notes, report pages and what its AI says. Say "the villa's system", or drop the phrase.

**Why:** the owner asked twice on 2026-10-15; the product is VESTA, the platform underneath is not the reader's concern.

**How to apply:** guarded by `tests/oracles/no_platform_name.mjs` (Kiosk) and the Agent's `test_no_platform_name.py`; a
new spoken file is added to its list. Comments, logs, the Agent's admin setup page and store descriptions are exempt.

## Automation, never rule

In any text a person reads, the villa's automations and blueprints are "automations" (or "VESTA automations"). "Rules"
is only the Agent's own policy file and tab.

**Why:** owner, 2026-10-22: "everything that relates to Automation defined in Home Assistant (or Blueprint) shall never
be replaced by the term Rules, since it's confusing." Code identifiers may keep "rule".

## Every number is a setting

No word in a message, card, report or screen may hardcode a value that is really a setting or a parameter: a role, a
duration, a count window, a priority or a threshold is built from its setting. Settings are named, shown with their
value, and the AI is given their values.

**Why:** an alert card's words stopped matching the automation's current settings after the owner changed a threshold
("a big issue", 2026-10-17); restated 2026-10-24 ("5 minutes is not editable").

**How to apply:** before writing a number into text, find the setting it comes from and read it there. An open alert is
judged against the automation's current values, never the ones it was raised with.

## Durations are joined

Write a duration with its unit joined to the number: "30s", "10min", "1h 30min", "2d 3h". One rule on every surface
(Kiosk, Agent messages and pages, the villa's own automations).

**Why:** owner, 2026-10-24 (option A, "all joined"), after "Watch 1 h" and "10 min" read inconsistently.

**How to apply:** the Kiosk's `fmtDuration` and the Agent's duration words share the agreement's duration cases
(`agent-contract.json`); use them, never format by hand.

## No long dash in UI text

Never write " — " in text a person reads on a screen or in a message. Use a colon, a comma or a new sentence.

**Why:** owner's standing rule for every UI text.

## No half features

When a change leaves a feature with no way for anyone to use it (its seed emptied, its screen never built, its caller
removed), remove the feature and its code in the same change.

**Why:** owner, 2026-10-20, on alert thresholds that had no editor for months: "why has this been introduced if it
hasn't been fully coded?" and "remove all unused code and dead one".

**How to apply:** after emptying a seed or removing a caller, grep what it fed and finish it or delete it. Before
proposing work on a feature, check a user can reach it.

## No exceptions

Never add an exception for one device, entity or case to a check, rule or alert. When a check fires wrongly, fix its
logic for every device, or explain why it is right.

**Why:** owner, 2026-10-18: "no, never introduce any exception." An exception list hides the next real fault and is
per-site tuning.

## Decided means decided

When the owner approves something, build it. An objection goes to the owner BEFORE the work, never as a note after it.

**Why:** 2026-08-28, a part the owner had approved was reversed silently and mentioned in a closing paragraph; the owner
decides fast and in one line, and that only works if approval means it gets built.

**How to apply:** state objections while scoping, when they are cheap. If new facts change the answer mid-work, say so
as the FIRST thing in the next message and ask. A reversal needs a stronger argument than raising it would have.

## Ship, don't ask

Once the cause is found, implement and ship the fix without asking "shall I?". Ask only for a real decision between two
behaviours the owner wants.

**Why:** owner: "never ask me to proceed to proceed to improvement, as this is what i am asking you to do" and "never
wait for my word before shipping, once you have finished the implementation".

## Time matters

Bundle related items into one release, measure only what a decision rests on, and say plainly what was skipped.

**Why:** owner, 2026-09-27, "Time matters": each release costs a full gate run and a CI wait.

## One mechanism per job

For every job (a channel, a store, a settings file, an input), keep ONE mechanism. When merging two designs, never
keep "the best of both": list what is removed and why. Before designing a new field, flag, store or card, find the
mechanism that already does that job for another case and widen it; say which one in the plan.

**Why:** owner, 2026-09-30, on a merge that kept features from both sides: "don't try to keep features from both
sources if it's redundant; simplify to the most efficient configuration". Owner, 2026-10-25, when a new field was
being planned for faults that clear themselves while the "being confirmed" card already watched a person's close:
"centrally define this by not adding new code for this, since the feature already exists".

## Defined once

Everything is defined in one place: a list, a value, a rule, a text. Never accept a second copy with a note to keep
the two identical.

**Why:** owner, 2026-10-24: "Everything shall be uniquely defined in a centralised way, right?" (a list written twice
in a YAML package; a YAML anchor shares it).

**How to apply:** before duplicating, find the sharing mechanism: a shared module, an attribute another entity reads, a
YAML anchor in the same file. If none truly exists, say so before the work.

## Fix the shared piece

When one use of a shared component misbehaves, fix the shared component, not the caller. Never write new code for a
feature that a central layout or function already serves (DRY).

**Why:** owner, 2026-10-15: "Always use DRY and never code specific new code lines for same feature and target, when
centralise layout or code can be used." A tooltip clipped in one chart was the shared tooltip's placement model.

## No per-caller switch

A shared window or component looks and behaves the same from every entry point. Derive a behaviour inside the
component from what it shows, never from a flag each caller must pass.

**Why:** a grouping flag passed by 2 of 5 openers gave two different windows for the same list: "a major break of the
DRY practice I told you multiple times to enforce".

**How to apply:** if a flag seems needed, list every caller first and say which entry points get it.

## The owner verifies by screenshots

Never drive a browser to verify UI work. The owner checks on real devices and sends screenshots; rely on the type
check, the build and the checks, and say exactly what to look at on which device.

**Why:** owner: "I'll do this myself." Budget for a round trip on pixel-level requests.

## iPhone and Android alike

Every change must fully work on iPhone and on Android.

**Why:** owner, 2026-08-02: "we had a lot of difficulties previously to make it work properly on iPhone." iOS breaks
first: a memory ceiling per tab, APIs that arrive late.

**How to apply:** check an API's availability on Safari and ship a fallback; anything raising peak memory needs an
explicit iOS answer. When controls stop fitting a phone row, group them so they wrap together; never strip their words.

## One line per problem

A repeated problem is one line with a count ("(6 times)"), never one line per update, in every list of problems,
faults or alert steps on every surface. The writer side never creates a second record for an open problem.

**Why:** the Cockpit showed the same incident six times; the owner called it "really bad".

## Forms, charts and lists

Every chart has a Y axis with grid lines and values. No free-text field where the value comes from a known set: choose
from a searchable dropdown. Long lists are tables paged ten rows at a time. Pages follow the Kiosk's Light / Auto /
Dark look. Long names never overflow their field.

**Why:** owner, 2026-10-01, as general rules ("always", "everywhere it's relevant").

## Fill, don't paint

When the owner shows an empty band, make the app use that space; never recolour the band.

**Why:** owner, 2026-10-16: "i don't want you to colour it, i want you to make sure the app is using the whole screen".

## Private stays private

`docs/`, the villa's own data and notes, and the proxy's security test suite never go to the repository.

**Why:** owner's rules (2026-10-13 for `docs/`; the security suite maps exactly what the sign-in boundary checks).

**How to apply:** stage named files only; `docs/` is excluded by `.git/info/exclude`, the villa notes and the security
suite live in gitignored `.scratch/`. Verify with `git check-ignore -v`, never from memory.
