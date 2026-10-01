# Changelog

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
