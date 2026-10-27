# Rules index

One line per rule, by theme; open the file for the rule, its why and how to apply it. These are the rules every
contributor and every agent follows in this repository; `CLAUDE.md` holds the commands and the two hard rules.

## The owner's rules

- [Branches and backport](owner-rules.md#branches-and-backport) — work on dev2 (Kiosk) / agent-dev (Agent); main only by `npm run backport -- --owner-asked`, on the owner's word, that prompt only
- [Shipped means published](owner-rules.md#shipped-means-published) — release with the ship command; exit 0 = the store offers it; never `git push` and say done
- [The owner installs updates](owner-rules.md#the-owner-installs-updates) — shipping ends at published; never install or update an app on the villa
- [Nothing villa-specific ships](owner-rules.md#nothing-villa-specific-ships) — no entity id, room, count, dimension, tuning or contract value in shipped code; empty defaults
- [No internet dependency](owner-rules.md#no-internet-dependency) — works with no WAN; no CDN, webfont, remote asset; check Babylon features for lazy fetches
- [Never name the platform](owner-rules.md#never-name-the-platform) — "the villa's system", never Home Assistant / HA in text a person reads
- [Automation, never rule](owner-rules.md#automation-never-rule) — the villa's automations are "automations"; "Rules" is only the Agent's policy
- [Every number is a setting](owner-rules.md#every-number-is-a-setting) — a role, duration, window, priority or threshold in text comes from its setting
- [Durations are joined](owner-rules.md#durations-are-joined) — "30s", "10min", "1h 30min"; use the shared duration words
- [No long dash in UI text](owner-rules.md#no-long-dash-in-ui-text) — no " — " in text a person reads
- [No half features](owner-rules.md#no-half-features) — a feature no one can reach is removed with its code
- [No exceptions](owner-rules.md#no-exceptions) — never a per-device exception; fix the check for everyone
- [Decided means decided](owner-rules.md#decided-means-decided) — approval means build it; objections BEFORE the work, never in a footnote
- [Ship, don't ask](owner-rules.md#ship-dont-ask) — cause found: implement and ship; ask only for a real decision
- [Time matters](owner-rules.md#time-matters) — bundle a release; measure only what a decision needs; say what was skipped
- [One mechanism per job](owner-rules.md#one-mechanism-per-job) — one store, channel or input per job; widen the existing one before adding; merging designs never keeps both
- [Defined once](owner-rules.md#defined-once) — every list, value or text in one place; YAML anchors, shared modules
- [Fix the shared piece](owner-rules.md#fix-the-shared-piece) — fix the shared component, never the misbehaving caller (DRY)
- [No per-caller switch](owner-rules.md#no-per-caller-switch) — a shared window behaves the same from every entry point
- [The owner verifies by screenshots](owner-rules.md#the-owner-verifies-by-screenshots) — no browser testing; say what to check on which device
- [iPhone and Android alike](owner-rules.md#iphone-and-android-alike) — every change works on iPhone too; fallbacks for late Safari APIs; group controls that wrap
- [One line per problem](owner-rules.md#one-line-per-problem) — a repeated problem is one line with a count, on every surface
- [Forms, charts and lists](owner-rules.md#forms-charts-and-lists) — Y axis with grid, pickers not free text, 10-row pages, Light/Auto/Dark
- [Fill, don't paint](owner-rules.md#fill-dont-paint) — use the empty band; never recolour it
- [Private stays private](owner-rules.md#private-stays-private) — docs/, villa data and the security suite never reach the repository

## Talking to the owner

- [Speak in UI terms](talking-to-the-owner.md#speak-in-ui-terms) — use the screen's words; no ids, versions, function names in replies
- [Short plain questions](talking-to-the-owner.md#short-plain-questions) — at most 3 short questions about what the owner sees
- [List every request](talking-to-the-owner.md#list-every-request) — several asks: one checked line per ask
- [Review pages for the owner](talking-to-the-owner.md#review-pages-for-the-owner) — plain English cards: today seen, after, why, cost; code in a folded box
- [Report prose rules](talking-to-the-owner.md#report-prose-rules) — units on numbers, apostrophes round names, one glyph per heading, whole sentences
- [Check notes before listing them](talking-to-the-owner.md#check-notes-before-listing-them) — open the code before saying open, parked, failed or forever
- [Check an agent's claims](talking-to-the-owner.md#check-an-agents-claims) — verify a sub-agent's cited commits and rules before reporting
- [Test steps the owner can do](talking-to-the-owner.md#test-steps-the-owner-can-do) — measure on the villa; a text sketch of the screen first, then the exact place, or say nothing is visible

## Decided: do not re-propose

- [Branches retired](decided.md#branches-retired) — only main, dev2, agent-dev; never the old dev/ai branches
- [The model's look is accepted](decided.md#the-models-look-is-accepted) — no environment/IBL/HDRI work on the baked model
- [KTX2 textures are closed](decided.md#ktx2-textures-are-closed) — measured +500% size, no gain; never raise it
- [Ceilings: the main behaviour stays](decided.md#ceilings-the-main-behaviour-stays) — the eye-level ceiling rule was reverted; per-room plan setting for roofs
- [Badge placement determinism stays](decided.md#badge-placement-determinism-stays) — order-independent placement fix stays
- [Nothing on the map overlaps](decided.md#nothing-on-the-map-overlaps) — every overlap is a failure; only the owner allows a category
- [Badges group only when they touch](decided.md#badges-group-only-when-they-touch) — no margin, no centre floor (2.413.0)
- [Badges behind a wall hide while walking](decided.md#badges-behind-a-wall-hide-while-walking) — the one allowed placement finding
- [Sun and moon placement](decided.md#sun-and-moon-placement) — real clock, one placement rule; seen-point turning rejected
- [The ~1.2 s freeze is not ours](decided.md#the-12-s-freeze-is-not-ours) — measured with no app code running; don't reopen
- [Intercom calling declined](decided.md#intercom-calling-declined) — no Telegram call to the intercom
- [Agent sub-agents parked](decided.md#agent-sub-agents-parked) — no SDK sub-agents without new cost figures
- [Asleep devices: one list, the Kiosk's](decided.md#asleep-devices-one-list-the-kiosks) — the Kiosk owns the unavailable-by-design list; the Agent reads it
- [The bake's job table is the owner's](decided.md#the-bakes-job-table-is-the-owners) — never reset or move the bake pipeline's job table
- [Automation descriptions stay as written](decided.md#automation-descriptions-stay-as-written) — short blueprint texts; automations' long descriptions kept

## Verifying a claim

- [Ask where the user sees it](verifying.md#ask-where-the-user-sees-it) — two correct halves joined by nothing; find the output only the whole path makes
- [Pin the caller](verifying.md#pin-the-caller) — test the production path that supplies the wiring, not the helper
- [A test must have gone red](verifying.md#a-test-must-have-gone-red) — prove every check red; the mutation pitfalls
- [Validate as the reader](verifying.md#validate-as-the-reader) — every line: true, names its subject, actionable, not duplicated
- [The screen can describe the wrong thing](verifying.md#the-screen-can-describe-the-wrong-thing) — trace a number to its source; pin the render, not the computation
- [Measure the claim, not the comment](verifying.md#measure-the-claim-not-the-comment) — count it in the code before acting on a comment or a "can't"
- [Run the artefact](verifying.md#run-the-artefact) — execute the file on disk, never a retyped procedure
- [Measure before optimising](verifying.md#measure-before-optimising) — instrument, read, then cut what dominates
- [Instrument before the fix](verifying.md#instrument-before-the-fix) — ship the counter a release ahead, or reproduce the number offline
- [Instruments never skip](verifying.md#instruments-never-skip) — report on every branch; bucket, don't drop; believe the screenshot
- [Check the instrument backwards](verifying.md#check-the-instrument-backwards) — what did this bug do to the measurement already on screen?
- [Absence is not evidence](verifying.md#absence-is-not-evidence) — read the definition before calling something dead
- [Zero is not missing](verifying.md#zero-is-not-missing) — duty-cycled devices read zero most of the day
- [A run is not an alert](verifying.md#a-run-is-not-an-alert) — open one trace before counting runs as events
- [The live system is not the repository](verifying.md#the-live-system-is-not-the-repository) — read live facts when needed; store the method, never the answer
- [Read the registry, not the id](verifying.md#read-the-registry-not-the-id) — a device's room comes from the registry, never its id
- [Fixtures come from the property](verifying.md#fixtures-come-from-the-property) — fixture shapes from real data; run the shipped function on real inputs
- [Check the type, not only the name](verifying.md#check-the-type-not-only-the-name) — accept every plausible shape; assert the good shape
- [A green subsystem is not a working one](verifying.md#a-green-subsystem-is-not-a-working-one) — starts and logs fine, does nothing; prove the whole path
- [One owner per predicate](verifying.md#one-owner-per-predicate) — the client asks the server, never copies its rule
- [A boundary is not a gap](verifying.md#a-boundary-is-not-a-gap) — check which layer owns it before calling it missing
- [Audit the applicable set](verifying.md#audit-the-applicable-set) — roll out to every case it applies to; `grep -L`; derive the set from the tree
- [Find the caller first](verifying.md#find-the-caller-first) — find who calls from evidence before capping anything
- [Widening a default is a load test](verifying.md#widening-a-default-is-a-load-test) — what is now O(N); read the Supervisor log after
- [State the direction](verifying.md#state-the-direction) — write "A → B" and check it against the owner's words
- [Read before promising a size](verifying.md#read-before-promising-a-size) — never "small" or "a deletion" before reading the code
- [Close, don't chase](verifying.md#close-dont-chase) — close an invisible residual; don't ask for measurements that change nothing
- [Visual bugs need a target](verifying.md#visual-bugs-need-a-target) — instrument first, get a target, identify the object by evidence
- [Simulate the pose space](verifying.md#simulate-the-pose-space) — camera-placed things: properties over the whole pose space, then the real render

## Git, gates and CI

- [Stage named files only](git-gates-ci.md#stage-named-files-only) — `git add -u` plus new files by name; account for every added file
- [Ask git what is tracked](git-gates-ci.md#ask-git-what-is-tracked) — `git ls-files` / `git check-ignore -v`, never .gitignore or memory
- [Searches that can be blind](git-gates-ci.md#searches-that-can-be-blind) — a grep that honours .gitignore can't prove absence; use `command grep`
- [Stage before the gate](git-gates-ci.md#stage-before-the-gate) — hard-rules scans tracked files: stage new files before gating
- [The gate stops the commit](git-gates-ci.md#the-gate-stops-the-commit) — chain with &&; never pipe a gate; judge by exit status
- [CI is the gate](git-gates-ci.md#ci-is-the-gate) — read the run and the published manifest; reproduce every CI step
- [Tests wait on events](git-gates-ci.md#tests-wait-on-events) — no fixed sleeps or reload races in async tests
- [Dates are locale-shaped](git-gates-ci.md#dates-are-locale-shaped) — never pin a formatted date in a check; CI is en-US
- [Diff the resolver config](git-gates-ci.md#diff-the-resolver-config) — machines differ: compare npm config before versions
- [Moving files silences guards](git-gates-ci.md#moving-files-silences-guards) — a move turns checks into skips; compare skip counts
- [A killed mutation run](git-gates-ci.md#a-killed-mutation-run) — read the in-progress marker; repair by hand; never stage during a run
- [Scripted edits get a trial](git-gates-ci.md#scripted-edits-get-a-trial) — trial file, compare, then overwrite
- [Formats outlive their writer](git-gates-ci.md#formats-outlive-their-writer) — migrate what the app wrote; refuse what the owner wrote; rename changed keys
- [Placeholders, never real ids](git-gates-ci.md#placeholders-never-real-ids) — shaped placeholders in comments and fixtures

## Working with the villa's system

- [The MCP tools only](villa-system.md#the-mcp-tools-only) — the villa through the session's MCP tools only; never a script, never a secret
- [Write the config yourself](villa-system.md#write-the-config-yourself) — save blueprints with the tool, then check consumers and the log
- [Edit the villa's copy](villa-system.md#edit-the-villas-copy) — read and edit the installed blueprint, never a local copy
- [Blueprint texts are short](villa-system.md#blueprint-texts-are-short) — 3-line descriptions; history in HISTORY.md; Common + one section per mode
- [Helpers live in package files](villa-system.md#helpers-live-in-package-files) — helpers only in packages/ files, one prefix per feature
- [Know what a reload resets](villa-system.md#know-what-a-reload-resets) — a reload restarts every template's last-changed; say it before; read the Agent log after
- [Fetch what you know](villa-system.md#fetch-what-you-know) — fetch the one thing by path or id; small history windows
- [Read the logbook in day windows](villa-system.md#read-the-logbook-in-day-windows) — 24-hour windows; one long read truncates silently
- [The suffix is not the duplicate](villa-system.md#the-suffix-is-not-the-duplicate) — the `_2` registration may be the live one
- [Use the platform's own features](villa-system.md#use-the-platforms-own-features) — consume the villa system's API before building your own
- [App packaging facts](villa-system.md#app-packaging-facts) — watchdog, HEALTHCHECK, linter defaults, ports on update

## Kiosk code

- [Checks drive values](kiosk-code.md#checks-drive-values) — oracles drive values or draw; `npm run oracles:changed` before ship
- [Babylon side-effect imports](kiosk-code.md#babylon-side-effect-imports) — some APIs need a sibling import tsc cannot see; grep the bundle
- [Animations own their clock](kiosk-code.md#animations-own-their-clock) — never `engine.getDeltaTime()`; per-second rates
- [Node green, browser dead](kiosk-code.md#node-green-browser-dead) — never store `setTimeout`/`fetch` as a field or default
- [Debug text can crash](kiosk-code.md#debug-text-can-crash) — no `!` on a value a debug line formats
- [One status vocabulary](kiosk-code.md#one-status-vocabulary) — status colours only from STATUS_COLOR; red means needs attention
- [A badge on a chip is an unresolved room](kiosk-code.md#a-badge-on-a-chip-is-an-unresolved-room) — check the room resolver's id set before placement
- [Rename a key when its default changes](kiosk-code.md#rename-a-key-when-its-default-changes) — saveConfig writes the whole config
- [Performance instruments](kiosk-code.md#performance-instruments) — probe, freeze spans, leak watch; never an unthrottled reporter
- [Measure on the real model offline](kiosk-code.md#measure-on-the-real-model-offline) — load the villa model headless; replay a placement report with tools/placement-probe.mjs

## Agent code

- [Skills before code](agent-code.md#skills-before-code) — whatever a skill can define lives in the skill, not the engine
- [Skill folders are hands-off](agent-code.md#skill-folders-are-hands-off) — edit a skill's files only when the request names that change
- [Tools follow the asker](agent-code.md#tools-follow-the-asker) — the asker's role decides the tools; a skill never limits them
- [The engine delivers what must be seen](agent-code.md#the-engine-delivers-what-must-be-seen) — photos and files sent by the engine; unasked actions gated by the engine
- [Never in the critical path](agent-code.md#never-in-the-critical-path) — alerts never wait on the Agent; plain fallback kept; untranslatable stays original
- [Format changes need migrations](agent-code.md#format-changes-need-migrations) — migrate what the Agent wrote; rebuild nightly artefacts at start-up
- [Test the real argument path](agent-code.md#test-the-real-argument-path) — test the caller with real wiring; read the app log the morning after
- [The Agent's test environment](agent-code.md#the-agents-test-environment) — agent-host/.venv/bin/python; full test ids for mutations

## Coding standards (review)

- [The owner's action, end to end](coding-standards.md#the-owners-action-end-to-end) — each changelog line's action is the one a test performs
- [One owner per job in the diff](coding-standards.md#one-owner-per-job-in-the-diff) — send back a second mechanism, copy or per-caller flag
- [Words a person reads](coding-standards.md#words-a-person-reads) — new UI text follows the wording rules
- [Comments explain why](coding-standards.md#comments-explain-why) — why, in the code's style; no real ids; past tense for fixed defects
