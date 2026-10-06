# Changelog

## 0.6.49 (6 October 2026)

- UI (owner):
  - toolCard() in .tool-grid (4 / 3 / 2 / 1 columns) for both tool tabs, 16 a page.
  - withInfo() for headings and fields; infoTip takes a function (the month's ceiling at open). The (i) is sized in em.
  - The AI: New conversation on the chats' line; the notes are gone from below the table.
  - Acting: a title switch only. Approval minutes on the services card's title line.
  - The villa files option is reworded.
  - test_ui pins it.

## 0.6.48 (6 October 2026)

- UI (owner):
  - infoTip(), a floating tooltip on hover, focus or tap, replacing the inline text. titleWithInfo takes a right-aligned control (the Costs' period). tryPanel: no command preview.
  - DRY:
    - floating(): the one floating panel (body, fixed, flips above; closes on outside, Escape, scroll, resize), used by dropdown(), the device picker (whose absolute panel took a table cell's input rules) and the tooltip; focus with preventScroll.
    - subTabs(): the one tab bar.
    - paged() runs on pagedBlock().
    - The table input rule spares checkboxes and radios; search inputs share the input style.
  - test_ui pins it all.

## 0.6.47 (6 October 2026)

- skill.yaml scripts.<s>.description (optional), shown by the page; the roi-energy and preventive-maintenance starters describe their scripts (recorded).
- UI: jump() links from "set elsewhere" to the #rules-acting and #rules-services cards; flags as code chips.
- test_page_controls: the skill page follows a hand edit of skill.yaml (scripts, commands, flags, tools, schedule), and the page's code names no starter skill or script.

## 0.6.46 (6 October 2026)

- **UI:**
  - Services: a devices column (the picker for "listed", first service of a domain; "same list as" for the others); the Allowed lists card removed; RULE_WORDS "listed" reworded. editTable passes refresh to cells.
  - card() puts the lead behind an (i) (titleWithInfo), except in a card with no other content.
  - The Overview setup card has two tabs.
  - Costs defaults to 7 days (page and server) with period figures (total, runs, per run, busiest day).
  - tryPanel in three steps, with a preview of the exact command.
- **Retention, DRY (owner):**
  - skills.to_trash is the one way into skills/.trash, and stamps the folder's date. Used by delete, take_release, Undo and import.
  - carry_villa_files is the one copy of a skill's villa.* files (update_starters, take_release, import).
  - housekeeping._files_older(whole=True) trims the trash under files_days. The separate folder helper and the history row cap went: the page's history follows records_days like every other record.
  - Tests: the trash's dating (mutation-checked); the Costs default pinned at 7.

## 0.6.45 (6 October 2026)

- UI (owner): pagedBlock(), 15 lines a page (PER_PAGE), for editTable (People, the services) and the Reading Home Assistant list (flat, group heading repeated per page). Roles table: fixed layout, switch columns centred; Guest is "—" with the reason. test_ui pins the paging.

## 0.6.44 (6 October 2026)

- UI, Skills (owner): skillSwitch() in each list row (the row is now a div: an open button plus the switch). The pane has no title, description or switch on a wide screen (.skill-head hidden); the state pill is on the tabs' line (.skill-bar). On a phone (≤760 px) the head comes back with the name, pill and switch, and the bar's pill is hidden. test_ui pins it. Rules → The AI: the tools column is a <details> summary ("N tools from <skill>") instead of chips; columns are fixed width and top-aligned, the header reads "Limit (US$)"; on a phone the × sits on the brain/limit row.

## 0.6.43 (6 October 2026)

- UI, Skills (owner: "very messy", mobile):
  - openSkill is a head (name, state chips, switch), banners, then sub-tabs About / Files / Try a command / Compare.
  - aboutSkill(): .kv rows for the acts, .cmd-row switches for the commands, the tools' verdict with a folded list.
  - Files: dots in place of " · differs" labels.
  - Compare: shown() keeps changed rows ±2.
  - Phone (≤760 px): .skills.has-open hides the list, with "‹ All skills". ≤600 px: .kv stacks, the comparison is one labelled column.
  - test_ui pins the phone rule. Checked by screenshots at 1280 / 390 px.

## 0.6.42 (6 October 2026)

- tool_access.py: one answer to "what may the AI use".
  - **Rules:**
    - ha_read_tools, only HA MCP readOnlyHint (and not destructive). Before, only destructiveHint was refused.
    - agent_tools: create_ticket, start_job, agent_status; web search stays in settings.web_search.
    - tool_access.fm, by group; the facility manager's chat is capped at the facility manager's tools.
  - **Toolbox(allowed=...)** builds nothing else: allowed_for_person in converse, allowed_for_job in run_model_job (the skill's `tools` ∩ switched on + always-on; no `tools` → everything but web search, as before).
  - **blockers():** a needed tool the villa switched off. read_skill and run_skill_script refuse in words; an AI job does not run and tells its chat (state `job_blocked`).
  - **The page's list:** the agent saves HA MCP's list (ha_tools.json, first_seen → "New"), plus catalog() and needs().
- **Skills:**
  - skill.yaml `tools:`; `commands` may be {name: words}.
  - villa.skill.yaml off_commands, lenient, enforced by validate_script_args and listed by read_skill.
  - policy.yaml skills_off: Skills(off=...), all(include_off).
  - release_state / keep_mine (.kept.json) / take_release.
  - Starter skill.yaml files declare their tools and command words.
- **runner:**
  - Collector records each ToolUseBlock as {tool, input} (step(): short, secrets scrubbed, ≤ 40) in the run's record.
  - status.costs gives each run's steps and the period's tool counts; tool_usage(7 d) feeds the switches.
- requests_box.py: the page's requests ("try", "refresh_tools") as files the agent answers (the UI holds no token). Vesta.try_command validates as the AI's call and never carries out.
- history.py (page_history.sqlite):
  - Every UI save: policy (form or file), skill file, create/delete, on/off, commands, take-release, import. Starter updates are "Release".
  - policy_change() says it in the page's words.
  - Undo only while the target still holds the change's result.
  - Pruned with records_days.
- ui/server.py: /api/tools, /api/tools/refresh, /api/skills/{name} (detail), /on, /commands, /compare, /keep, /take-release, /try, /api/history (+ /undo), /api/setup/export, /api/setup/import.
- ui/setup_copy.py: export (skills, optionally villa.*, settings for the AI and keep, allowed_services, the tool sections, instructions.md). Never people, chats, entity lists, the siren, system_actions, notify_recipients, keys or records. Import is read() (paths checked), then preview() (added/replaced/changed/same, plus misfits: policy problems, listed services with empty lists, absent tools, blocked skills, unset jobs, fingerprint), then apply().
- Page (app.js/app.css): the What the AI can use card (three tabs), Tools it gets, the fuller Skills tab (switch, state, needs, acts, commands, Try a command, Compare with the release, 2C fix), Costs Tools used and tool table, Overview history/export/import. Checked by screenshots at 1280 and 390 px, light and dark.
- **Leaner:**
  - Removed with no caller: is_known_chat, read_tool_allowed, match_any, reply_keyboard, asset_number, feature_series, audit_rows, water_rules, days_back, timeutil.tz, release.init_version.
  - One reading each:
    - timeutil.local_day (features._day, facts._ms_day);
    - stats.slope_per_hour (facts' battery slope);
    - KnowledgePack.rows/read for the engine's names, related devices and the page's pickers;
    - Settings.policy() as the one policy cache (app.py's own gone).
  - FixtureClient → tests/fixture_client.py and replay.py → tests/ (no longer installed).
  - favicon.py → the reports template's <head>; telegram sends files as written.
  - Store rewrites pre-0.6.16 tasks once (source, check_text) and problems.py's second reading went. State.rename_job_runs rewrites "job:skill:when" runs once at start and status' job_names went. Pre-0.12.10 alert-message settle went.
- Tests:
  - New: test_tool_access.py and test_page_controls.py.
  - Old shapes updated: test fakes list tools with readOnlyHint; packs in their real shape.
  - 19 mutants red.
- Starter skills recorded.

## 0.6.41 (6 October 2026)

- API failures (api_errors.py): runner.Collector reads the SDK's three ways to fail (AssistantMessage.error with the raw "API Error" as its text — never the answer now; ResultMessage is_error/api_error_status; exceptions incl. ResultError). classify() → credit / key / rate_limit / busy / offline / too_long / unknown; FOR_PERSON words in the chat; NEEDS_THE_OWNER (credit, key) told in the owner chat at most every 12 h (State.owner_told); NO_RETRY: a failed resume is not retried for those. run_model_job: a failed job tells its chat (for_job) instead of logging "done". tests/test_api_errors.py, 4 mutants red.
- Housekeeping (housekeeping.py, policy.KEEP / settings.keep): runs 400 d, other records 90 d (calls, decided approvals, continuations, own_messages), CLI transcripts (claude/projects) 30 d, out folder 90 d, store features 24 months. At start and nightly after the pack. params' photo_retention_days / feature_retention_months removed (declared, never enforced); State.prune_own_messages folded in. policy_doc carries settings.keep through the Rules form (a save dropped it). tests/test_housekeeping.py, 4 mutants red.
- UI: ask() — a styled <dialog> for every confirm/alert/prompt; guard() async. tests/test_ui.py forbids the native ones, 2 mutants red.

## 0.6.40 (6 October 2026)

- UI: textarea.editor (Skills and Rules (file)) is white-space: pre-wrap + overflow-wrap: anywhere instead of pre (owner: no sideways scrolling). Soft wrap only, nothing added to the saved text. tests/test_ui.py pins it, mutation-checked.

## 0.6.39 (5 October 2026)

- Voice messages (owner, 2026-10-05): ha_events also listens to `telegram_attachment`; an audio attachment from a person the agent answers (private chat, or a reply to the agent in a group) is fetched with getFile (Telegram.download; only with takeover), handed to the skill hook `on_event.voice_message` (new HOOK_EVENT) with {audio, language}, and the WAV the skill returns goes to Home Assistant's /api/stt/<entity> (speech.py: the engine holds the token, a script never does). The text then reaches converse(voice=True). Audio and WAV are deleted after. tests/test_voice_messages.py (real hook, fake Telegram and STT), mutation-checked.
- villa-concierge: scripts/voice.py decodes Ogg/Opus with libopus (ctypes) to 16 kHz mono WAV and picks the stt entity (the only one, or villa.voice.yaml `stt:`; several and none named: refused, never guessed) and the language (villa.voice.yaml `language:`, else the person's). vesta-agent.yaml system_packages: libopus0. tests/test_voice_prepare.py (a real Opus fixture: duration, energy, 440 Hz), mutation-checked.
- villa-concierge find(): the Home Assistant area decides (place(): area name or alias, accents and case folded, exact before contains); a device with no area counts by its name; names only when no area answers; an entity id never. The pack carries area_aliases. SKILL.md: resolve every place with find, never from ha_search text. tests/test_concierge_place.py, 5 mutants red.
- Reply language: converse() no longer says "Answer in <saved language>"; it gives the saved language as information. The rule (the message's own language) is the skill's (villa-concierge SKILL.md).
- Starter skills recorded.

## 0.6.38 (5 October 2026)

- Workflow and DRY passes 1–2:
  - vesta_shared.timeutil.day_label / day_time_label: the one day format ("5 Oct"), used by the 7 hand-written strftime("%d %b") calls in the reports and preventive-maintenance skills (mixed "05 Oct"/"5 Oct"). A test forbids a new hand-written one.
  - Removed helpers with no caller: timeutil ms_to_local, parse_iso, local_now, day_of, fmt_dt, fmt_day, daterange; stats.mad; messaging.fmt_kwh, fmt_pct.
  - tests: the stop tests wait for the agent's own readiness line, not a fixed 3/6 s (suite 45 → 38 s).
  - Starter skills recorded.

## 0.6.37 (5 October 2026)

- Architecture review round 3:
  - Scheduler.tick starts every job as a task (_start, keyed; a job still running is not restarted; a scheduled job awaits a running pack rebuild) instead of awaiting each in turn. The nightly check, up to 1,800 s, held every_5_min (the alert chase) and could let other slots' windows close. Scheduler.idle() for tests and a clean stop. Test test_a_long_job_never_holds_the_alert_chase, mutation-checked.
  - outcome.CARRIED_KEYS / has_work(): the keys carry_out reads, used by run_skill_script, which kept its own copy. A drift test reads carry_out's source.

## 0.6.36 (5 October 2026)

- Architecture review round 2: Policy and problems() read values through shared readers (read_bool, read_int_in, _id): the agent uses the default exactly when problems() names the value. Fixes `act_enabled: "false"` read as True, a non-numeric chat id crashing Policy(), and a negative person id registered. Also: State.use_continuation(by=) refuses (without using it) a Continue pressed by someone other than requested_by, which was written and never read. tests/test_policy_agreement.py (29 cases), each fix mutation-checked.

## 0.6.35 (5 October 2026)

- Architecture review round 1: vesta_shared/axis.py (nice_axis, label, is_flat). It is the one Y-axis rule: reports compose._ticks/_axis/line delegate to it, and status.costs serves the Costs chart's `axis` (app.js only draws it). Both old copies took decimals from the step's size and mislabelled 2.5 and 0.25 steps; app.js had no tick bound and no flatness rule. tests/test_axis.py, mutation-checked; reports starter skill recorded.

## 0.6.34 (5 October 2026)

- status.costs(job_names=…): a run recorded before 0.12.0 as "job:skill:when" is counted under the job's name (the UI server maps skill:when → name from the skills). paged(): a head cell's `half` pairs columns on a phone (Every run: When/What, Tokens/Cost). tests/test_ui.py, mutation-checked.

## 0.6.33 (5 October 2026)

- UI: table-layout: fixed only for the editable tables (.edit, .ai); 0.6.28 had applied it to every table.rows, so the paged data tables overlapped. paged() labels each cell (data-label); on ≤ 600 px a data table is labelled cards. tests/test_ui.py pins it.

## 0.6.32 (5 October 2026)

- UI, Costs → Every run: app.js runWhat() keeps a run's label in the cell, with the chat and the asked text as its title tooltip and a tap-to-expand detail (no hover on a phone). tests/test_ui.py pins it.

## 0.6.31 (5 October 2026)

- reports compose._ticks/line(): a span of float noise (≤ 1e-9 of the values) is flat, and ticks come from their index, at most 100. `v += step` never moved for readings like 21.4 and 21.400000000000002 and the report job hung (the Kiosk crashed on the same data, 2.496.282). tests/test_shared_grouping.py, mutation-checked; starter skill recorded.

## 0.6.30 (5 October 2026)

- reports compose.line(): a "%" series whose values all lie in 0–100 gets its axis top at 100 at most (the 15 % padding no longer passes it); any value outside keeps the old range, so nothing is capped. tests/test_shared_grouping.py, mutation-checked. Starter skill recorded.

## 0.6.29 (4 October 2026)

- Architecture review (fourth pass):
  - policy.form_schema(): the rule words, the entity lists with their domains and labels, the siren's domains and the actionable domains, from the tables the checks read (RULE_WORDS, ENTITY_LISTS, SIREN_DOMAINS, ACTIONABLE). Served by /api/policy as `schema`; app.js keeps no copy, and policy_doc.LISTS is ENTITY_LISTS.
  - Two drifts fixed: button_allowlist offered input_button (refused on save), and siren_entity offered siren.* while outcome asked switch.turn_on. The siren now uses its own domain for turn_on and auto-off, and problems() names a siren outside SIREN_DOMAINS.
  - app.js editTable(): People and services from one builder. Columns carry their <col> width and phone place; generic .rows.edit grid CSS replaces the nth-child blocks.
  - tests/test_policy_schema.py (every offered domain accepted, siren asked with its own domain) and test_ui, all mutation-checked.

## 0.6.28 (4 October 2026)

- UI: editable tables (table.rows) use table-layout: fixed with per-table column widths (svc, people, ai). An automatic table sized a column to its longest unbreakable dropdown label and overflowed a phone. On ≤ 600 px the svc and people rows stack as a grid, as the ai rows did. tests/test_ui.py pins it.

## 0.6.27 (4 October 2026)

- The UI's dropdowns: app.js dropdown() (a picker-box button, its own listbox fixed on the page body, under or above the button, keyboard arrows/Home/End/Enter/Escape) replaces every native select (Costs period, sel(): brain, conversation reset, role, language; the service Rule). app.css .dropdown*. tests/test_ui.py refuses a native select in app.js or index.html.

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
