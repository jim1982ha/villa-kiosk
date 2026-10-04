# Changelog

## 0.6.26 (4 October 2026)

- Architecture review (third pass), behaviour-preserving apart from the drifts it closes:
  - vesta_agent/job_notices.py: the "being prepared" message is a pure JobNotices (started / replied / result / ended → delete or edit), replacing a dict app.py edited in three places. It fixes the result arriving before the reply (the reply stayed), the end before the reply (the reply promised a report), and two jobs in one turn. tests/test_job_notices.py drives each order.
  - preventive-maintenance features.device_key / device_name: one device key for offline, silent and flapping (flaps keyed on asset slug, the others on platform:asset). features.worsened / to_close: the persist loop's two decisions, now pure.
  - reports facts.group_kinds: one grouping for the weekly list and the 07:00 digest. The digest's own copy guessed names from the summary text, used the first member's severity, and raised KeyError on a {kind} group line. Names now come from the knowledge pack.
  - vesta_shared.messaging.no_code: one copy, where there were three.
  - tests/test_shared_grouping.py, all mutation-checked.

## 0.6.25 (4 October 2026)

- Every report asked for in a chat (owner, 2026-10-04: "all report messages"): the waiting message is replaced by the job's FIRST result whatever its form — the daily digest is text, not a page, and 0.6.24 replaced only on a page. app.send(from_job=…), passed by send_message and outcome.carry_out for an Origin JOB. tests/test_jobs.py: the daily digest's case (red when keyed on the page again) and the list of on-request jobs (fm-daily, fm-weekly, owner-monthly) the rule covers.

## 0.6.24 (4 October 2026)

- A job asked for in a chat is ONE message, then its result (owner, 2026-10-04: "I don't want to see 3 messages"). The conversation reply that started it is remembered per chat (app._job_notices) and deleted when a page is sent to that chat (Telegram cannot turn a text message into a file message: telegram.delete, deleteMessage on the bot's own message); a job that ends without a page edits it to say so. reports skill.yaml fm-weekly: the owner-weekly lines on schedule only; asked in a chat, the page is the whole answer. tests/test_jobs.py: 3 new, each red under its mutation.

## 0.6.23 (4 October 2026)

- PM-SILENT judges a sensor on the 72 hours BEFORE it went quiet (silence_history_hours, was a 14-day window). Checked against the villa's live history after 0.6.22 was installed: the one sensor that really stopped had been frozen once before (6 days), so over 14 days it moved in ~45 % of hours and 0.6.22 would have taken it for a change-only sensor. tests/test_maintenance_noise.py: the earlier-freeze case (fails with the 14-day window).

## 0.6.22 (4 October 2026)

preventive-maintenance and reports (villa, 2026-10-04: a morning message of 24 "new" lines, repeated under "Still open"; the Kiosk's Cockpit filled with the same tickets):
- nightly.py judges the LAST FINISHED day (live: yesterday). It ran at 02:00 and judged its own date — a 2-hour stub — so "the last 2 days" of a pump were yesterday and that stub.
- PM-SILENT only for a sensor that normally reports all the time: features.reporting_share over its hourly statistics before it went quiet (silence_history_days 14, silence_reporting_share 0.5, overridable as vesta_<name>). A curtain, a rain gauge at 0, a sensor with no history: never silent. One finding per device.
- PM-RECONNECT-LOOP: a minute in which restart_crowd_entities (20) or more entities drop together is a restart, not counted against any of them; one finding per device, named in words (never a raw entity id).
- PM-UNAVAILABLE: "unknown" is not offline (a wind chill on a warm day).
- PM-ENERGY-CHANGE: a day the plug had energy_gap_hours (3) or more without data, from its first data to the day judged, is left out of the comparison.
- compose fm-daily: a new finding is not repeated under "Still open"; a kind with todo.group_from items and a todo_groups line is one line (PM-RECONNECT-LOOP added).
- tests/test_maintenance_noise.py (9; each fix mutated red); two silence tests given hourly history. Villa replay: 54 pass (it caught a first version of the offline-day filter that starved a baseline).

## 0.6.21 (3 October 2026)

- State: named records — claim_job_slot (atomic under the lock; was get-then-put) / jobs_run, set_alert_skill / alert_skill, remember / alert_messages / is_alert_message / forget_alert_message, mark_saved_by_model / saved_by_model. Same stored keys (no migration). outcome, scheduler, status, tools use them. tests/test_state_records.py (incl. old-key compatibility and ownership); 3 mutations red.

## 0.6.20 (3 October 2026)

- UI Costs: Period as a one-line field (.field.row), the figures in a .divided block. tests/test_ui.py pins it.

## 0.6.19 (3 October 2026)

- UI header: the short version (app version · channel, full line as the title attribute) inside .brand; the theme toggle margin-left:auto on the same line. tests/test_ui.py pins it.

## 0.6.18 (2 October 2026)

- UI: one figures() builder for every set of figures (Overview's last 24 hours, Costs), its own .figures grid: two 120px columns on a phone instead of .grid's one 220px column. tests/test_ui.py pins it.
- tests/test_engine_version.py: vesta-agent.yaml, __version__ and this file's top entry are one version (nothing compared them).
- tests/test_favicon.py reads the Kiosk's icons from dev2 in git (as the contract test does), not this branch's stale public/.

## 0.6.17 (2 October 2026)

- vesta_agent.favicon: every HTML document sent (telegram.Telegram.send, the one path) carries the VESTA mark inline as data: URIs (light/dark SVG + 32 px PNG, the Kiosk's own files; tests/test_favicon.py fails if they drift). A page declaring its own icon keeps it; non-HTML and non-UTF-8 files are sent untouched. No skill edited.

## 0.6.16 (1 October 2026)

Architecture review (all five candidates):
- vesta_shared.problems: one owner of a problem's lifecycle (finding / incident / task / Kiosk ticket). Status words DONE / CLEARED / CLOSED_IN_KIOSK; a task keeps its source and its check (store migration adds tasks.source, tasks.check_text); open_problems() is the one "still open" for facts, compose (fm-daily, owner-weekly) and concierge. A fault closed in the Kiosk closes its incident and settles its messages. alert-desk, preventive-maintenance and the reconcile go through it; outcome.create_ticket no longer parses "Check:".
- routing.Origin(kind=conversation|job|press): Routing.offered / target / is_conversation answer every "where may it go" question; a conversation holds every message, scripts' included, to its chat. Toolbox.tool_objects(person, origin, include_web).
- vesta_shared.agent_records: the one reader of the agent's records (cost, listening since) for status.py and the reports; reports.yaml incident_words (every desk state) and alert_follow_window_min; facts.followed_by_agent.
- reports: one_list(...) builds the "Do this week" list from plain inputs; a line names its device from the pack.
- UI: /api/jobs gives when_words and runs_per_month (scheduler.describe), /api/policy and /api/costs the brain labels (policy.profile_labels); app.js keeps no copy.

## 0.6.15 (1 October 2026)

- outcome.create_ticket: "<finding> Check: <what>" becomes the ticket's title and its note.

## 0.6.14 (1 October 2026)

- preventive-maintenance: a state finding closed by the night closes its task ("cleared") and emits ticket.resolve.
- outcome.repair_tickets reconciles: a task whose Kiosk ticket is resolved is closed ("done_in_kiosk"); a task whose findings are all closed is closed with its ticket resolved; tasks without a finding (alerts) are left alone. kiosk.ticket_states().

## 0.6.13 (1 October 2026)

- UI: theme switch (theme.js in the head; `data-theme` light/dark, none = auto; tokens for both in app.css).
- UI: the device picker is a dropdown (search, checkboxes, single choice for the siren); fields holding a picker are a <div> (a <label> forwards clicks to its first control); grid items `min-width: 0`.
- UI: the Costs chart has Y ticks (1/2/2.5/5 × 10^k), grid lines and dated bars; the 4th KPI is the average per run.
- reports: compose.py charts (line, bars, pairs) draw a Y axis with grid lines (`_ticks`, `_axis`).

## 0.6.12 (1 October 2026)

- policy.LANGUAGES: zh (Chinese), ja (Japanese), ko (Korean).

## 0.6.11 (1 October 2026)

- UI: one "Rules (file)" tab; its "(file)" part opens the file view (`#rules-file`).

## 0.6.10 (1 October 2026)

- outcome: every message sent with an incident's buttons is remembered (`incmsg:<id>:<chat>:<message>`); `settle(id, note)` edits all of them (buttons removed, the note added) and forgets them. A press settles every copy, by name; the standard form gains `settle: [{incident_id, note}]` ("{time}": villa time).
- alert-desk: a reply (Done / Not found / Need help / Mute, typed or pressed) and an incident Home Assistant clears emit `settle`.

## 0.6.9 (1 October 2026)

- runner: each `run` record keeps the profile, the model, the tokens (input, output, cache read/write), turns, duration and the first 160 characters of what a person asked.
- status.costs: the Costs tab's reading (runs, by work, by model, by day, today/7 days/month); UI `/api/costs?days=7|30|90`, a "Costs" tab, a shared 10-row paged table (also "Scheduled jobs run").
- UI `/api/entities` (the knowledge pack's entities): device pickers for the protected devices and the allowed lists; `policy.LANGUAGES` is the one language list (app and the page's menu).
- UI: cost limits say per reply / per run, jobs say their cadence, the scheduled runs' monthly maximum; skills show "not working" only.

## 0.6.8 (1 October 2026)

- send_message: with a chat (a person answered, or a job asked for), `here` only, and any other name is held to that chat; without one (a scheduled job), owner or fm.
- skill.yaml `scripts.<s>.job_only: {command: job}`: in a conversation, that command is refused and points to start_job. reports: fm-daily, fm-weekly, owner-monthly; fm-daily is now on_request. A test fails when an on_request job has no job_only command.
- UI: "Rules (file)" top tab (no sub-tabs); Overview without the Rules and Skills cards (their problems still shown); divider above "Scheduled jobs run".

## 0.6.7 (1 October 2026)

- reports: one list (`todo`: clues and open tasks merged by device, grouped by kind when reports.yaml gives the kind a group line, "same time" detected); `noticed`, `tasks`, `maintenance` sections removed. Alerts grouped per alert with a count; alert names from `alert_words`.
- reports: HA's logbook counts as alerts only the runs of the blueprints in `alert_on_every_run` (a schedule rule's run is a check, not an alert); `nothing_happened` only for what was watched (`listening_since`).
- reports: 6 files — templates/report.html holds the style and every section; charts.py merged into compose.py.
- reports: power_step needs `min_hours` of running a day; circuits cap `circuit_change_max_pct`.
- preventive-maintenance: PM-SILENT reads `last_reported` (ha_client asks for it), not `last_changed`.

## 0.6.6 (1 October 2026)

- A job asked for in a chat sends only to that chat: `Origin.requested` makes routing send every `to` (here, owner, fm) there, for send_message and for its scripts' results; send_message offers only `here`.
- UI: The AI and the AI jobs are one table (Work / Brain / Limit), stacked per row on a phone; the AI jobs card is gone.
- UI: a switch and its field share one line (Acting on the villa; New conversation and Web search).
- UI: a skill's file list is folded to one line, with "All N files" when it does not fit; the open file comes first.
- UI: the skills grid no longer widens the page on a phone; the error reporter ignores the browser's "ResizeObserver loop" notice.

## 0.6.5 (1 October 2026)

- UI: the AI jobs card uses The AI card's fields and grid (one block per job, Set / Stop) instead of a table.

## 0.6.4 (1 October 2026)

- UI: the page's files are linked as `static/<version>/…` (a path), not `?v=` — on the villa, behind Cloudflare,
  0.12.3's page still ran 0.6.1's code. The app's version comes from the host (host.json), not the environment.

## 0.6.3 (1 October 2026)

- UI header: the app's version too (`VESTA_APP_VERSION`, given by the host to the UI process only).

## 0.6.2 (1 October 2026)

- UI errors.js: a failed resource load counts only for the page's own files (same origin); the villa's Cloudflare
  inserts beacon.min.js, which the CSP blocks, and it was reported as "page error: error".

## 0.6.1 (1 October 2026)

- UI: index.html is served with the version in its files' addresses (`static/app.js?v=…`): on the villa, 0.12.0's
  page showed 0.10.0's code with the new data. `errors.js` (loaded first, plain script) shows a page error on the
  page and posts it to `/api/client-error`, logged as `UI: page error: …`; `UI: page opened (agent …)` per load.
  Cause found from the owner's console: the villa's HA is behind Cloudflare, which served 0.10.0's app.js.
- UI: no inline `style` (the CSP refused it): `.spaced`, `.push-right`; a test forbids `style:` in app.js.

## 0.6.0 (1 October 2026)

Readings (owner's design, agent-host/docs/adr/0001; glossary agent-host/CONTEXT.md).

- AI jobs: `schedule` entries with `prompt` need a `name` (+ optional `to`, `on_request`, `default`, `on_limit`,
  `description`); policy.yaml `settings.jobs.<name>: {profile, limit_usd}`; a job not set does not run.
  `runner.run(profile=)`. At the limit, the job's `on_limit` code step runs ({to}, {started}, {limit}).
- Tool `start_job`: a person (never a job) starts an on_request job; it runs as itself and answers `here`.
- Skill messages may carry an `attachment` (a file of the out folder).
- Files named `villa.*` in a starter skill: not an edit (fingerprint), kept by updates.
- UI: AI jobs card, "not set" banner and "Add them" on Overview and Rules; `/api/jobs`.
- reports: `playbook:` (when kinds power_step, run_change, battery_trend, offline, use_while_empty; entries without
  `when` are knowledge), `nothing_happened:`, sections `noticed` and `quiet`; readings unchecked and marked, slots
  `checked: true` still checked; `compose.py --finish/--since/--limit`; `villa.reports.yaml` merged.

## 0.5.0 (1 October 2026)

Owner's architecture review (all six candidates, one release); rule: whatever a skill can define lives in the skill.

- `outcome.py`: one module carries out a script's result (send / ticket / ticket.resolve / snapshot.get / siren gate)
  for every caller — scheduler, hooks, alert buttons and the model's run_skill_script (before: dropped on the model
  path, losing tickets). The alert buttons live there (`press`). `repair_tickets()` at start and nightly.
- `routing.py`: the one routing rule (`here`, role chats, approver chat, one send per chat). alert-desk replies use
  `to: here`. send_message, Actions.request and the siren notice route through it.
- `policy.py` is the one reader of policy.yaml: settings block, `siren_auto_off_min`, defaults; config, the UI and
  the skills read from it. Skill scripts get `VESTA_POLICY` and `VESTA_STATE` (read only).
- alert-desk: the dead `siren` command and `siren.on` action removed; the gate prompt reads the policy's minutes.
- ha_client logbook: stops at a page that brings nothing new, keeps each row once (ha-mcp 8.5.0 repeated page 1).
- run_skill_script serves part N of a long answer from the first run, never runs the script again.
- New tool `save_file`: a .json/.txt/.md in the out folder, never over a script's file.
- reports: `reports.yaml` (sections, order, thresholds, sentences, gaps), `facts.py` (every figure: HA statistics,
  states, the VESTA rules' logbook, the store, the AI cost), `compose.py` renders `report.html` + `blocks/*`, inline
  SVG charts (`charts.py`), and refuses a note whose numbers are not its section's. Old page templates removed.

## 0.4.0 (30 September 2026)

- The UI (`python -m vesta_agent.ui`, the manifest's `ui`): aiohttp, plain HTML/CSS/JS, no build step, the
  Kiosk's tokens and self-hosted fonts. policy.yaml forms and raw file (ruamel.yaml, comments kept; `rev`
  refuses a stale save), skills and their files (checked with `skills._parse` on a trial copy, Python with
  `compile`). Only the Ingress gateway may connect (standalone: loopback); writes need a JSON body and the
  page's header. Skills deleted go to `skills/.trash`.
- `policy.problems()`: the file's checks in one place, used by the UI (refuses to save) and the agent (logs).
- `status.report()` shared by the `agent_status` tool and the UI overview.
- `send_message` `to: here` (the chat asked in); the system prompt says to redo a job, never replay one.
- `ruamel.yaml==0.19.1`.

## 0.3.4 (30 September 2026)

- reports: `compose.py` fm-weekly / owner-weekly / owner-monthly require `--energy` and say what to run when it is
  missing (without it Jinja stopped on `Undefined.__round__`, reported as "a template error"). SKILL.md gives
  the two steps; the Monday prompt passes `--energy week.json` to owner-weekly.
- A failed skill script (model tool or code job) is logged with the last line of its stderr, scrubbed.

## 0.3.3 (30 September 2026)

- `allowed_services` rule `direct`: executed at once when a registered person asked in a chat
  (`Actions.request`, logged `direct`); no requester (a job, an alert, a skill) or an owner-only device, directly
  or behind a group, still goes through an approval. The system prompt and the tool description say so.

## 0.3.2 (30 September 2026)

- Fixed: every approved action failed. `McpClient.call_service` sent `entity_id` as a list; ha-mcp 8.5.0's
  `ha_call_service` takes one string. One device now goes as that string (ha-mcp waits for its state), several
  as Home Assistant's list inside `data` (the read-back then polls up to 5 s). Pinned against ha-mcp's real input
  schema (`tests/fixtures`); the host's container test fails when the server in the image stops matching it.
  A failed approved action is logged with its reason.
- No PDF: `compose.py` writes a self-contained HTML page (`--pdf` and `to_pdf` removed); the weekly and monthly
  pages are sent as an attachment with the headline and key numbers in the message. `system_packages` is empty.
- Starter skills follow the release when never edited: `starter/shipped-skills.json` holds the fingerprint of every
  shipped version; `Skills.update_starters()` replaces a matching folder, keeps an edited one and leaves the new
  version in `skills/.starter/`. A test fails until a changed starter is recorded (`record_shipped`).
- `install_files: [requirements.txt]` in the manifest: the image build installs the libraries from that file alone.

## 0.3.1 (30 September 2026)

- A reply to an alert button goes to the chat where it was pressed; the pressed message loses its buttons and
  says who answered, what, and when (Telegram `editMessageText` without a keyboard).
- Telegram messages are plain text: Markdown the model writes anyway is removed before sending, and the system
  prompt says so.
- Acting off: the model is told never to offer an action.
- Kiosk ticket titles: no leading emoji or rule code.
- Log lines per alert received and handled, message sent, button pressed, ticket created/resolved, reply answered.
- New read-only tool `agent_status`: the agent's own jobs, calls, incidents and AI cost over the last hours.

## 0.3.0 (30 September 2026)

Integrated into the VESTA Agent host (Home Assistant app "VESTA Agent"); decisions D1–D5 approved by the owner.

- Runs in the host's agent slot, started from `vesta-agent.yaml`; built by the host's CI, never on the Yellow.
- Settings from the host's environment (connections and secrets); the villa's people, lists and the agent's own
  settings (brain, limit per reply, web search, conversation reset) in `policy.yaml`, reloaded live.
- Skills are files in the skills folder, each with a `skill.yaml` (its scripts and flags, its schedule, its hooks):
  added, edited or deleted without code or rebuild. The five skills are copied there once, at the first start.
- Critical alerts arrive as Home Assistant's `vesta_critical_event` (opened, resolved, abandoned) on one
  listen-only websocket; no incoming port, no alert secret, no `rest_command`, no heartbeat automation.
- Telegram: Home Assistant stays the bot's only receiver; the agent reads its `telegram_*` events and only sends.
  It never polls the bot and never leaves a group. Button presses on Home Assistant's own messages (the gate)
  are left to Home Assistant.
- Facility manager tasks are VESTA Kiosk tickets; presence is the Kiosk heartbeat. The Home Assistant to-do list
  and `input_datetime.vesta_last_run` are gone.
- Web search is Claude's own WebSearch tool; `websearch.py` and the `anthropic` package are gone. `requests` too
  (the scripts' HA client uses the standard library).
- No villa data in the code: an empty example policy, no regional time zone (Home Assistant's `TZ`), invented
  ids in comments.

## 0.2.1 (30 September 2026)

Reviewed against a live villa (the nightly batch and the weekly numbers run for real through ha-mcp on 30 September).

- Asset kinds in the knowledge pack: motor, lighting, meter, appliance. The physics rules (running draw, run hours, sag) now apply to motors only. Before, light circuits with power meters and the mains phase averages raised false findings as if they were pumps.
- One energy counter per asset in the ROI numbers (a smart plug exposing "energy" and "energy consumed" for the same kWh was counted twice). The pumps table lists motors only.
- Devices of one integration offline together become one finding (four cameras of one integration were four P2 lines).
- The 02:00 job runs entirely in code: pack rebuild, batch (30 minutes allowed, it takes about 3 minutes through ha-mcp), to-do items, P2 to the FM. Zero tokens at night; the 07:00 digest carries the words. Before, the batch ran inside a model turn with a 15-minute cut.
- Level sensors are read only when a threshold helper exists for them (89 sensors were read every night for nothing); the logbook read is capped at 20 pages.
- DOCS: the heartbeat automation and the helpers to create (vesta_last_run, villa_mode, the pool parameters).

## 0.2.0 (30 September 2026)

Hardened from vesta-agent 0.1 (permissions audit of 30 September 2026) and packaged as a Home Assistant add-on.

- The model has no built-in tool: no shell, no file access. It sees only VESTA's own tools.
- Every Home Assistant access goes through ha-mcp, the skills' scripts included. No Home Assistant token.
- Layer 1: the Home Assistant read tools are named one by one in policy.yaml; a tool added by a later ha-mcp version stays hidden. A tool the server marks destructive is refused whatever the list says.
- Layer 2: every service call is checked by code on domain, service, entities and data. restart, shell, scripts, MQTT, updates, recorder, toggles, automation trigger are refused even with an approval.
- Approvals are buttons pressed by a registered person (Telegram id and role), never by the group; anonymous presses refused; one use; 15 minutes; bound to the exact action.
- Owner-only devices: the locks, the gate, the siren and the siren scene. Automations on and off: owner only.
- v1 informs only: `act_enabled: false` refuses every action until switched on.
- 1 USD per reply by default, with a Continue button. No turn limit.
- Alerts, the chase ladder and its buttons run in code, without the model.
- Rule codes removed from what people read. PDF by the system Chromium instead of Playwright.
