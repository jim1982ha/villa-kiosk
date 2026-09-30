# Changelog

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
