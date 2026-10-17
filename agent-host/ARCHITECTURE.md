# VESTA Agent — architecture notes and decisions

Moved out of `agent-host/CLAUDE.md` on 2026-10-13 (it is loaded on every turn; this is read on demand). The standing
owner rules are summarised there; their full entries, and every review's module map, are here.

## Original build method (SPEC milestones, done)
- Follow the milestones in SPEC section 16, in order.
- Plan first; after each milestone, stop and report: what changed, how it was tested, what is `skipped` and why.
- A check that cannot pass yet because a dependency does not exist (SPEC section 15) is reported as `skipped`, never faked.

## Verified facts (SPEC section 14)

Moved from vesta-agent/DOCS.md (the owner's Documentation tab) on 2026-09-29 —
internal engineering notes, not for the app's readers.

Checked on 2026-09-28 against the running system and upstream sources.

1. **HA MCP.** The installed app `81f33d0f_ha_mcp` is
   `homeassistant-ai/ha-mcp` 8.5.0 (PyPI `ha-mcp`, Python >=3.13,<3.15). HTTP
   mode: `ha-mcp-web`, configured by `HOMEASSISTANT_URL`, `HOMEASSISTANT_TOKEN`,
   `MCP_HOST`, `MCP_PORT`, `MCP_SECRET_PATH` (default `/mcp`),
   `HA_MCP_DISABLE_SETTINGS_UI`; transport streamable HTTP (stateless). The
   self-test's handshake against 8.5.0: pass, 77 tools.
2. **Hostnames.** An app's hostname is its slug with `_` → `-` (Supervisor
   `apps/model.py`): `e66a2348-villa-kiosk` (confirmed live),
   `e66a2348-villa-kiosk-dev2` (DEV2 installed). Home Assistant's container is
   `homeassistant`. **Confirmed on the HA Yellow** (0.5.1): the self-test from
   this app reached `http://homeassistant:8123/api/` (pass) and
   `http://e66a2348-villa-kiosk-dev2:8099` (reached; no agent interface yet).
3. **`map` and schema.** `- type: addon_config` + `read_only: false` is the
   current form (the `addon_config:rw` string is still converted). All schema
   types used are in the Supervisor's grammar (`apps/options.py`); `timeout`
   must be 10–300 s.
4. **Base image.** `ghcr.io/home-assistant/{arch}-base-debian`; tags `latest`,
   `trixie`, `bookworm` and dated ones. This app uses `trixie` (Python 3.13).
5. **Claude Agent SDK (Python)** does not need Node.js: its per-architecture
   wheels bundle a native `claude` binary.
6. **Time zone.** The Supervisor sets `TZ` in every app container
   (`docker/app.py`); the host passes it to the agent unchanged. Confirmed on
   the HA Yellow: the app logged Home Assistant's own time zone.

## The agreement with the VESTA Kiosk (0.8.0)

`agent-host/rootfs/opt/vesta/host/agent-contract.json` is a COPY of the Kiosk's
`rootfs/usr/share/vesta/agent-contract.json` (dev2). `vesta_host.kiosk_contract`
reads it (its version); the self-test and `tests/fake_remote.py` use it. (The
test mode — the "stub" and its demo message — went in 0.12.46: the slot always
runs the VESTA Agent, after the self-test, once Home Assistant and Anthropic
pass; the UI runs from the start so the files can be prepared.) `tests/test_kiosk_contract.py` fails when the
copy and the Kiosk's file differ — when the Kiosk changes the agreement, copy
its file here and release the host; never edit one side alone.
`vesta_host.manifest` reads `vesta-agent.yaml` (slot, start banner, image
build); `vesta_host.host_state.HostState` is `/run/vesta/host.json`.

## The VESTA Agent in this repository (0.9.0)

`agent-src/` is the VESTA Agent's source (owner, 2026-09-30: no separate
repository for now). The image build installs it from its `vesta-agent.yaml`:
`install` in the agent stage, `system_packages` (Debian packages, checked as
package names) in the final stage. The separate-repository fetch was removed
from the workflow; `versions.json` still holds the empty `agent_repo` /
`agent_ref` the update check reads, until that question is decided.

Decisions of 2026-09-30 (owner):
- D1: the agent opens one Home Assistant websocket that only LISTENS
  (`vesta_critical_event`, `telegram_text`, `telegram_command`,
  `telegram_callback`). Home Assistant stays the only receiver of the villa
  bot; the agent reads Telegram from those events and only sends.
- D2: no external HA MCP mode — the sidecar always (`ha_mcp_mode`,
  `ha_mcp_url`, `ha_mcp_secret`, `VESTA_HA_MCP_SECRET` removed; old stored
  values are ignored).
- D3: no Node.js in the image.
- D5: the "VESTA Agent" HA user is an administrator, Active, local-network
  login only. NOT login off: Home Assistant refuses the token of an inactive
  user (found on the Yellow, 2026-09-30).
- Skills live in `/config/skills` as files, each with a `skill.yaml`. A starter
  skill never edited there follows the release (fingerprints of every shipped
  version in `agent-src/starter/shipped-skills.json`; a test fails until a
  changed starter is recorded); an edited one is kept.
  0.12.157: a starter skill a later release ADDS reaches an older install (`skills.OFFERED`, .offered.json: the
  names an install was given; a deleted one stays deleted); a rewritten starter instruction sentence reaches the
  villa's instructions.md only where it still stands word for word (`config.INSTRUCTION_REWRITES`).
  0.12.160 (owner, 2026-10-11): in a CONVERSATION create_ticket only offers a fault (`state.ticket_offers`, button
  `button_data.TICKET`, `app._press_ticket`); jobs and alert hooks create at once. Never let the AI create one unasked.
  0.12.162: skill.yaml `command:` makes a skill run ONLY on its "/command" (intake.gate, Toolbox.gated) — investigate
  (/investigate). A chat answer is the text after the AI's LAST tool call (runner.Collector.answer).
  Review 32, 0.12.165: `fault_offers.FaultOffers` is a fault offer start to end (one per investigation `inv`, its page,
  shown once delivered, pressed within the caption limit); a Continue carries `invoked` and `inv`;
  `vesta_shared.messaging.TELEGRAM_CAPTION` is the one caption limit; `McpClient.history_cut` says a cut read.
- ⚠️ SKILLS BEFORE CODE (owner, 2026-10-01, mandatory): whatever a skill can
  define (report sections, thresholds, wording, routes, which scripts the model
  may run, which rules are VESTA alerts) lives in the skill, never in
  `vesta_agent/`. No threshold in code: a missing one is named, not guessed.
- Readings (0.12.0, docs/adr/0001, glossary GLOSSARY.md): a report's FIGURES are
  computed and checked; VESTA's READINGS are the AI's conclusions with its own
  numbers, marked, unchecked — do not reinstate the check on readings. AI jobs
  run only when policy.yaml `settings.jobs` names them. A starter skill's
  `villa.*` files are the villa's: kept by updates, not an edit.
- One module per job (architecture review, 0.11.0): `outcome.py` carries out
  every script result (all callers), `routing.py` decides every chat,
  `policy.py` is the one reader of policy.yaml, `status.py` the one reading of
  the agent's records. Architecture review 2026-10-06 (0.12.65): `delivery.py`
  is everything that reaches a chat and whether it did (`send` returns the id or
  None — never "Sent." for what did not arrive; a message on behalf of a job
  asked for in a chat is its result, job_notices); `script_run.py` runs and
  judges every skill command (AI, job, page: one verdict, one record);
  `tool_access` decides the AI's tools and `Toolbox.for_run` builds exactly
  them, names read off the built tools. Tests use ONE Telegram stand-in,
  `tests/telegram_fake.py`, held to the real interface by test_telegram_fake,
  and ONE AI stand-in, `tests/ai_fake.py` (FakeAI), held to runner.run's
  parameters by test_ai_fake. 0.12.66: the page is ES modules —
  `static/app.js` (entry: theme, tab clicks, `page.views`) imports
  `core.js` (shared state `page`, helpers, dialog, `go`), `costs.js`,
  `overview.js`, `rules.js`, `skills.js`; tests read them all with
  `helpers.page_js()` / `body_of()`. Every page change is written AND recorded
  by `UI.text_change` (rules, instructions, a skill's file) or
  `UI.folder_change`; Undo of any text uses one rule. A try's payload is
  `requests_box.try_request` / `try_of` on both sides.
  Second review, 0.12.67: `policy.FIELDS` is the one table of policy.yaml's
  settings (sections, the words the page and history use, what the forms edit,
  what a setup carries) — SECTIONS, policy_doc.FORM_KEYS, setup_copy's lists,
  history.WORDS and the page (form_schema "words"/"resets") read it.
  `skills.Script` is a skill's script (commands, words, job_only, this villa's
  off choice; `switch_command` writes villa.skill.yaml). Skill scripts: one day
  format and one "which day" rule (`vesta_shared.timeutil` day_label /
  day_time_label / villa_day), the meter's day features in
  `vesta_shared.daily` (no skill imports another skill's folder). Outcome
  carries a result out; `tickets.py` (Kiosk tickets) and `alert_buttons.py`
  (the ladder) are their own modules, `voice.py` the voice message. Tests: one
  builder `helpers.make_agent` / `make_skill`, stand-ins `ha_fake.FakeHA` and
  `kiosk_fake.FakeKiosk` held to the real ones by test_fakes. Page: one switch
  card, `core.toggleCard` (Rules › What the AI can use, Skills › What the AI may
  run; `.tool-grid.three`).
  Third review, 0.12.68: `policy.read_policy` reads the file ONCE — the values
  the agent uses and problems() come from the same pass (a value named is the
  default; a wrongly shaped section never crashes; device lists stay lenient on
  purpose); the configured siren's turn_off is an implied system action.
  `vesta_shared.params.live_params` (the alert desk now reads the villa's
  parameters, kept 10 min). villa-concierge has no action path of its own
  (catalogue.yaml, propose/execute/readback removed; SKILL.md names only what
  the skill offers — test). `store.Incident` names an incident's states; the
  store owns its SQL (test). Scheduler: one key per job, housekeeping beside the
  tick; runner's retry keeps `asked`; kv rows are dated and button records
  pruned. release.py: each gate names its lane (test: port users → "sidecar").
  start_job answers whether the job still runs (never the AI's memory);
  Delivery keeps "typing…" while a job asked for in a chat runs.
  0.12.70: an AI job may declare `without_ai` code steps (skill.yaml): on any LLM problem
  app.run_without_ai still makes the report from its figures ("Made without the AI", why), each step
  needing the one before; the Costs tab lists it at no cost. Open Kiosk tickets follow their finding's
  current wording (tickets.repair → Kiosk.update_ticket).
  Fifth review, 0.12.77: `chat_jobs.ChatJobs` is a job asked for in a chat from start to
  end (never twice, its waiting message, typing, its end) — start_job and a report's button
  both use it; `job_steps.run` runs on_limit and without_ai alike (one-step list / list,
  stop at a failure, carry out what sends); `ai_down.offer` decides start / buttons / nothing
  when the AI cannot answer, `api_errors.AI_DOWN`; `tool_access.may_start_job` judges the
  offer AND the press; `routing.job_to`; `redact.scrub` is the one scrubber;
  `run_records` writes and reads a run's `who` and the without-AI record;
  `KnowledgePack.row/name_of`; facts.Ctx reads each thing once per run; the page's write
  methods are public (setup_copy uses only them — test); a device "on its way" is read again.
  Sixth review, 0.12.79: `siren.Siren` — every execution (actions `executed` hook) that
  turns the configured siren on records its stop time in State; `watch` stops it, a restart
  included. `ai_jobs.AiJobs` holds the reports (find, run, start, without the AI);
  `intake.gate` decides each Telegram message (pure) and `intake.resume_for` the
  conversation reset; `button_data` is the one table of button kinds (a/c/i/w), the press a
  lookup, "registered?" once (`policy.NOT_REGISTERED`). The run record (kinds, who, the
  without-AI record, `detail`) lives in `vesta_shared.agent_records` (run_records.py gone);
  the Costs rows are pruned together; a failed resume is one row. `Problems.close_incident`
  / `close_finding` close a source and what it owes, by its state. The page's
  `text_change` checks the version and the text by kind for every write (Undo, Import
  included); `tool_access.health` answers "is this skill working". ChatJobs keeps its
  tasks; `idle()` replaces polling in tests.
  Seventh review, 0.12.80: a script's result is built with `vesta_shared.result` (message
  with its incident for the buttons, fault, resolved, snapshot, settle, siren) — outcome reads
  fields, never the wording ("#N", the siren prompt's text); "Check: …" is the one fault note.
  Every script starts from `vesta_shared.script` (arguments + Context: client with one test seam
  --fixture-dir, pack, store — never invented —, params via live_params, ONE zone rule, day,
  now). A skill's settings: `vesta_shared.skill_settings.load` (the villa.<file> on top; lists
  added after, `first` keys before); thresholds live in each skill's settings file
  (`behaviour:`; params.BEHAVIOUR_DEFAULTS gone; a missing one is named). The night's ledger
  is `Problems.record_night`; `features.integration_down` is pure. The page's `api()` always
  gives reasons (`core.reasons`, `saveWith`). The host self-test reads the SSE stream by the
  SSE rule; tests/sse_samples.py holds it and the agent's reader to the same samples.
  Eighth review, 0.12.96 (the page): the page draws the agent's verdicts, never its own copy of a rule —
  `server.undoable` (the Page changes list and Undo), `status.figures` (the Overview's figures; FAILURE_KINDS),
  `tool_access.health` `line` (the skills list), `tool_access.switch_on` (a skill's "Switch … on", POST
  api/tools/on), POST api/jobs/missing (the banner's "Add them"). The Rules form says every tool switch true/false
  (`policy_doc.to_form`; `apply_form` writes the file's own shape back: absent means on, web search in settings).
  A skill's "When the skill runs" rows come as fields in display order. Tests of these go through HTTP
  (test_page_controls), not the page's source. places.py names every place once (titles and "Tab › Card").
  Ninth review, 0.12.101 (the page): every write, check, history row and Undo is `ui/changes.PageFiles` (no
  HTTP; the server and setup_copy call it); the page server reads policy.yaml through `changes.page_policy` (a
  broken file answers with its problems, never 500); Rules is one request (`GET api/rules`), Rules (file) asks for
  the file only, and `core.go` shows a failed tab's reasons. One file editor (`viewer.fileEditor`) for Rules (file)
  and a skill's files. Names on the server: the export's parts (`setup_copy.offer`), roles (`policy.ROLE_WORDS`),
  Page changes chips (`history.CHIPS`), top tabs (`places.TABS`, filled into index.html), a tab's section order
  (`places.ORDER`, drawn by `core.inOrder`). A table's column is named, never counted (`core.table` widths may be
  {width, cls}); test_ui fails on a stylesheet class the page never uses.
  Twelfth review, 0.12.115 (the chat path): `incident_thread.IncidentThread` is what each chat shows of an incident —
  one record per incident and chat (`state.incident_message`; incmsg:/inclast: migrated), `post` / `adopt` / `close`;
  `outcome.carry_out` settles before it posts (a "Need help" escalation kept its buttons). `chat_jobs.ChatJobs` owns a
  job asked for in a chat end to end: its turn (`turn`, `replied` from `_converse`), its waiting message
  (`JobNotices`, keyed by turn), its "typing…" (one loop per chat, started after the reply) and its result
  (`routing.Origin.job`, `Delivery.on_job_result`); Delivery only sends. `KnowledgePack.device_of` is the one device
  identity of every report section. `compose.say` is the one way a sentence reaches the report page.
  Thirteenth review, 0.12.116–0.12.117 (the skills' data path): a device's NAME on every page comes from
  `KnowledgePack.device_name` (the night check's stored `features.device_key` stays its own: it is a finding's
  identity; the to-do list matches tasks by entity). "Running" is `vesta_shared.daily.running_threshold` /
  `power_days` for the night check and roi-energy (the weekly page still uses reports.yaml's run_min_w: moving it is a
  skill-file change, the owner's call); the weekly page's power steps use `stats.step_index`, as the night check does.
  "New / still open" is `Problems.since`. A report's settings come through `script.Context.params`; the currency and
  the filtration pump are no longer defaulted in code (the 07:00-18:00 window still is: its home is a skill file,
  the owner's call). Rule ids another skill reads and a finding's detail are
  in `vesta_shared.result`. The clues and the one list live in `reports/scripts/playbook.py`, not facts.py.
  Fourteenth review, 0.12.118 (one AI turn): `turn.Turns` runs every AI turn — `chat_terms` / `job_terms` decide its
  tools (by who asks: `Origin.role`, `tool_access.SYSTEM` on schedule), brain, limit and record once; the runner takes
  a `tools.Kit` and those `Terms` and chooses nothing. Each run works in its own folder (`Settings.in_folder`: a job
  and its on_limit / without_ai steps share out/runs/NAME-TIME, a chat out/chats/ID). One "running" record:
  `ChatJobs.held` registers a scheduled job where it sends. A job name two skills declare: the second is switched
  off. The tests' FakeAI acts through the run's own tools (`run_["call"]`), refused like the real guard.
- People is the one list of where the agent posts (owner, 2026-10-10, 0.12.128): a message for a role goes to every
  chat listed with it (`Policy.chats_for`; a group is a negative id, a destination and never a person). The Chats card
  is gone; an older `chats:` is still read and moved into People by the page's next save. Every message leaves through
  `outcome.carry_out` (the AI's send_message too), every approval through `Approvals.ask` (copies kept as one
  IncidentThread, settled together). Rights per chat: a private chat is the person's role, a group listed for fm is fm.
  0.12.129: a listed group's MEMBERS inherit its role (`Policy.member`, the narrower when listed for both; 0.12.134:
  listed people too, whatever their own row — their row is their private chat) — the
  intake, a press and an approval's decide ask `member`, never `person`. A copy carries every role it went to its chat
  for (`outcome._deliveries` merges them); `posting.Poster.post` is the one way a copy is put in a chat (heading,
  send, thread). An unreadable policy.yaml keeps the last good rules; the siren's stop records the siren it turned on.
- Review 19, 0.12.142 (2026-10-10): `layout.py` is a message's layout — head / lead / body / status, kept as PARTS in the
  thread's record and rendered; nothing re-cuts a sent text (`layout.legacy` reads a record from before, once). A skill
  gives the status apart (`result.message(status=)`; the alert desk's `about()` returns text + status).
  `approvals.Approvals` is an approval request start to end: ask (every chat, lead kept), press (actions.decide checks
  and executes), a moving device recorded "moving" and followed — resumed at start — to one verdict (done / failed),
  expiry settled by housekeeping, and `now()` for the AI (every waiting request, decisions of the last 2 h, by
  `decided_name`). Who acts with which role: `Policy.member` and `Policy.knows_chat` only. Mute's leftovers: an
  incident "muted" counts as ended (`Incident.ENDED`), and Store / record_night keep Mute's old calls as no-ops for a
  skill edited before.
  Review 20, 0.12.143: `posting.Poster` puts one message in one chat (heading, parts laid out to the message's limit —
  a caption's 1,024 too —, send, thread record); Outcome and Approvals are both handed it, and Outcome gets `ask` at
  construction. `approvals.STATES` is the one table of a request's states and their words (pending, approved, moving,
  done, failed, blocked — the rules refused at the press —, refused, expired, unknown); the AI is told decisions by
  their time; `expire_approval` claims once; resume ends a request left "approved" by a stop. `layout.render` drops the
  head's oldest history first and never asks for a negative room. Tests press Approve through handle_callback and wait
  with `Approvals.idle()`.
  Review 21, 0.12.144: what is RECORDED is what is SHOWN. A copy's record keeps `settled` (decided) apart from `owed`
  (Telegram did not take the edit): `IncidentThread.catch_up` retries owed copies from housekeeping. `Approvals.resume`
  ends everything decided before this process's start; `ask` with no copy ends "undelivered". `approvals.STATES` holds
  the note under a request too (`note()`); `actions.decide` returns a state. Where an owner's request goes and who may
  press it are one answer, `Policy.may_approve_in`. A chat job and a scheduled run are recorded while they run and taken
  up at start (`ChatJobs.recover`, `Scheduler._cut`); a cancelled run keeps its record. `tests/helpers.restarted` stops
  and starts a real agent on the same records.
  Review 22, 0.12.146: "is it over" is judged by the RULE's own bad states — the critical_condition / critical_watchdog
  blueprints send `bad_states` (and `mode`, `still_true` on abandoned); `device_state.out_of` is the one "is it back".
  Owed copies are retried by DURATION (`OWED_FOR`), housekeeping runs every 30 s. A state finding that comes back
  within `AGAIN_DAYS` is reopened, never new. `state.RUNNING_JOB` marks a scheduled run delivered from Delivery.send.
  Review 23, 0.12.147: a reopened finding is its own occurrence (findings.reopened_day/_at/occurrences); every reader
  goes through `Problems.open_problems` and `again_title`. An incident back within `reopen_hours` reopens (desk
  `came_back`); after Done the desk reads the device once (`quiet_after_done`, `rule_states`).
  Review 24, 0.12.148: an incident's runs are rows of their own to every reader (`store.incident_occurrences`); a
  returning problem reopens its OWN task and Kiosk fault (`Problems.reopen_task`, `ticket.reopen`); the heading's word
  comes from the notice's stage (`notice.HEAD_WORDS`). Mutation runs: `PYTHONDONTWRITEBYTECODE=1 python -B`.
  Review 25, 0.12.149: closed is not over — the desk's `still_there` after every Done and Kiosk close (reopen "still",
  or "VESTA cannot check this one"); a person's Kiosk reopening is kept (`Problems.reopened_in_kiosk`); a settled copy
  is retitled from the incident's state (`Notices.retitle`); a refused fm chat escalates at once and tells the owner.
- Review 26, 0.12.151 (with the Kiosk 2.496.323): a fault's step carries its `kind` (agent-contract.json
  `ticketUpdate`: reopened, retitled {title, was}, reading {title}; none = a status step) — neither side reads a note's
  first words (`kiosk.OLD_TITLE_NOTE` reads the old "Now: …" only). A title a person wrote stays (`person_titled`); a
  reopening is the Kiosk's "Reopen fault" step (`held_tickets` reopened_at/by); `still_there` says a silent device
  cannot be checked. Every Kiosk step records the profile (`by`) and the typed name (`who`).
- Messages, 0.12.152 (owner, 2026-10-11; reviews 27–28): `vesta_shared/message_format.py` is the ONE shape of every
  alert and report and the ONE style table (TELEGRAM) — another channel is another table; no other module names a style
  (test). An alert: `notice.heading` + `layout.render`; one incident = one picture in every chat
  (`IncidentThread.sync` after every result, buttons kept per copy). A report is titled as data (`title=`), the agent
  writes "To:" and its pages. 0.12.175 (owner, 2026-10-12, reversing the earlier "For:" choice for approvals): ONE
  layout for every message sent on its own — `layout.render` has one path, a message about no incident is headed by
  its title (approvals.TITLE, outcome.SIREN_TITLE, the engine's own; UNTITLED last) and "To:"; only an answer to the
  asker has no heading. `incident_tag` is "#N". Never reintroduce "For:" or a "-------" line.
  0.12.176 (owner, 2026-10-12: a critical alert must never depend on the agent): Home Assistant formats its own
  alerts with `agent-src/homeassistant/custom_templates/vesta_message.jinja` (the same layout in Telegram's HTML,
  included `ignore missing`) and falls back to its plain text whenever `sensor.vesta_message_layout`
  (`homeassistant/packages/vesta_message.yaml`) is not "ok" or Telegram refuses; test_ha_message_layout holds both to
  message_format. Never make a blueprint's alert wait on the agent (option C was rejected for that reason).
  0.12.179: a blueprint gives a STAGE (vm_stage new / existing / closed / help, vm_who for a press), never the status
  words or icons: the jinja writes them from message_format's STAGE_ICONS, MARK_ICONS, STAGE_WORDS and PRESSED.
- Architecture review 2026-10-13 (0.12.179): `command_request.Requests` is a command skill's request across its turns
  (web searches kept as records); `vesta_shared.periods` + `timeutil.lasting` are the investigation's kinds, words and
  durations for both skill folders. skill.yaml `modes` is retired.
  Review 2 of 2026-10-13 (0.12.180): `device_state.reading` is the one "does this device answer" ("unknown" answers
  without a value; only "unavailable" is a drop). skill.yaml `buttons` are the alert buttons — the engine passes the
  option, never the label to read back. `TurnResult.then` joins a follow-up turn (a rule per field, THEN); a reply's
  buttons are added up, never replaced.
  0.12.181 (owner, 2026-10-13): an alert says what it CLAIMS — the rules send `claim` (a template, true while what
  they reported holds) and `priority`; the desk renders the claim every tick and knows no blueprint by name. "To:" is
  ROLES only (`message_format.audience`), never a person's name. Telegram: bold titles, ONE quote block per section,
  an alert's history and status one block.
  Review 3 of 2026-10-13 (0.12.182): `message_format.pages` cuts a too-long item into pieces, never "…" (no text is
  lost); a skill keeps room for `message_format.TO_LONGEST`, never a typed "To:" length.
  Review 4 of 2026-10-13 (0.12.183): a run's scripts know whether it may search the web (VESTA_WEB_SEARCH_ON); an
  investigation page needs a search when it is on. "[n]" is dropped by `messaging.uncited` (chat message, Kiosk fault).
  The night check has no typed threshold left (reconnect_days is the logbook read AND the rule's window).
  0.12.184 (owner, 2026-10-13): a proposal is answered with /proposal accept|later|ignore N — the `proposals` starter
  skill (a command skill, like investigate), the owner only (VESTA_ASKER: a run's scripts know who asks). The owner
  REJECTED buttons in the page and a message per proposal ("bloating"): do not propose them again.
  Review 5 of 2026-10-13 (0.12.186): an open incident's records outlive records_days (State.prune open_incidents);
  `skills.when_it_runs` is the page's trigger rows; `actions.related_entities` treats no pack / an unseen id as
  unknown (the owner asked); `result.PRIORITIES`; Offline Test = VESTA_ASKER "page" (a script that writes its own
  records checks and records nothing then).
  0.12.187 (owner, 2026-10-13): `paged` reports a read cut short (`logbook_cut`); the pack keeps every entity's
  device (`entity_devices`, `device_id_of`); a finding about a DEVICE is named by its device, a measurement by its
  asset; reconnect wording reads the device's "uptime" entity; a change needs every confirm day (`rules._held`).
  OPEN, told owner: name-word heuristics (knowledge_pack *_WORDS, energy_period "main"/"phase"/"returned",
  filtration_optimiser "_pump") — owner 2026-10-13: generic words, not villa data; low priority (main meter could
  come from HA's Energy settings one day).
  0.12.188: a drop is a restart's only near Home Assistant's own "started" entry (`device_state.ha_restarts` /
  `in_restart`, `restart_settle_minutes`); the 20-entities crowd filter is gone — never reintroduce a crowd count.
- No PDF (owner, 2026-09-30): the reports are self-contained HTML pages sent
  as attachments. Chromium was ~480 MB of a 1.1 GB image for this alone.
- ⚠️ The Dockerfile's layer order is what an update costs the Yellow: agent
  code LAST, libraries built from `install_files` only (`manifest
  build-inputs`). 0.9.1 re-sent ~840 MB for a few KB of code.

## What the AI can use, and the page's controls (0.12.46)

- `vesta_agent/tool_access.py` is the one answer to "may the AI use this tool": Toolbox builds only its
  `allowed_for` set (by who asks; `SYSTEM` for a scheduled job); the page draws its switches from `catalog()`. Only
  a tool HA MCP marks `readOnlyHint` (and not destructive) can be on. A skill's `tools:` limits and stops NOTHING
  (owner, 2026-10-10: "only the user role shall control what is available, and the skill shall adjust to it"):
  `unavailable` says what a run lacks, to the AI (read_skill) and on the page ("Works without a tool").
- The page holds no token: the agent saves HA MCP's list to `<data>/ha_tools.json`; "Try a command" and "Read the
  list again" go through `vesta_agent/requests_box.py` (files the agent answers). A try is checked like the AI's
  call and never carried out.
- Every page save is a row of `vesta_agent/history.py` (`page_history.sqlite`), undoable only while the file still
  holds what the change wrote. Copying a setup: `ui/setup_copy.py` (never people, chats, devices, keys, records).

## A problem's life: one decision, one mover (architecture review, 2026-10-15, 0.12.213–0.12.215)

- `vesta_shared/problems.py` `wants_open` / `settle` / `settle_all` is the ONE answer to "should this problem's task be
  open": open while its finding (at a task severity) or incident lasts, unless a person closed it since the problem's
  latest return; a task a person reopened closes only on a person's Done; a task with no source waits for a person.
  Event sites (close_finding, close_incident, record_night, the repair) record the facts and call it — never decide.
  Do not reintroduce per-pass sweeps (close_outlived, restore_unseen, a night backfill): each had its own rule.
- `vesta_agent/outcome.py` never moves a fault about a task: a script's ticket actions or `faults_changed` run
  `tickets.repair` at once, which makes each fault what `Problems.card` says. Only a chat's fault (no task) is
  created directly.
- What the Agent reads again every few minutes is the skill's `rechecks` (skill.yaml), read by recheck.py itself and
  carried to the Kiosk as each fault's `check`; the Kiosk's card and (i) say what the fault says, never a copy.
- A duration in a fault's title is worded by the Kiosk when shown (`titlePattern` + `since`), only to a Kiosk whose
  /agent/v1/info lists the field, never on a person's title.
- Tests: one pretend villa, `tests/villa_timeline.py` (states, history with the carried-over first row, not found).

## Work in progress: one record of what runs (architecture review round 2, 2026-10-16)

- `vesta_agent/in_progress.py` `InProgress` is what runs, for whom, what it promised and whether its result arrived:
  a scheduled run, a job asked for in a chat, a question being answered, a scheduled report holding its chats
  (`held`). `kept(item)` is the ONE "cut / finally" (a stop keeps the record; an end, a failure included, clears it
  and says it ended); `arrived(origin)` is the one "its result came" (Delivery.send only); `left(kinds)` reads at start
  what a stop cut, once, each with `ON_START`'s decision for its kind (scheduled: run again in its window; a chat's
  job or question: tell the chat; arrived: nothing). The words are `Item.cut_text`. One instance (`Vesta.work`) is
  shared by Delivery, ChatJobs and the Scheduler; state.py keeps the keys (`jobrun:`, `chatjob:`), unchanged — an
  older engine's "|delivered" row reads as arrived. ChatJobs keeps the waiting message and "typing…"; the scheduler's
  task map is task control (never twice, `idle`), not a record. Superseded above: `state.RUNNING_JOB`, `job_running`,
  `jobs_cut`, `chat_job(s_cut)`.

## Rewriting a skill's instructions (retro, 2026-10-15)

Before shipping a rewritten SKILL.md, list every rule of the old version and find each in the new one: the
investigate rewrite (0.12.216) lost "the summary explains the recorded times, never repeats them" and its new example
broke it. A rule a test can check gets one (test_investigate pins the example cause and the example summary). Keep the
step numbers the scripts' messages cite (page.py: "SKILL.md step 6").

## A read of the past says how far it got (architecture review round 2, 2026-10-16)

- `HABase.history_read` / `logbook_read` hand back the rows WITH where the reading stopped, the period's end brought
  back to now (`vesta_shared.past.until`). `past.History` answers "the state at a moment" (`state_at`) and "each
  state's period" (`periods`), never past `reach`; `past.unread(what, when)` is the one sentence for the rest
  ("… could not be read whole: nothing is known after …", /investigate's). Readers: investigate (timeline, its chart,
  its normal, around), investigation_facts (cannot-tell line, a lane's last band), the night check (a pump's runs —
  a run still going at the cut is dropped, `features.ended_runs` — and the logbook note), the reports (a rule's runs,
  the state at noon), `device_state.out_for` (a read short of now is "not yet").
- ⚠️ history() / logbook() keep their plain lists and still set `history_cut` / `logbook_cut`: a starter skill edited
  on the villa is kept by updates and reads them. Do not change their returns. A client of another shape gets the
  reads from HABase over those two attributes (tests' stand-ins subclass HABase; `TimelineVilla(cut=…)` stops a read).

## The villa's electricity from its own Energy settings (architecture review round 2, 2026-10-16)

- `vesta_shared/energy_setup.py` is the Kiosk's Energy window rule (dev2 `src/config/energyModel.ts`) in Python: the
  settings' grid in / out, solar and devices with their nesting (`included_in_stat`); used = grid in + solar − grid
  out; untracked = used − the TOP-LEVEL devices (a device inside another is counted once); `overlap` when the top
  level exceeds used. tests/test_energy_setup.py replays the Kiosk oracle's cases (energy_model.mjs) with its kWh.
- Read with `HABase.energy_prefs` → ha-mcp `ha_manage_energy_prefs` mode "get". ⚠️ The tool writes in every other
  mode (set, add_device, remove_device, add_source; ha-mcp marks it destructive): `ha_client.READ_ACTIONS` is now
  {tool: (argument, read values)} — this tool keys on `mode`, ha_manage_blueprints on `action`; a writing client is
  held to it too.
- roi-energy `energy_period.py` builds on the settings (`basis: settings`, `total_from`) and falls back to the name
  guess (+ input_text.villa_main_meter) only when they give no grid or solar source or cannot be read
  (`basis: names`, `total_basis` in words). The reports' days, trend and "use while empty" read `Ctx.daily_total`
  (the same rule over `total_from`), never one meter by name. Closes the 0.12.187 OPEN note on energy_period's
  "main"/"phase"/"returned" words (they remain, as the fallback only).

## An alert card: one table of steps, a heading as facts, one set of words (architecture review, 2026-10-17)

- **One table of steps** — `vesta_shared/message_format.STEPS`: each step's history words, its title word, whether its
  bottom line says its own time, whether the Kiosk's card tells it. `result.STAGES` is its keys plus `pressed`. It
  replaced five tables (`notice.STAGES`, `HEAD_WORDS`, `TIMED_STAGES`, `NOTED_STAGES`, `result.STAGES`). A new step is
  one line. The alert desk's own `ASKING` (which notice asks for an answer) and its "FM" / "the owner" wording stay in
  the skill: skills before code.
- **A heading is facts** — `layout.head(title, to, history, word)`; `notice.Notices.heading` returns it, `layout.render`
  draws it. Nothing reads a heading back by pattern any more: `retitle` sets `word`. A heading stored as text (a record
  from 0.12.229 or earlier, or a "For: …" one) is read once by `layout.head_of`.
- **One set of words for the villa's own alerts** — the words block of
  `homeassistant/custom_templates/vesta_message.jinja` is written by `message_format.jinja_words`
  (`python -m vesta_shared.message_format`), and a test fails when it differs or a word is written by hand outside it.
  "To:" there says roles as an alert card does ("Owner & FM"), read from any of their words separated by ",". The
  template itself stays: an alert never waits on the agent. Its tests render it in an immutable sandbox, as the
  villa's system does.

## Round two: a chat reply, an incident's notes, one read guard, skills recorded by the release (architecture review, 2026-10-17)

- **What a chat turn's reply is**: `vesta_agent/turn_reply.TurnReply.compose`. Its seven rules, in order: the answer
  and its last-words fallback, a page's message is the answer, the failure in plain words, a report without the AI,
  Continue, offered faults, and silence under an approval request. app._converse runs the turn and sends the `Reply`.
  Tests: `tests/test_turn_reply.py`, one table per rule, no agent.
- **An incident's notes**: `vesta_shared/store.Notes`, `notes_of`, `Store.note(iid, set, drop, **cols)` and
  `Store.take_note(iid, key)`. The single `payload` column holds the alert's claim, the desk's working notes and
  engine→desk mail (`kiosk_reopened`, `unreached`). Every write changes only its own keys, against the record as it
  stands, inside one `BEGIN IMMEDIATE`. Nothing rewrites the whole payload any more: desk.py, problems.py, facts.py
  and investigate.py read through `notes_of`. This fixes a race: `quiet_after_done` wrote back a stale copy after
  reading the villa, so a Kiosk reopen in between lost its note. The stored format is unchanged.
- **One read guard**: `vesta_shared/read_guard.refused(name, args, known)`. It owns READ_ACTIONS, the argument
  rules, the forbidden arguments and the 6-hour villa-wide logbook (LOGBOOK_SLICE is the same constant). Both doors
  ask it: the AI's `tools._proxy` and `ha_client.McpClient.tool`. Which TOOLS a caller may use stays per door. Its
  refusal names no skill script.
- **The release records the shipped starter skills**: `tools/release.py ship` runs `record_shipped` and stages
  `shipped-skills.json` when a staged file is under `starter/skills/`.
