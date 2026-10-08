# Working rules — VESTA Agent host (`agent-host/`)

You are building the **VESTA Agent host**: a Home Assistant app that hosts the VESTA Agent. The agent itself (Fabien's, integrated 2026-09-30) is in `agent-src/`; its design and every decision behind it are in `docs/agent-host/INTEGRATION-PLAN.md` and `ZIP-CHANGES.md` (local).

## Read before any change
1. `docs/agent-host/SPEC.md` — the specification you implement (source of truth).
2. `docs/agent-integration/PLAN.md` — names, foundations F1–F10, and the systems this app talks to.
3. The existing patterns to mirror: `villa-kiosk/config.yaml`, `.github/workflows/build.yaml`, `.github/workflows/ci.yaml`.

## Hard rules
- Work on branch `agent-dev`. Never commit to `main` except through the CI manifest-sync job.
- Never modify `villa-kiosk/`, `villa-kiosk-dev2/`, the root `Dockerfile`, `rootfs/`, `src/`, `build.yaml` or `ci.yaml`.
- Never build on the HA Yellow. Images come from GitHub Actions and GHCR only.
- `homeassistant_api: false`, `hassio_api: false`, no published port. One way
  in (H4 amended by the owner, 2026-09-30): Home Assistant's Ingress, for the
  agent's UI only, `panel_admin: true`, port `contract.UI_PORT`. The UI runs as
  its own s6 service (`agent-ui`, the manifest's `ui`), gets `contract.ui_env`
  (folders, no secret), and accepts only the Ingress gateway 172.30.32.2.
- Never export the Telegram token or call Telegram unless `telegram_takeover` is true. Never call `getUpdates` from the host.
- Never write a secret to a log, a file under `/config`, the repository, or a CI log.
- No agent logic in the host. The host only knows the agent manifest and the environment contract.
- Nothing villa-specific in `agent-src/` either (the repository's hard rule): its villa tests and their real data live in `agent-src/tests/villa/`, gitignored, run locally only.
- Use the names from PLAN.md section 1 exactly. Never write "VESTA" alone.
- Bump `version` in `vesta-agent/config.yaml` on every push to `agent-dev`: the Supervisor resolves `image:<version>`, so an unchanged version is invisible to Home Assistant.
- Pin GitHub Actions by commit SHA, as `build.yaml` does.
- Comments explain WHY, in the style of the existing repository.

## When unsure
- Items in SPEC section 14 ("Verify — do not assume") must be checked against the real system or upstream docs, never guessed. Record each answer in `vesta-agent/DOCS.md`.
- If the spec is ambiguous or conflicts with what you find, stop and ask. Do not change foundations or the environment contract on your own.

## Working method
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
- ⚠️ SKILLS BEFORE CODE (owner, 2026-10-01, mandatory): whatever a skill can
  define (report sections, thresholds, wording, routes, which scripts the model
  may run, which rules are VESTA alerts) lives in the skill, never in
  `vesta_agent/`. No threshold in code: a missing one is named, not guessed.
- Readings (0.12.0, docs/adr/0001, glossary CONTEXT.md): a report's FIGURES are
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
- No PDF (owner, 2026-09-30): the reports are self-contained HTML pages sent
  as attachments. Chromium was ~480 MB of a 1.1 GB image for this alone.
- ⚠️ The Dockerfile's layer order is what an update costs the Yellow: agent
  code LAST, libraries built from `install_files` only (`manifest
  build-inputs`). 0.9.1 re-sent ~840 MB for a few KB of code.

## What the AI can use, and the page's controls (0.12.46)

- `vesta_agent/tool_access.py` is the one answer to "may the AI use this tool": Toolbox builds only its
  `allowed_for_person` / `allowed_for_job` set; the page draws its switches from `catalog()`. Only a tool HA MCP
  marks `readOnlyHint` (and not destructive) can be on. A skill's `tools:` bound its AI jobs; a needed tool the
  villa switched off makes the skill "not working" (`blockers`).
- The page holds no token: the agent saves HA MCP's list to `<data>/ha_tools.json`; "Try a command" and "Read the
  list again" go through `vesta_agent/requests_box.py` (files the agent answers). A try is checked like the AI's
  call and never carried out.
- Every page save is a row of `vesta_agent/history.py` (`page_history.sqlite`), undoable only while the file still
  holds what the change wrote. Copying a setup: `ui/setup_copy.py` (never people, chats, devices, keys, records).
