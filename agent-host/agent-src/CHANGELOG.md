# Changelog

## 0.6.113 (10 October 2026)

Architecture review 16, its defects:
- Skills.all claims an AI job's name by the villa's own switches whatever the reader (include_off): a switched-off skill claims no name and is refused for none. 0.6.112 judged it on the reader's `off`, so the page's reading let a switched-off copy that sorted first knock out the live skill (page, Offline Test, setup copy), and each page read flipped the load log.
- skills.out_files / take_run_file: the Offline Test offers the files of the last ten report runs (runs/NAME-TIME/FILE, labelled with the report and the time) beside the out folder's own; a chosen one is copied into the out folder, where the test runs, and checked as every file argument. ui.server._out_files returns {value, label}.
- create_ticket no longer logs `executed` itself: tickets.create does (each AI ticket was two actions on the Overview).
- Tests: a switched-off copy sorting before or after the live skill; the run files offered and copied, never outside out/runs; one action per ticket. Each shown red with the old behaviour.

## 0.6.112 (10 October 2026)

Architecture review 14 (one AI turn), all six candidates and the owner's rule on tools:
- turn.Turns: chat_terms / job_terms decide a run's tools, brain (policy.PROFILES), limit and record once; each turn gets its folder, the runner takes tools.Kit (server, names, tool objects) and turn.Terms, and returns into one TurnResult (answer, photos, problem, limit). The owner is told by the turn when no retry helps. runner.run had eleven parameters and chose the brain itself; Settings.reply_limit_usd was read in three places.
- Who asks decides (owner, 2026-10-10): tool_access.allowed_for(policy, tools, role, chat), SYSTEM for a scheduled job; Origin.role carries who asked a job (start_job, ChatJobs.start). allowed_for_person / allowed_for_job / blockers removed: a skill's tools list limits and stops nothing; tool_access.unavailable says what a run lacks (read_skill tells the AI; health gives "without", ok stays true; the page shows "Works without a tool"). The job_only refusal sends the AI to start_job only when the run has it.
- One folder per run: config.Settings.in_folder (run_folder); ai_jobs.run_folder for a job and its on_limit / without_ai steps; out/chats/ID for a chat. Outcome.carry_out(folder=) for attachments; save_file's guard keyed by folder and name.
- One running record: ChatJobs.held for a scheduled job, where it sends. Skills.all refuses a skill whose AI job name another skill (or itself) already declares.
- tests/ai_fake.FakeAI: the run's record has call(name, args) through the run's own tools, refused when not given; tests use it instead of a hand-built toolbox.
- Tests: two reports at once in two folders; a run's terms by who asks; the facility manager's report cannot use a tool refused to them; a scheduled report asked for meanwhile runs once; a duplicate job name refused; the start_job redirect only with start_job; a skill works without a switched-off tool and the AI is told; what a skill lacks judged on the run's own tools. Each shown red with the old behaviour.

## 0.6.111 (10 October 2026)

Architecture review 13 (the skills' data path), candidates 1 to 6:
- One device name: KnowledgePack.device_name (device_of's name, the asset's name for a row without a device, the caller's words for an entity the pack does not have). The step / run / battery clues, the equipment cards, the trend charts, the counter resets, the mutes (once each), the to-do list's and the digest's subjects, roi-energy's loads and pumps. features.device_key stays the night check's stored finding identity (no migration; nothing compares it with device_of).
- One "running": vesta_shared.daily.running_threshold / power_days (a fraction of the typical peak, capped by the baseline helper, the floor without data; no floor asked when nothing peaked). nightly, energy_period and filtration_optimiser ask it. The weekly page's own 15 W (reports.yaml pump.run_min_w) is unchanged: moving it is a skill-file change. facts._best_split asks stats.step_index; facts.daily_kwh reads daily.energy_daily_features.
- One "new / still open": Problems.since(day). compose.fm_daily takes New and Still open from it (it read closed findings as new and listed a noted alert twice); owner_weekly counts alerts apart from maintenance problems.
- One way to the settings: facts.Ctx takes script.Context.params. params.tariff raises MissingParameter(villa_currency) instead of defaulting to one villa's currency; filtration_optimiser has no --asset default (filtration_pump: the "_pump" asset whose pool volume is set, the only one, or each one's missing helper named) and says a missing tariff with the rest.
- Written once in vesta_shared.result: PARAM_MISSING, COUNTER_RESET, finding_detail / finding_name (rules.py writes them; facts, proposals and nightly read them).
- reports/scripts/playbook.py: the clues and the one list moved out of facts.py (facts.py 1,008 → 685 lines).
- Tests: device names on every page; the threshold's cap, floor and no-floor; no script keeps its own threshold; the step detector against noise; the digest's new / noted / still open and the owner's counts; the currency, the pump choice, the settings' way in; every field the page prints exists; the rule ids written once. Each shown red with the old behaviour.

## 0.6.110 (9 October 2026)

Architecture review 13 (the skills' data path), its three live defects:
- facts.s_equipment compares the to-do list's devices by the one identity (knowledge_pack.device_of): since 0.6.109 it compared them with the asset slug and no card reached "Watch" through the to-do list (a regression of review 12).
- The night check prints result.FAULTS_CHANGED (new, still open or closed findings), the key app.run_code_job reads to repair the Kiosk's faults; it read new_findings / still_open / closed, which the night check never printed.
- facts.battery_pct: a battery's charge from its reading, % as it is, volts against its nominal; clue_battery_trend and s_batteries both ask it (the clue read 3.0 V as 3 %).
- Tests: a card watched through its device, the night check's printed key and the engine reading it, a volt cell's clue in %; each shown red without its fix.

## 0.6.109 (9 October 2026)

Architecture review 12 (the chat path), all five candidates:
- incident_thread.IncidentThread: what each chat shows of an incident, one record per incident and chat (state.incident_message; the incmsg: and inclast: families migrated at start, inclast: was never pruned). post / adopt / close; AlertButtons keeps keyboard and press. outcome.carry_out settles before it posts: "Need help" had taken the owner's new buttons away the moment the escalation arrived (live defect). The hasent: clean-up is one delete, not a scan on every write.
- chat_jobs.ChatJobs owns a job asked for in a chat: its turn (turn, replied, called by app._converse), its waiting message (JobNotices keyed by turn: a failed reply no longer lets the next answer be taken for it, two jobs from two turns no longer share one), one "typing…" loop per chat started once the conversation's reply is out, and its result told by name (routing.Origin.job, Delivery.on_job_result). Delivery only sends. start_without_ai has the 60 s "just started" window too.
- KnowledgePack.device_of: one device identity for every report section (the to-do list, the offline table, the batteries).
- compose.say: the one way a sentence reaches the report page; text already made for the page is kept, never escaped twice.
- Tests: Need help keeps the buttons, a second close changes nothing, records pruned, the migration; each turn its own waiting message; the to-do list, the offline table and the batteries name one device; every sentence of a to-do line shown once, linked once. Each shown red with the old behaviour.

## 0.6.108 (9 October 2026)

- reports: the monitoring table, the offline count and the "devices offline" line list DEVICES (owner: "only devices, not entities related to a device"). facts.Ctx.offline groups offline sensors by Home Assistant device: its name (the owner's first), the earliest time a sensor went, critical if any is. A sensor with no device keeps its own row; a device Home Assistant knows nothing about (no name, maker or model: a phone seen on the Wi-Fi, the "RX"/"TX" rows) is left out; one with no name but a maker or model shows as "Unnamed <maker> <model>". KnowledgePack keeps the devices (devices, device_label) from the registry already fetched. app.pack_needs_build rebuilds at start a pack built before devices were kept (format change, its migration). Tests: one row per device, nameless left out, an old pack groups nothing; the migration (each shown red).

## 0.6.107 (9 October 2026)

- "typing…" every 5.5 s (delivery.TYPING_EVERY_S). Measured on 9 October: at 4.4 s apart (group, 16:47) Telegram Web showed it with long gaps; at 2.4 s apart (private chat, 17:26, 24 of 24 accepted, longest gap 2.5 s) it never showed. Every signal was accepted both times, so one sent while the previous still runs is not passed on; 5.5 s sends each just after the last has ended.

## 0.6.106 (9 October 2026)

- start_job answers with the report's start time (ai_jobs.AiJobs.start, ChatJobs.started_at). A report started under JUST_STARTED_S (60 s) ago is "started now" even when asked again: the model called start_job twice in one turn, the second answer said "still running", and the group read "Still in progress" for a report that had just started. Later on, the answer says when it started. test_jobs pins it (shown red without the window).
- "typing…" every 2 s (delivery.TYPING_EVERY_S, was 4). The log at 16:47 had 30 of 30 accepted, evenly spaced (longest gap 4.4 s), while Telegram Web showed long stretches without it; tried at the owner's request, with no promise of how Telegram displays it.

## 0.6.105 (9 October 2026)

- The log covers a report asked for in a chat from end to end: "Message received in chat …" when the message reaches the agent (app.handle_message), and at the job's end every "typing…" with its time, how long Telegram took when over a second, refusals, and the longest gap (delivery.typing_timeline). Owner, 16:21: "no signal at all from a certain point", while the log said only "sent 34 times, 34 accepted", which cannot tell an even spread from bursts. Code checked: Home Assistant reads and skill scripts run in threads (asyncio.to_thread), so they do not stall the loop. Test: the timeline and its longest gap (shown red with min for max).

## 0.6.104 (9 October 2026)

- test_reports: HTML-like text the AI writes in a report (an unclosed tag, a script) shows as its characters and breaks nothing; the links stay one each, opened and closed. Shown to fail with the escaping switched off. Owner, after 0.12.109's changelog turned blue: "I want to make sure the reports will NOT have this issue".

## 0.6.103 (9 October 2026)

- reports: a check and its question showed the raw <a> tag (villa, 15:56). note() returned an already linked text, and the template's sentence() made it a string again, so it was escaped a second time. Now note() returns the text as written and sentence() makes the links after the words. test_reports renders a "Do this week" check and its question; with the old code it fails (the cache cleared between runs: a mutation and its restore in the same second left a stale .pyc that hid the result).

## 0.6.102 (9 October 2026)

- reports: every web address in a reading or a check is a link (compose.linked: escaped around it, a quote or angle bracket ends it, a closing full stop or bracket is not part of it; opens in a new tab; style a.src wraps on a phone). The reports skill lists web_search, and step 3 of SKILL.md asks for one search per line whose check repairs, replaces or adjusts something (the owner's wording, 2026-10-09). test_reports pins the links (three mutations shown red); test_tool_access expects web_search for a report while it is switched on.
- delivery.py: a chat job's "typing…" loop says at its end how often it was sent and accepted, and when last (villa, 15:27: it vanished before the weekly report came).

## 0.6.101 (9 October 2026)

- delivery.py logs each step of a chat job's waiting message (job asked for, the reply recorded, the result, the delete or the edit), with job_notices.JobNotices.describe. Villa, 15:03: a weekly report asked for in the group arrived and "on its way" stayed, with no delete tried; the notice lives in memory only and the case did not reproduce with the test stand-ins (private chat and group). Instrument only: no behaviour change.

## 0.6.100 (9 October 2026)

- One message per incident per chat (owner). alert_buttons.AlertButtons.replace: a message with an incident_id is sent, then the incident's earlier messages in that chat are deleted (state inclast:*); one past Telegram's 48 hours is edited to a pointer. adopt: Home Assistant's own messages of the run (ha_events now listens to telegram_sent; every event's context id travels as data["_context_id"]; state.note_ha_sent / ha_sent, kept 24 h) are rewritten and tracked under the incident. outcome: new key ha_messages (vesta_shared.result.ha_message); two messages of one result for one incident and chat keep the one with the buttons. vesta_shared.messaging.incident_tag / incident_message: the one layout ("Incident #N · status", the original alert, what to answer). alert-desk: every message through desk.about (the original alert and what to check repeated), escalations and the owner's messages carry the buttons; reports' digest lists "Incident #N · …". tests/test_one_message_per_incident.py (each check shown to fail by a mutation).

## 0.6.99 (9 October 2026)

- Prompt cache: app.system_prompt no longer carries the clock (it changed the cached prefix every minute). runner.with_time puts "[Villa time: …]" at the head of every message (chats, Continue, AI jobs). tests/test_prompt_cache.py: the instructions are identical at two different times (checked to fail with the old line), and every run sends with_time.

## 0.6.98 (8 October 2026)

- places.py: a title may carry a {slot} ("When the {skill} skill runs"). places.title(key, **names) and core.place(k, names) fill it, or drop it with its space, by the same rule. aboutSkill names the open skill. test_ui pins.

## 0.6.97 (8 October 2026)

- viewer.fileViewer: "View" / "Edit".
- skills.js: the CSS `order: -1` that moved the open file first is removed; fits() unfolds the list when the open file is off its first line (checked again once fonts load and after the file loads).
- skills.js: show(name) moves the highlight and opens the pane without redrawing the list; a skill's switch reopens the skill open now. test_ui pin.

## 0.6.96 (8 October 2026)

Ninth architecture review: all six candidates and the live defects.
- Live defects:
  - An unparseable policy.yaml made api/jobs, api/overview and api/skills answer 500, and Rules (file) hung (fixed: changes.page_policy, and the file view asks for the file only).
  - Keep mine had no catch.
  - Stale words ("The AI", "only the devices in the lists", "allowed lists", "Try a command" in docstrings).
  - Page copies of server facts ("WebSearch", "not recorded", the verdict words, which files may be deleted; the server allowed deleting SKILL.md and skill.yaml).
- 1: GET api/rules returns the Rules tab in one answer. core.go shows a failed tab's reasons. page.PROFILES is gone (each tab keeps its own).
- 2: places.ORDER and core.inOrder (the Rules section order is data). Code-shape test pins replaced by data, HTTP and Node tests.
- 3: viewer.fileEditor (one editor for both). rules.openTools (the skill page no longer writes Rules' tab keys).
- 4: dead CSS removed and duplicates merged. AI and roles column widths are data (core.table {width, cls}); no nth-child column rules. test_ui fails on an unused stylesheet class. Measured identical before and after on a laptop and a phone.
- 5: setup_copy.offer, policy.ROLE_WORDS, history.CHIPS, places.TABS (index.html filled by the server), core.api({file}) for the export.
- 6: ui/changes.PageFiles holds the write, check, record and Undo code, moved out of the HTTP class; setup_copy.apply takes PageFiles.

## 0.6.95 (8 October 2026)

- core.cell: a labelled cell (paged) with several pieces wraps them in one span.cell-v, so the phone card's "label … value" keeps them together. Checked on all 48 phone cells: only the 3 "What runs" cells moved.

## 0.6.94 (8 October 2026)

- static/viewer.js: the one file viewer, `fileViewer(ta, path)` returning {toggle, box, show}. Rules (file) and Skills › Files both use it. Markdown is drawn by markdownView (moved from skills.js), YAML by yamlView.
- static/yaml.js: `lines(text)` turns each line into pieces (indent, comment, dash, key, colon, number, switch, quoted text, value). A `#` inside a word or quotes is not a comment, and the pieces join back to the exact text. No HTML string is produced.
- page.fileView replaces page.mdView. test_ui: the tokenizer is run in Node on policy.example.yaml (lossless) and on edge cases, checked with two mutations.

## 0.6.93 (8 October 2026)

- static/markdown.js: `parse(text)` turns Markdown into plain blocks (front matter, headings, paragraphs, nested lists, tables, fenced code, quotes, rules; inline code, bold, italic and links). HTML comments are dropped and no HTML string is produced. skills.js `markdownView` draws the blocks with core.h, tables with core.table, and opens a link only when it is an http(s) address. Nothing is fetched.
- Files: a .md file opens Formatted by default; core.segmented gives the Formatted / Raw switch (styled like the theme switch); page.mdView keeps the choice.
- test_ui: the reader is run in Node on real input (it fails, never skips, without Node; checked with two mutations), plus a pin on the Files view.

## 0.6.92 (8 October 2026)

- skills.js `takeReleaseButton(name)`: one button, drawn by the release banner and the Compare tab (the banner is hidden after "Keep mine", while the Compare tab still described the button). test_ui pin; checked in the browser with a kept edit.

## 0.6.91 (8 October 2026)

Eighth architecture review: the page draws the agent's verdicts.
- server.undoable is the one answer for Page changes and Undo; history rows carry `undoable`. Fixed: Undo was hidden for instructions.
- status.figures and FAILURE_KINDS: `last_24h.figures`. Fixed: action_failed was not counted; script_refused (a refusal) is still not a failure.
- tool_access.health `line` for the skills list. tool_access.switch_on with POST api/tools/on, and POST api/jobs/missing: the page no longer reads, changes and writes the whole form.
- policy_doc: the form gives agent_tools and tool_access.fm as true/false switches, web search included. apply_form writes the file's own shape back; the file written for an unchanged form is byte-identical to before.
- skill_detail `acts`: rows of {when, job, script, kind[, note]} in display order (no "when — job" sentence, no "AI job" magic value).
- Tests through HTTP (test_page_controls): each new rule went red under a mutation.

## 0.6.90 (8 October 2026)

- rules.js: the AI tools card after AI brains and limits (owner). test_ui pin.

## 0.6.89 (8 October 2026)

- places.py: skill_when / skill_commands / skill_tools renamed "When the skill runs" / "Skill commands" / "Skill tools" (owner).

## 0.6.88 (8 October 2026)

- Starter skills (asked for by the owner): villa-concierge SKILL.md says "Rules › Allowed actions"; the reports and villa-concierge skill.yaml comments say "Rules › AI tools". Both recorded in shipped-skills.json. test_ui's old-names guard now covers starter/.

## 0.6.87 (8 October 2026)

- vesta_agent/places.py: one name per place on the page (title, and where it sits). The server writes the table into index.html as JSON; core.js `place(k)` / `where(k)` read it. policy.FIELDS section words, tool_access's "why", the history and setup_copy use it as well. Renamed as listed in the app's changelog.
- Rules › AI tools: the Home Assistant tools count/source and the roles paragraph are now tab (i)s (tabbed's info; the count is worked out when the (i) opens).
- test_ui: no multi-word place title and no "Tab › …" sentence is typed by hand in the page code, and the old names are gone from the code. Checked to fail with both kinds of mutation.

## 0.6.86 (8 October 2026)

- DRY pass on the page, as the owner asked. core.table / cell / tableRow build every table: paged, editTable, Rules' AI and roles tables. core.tabbed builds every tab section: Costs' tabbedCard, setupCard, toolsCard and aboutSkill. Its open tab is kept in page.tabs (it replaces costTabs, setupTab, page.toolsTab and aboutTab).
- A skill's "When" list is now paged(["When", "What runs"]); `.kv` is removed.
- Dead CSS removed: .spaced, .tool-row/.tool-text, .cmd-row/.cmd-text, .try-row/.try-go/.try-preview, .files .special.
- Phone fixes: the roles table's column widths, and the AI table's cells can now shrink. test_ui: a test that every table and tab section comes from one builder (checked to fail when one is built by hand).

## 0.6.85 (8 October 2026)

- skills.js tryPanel: no code subtitle, no "Options" heading; the popup title is "Offline Test · <script> <command>". test_ui pin.

## 0.6.84 (8 October 2026)

- skills.js aboutSkill: "When" is its own section on top; the tabs are Commands (with the switches' (i), via subTabs' info) and Tools; Commands first, absent for a skill without scripts. test_ui pins.

## 0.6.83 (8 October 2026)

- Log lines name the app setting by its label, "Agent replies on Telegram" (the option key stays `telegram_takeover`).

## 0.6.82 (8 October 2026)

- core.toggleCard `action`: a button in the card head left of the switch (`.tool-card-side`); the Offline Test pill moved there, "Offline " hidden by `@container (max-width: 300px)`. core.popup focuses Close (`autofocus`): showModal focused the title's (i), whose focus opened its tip. app.css `.about > * {min-width: 0}`. test_ui pins.

## 0.6.81 (8 October 2026)

- skills.js: the Try tab removed; `offlineTestPill` on each command card (and on a whole-script card) opens `tryPanel(name, d, script, command)` in `core.popup`, with no script or command choice. About opens with `subTabs` of when/tools; the tools are `core.tileCard` cards (toggleCard builds on it); renames live in `ABOUT_TEXT`.
- core.js: `floating` attaches a panel inside an open `<dialog>` (the top layer), so a tip or a list in a popup is drawn above it. test_ui pins.

## 0.6.80 (8 October 2026)

- costs.js: the per-day chart's viewBox is the card's pixel width (no stretch); axis text 12 px. test_ui pin.

## 0.6.79 (8 October 2026)

- app.css .skills: the list column 280 → 364 px (test_ui pin).

## 0.6.78 (8 October 2026)

- app.css --page-width 1650px (was 1100, four places). costs.js tabbedCard (subTabs, tab kept per page life): By work/By model, Every run/Tools used.
- scheduler.job_key (the stored slot key, unchanged) and job_label (AI job name, skill › script, engine words); status.report(label=) → scheduled_jobs[].label; overview.js and the agent_status tool show it. Tests.

## 0.6.77 (8 October 2026)

- skills.js About › What the AI may run: no flag chips on a whole-script card; the explanation is the title's withInfo (i). test_ui pin.

## 0.6.76 (8 October 2026)

- costs.js madeWithoutAi: the (i) before the chip, aligned with alertButton's (!) (test_ui pin).

## 0.6.75 (7 October 2026)

Seventh architecture review (all candidates):
- vesta_shared.result (message/fault/fault_note/resolved/snapshot/settle/siren); desk, nightly, compose, problems and tickets.repair use it; outcome reads a message's incident_id (no "#N" regex) and an armed gate's prompt goes to gate["to"] when no siren is configured (no text-equality drop).
- vesta_shared.script (arguments, Context: client / live_client / pack / store / settings / params / zone / Z / now / day; of()); nightly, energy_period, filtration_optimiser, proposals, facts, compose, desk, concierge, voice; desk drops --helpers / --villa-mode (fixture dir), intake takes zone; no store made unasked.
- vesta_shared.skill_settings (load/merge/behaviour); params.BEHAVIOUR_DEFAULTS and behaviour_text_default removed; VillaParams.defaults / with_defaults, behaviour() raises MissingParameter; behaviour sections in alert-desk/rules.yaml, preventive-maintenance/settings.yaml, roi-energy/settings.yaml (+ proposals thresholds); facts.load_cfg via skill_settings, alert_blueprints from reports.yaml alert_words; compose names a missing todo.group_from.
- Problems.record_night (+ worsened, closes_tonight); features.integration_down pure.
- Page: api() always gives problems (UNREACHABLE, session ended), core.reasons, saveWith (rules ×2, skill file).
- Host selftest._sse_events by the SSE rule; tests/sse_samples.py run against both readers.

## 0.6.74 (7 October 2026)

Sixth architecture review (all candidates):
- siren.Siren: Actions(executed=) hook on every execution; stop time in State (siren:stop_at); watch() task in main; app.after_execution removed. Tests: direct path, restart, wrong entity, failed stop.
- ai_jobs.AiJobs: run / start / start_without_ai / run_without_ai / find / without_ai_able; not_set() one wording; app wires it (scheduler, toolbox start_job, ai_down, the press).
- intake.gate (pure: drop / whoami / unregistered / new / converse) and intake.resume_for (tested for the first time); button_data (APPROVAL/CONTINUE/ALERT/REPORT make/read, FOR_PEOPLE_ONLY), handle_callback a lookup + Press; policy.NOT_REGISTERED (actions said "VESTA" alone).
- agent_records holds RUN, COSTS_KINDS, who helpers, without_ai(), detail(); vesta_agent/run_records.py removed; status reads rows through detail(); state.prune keeps COSTS_KINDS on the runs' limit; runner does not record a retried resume that did nothing.
- problems.close_incident / close_finding (state decides; returns ticket.resolve actions); desk.py resolved/reply(done, mute)/recovered and nightly use them.
- ui/server: text_change(base_rev=) checks version (_check_rev) and kind (_check_text: rules problems, .py compile, YAML) for every write; rules_problems() one reading; tool_access.health for the list and the skill page.
- ChatJobs keeps its tasks; idle(); tests await it instead of polling.

## 0.6.73 (7 October 2026)

- agent_records.run_cost: a record whose token counts (input and output present) are all zero cost 0.0 — read side, so past records are corrected; runner records and logs the same figure. Records without counts keep theirs.

## 0.6.72 (7 October 2026)

Fifth architecture review (all candidates):
- chat_jobs.ChatJobs: one lifecycle for a job asked for in a chat (running set, job_started, job_waiting, Origin JOB, job_ended in finally); app._running_jobs and _requested_job removed; the press passes waiting_mid (no startswith("Making")).
- job_steps.run: on_limit (now a one-step list from skills._without_ai) and without_ai run alike; routing.job_to replaces 4 copies.
- ai_down.offer / keyboard (pure) + api_errors.AI_DOWN; tool_access.may_start_job for offer and press (the press checked only "registered").
- redact.scrub, the one scrubber (runner._scrub removed; runner.kept_steps); run_records (who for job/person, without_ai record).
- facts.Ctx: incidents, ha_alerts, rule_states, hourly_means read once per run; running_power/_days_power on hourly_means. energy_period keeps the named main meter for its asset; an unknown one is a note, not a KeyError.
- KnowledgePack.row / name_of replace six hand-written walks (app, facts, compose).
- UI: check_skill, folder_change, policy_now, save_policy, text_change public; setup_copy uses only public methods (test).
- actions: a state in ON_ITS_WAY is read again (up to 5 s) for one device too.
- compose.py: mode (ai / limit / no_ai) named once; --finish without --out, --no-ai/--since/--limit without --finish, and a chat text's --finish without --no-ai are refused.

## 0.6.71 (7 October 2026)

- report.html: `.asset` align-content:start + min-width:0, its pill justify-self:start, `.wrap` overflow-wrap:anywhere; proposals say "To answer, write in the chat: accept N…" (no fake buttons); P1/P2 tasks say how they leave the list; detail/benefit as sentences.
- preventive-maintenance: PM-PARAM-MISSING detail carries the asset's name; roi-energy proposals title the missing setting by it ("Create the missing setting for …").

## 0.6.70 (7 October 2026)

- AI down: the report buttons are offered only when the message shares a word (4+ letters) with a report's `button` — the skill's words.

## 0.6.69 (7 October 2026)

- FIX: a job started by a `w:` button registered no reply, so JobNotices kept a done notice and deleted the next conversation reply. Delivery.job_waiting makes the pressed message the waiting message (test, mutation-proven).

## 0.6.68 (7 October 2026)

- AI down: a message naming exactly one report by its `button` words starts start_without_ai directly (no keyboard); the `w:` press edits its message (text + what is being made), which removes the buttons.

## 0.6.67 (7 October 2026)

- converse: on an AI-down problem (api_errors.NO_RETRY), a person with start_job gets one button per on_request job with without_ai that policy sets up (skill.yaml `button`, callback `w:<problem>:<job>`); handle_callback `w:` → start_without_ai (registered presser, not twice per chat, job_started/ended, "could not be made without the AI either" when nothing was sent).
- telegram.typing returns whether Telegram accepted it; Delivery logs the first acceptance per answer (INFO).

## 0.6.66 (7 October 2026)

- test_jobs: the typing test waits for the job's run to end (an Event, 10 s) instead of a fixed 0.15 s sleep — CI was slower and 0.12.70 failed there.

## 0.6.65 (7 October 2026)

- Reports without the AI: skill.yaml AI jobs take `without_ai` (code steps in order; `{skill, run, on_schedule_only}` for another skill's script, checked when it runs). app.run_without_ai runs them on any LLM problem, each needing the one before (a stale file never stands in), carries out what a step sends, logs a `without_ai` record; for_job is sent only when nothing was. compose.py `--no-ai WHY` (with --finish): page banner, message note, an old notes.json ignored; fm-daily / owner-weekly gain a --finish send path. status.costs lists `without_ai` rows (cost 0, outside runs_count and the groups); costs.js shows them. api_errors.why_job / why_job_sentence.
- Kiosk tickets follow their finding: Kiosk.held_tickets / update_ticket (title + an update entry), _edit skips a no-op PUT; tickets.repair updates open titles from problems.current_title; run_code_job repairs after a night check that changed findings.
- Costs: a failed run is core.alertButton (!) with api_errors.FOR_PERSON words and the raw error; infoTip takes a kind.
- compose.py charts: one `_tip` per point/bar/day (title + hover/focus label, no script).
- alert-desk: the repeat count's "since" through timeutil.day_time_label in the villa's time.

## 0.6.64 (7 October 2026)

- FIX (regression from 0.6.62): skills.injected() named the declaration and the argument list both `inject` — every script ran without --pack/--store/--zone. Test drives the real list and a real script. script_run: exit 2 with an argparse usage error is "stopped", not "nothing to do".
- Fourth review 1: knowledge_pack classifies by platform (mobile_app: a person's device; router integrations: network) — NOISE_PREFIXES with one villa's devices and a person's name removed; night-check thresholds into params.BEHAVIOUR_DEFAULTS (worsened takes its step).
- Fourth review 2: vesta_shared/device_state (is_offline: unavailable only; battery_charge by unit, V against nominal); facts.py uses it and Ctx.params() (live_params); report template shows volts; rules.py uses battery_charge.
- Fourth review 3: timeutil.villa_time / villa_date (UTC → villa; naive = UTC; dates kept); facts.offline "since" in villa time, kpis/kpis_month and compose's day comparisons through villa_date; ha_client.paged() — one paging rule for statistics, history, logbook.
- telegram.typing logs a refusal as a warning, once per 10 min per reason.

## 0.6.63 (7 October 2026)

Third architecture review, all six candidates, and two owner reports:
1. `policy.read_policy(raw) -> (values, problems)`: one pass; Policy and problems() both read it. Fixes: list-shaped allowed_services / system_actions crashed Policy() (every reply and job); reply/job limits as text, unknown chat roles, tool_access.owner, repeated person ids (first wins), refused service lines are now the default/absent; siren_entity lower-cased and checked; a protective device list written as text still protects (named). check_service(system=True) allows the configured siren's turn_off. test_policy_agreement +5.
2. `vesta_shared.params.live_params(client, store, max_age_minutes=10)`; alert-desk reads it (no --helpers in production before: params None, maintenance_mode never read); the desk's literals come from BEHAVIOUR_DEFAULTS.
3. villa-concierge: propose/execute/readback and catalogue.yaml removed (unreachable); SKILL.md "Acting" is ha_call_service; SKILL_PREFACE's concierge clause dropped; test: a SKILL.md never names a `script.py command` the skill lacks.
4. `store.Incident` (states, CHASED, ANSWERED_OR_CLEARED) used by desk/problems/compose; Store.finding / set_finding_detail / prune_features / pack_seen_empty replace raw SQL in nightly, problems, housekeeping, build_pack; guard test.
5. Scheduler: start key = claim key (two jobs at one time both run); housekeeping hook started beside the tick. runner: the lost-session retry passes `asked`. State: kv gains `at` (migration dates existing rows), prune removes inc:/incmsg: with the other records.
6. release.py: GATES carry their lane; test_release holds every gate whose test file uses the sidecar port to "sidecar".
Owner: start_job keeps (chat, job) running and answers "still running" (the AI had answered from memory, nothing started); Delivery keeps "typing…" in the chat while a requested job runs (stops at its result or end).

## 0.6.62 (7 October 2026)

Second architecture review, all five candidates:
1. `policy.FIELDS` (+ RESET_WORDS): sections, labels, form/setup membership; SECTIONS, FORM_KEYS (form_sections), setup_copy AI_SETTINGS/TOOL_SECTIONS/ACTION_SECTIONS (setup_fields), history.WORDS and the page (schema words/resets) derive from it. Label drift fixed (history vs page). test_policy_fields.
2. `skills.Script` replaces the spec dict (commands, flags, inject, job_only, off_all/off; runnable, runnable_commands, view, switched) + `switch_command`; `_parse`/`_files` → public `parse_skill`/`skill_files`. test_skill_scripts.
3. timeutil: `day_label(weekday, long, year)`, `day_time_label(weekday, year)`, `villa_day(zone, as_of, last_finished)`; 7 hand-written "%a %d %b" removed (rules.py, compose.py, facts.py); compose's when() converts HA's naive UTC to the villa zone (facts carries "zone"); `vesta_shared/daily.py` (power/energy day features) — roi-energy no longer imports preventive-maintenance's scripts by path; 8 dead `_shared` sys.path lines removed. Starter skills recorded as shipped. test_one_day_format.
4. Tests: `helpers.make_agent` / `make_skill`; `ha_fake.FakeHA`, `kiosk_fake.FakeKiosk` (contract tests in test_fakes; test_telegram_fake's scan now sees handed-on methods too); 7 fixtures, 5 readers, 2 kiosks consolidated.
5. `tickets.py` (create/resolve/repair), `alert_buttons.py` (keyboard/remember/settle/press, LADDER), `outcome_words.py`; Outcome takes tickets + buttons (8 deps, carry_out only); `voice.py` (transcribe) out of app.py.
Page: `core.toggleCard` shared by Rules tools and Skills commands (`.tool-grid.three`); Tools-it-needs (i); Acting title order; ttl (i) after "min".

## 0.6.61 (7 October 2026)

Architecture review, the rest (candidate 5 and the leftovers):
- Page JS split into ES modules by tab (core, costs, overview, rules, skills; app.js the entry). Done by a TypeScript-checker transform: 77 statements moved verbatim, the 5 cross-module mutable lets (dirty, current, PROFILES, jumpTo, toolsTab) into `core.page`, `go` reads `page.views`; verified statement-by-statement and by name resolution (0 unresolved, mutation-proven), all tabs rendered with no browser error.
- `UI._text_change` / `_folder_change`: the only writers of page_history; Undo of policy, instructions and a skill's file is one rule (`TEXT_KINDS`). Fixes: imported instructions recorded as a kind Undo refused.
- `requests_box.try_request` / `try_of`: a try's payload checked by the page and again by the agent.
- `tool_access.saved_server_tools`: the saved list back in the server's shape (was rebuilt in ui/server.py).
- Import preview through `paged()`.
- Tests: `tests/ai_fake.py` FakeAI replaces 8 hand-written runner.run stubs (contract test vs runner.run); `helpers.page_js()` / `body_of()` read the page's modules.

## 0.6.60 (6 October 2026)

Architecture review candidates 1–4 (candidate 5, splitting the page's files, not done):
- `delivery.py` (new): every send, its failure verdict (id or None), photos/caption of a reply, "typing…", the job notices. Fixes: send_message answered "Sent." on a refused message; carry_out counted unsent as sent; a failed/blocked job asked for in a chat sent its reason AND its waiting message was edited (two messages) — its sends now carry the JOB origin and replace the wait. `Vesta.send` and `_job_notice_step` removed; Outcome and Toolbox take `Delivery.send(..., photo=, origin=)`.
- `telegram.py`: sendDocument/sendPhoto go through `_post_form`, failing as TelegramError like `api()`; one attachment per message.
- `script_run.py` (new): run + verdict (done/nothing/stopped) + scrub + JSON + one record (`script` / `script_failed`, with `by`) for the AI, jobs and the page; app.code_command, tools.run_skill_script and app.try_command use it; the page reads `verdict`. status counts `script_failed` (and old `code_script_failed`).
- `Toolbox.for_run(person, origin)` → (server, names): names read off the built tools; every tool built only when tool_access allows it; read tools computed once per Toolbox (no tool_denied row per call). `model_tool_names` / `server` removed.
- Tests: one Telegram stand-in `tests/telegram_fake.py` (4 copies removed), `test_telegram_fake.py` holds it to Telegram's interface; tests for each fix, each mutation-proven.

## 0.6.59 (6 October 2026)

- converse(): sendChatAction "typing" every 4 s (TYPING_EVERY_S) from the start of the run until the reply is sent (`telegram.typing`, failures logged at debug only).

## 0.6.58 (6 October 2026)

- UI Try a command: `outfile` flags as a text box (validated as for the AI: a plain name in the out folder); after a run the skill's `out_files` are fetched again so the next step offers the file.

## 0.6.57 (6 October 2026)

- UI: skill detail carries `out_files` (the out folder's files, newest first); Try a command offers `infile` flags as a menu of them (preselected: the file named after the flag), `outfile` still hidden. validate_script_args checks them as for the AI.

## 0.6.56 (6 October 2026)

- vesta_shared.store.raise_finding: no open row → the row of the same (rule, entity, opened_day) is reopened and updated (is_new False) instead of a UNIQUE crash; nightly.py reports an event rule as new only when is_new. preventive-maintenance recorded as shipped.

## 0.6.55 (6 October 2026)

- requests_box: `submit` / `result` (page polls GET /api/tries/<id> every second; POST /try answers {"pending": id} at once); the agent renames a request to <id>.taken.json and runs each as its own task. Cause: a 180 s page request outlived Cloudflare's 100 s (Error 524) on nightly.py. `ask` kept for refresh_tools.
- subTabs: [key, label, info] puts an (i) beside the tab (`infoButton`, shared with withInfo).

## 0.6.54 (6 October 2026)

- The model did not call send_message(camera=) (live, 20:19): removed. Toolbox.photos records every image a read tool returned in the run; converse() sends them (last 4, deduplicated) with the reply as the last one's caption; a refused photo falls back to the text. One mechanism, not chosen by the model.
- telegram.send: a reply longer than a caption (1,000) continues as text after the photo (was cut).

## 0.6.53 (6 October 2026)

- send_message takes `camera` (camera.*) when ha_get_camera_image is allowed for the run: the agent fetches the picture and sends it with sendPhoto, the text as caption; no picture or a refused photo is an error, never "Sent.". One fetch for both paths: `outcome.camera_photo` (also the alert desk's snapshot.get).
- telegram.send raises on a refused sendPhoto (was a silent caption-only message).

## 0.6.52 (6 October 2026)

- UI: settings.conversation_reset is named "Delete conversation context at" (caption, aria-label, history wording, export line).

## 0.6.51 (6 October 2026)

- UI: The AI's chat line puts the New conversation menu in a captioned cell (td.with-caption) aligned with the brain and limit. test_ui pins it.

## 0.6.50 (6 October 2026)

- UI: editTable takes `per`; the services table pages at 10 (owner). test_ui pins it.

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
