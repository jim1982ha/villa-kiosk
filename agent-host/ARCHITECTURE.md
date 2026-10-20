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
  0.12.179: a blueprint gives a STAGE (vm_stage new / existing / closed), never the status words or icons: the jinja
  writes them from message_format's STAGE_ICONS and STAGE_WORDS (0.12.267: the press — vm_who, 'help', PRESSED — is
  no longer drawn there; an all-clear is 'closed' with no status; "To:" follows vm_priority).
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

## An alert that goes and comes back (architecture review, 2026-10-18, 0.12.239)

The villa's #52 opened, cleared and came back four times in four hours. Decided:
- **A reopening says why, like a close.** The task keeps `reopen_note` beside `close_note`; `Problems.card` returns it
  and `tickets.repair` writes it. A `ticket.reopen` action only tells the engine a fault moved; its words are not read.
- **"N times in 7 days" is the week of the alert's key**, every incident of it (`incident_runs(inc, store)`).
  Whether a return reopens the old number stays the skill's `reopen_hours` (owner, 2026-10-18: after the 4 hours, a
  new number — the same one would be inconsistent).
- **Who closed a fault is read from the Kiosk's step** (`held_tickets["cleared"]`), never inferred from times alone.

## When a device goes offline (architecture review, 2026-10-18, 0.12.241)

Timmerflotte_5969 dropped at 21:46 and stood "Unavailable" in the Cockpit for 4 h 14 min before the night check opened
its fault. Decided (owner: "implement the recommended finding", card 1 of 4):
- **One reading of "offline now"**: `nightly.offline_findings` (per device, an integration down as one) serves the
  02:00 batch and `recheck.py` every 5 minutes. The recheck opens a finding for a device with none open, closes nothing
  it did not see (that stays `back_online`, `back_online_minutes`), and sends the FM the night's own P2 message.
- **`Problems.record` is the night's ledger without its closing**: `record_night` = `record` + close what the night
  did not see. A partial reading (the recheck) records; only the whole night may close.
- **A code job finds the pack through `VESTA_PACK`** (as the store through `VESTA_STORE`): an `every_5_min` job is
  run without `inject`.
- **One problem, one fault (card 3, 0.12.242)**: a device an open alert follows for being offline (its bad states hold
  "unavailable") gets no PM-UNAVAILABLE finding (`nightly.alerted_offline`); the alert is its record. Needed once
  card 1 made both fire at the same 10 minutes. The villa's own message beside the Agent's card stays, by design.
- **One list of critical devices (card 2, 0.12.243; owner: "the list in the villa's critical devices offline")**:
  `vesta_shared.critical` reads every automation built from the agreement's `criticalDevices.blueprint`, input
  `criticalDevices.input`; the nightly pack keeps it and `KnowledgePack.is_critical` (entity or same device) is the
  ONE predicate — night check, recheck, chat status and reports. The Kiosk's proxy reads the same rule. Nothing is
  critical for what it is (no lock/motor/schedule rule, no family). A failed read keeps the last list.
- Card 4 (one meaning of "offline": "unknown" is not lost) is the Kiosk's (2.496.410); the Agent already had it.

## One owner of "what to do", one opener, the week on a new number, the page's figures (architecture review, 2026-10-19, 0.12.264)

- **"What to do" has ONE owner — the alert desk's route (rules.yaml `check`)**, and every reader gets its current
  words: Telegram reads the route live (`desk.details`); the desk CARRIES it on the incident (`store.Notes.CHECK`,
  `desk.carry_check` at an opening, a repeat, a restate, a return and every tick), as it carries the claim; the Kiosk
  fault's note and the digest's "Still open" line read `Problems.check_of`, which reads the SOURCE (an incident's
  carried check, a finding's `detail.check` the night rewrites) and the task's `check_text` only for a record from
  before. `Problems.card` carries it as `todo` (`check` there is the recheck cadence) and `tickets._converge` amends the
  fault's note (`kiosk.todo`) — only a note the agent wrote (`TODO_LABELS`); a person's note stays theirs, as their
  title does. The agreement already lets the agent change a ticket's `note` (a ticket field; the proxy forbids only
  removals and unknown top-level keys), so no contract change.
- **One opener for an alert's task**: `desk._ladder` always goes through `Problems.reopen_task` (open — reopened —
  new), with rules.yaml `raised_words` ("Raised to P2.") when a lowered priority is raised again, and
  `Problems.settle` reopens through the same method. Lowered then raised is one task and one Kiosk fault reopened.
- **A new number within the week says it**: `message_format.STEPS` "new" carries `{times}` and `notice.record` writes
  `run` for it as for "back" ("Alert sent …, 3rd time in 7 days (to: FM)"); the count stays `problems.incident_runs`.
- **The desk's durations** go through `timeutil.lasting` (the agreement's `duration.cases`), never "N min" by hand.
- **The owner's Monday lines** say the weekly page's own figures only (`facts.s_kpis`: alerts, p1, alerts_open,
  open_tasks; `compose.OWNER_FIGURES`); `compose.py owner-weekly` requires `--facts`; a figure an older facts.json
  lacks reads "n/a", never a count of the composer's own.
- Deleted: `outcome_words.clean_summary` (= `messaging.no_code`), `Kiosk.ticket_states` / `update_ticket` /
  `note_ticket` / `tag_ticket` (one-line wrappers over `amend`), `Tickets.resolve` (no caller: a `ticket.resolve` action
  only runs the repair), `tickets.kiosk_reopen_note` (callers use `kiosk_words.reopened`).

## The Telegram layer, measured: one copy per chat, "To:" from the priority, one title word, one writer (architecture review, 2026-10-19, 0.12.265)

Four leads measured with a probe on the real harness (`tests/helpers.make_agent`, the alert desk, the fake Telegram),
then fixed with the probe's scenarios as the tests. Decided:
- **One copy per chat, whatever wrote it.** The villa's own message of a step, taken over in a chat (`ha_messages`:
  its number, heading and buttons — `Outcome.adopt_ha`, `IncidentThread.adopt`), IS the desk's copy there: a desk
  message of the same (incident, chat, step) is not sent to that chat (`Outcome.carry_out`, right after adoption; the
  chat still gets this result's snapshot and counts as reached for `first_in_line`). `Routing.deliveries` keeps the
  desk's own dedupe (a chat listed for both roles). The rule sits in Outcome, not routing, because what adoption showed
  is known only once Telegram answered and routing's roles (`Notices.audiences`) are what the taken-over copy says. A
  P1 had rung the owner's group twice: the rule's message edited, then deleted for an identical one. "A failed send
  never leaves the chat empty" stays for every chat with no taken-over copy (`IncidentThread._post`: new first, then
  the older goes).
- **"To:" follows the priority, never the chat the rule posts in** (owner, 2026-10-17). Skills before code: the alert
  desk carries whom a priority reaches on the incident (`store.Notes.TO`; `desk.reaches` = people_roles' roles, else
  the priority_does word — "digest", "log"; `desk.carry_to` at an opening, a reopening, a priority change and every
  tick, as `carry_check`). The engine reads it: `Incidents.reaches` → `Notices.to_line`, the ONE "To:" of every copy
  of an incident — the roles the priority reaches, widened by every step's roles (an escalation names the owner); a
  priority nobody is sent reads "To: digest" / "To: log", and its step lines "(to: digest)" (`Notices._who`, the
  line's own `reach` record). `Notices.record` writes the roles given and `reach`, never the chat's roles, so no
  later heading reads the chat out of the history; `Notices.went_to` is the one order for a taken-over message's roles
  (this step's, the priority's, this result's, the incident's so far). The chat-role fallback remains ONLY for a message
  about no incident, and — knowingly — for an incident of an older desk that carried no `Notes.TO` (until its next
  tick writes it): a shipped villa may run the older skill.
- **The title word and "To:" are the INCIDENT's — the same in every copy; the Status lines are each chat's own**
  (#55 unchanged; the direction stated to the owner on the review page). `IncidentThread.sync` re-heads EVERY copy: a
  chat the step does not concern (`quiet`, from `Notices.concerns`) keeps its own words and lines and takes only the
  heading through `Notices.retitle`, which is now "the title word (`Notices.word`, closed ↔ existing both ways) and
  the 'To:' (`to_line`) as the incident stands now", computed in that one place; `close()` and `_head_now` use the
  same. Measured: Done by the FM, the fault reopened in the Cockpit, the tick's reopen request to the FM — the owner's
  group kept "(closed)" over "Done on … (Wayan)." while the FM's copy read "(existing)". Two older tests pinned the
  opposite ("a step to the FM leaves the group's copy untouched"); they now pin the direction: the group's own Status
  lines untouched, its word and "To:" the incident's.
- **One writer of "<what> on <when> (<who>)"**: `message_format.acted` writes `PRESSED`, the approvals' three notes
  (`approvals.STATES`, each state's tail kept) and the desk's "Noted on … (who): label". A mutation of `acted` goes red
  in the villa's template test, the approvals' pinned notes and the desk's.

## Round two seams: a close by the agreement, a refusal that stops nothing, a reopening told by its skill, one "ran" (architecture review, 2026-10-19, 0.12.265)

- **How a fault was closed is the agreement's rule, read from the file**: `vesta_shared/agreement.py` loads the host's
  `agent-contract.json` once (`/opt/vesta/host/`, else the checkout's `rootfs/opt/vesta/host/` — the tests' copy) and
  `kiosk.status_changes` / `last_close` / `cleared_step` read `ticketUpdate` (notStatusChanges, clearedNotes,
  clearedNotePrefixes) exactly as the Kiosk's fmEngine.lastResolution and the proxy's _fm_last_resolution do: the last
  STATUS CHANGE in time order, an unreadable time first, a kindless close by its note. `fault_of` keeps its interface
  (`cleared` is None when no step closed it; `by` is the close's person on a closed fault). No list of the agreement is
  typed in the engine; tests/test_contract_ticket.py replays all 16 `histories`.
- **`KioskError` says whether the Kiosk refused or was not reached** (`status`, `said`, `refused`): the repair's two
  loops (`tickets._repair` creating, `_converge` amending) log the Kiosk's sentence and go on to the next fault; only
  an unreached Kiosk (status None: connection refused, a timeout) ends the round. tools.py quotes the sentence to the
  chat. The stand-in's `FakeKiosk.refuses(tid, status, sentence)` plays the proxy's no.
- **A person's reopening is a mark the engine sets and a skill clears**: `store.reopen_task(at=…)` keeps the Kiosk's
  own time, `reopen_told_at` NULL = untold (`untold_reopenings`, `reopening_told`; migrated: rows from before are told).
  `Problems.reopened_in_kiosk` marks an alert's told when it mails the desk; a night fault's waits for the
  preventive-maintenance recheck (`reopened_untold`), whose recipient role and title are its settings.yaml
  `reopened_in_kiosk`, the body `kiosk_words.reopened`. The engine sends nothing of its own (no `tell_fm`, no title in
  vesta_agent/); with an older recheck.py the task stays marked.
- **"An automation ran" is one reading**: `vesta_shared.past.automation_run(row) -> Run(at, started_by, is_system)`
  (only a "triggered…" row; `system_run` names a reload or a start from the logbook's shape: `SYSTEM_RELOAD`,
  `SYSTEM_START`). The reports' facts apply the skill's `not_an_alert_when_started_by` to `started_by`; the
  investigation keeps runs only in `automations` and carries a reload or a start as `system_runs` with the skill's
  sentence (investigate settings.yaml `words`) — one line on the answer, one "usual" row on the page.

## Scan 4 seams: one verdict per fact, one sentence per outcome, places named once (architecture review, 2026-10-19, 0.12.266)

- **`tool_access.health` is THE verdict on a skill's tools** — `{ok, problem, line, without, tools, where_tools}`.
  `line` is what the skills list shows under the description and the skill page's "Skill tools" heading says (None
  when every tool is on: nothing to say); `tools` the rows `{tool, label, state, words, on}` (`STATE_WORDS`);
  `where_tools` the sentence behind the tab's (i), in the owner's rule of 2026-10-10 (a tool switched off is gone
  without, the skill runs). The page (`skills.js`) draws them and computes nothing: it counted "N of M not available"
  itself over a missing or never-readable tool, which `without` leaves out, and its own (i) still said a switched-off
  tool made the skill "not working". `setup_copy` judges a tool by `tool_state` (one reading) and says "the villa's
  system"; `test_no_platform_name` reads it too. Tests: test_tool_access (the object), test_page_controls (the page's
  heading equals health's `line` through HTTP; no verdict words in the page's source).
- **A job whose AI sent nothing is its own outcome**: `AiJobs.run` owns "did this job deliver" — a run neither failed
  nor sent (`TurnResult.sent` plus its on_limit steps' `Done.sent` = 0) is recorded as `agent_records.JOB_NO_RESULT`
  `{job, why}`, counted as a failure (`status.figures`), shown on the Costs tab beside the run (`no_result`, no cost),
  and told ONCE with `api_errors.NOT_COME(NO_RESULT)` sent through Outcome as the job's result (so JobNotices deletes
  the waiting message like any result; on schedule it goes to the job's `to`). "Its work stopped with an error" (the
  waiting message edited) remains only for a task that died. job_notices stays pure. The tests' FakeAI must send
  through the run's own tools (`run_["call"]`): a tool built apart does not count as the run's `sent`.
- **"Scheduled jobs run" says what the run did**: `InProgress.kept` — the one cut/finally — writes `jobend:<key>`
  `{outcome: ended | failed | cut, at, why, slot}` for a SCHEDULED item (state.keep_run_end / run_ends); a body that
  knows better than "it raised" says so with `InProgress.verdict(outcome, why)` on the run this task works for
  (AiJobs.run: the model could not run, made without the AI, sent nothing, not set up; app.run_code_job: a script
  that stopped). `status.jobs_run` reads the end row for the claimed slot, RUNNING while the `jobrun:` row stands,
  and the claim alone (`job:`, unchanged: scheduler.py's warning holds) for an older row — `words` ("done", "not
  prepared (why)", "stopped by a restart", "running", "run") is what overview.js draws. Tests: test_in_progress (each
  end), test_scheduler_runner_stop (a cut run reads "cut"), test_page_controls (the Overview row through HTTP).
- **One sentence for "the report you asked for did not come"**: `api_errors.NOT_COME(name, cause, asked, when)` —
  CHAT ("…you asked for could not be prepared: cause. Ask again in a moment."), SCHEDULE ("…It will run again at its
  next time." — only on schedule: a job asked for in a chat read it too), CUT (at `when`, after a restart), NO_RESULT.
  `for_job(name, problem, origin)`, `chat_jobs._carry`, `Item.cut_text`, `start_without_ai`'s failure all call it;
  the noun is "report" wherever a person reads it ("There is no … report that can be started from a chat", not_set).
- **The Overview's figures mean what their labels say**: `status.figures(records, cost)` reads each run as
  `status.costs` does — `agent_records.job_of(who)` (reply or report), `problem` (a failure): "replies written" =
  chat runs without a problem, "reports made" (new) = job runs without one plus a report made without the AI,
  "failures" = FAILURE_KINDS (JOB_NO_RESULT among them) plus runs with a problem. "Per run" and "Busiest day" come from
  `status.costs` (`per_run`, `busiest`); costs.js draws them.
- **One table of causes**: `api_errors.CAUSES = {kind: (cause, what_to_do, owner_fix)}`; `FOR_PERSON[kind]` =
  "I cannot answer right now: {cause}. {what_to_do}", `why_job` = cause, `NEEDS_THE_OWNER` built from `owner_fix`
  (CREDIT, KEY). The Costs tab's (!) gets `cause` and `what_to_do`, never the first-person sentence (`error_words`
  gone).
- **Every sentence naming a place goes through `places`**: `where(key)` as before, `places.tab(key)` for a whole tab
  ("VESTA Agent page › Skills"); `not_set` points at `where("ai")` (the card "AI brains and limits" — "AI jobs" no
  longer exists); the start_job refusal is `tool_access.start_job_off(who)` — one sentence, "you" to the presser
  (app._press_report), "this person" to the AI (tools.py). tests/test_places_named.py greps the tracked engine for
  "page →" / "page ›" outside places.py.
- **"Already being made" said once, truthfully**: `ChatJobs.start` answers `Started(kind: NEW | JUST_STARTED |
  RUNNING_SINCE, since, by: ASKED | SCHEDULED)` (`chat_jobs.JUST_STARTED_S`; `started_at` gone); `ai_jobs.being_made`
  words it once for both audiences — "scheduled at 19/10/2026 08:00" when a run nobody asked for holds the chat —
  the time through `notice.when`. Superseded: ai_jobs.JUST_STARTED_S, ChatJobs.started_at, the page's WHERE_TOOLS,
  status._error_words, the `needs` field of the skill page (`tools`).

## Round three, the shared leads: one clock, one number, the agreement read, one "{time}", one "offline now" (architecture review, 2026-10-19, 0.12.266)

- **One clock on an investigation**: `timeutil.clock(t, zone, *, days, seconds=False)` — "03:09", "9 Oct, 03:09" when
  the period spans several days, the seconds kept ONLY on the lines the AI reads (investigate.py `at`: a 71-second
  drop, a run of 8 s); the page's log (`investigation_facts._Clock`), its charts (page.py's three label lambdas) and
  SKILL.md's example for the AI's own rows all read it. `timeutil.said(value, zone, weekday=, day=)` is the one reader
  of a stored ISO day or moment on a report page (playbook `_fill`, compose `day()` / `when()`); facts.json keeps ISO.
  `month_label`, `day_label(short=True)` replace the last two strftime calls (test_one_day_format forbids "%d").
- **One number rule**: `vesta_shared.page.number(v, unit=None, *, whole=False)` — compose.num, the charts' `_nice`
  (an alias) and roi-energy's headline. Decided: one decimal from 10 on (the composer's "12.3"), two under 10 (the
  charts' "0.15"), whole from 100 on and for a tile. A chart tip reads "12.5 kWh" where it read "12".
- **The agreement's words are read from the file, never typed**: `kiosk.KINDS`, `kiosk.AGENT_BY`, `kiosk.taken_step`
  (`ticket.takenStep`: status, kind null, `byNot` the stamp), `problems.agreed(field, word)` (`ticket.origins`,
  `ticket.checks` — an undeclared word is not written). The mapping source → origin word (incident → "alert",
  finding → "night") is the engine's: which word a source means is not in the file. `OLD_TITLE_NOTE` stays a literal
  beside its twin's name (the Kiosk's faultNotes.ts): the agreement has no key, and that file is the Kiosk's to change.
  An unreadable agreement is said once in the log; the engine does not fall back to a typed copy.
- **"{time}" has one filler**: `layout.fill_time(text, now, zone)` (timeutil.moment_label); Poster.post, the thread's
  close and restate, and Outcome.adopt_ha call it. The pending request's words are `approvals.STATES["pending"]`
  (`note("pending", who=, minutes=)`); actions.request reads them. `messaging.SIREN_TITLE` ("Siren") is the one title
  of every message about the siren: outcome reads it; app.py's `_tell_owner_siren` literal "Siren" is to be replaced
  by the constant (the other implementer's file in this round).
- **"Devices offline now" is one reading**: `vesta_shared.offline.devices_offline(pack, states, now, families, *,
  min_minutes=0, alerted=frozenset(), integration_min=None) -> list[Group]` — one walk, grouped by `pack.device_key`,
  named by `device_label` else the asset else the entity, `since` the earliest `last_changed`, `hours` at `now`,
  `critical` by `pack.is_critical`, a device the villa's system knows nothing about dropped once; `merged_integrations`
  is the merge features.py had. Callers: `nightly.offline_findings` (its settings: `unavailable_minutes` as the
  minimum, `integration_down_devices`; its words, `integration_name`; `alerted_offline`), `facts.Ctx.offline` and
  `concierge.status` (no minimum: every one). No threshold in vesta_shared. The three family lists (reports.yaml
  `offline_families`, nightly `WATCHED_FAMILIES`, concierge `FAMILIES`) stay in their skills and DIFFER today
  (reports: + battery, network; night: + water, generation); test_offline holds them side by side until the owner
  decides whether to make them one.

## The night check owns each number asked twice (owner, 2026-10-19, 0.12.267)

- **A pump's "Watch" and a battery's "replace / watch" are the night check's.** The weekly page's equipment card is
  "Watch" exactly when the one list (playbook.todo: clues + Problems.open_problems) names its reading; a battery row's
  level is `facts.night_battery_says`: "replace" from an open PM-BATTERY-CRIT / LOW problem (open_problems, so a fault a
  person closed is not shown), "watch" from an open PM-BATTERY-TREND finding read from the store (INFO: never a task,
  never on the list). The page's own thresholds and the power_step / battery_trend clues are gone.
- **`vesta_shared/battery.py`** owns a battery's charge (`charge`; device_state.battery_charge is a re-export for a
  villa-edited skill), its projection (`projection(points, floor_pct, level)`, the floor the caller's setting) and the
  rule ids the reports read (CRIT, LOW, TREND, REPLACE) — kept out of result.py on purpose (one owner per subject).
- **A retired setting is named**: a skill file's `retired: {dotted.path: what decides it now}`;
  `skill_settings.retired` gives one sentence per key a villa.<file> still sets. Callers: facts (the report's problems),
  investigate main (`settings_not_used` + stderr). reports.yaml `retired_kinds` does the same for a playbook `when` kind.
- **One "running" for /investigate**: `daily.threshold_from_readings` = `running_threshold` over `hour_rows_of(raw
  readings)` (per hour: max, plain mean of the readings — not time-weighted). investigate keeps only its flat_spread
  check (hi = the highest reading, which the old 99.9th percentile already was below 1 000 readings). The share lives in
  four skill files (preventive-maintenance, roi-energy, reports, investigate), held equal by test_skill_settings.
- **Charts by time are vesta_shared.page's**: timechart, hourchart, strip (colours and words as parameters); a skill
  binds its own (investigate page.py: band_of, LANE_STYLE via lane_colour). No starter script uses a `_` name of
  vesta_shared (AST test). `legend` and `pill` are macros of vesta_shared/templates/page_parts.html — a separate file
  because an `{% include %}` does not share its macros.

## The villa's own alerts: "To:" by the desk's table, one closing wording, no press (owner, 2026-10-19, 0.12.267)

- **"To:" by priority is the alert desk's table, also on the villa side**: `message_format.priority_to(rules)` reads
  the desk's released rules.yaml (`people_roles`, `priority_does`: `ALERT_DESK_RULES`) as data and `jinja_words` writes
  it into the template (`vm_priority_to`). A blueprint passes `vm_priority` (only when its "Who the message is for"
  follows the agent) and `vm_to` ('' then); the template says the priority's words, else `vm_to`, else the villa-wide
  helper. test_ha_message_layout holds every priority to `desk.reaches`. The villa's own copy of rules.yaml
  (villa.rules.yaml) is NOT read: the template is a released file, copied by hand.
- **One closing wording**: `message_format.closing(tail)` is STAGE_WORDS["closed"] and every desk end; the template fills
  "{time}" with `timeutil.MOMENT_FORMAT`; `stage_words(word, time="")` is the agent's fallback ("Cleared.", never a
  "{time}" shown). A blueprint's all-clear gives `vm_stage: closed` and no status; a duration it knows is its text.
- **The template draws no press**: vm_who, 'help', the button labels and the strftime are gone with the villa's task
  rule (vesta_task_actions), which no enabled rule feeds since 2026-08-25.
- **How the template reaches a villa**: by hand — the Agent has no access to /config (`homeassistant_api: false`).
  Copy `agent-src/homeassistant/custom_templates/vesta_message.jinja` to /config/custom_templates/, run
  `homeassistant.reload_custom_templates`, and only then save blueprints that pass `vm_priority`: with the old
  template a rule following the agent says the villa-wide "To:".

## One rule for a close, actions that carry what is read, one Kiosk door, the Kiosk's window (architecture review, 2026-10-19, 0.12.267)

Owner: "proceed with the recommended implementation", four cards.
- **A person's close holds until the source is read again, still bad** — for an alert and a night fault alike. The
  alert keeps its path (`desk.quiet_after_done` reads the device after `clear_minutes` and reopens the incident;
  settle follows). A finding: every reading RECORDS the fact — `store.finding_seen` (findings `seen_at`,
  `settle_minutes`) through `Problems.record` (the night; the recheck's new findings, `at`=its now) and
  `Problems.seen` (recheck.py's reading of a device whose finding is open — it skipped those) — and
  `Problems.wants_open` decides: `still_there_after_close` (read `settle_minutes` or more after the person's close)
  opens it again, `reopen_note` = `problems.STILL_THERE` ("Still there after the close.", the desk's words). The settle
  time travels on the finding, as the desk carries its check on the incident, so the engine's repair (settle_all)
  decides the same without reading a skill. Skills before code: preventive-maintenance settings.yaml
  `still_there_after_close` {minutes (10, the desk's clear_minutes), tell, title, words}; none in code — missing, it is
  named on stderr and the close holds. The FM is told by `recheck.still_there_untold` (store.untold_findings_reopened:
  a finding's task reopened with STILL_THERE, untold — whoever reopened it: the recheck, the night, the repair).
- **A task's fault action carries nothing to read**: `result.faults_changed()`; `Problems.settle` / `settle_all` →
  task ids, `record` `task_ids` / `record_night` `resolved` → ids, `close_incident` / `close_finding` → `result.moved`
  (a script's `actions`). `result.fault` is a chat's fault only. `outcome.carry_out` still reads ticket{task_id},
  ticket.resolve, ticket.reopen and a bare task id as faults_changed — a starter skill edited on a villa sends them;
  `result.reopened` / `resolved` / `fault(task_id=)` stay for it (test_outcome: no starter skill builds one). The new
  ids are `record`'s `task_ids` and `record_night`'s `resolved`; `tasks` (a new task's dict, with its words),
  `reopen_actions` and `resolve_actions` stay, built from the ids, kept for a skill edited before 0.12.267 (its
  nightly.py / recheck.py unpack them — test_problem_close runs the old lines).
- **The Kiosk-version gate is `Kiosk._gated`**, inside add_ticket, amend, reopen_ticket, resolve_ticket: an unlisted
  kind is written without `kind`, or dropped when it is in `notStatusChanges` (it would read as a status change); an
  unlisted declared field (`ticket.fields`) is not written (a person's value stays). An info listing nothing → the
  agreement's `ticketUpdate.kindsBeforeList` / `ticket.fieldsBeforeList` (new keys; the Kiosk's sets just before it
  listed them, 2.496.356 / 2.496.382). takes/says are gone; `Kiosk.refresh` re-reads the info while it lists no kinds
  (the repair calls it). ⚠️ The agreement file changed on the Agent's side first: the Kiosk gets the identical JSON
  before release.
- **The heartbeat's interval is the Kiosk's**: `kiosk.beat_every(answer, current)` — a third of
  `offline_after_minutes`, floor `BEAT_FLOOR_S` (30), `BEAT_BEFORE_ANSWER_S` (120) until the first answer; a
  `"cadence": "refused: …"` answer is logged once (the beat counted).

## Every open fault read again every 5 minutes (owner, 2026-10-20, 0.12.293)

Owner: "simplify: remove the split, check every 5 min for all the reported issues — keep it as simple as possible, no
useless exceptions"; "I am worried how I will judge what is a daily-check fault versus what is not". Supersedes the day
recheck below (its times, `day_rechecks`, `kiosk: day_check`, `dayChecksAt`, the card's "day" are gone).
- **One reading per rule, every rule**: `recheck.READS` maps every rule of `nightly.STATE_RULES | EVENT_RULES` but
  PM-UNAVAILABLE (back_online's) to the night's own function over one finding's rows — battery_findings,
  silent_findings, reconnect_findings, hidden_in_rule_findings, and `nightly.asset_findings` / `level_findings`
  (extracted from run(), so the night and the tick share them). `unreadable()` non-empty stops the tick (Overview says
  which). skill.yaml `rechecks: all` → `Skill.rechecks == ["*"]` → `Problems.card` says "minutes" for every finding.
- **A rule judged on a finished day is read over the last finished day**, settled `recheck.day_settle_minutes` (15)
  after midnight — never "today so far". Its verdict is cached per finding and day (`pm-dayread:<id>:<day>`), worked
  out again only when that day changes: a pump fault cannot close mid-day, and closes on the first tick after a clean
  day.
- **The reconnect loops' logbook is kept between ticks** (`recheck.loopbook`, cache `pm-loopbook`): the villa's 72-hour
  read was 9 s / 14,838 rows (2026-10-20). Kept: the restarts and every row of an entity that went offline (all a count
  reads); each tick reads [kept end, now) only; a cut read is kept as far as it reached. Same count as a whole read
  (test_recheck_all).
- The agreement dropped "day" and `dayChecksAt` (Kiosk 2.496.452, copied in 0.12.295). `ticket.checks` ==
  `checksBeforeList` (minutes, nightly): every Kiosk reads both, so `Kiosk.checks()` and `_gated`'s check-word gate
  went too (test_contract_ticket pins that every word the card says is in `checksBeforeList`).

## The night's open faults read again in the day (owner, 2026-10-19, 0.12.268) — superseded 0.12.293

Owner: "refresh the open ones every 4 hours during the days … just re-check the identified ones".
- **A partial reading records; the night OR a day recheck of the very findings it read may close them.** Amends
  0.12.241's "only the whole night may close": `Problems.record_rechecked(rechecked, seen, day, at, note=,
  settle_minutes=)`, beside record / record_night, records each finding read as seen (`Problems.seen`) or closes it
  and settles — only among the ids it was given. A reading that does not name what it judged (the 5-minute recheck's
  new offline findings: `record`) still closes nothing. settle() decides every task as before (a person's close, its
  still-there reopening, a person's reopening, AGAIN_DAYS: a day close seen again by the night is "again").
- **Skills before code**: the times are the preventive-maintenance schedule entries marked `kiosk: day_check` (one per
  time, the schedule's idiom — not a copy in settings.yaml, which the scheduler and the cadence would not read); the
  rules are skill.yaml `day_rechecks`; the close's words are nightly.CLEARED / `cleared_note` (one wording, with the
  time). The engine only carries them: `Skill.day_checks_at` → the heartbeat's `dayChecksAt`, `Skill.day_checked`
  (empty without a day_check job) → `Problems.card`.
- **One implementation per rule**: `recheck.DAY_READS` runs the night's `nightly.battery_findings` /
  `nightly.silent_findings` over one finding's rows. Read in the day: PM-BATTERY-CRIT, PM-BATTERY-LOW, PM-SILENT.
  Nightly: PM-POWER-CHANGE, PM-ENERGY-CHANGE, PM-RUNHOURS, PM-LEVEL-HIGH (judged on a finished day: at 12:00 it is half
  there), PM-RECONNECT-LOOP (needs the villa-wide logbook, where the villa system's own restarts are). Not read back is
  not gone: a missing state or a battery with no value closes nothing.
- **"day" only to a Kiosk that shows it**: `Kiosk.checks()` (info `ticket_checks`, else the agreement's
  `ticket.checksBeforeList`) is passed to `Problems.card`, which says "day" only when listed, else "nightly" (true too);
  `Kiosk._gated` writes no check word the Kiosk does not list. A device with an alert's fault ("minutes") and a night
  fault ("day") has two faults; the Kiosk card shows the soonest.

## A run's own cost, and the skills it used (owner, 2026-10-19, 0.12.269)

Owner's screenshot: one chat's Haiku replies of about 48k tokens on the Costs tab at 0.44, 0.50, 0.52 … 0.56 USD,
climbing reply after reply.
- **Measured, not supposed**: `ResultMessage.total_cost_usd` is the CONVERSATION's running total. The bundled CLI
  (2.1.284) writes a "cost-state" entry into a conversation's transcript and, on resume, restores it (`Cae` → the
  cost tracker), so `total_cost_usd` (`Tg()`) carries every earlier reply — across a restart of the agent too, the
  transcript being under CLAUDE_CONFIG_DIR. The CLI's own budget check subtracts it: "spent" = `Tg() −
  costLedger.restoredCostUSD()`, so `max_budget_usd` was always per run. `usage` is this run's (the screenshot's tokens
  go up and down). Arithmetic: a 47.3k-token Haiku reply costs at most ~0.06 USD even all written to the cache; the
  recorded steps (0.50 → 0.52 → 0.54 → 0.55 → 0.56) are each reply's real cost.
- **One rule, in agent_records**: a run record keeps `session` and `session_total_usd` (the SDK's total);
  `session_before(rows, resume, who)` is the latest recorded total of the resumed conversation (`State.runs_of`: by
  session or by chat, newest first) — a Continue pressed by someone else finds it by session; a record before 0.6.260
  (no `session`, its `cost_usd` the CLI's total) is the base the first time an older conversation is resumed;
  `turn_cost(total, before)` = the difference, or the whole total when it is below (the CLI found no cost-state and
  counted afresh). A run cut by a stop records no total: what it spent, if the CLI kept it, lands in the next reply.
- Past rows are left as they are: they carry no conversation id, so which earlier reply each total included is not
  certain (a conversation also resets by itself). Scheduled jobs (never resumed) and each conversation's first reply
  were right; every later reply of a conversation showed the conversation so far.
- **Skills**: `runner.skills_of(terms.skill, collected)` — `Terms.skill` is the skill a run was started for (an AI job's
  declaring skill via `Turns.job(..., skill)`; a command's via `chat_terms(..., skill)`), then each `read_skill` /
  `run_skill_script` `skill` argument the AI passed, in order, once each — recorded as RUN/RUN_CUT `skills`;
  `status.costs` serves `skills` (empty for older rows); `costs.js usedSkills` draws chips, "—" for none.

## A command a reply suggests, as a button (owner, 2026-10-19, 0.12.271)

Owner's screenshot: asked about the pool pump in a private chat, the reply ended "write /investigate followed by your
question about the pool pump history…" — he wanted a button that starts it.
- **Which skill**: the skill says it, skill.yaml `offer: {label, pressed?}` (only with `command:`; investigate has it,
  proposals does not — it needs a number). The engine names no skill.
- **One owner, start to end**: `command_offers.CommandOffers` — `rows` (turn_reply rule 7, buttons added to the
  others) and `press` (button_data.COMMAND `o:<id>`). The question is the PERSON'S (`asked`), kept in State
  `command_offer:` (RECORDS); the data carries only the id (Telegram's 64 bytes).
- **Who may, one rule**: the button IS "/<command> <question>" typed in that chat (`command_offers.typed`, the event
  Home Assistant fires), judged by `app.Vesta.gate` — intake.gate with the villa's rules, the method handle_message
  uses — for the asker at the reply and for the presser at the press. No second copy of "who may run a command skill".
  Today that is anyone the villa knows in a chat it lists, with the skill switched on; a rule added to intake.gate
  reaches the button by itself.
- **The press**: read, judged, claimed once (`State.claim_command_offer`; nothing awaited between the read and the
  claim), said under the message (`Delivery.settle`, shared with FaultOffers; the pressed button goes, the others stay
  from the message's reply_markup), then `handle_message` runs the typed command — so the request, its brain, limit,
  page and fault offer are the typed one's (test: the run's skill, tools, limit, brain and prompt equal typing it).
- No button under the same skill's own request, nor without a question (a Continue, a photo with no words).
- Mutations red (tests/test_command_offer.py, test_turn_reply.py, test_page_controls.py): no question allowed; `offer`
  ignored; the same-request skip removed; the gate skipped at the reply, and at the press; the gate loosened to "not
  dropped", or to always; the claim not checked (press) and its used/chat check, its write; the answer kept instead of
  the question; every button removed on the press; the rows replacing the others (turn_reply); the press routed to the
  fault handler; another question run; the skill.yaml checks (no command, unknown key, no label); the page's row.
