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
- Never export the Telegram token or call Telegram unless `telegram_takeover` is true. Never call `getUpdates` from the host or the stub.
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
reads it (version, message rules); the self-test, the stub's demo message and
`tests/fake_remote.py` all use it. `tests/test_kiosk_contract.py` fails when the
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
  the agent's records.
- No PDF (owner, 2026-09-30): the reports are self-contained HTML pages sent
  as attachments. Chromium was ~480 MB of a 1.1 GB image for this alone.
- ⚠️ The Dockerfile's layer order is what an update costs the Yellow: agent
  code LAST, libraries built from `install_files` only (`manifest
  build-inputs`). 0.9.1 re-sent ~840 MB for a few KB of code.
