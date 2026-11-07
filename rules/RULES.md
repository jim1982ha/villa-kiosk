# Rules

The owner's standing product decisions. `CLAUDE.md` holds the commands, the branches and the hard safety rules.
Keep this file short: add a rule only when the owner states one, and remove rules that no longer apply.

## Working with the owner

- Approval means build it. Once a cause is found, fix and ship; ask only for a real choice between behaviours.
- Ship each fix as soon as it is ready. Do small, located fixes directly; use a sub-agent only for a real
  investigation, with the files already named.
- The owner installs updates and checks the result with screenshots: say what to look at, on which screen.
- Talk in the screen's words, in plain English: no file names, function names or version ids unless the owner needs
  them to decide. At most three short questions at a time.
- Review pages: for each item, what the owner sees today, what he would see after, why in one sentence, the cost; code
  details in a folded box.

## Words a person reads

- "Automation", never "rule", for the villa's automations.
- A role, duration, window or threshold in text comes from its setting, never typed by hand.
- Durations are joined: "30s", "10min", "1h 30min".
- No long dash (" — "): use a colon, a comma or a new sentence.

## Design

- One mechanism per job, each list, value or text defined once; fix the shared piece, not the caller.
- No exception for one device or case: fix the logic for every device.
- A feature nobody can reach is removed with its code.
- Telegram and the tablet alike: one alert is one card updated in place, with the same name ("#91-P2") and the same
  Status everywhere, every copy updated at every change.
- A repeated problem is one line with a count.
- Every card has the same anatomy: the strip (icons, alert name, name, time), the state as its first line with the next
  check in its pill, one quiet line (room), the words, the who line, the buttons.
- Status colours come from one table; red means "needs attention".
- Works on iPhone and Android alike; controls that stop fitting wrap as a group.
- Charts have a Y axis with grid lines; values from a known set are picked, not typed; long lists are pages of ten.

## Decided: do not re-propose

- The baked model's look is accepted (no environment/HDRI work); KTX2 textures are closed.
- Nothing on the map overlaps; badges group only when they touch; badges behind a wall hide while walking.
- Sun and moon follow the real clock. The ~1.2s freeze is not ours. Telegram calling the door intercom: declined.
- Asleep devices are one list, in the Kiosk's Advanced Settings. The bake pipeline's job table is the owner's.
- Automation descriptions are one or two sentences; history goes in the blueprints' HISTORY.md.

## The villa's system

- Work through the MCP tools only. Save blueprints and change automations directly (read the villa's copy first, read
  it back after); package files and HISTORY.md go to the owner to paste.
- Helpers are defined in package files, never created in the UI.
- Say what a reload resets before doing one (a template reload restarts every template's "last changed").
- A villa message reporting a problem hands it to VESTA in the same run (`vesta_critical_event`).

## VESTA Agent

- Whatever a skill can define (wording, thresholds, routes) lives in the skill, not the engine.
- Never in the critical path: alerts reach Telegram and the tablet without the Agent or the Kiosk app.
- Migrate what the Agent wrote when a stored format changes.
