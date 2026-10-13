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
- Bump `version` in `vesta-agent/config.yaml` on every push that touches `agent-host/` or `vesta-agent/` (the paths `agent-host.yaml` builds on): the Supervisor resolves `image:<version>`, so an unchanged version is invisible to Home Assistant. `tools/release.py ship` does it; a push touching neither builds nothing and needs no bump.
- Pin GitHub Actions by commit SHA, as `build.yaml` does.
- Comments explain WHY, in the style of the existing repository.

## When unsure
- Items in SPEC section 14 ("Verify — do not assume") must be checked against the real system or upstream docs, never guessed. Record each answer in `vesta-agent/DOCS.md`.
- If the spec is ambiguous or conflicts with what you find, stop and ask. Do not change foundations or the environment contract on your own.

## Working method
- A check that cannot pass yet because a dependency does not exist (SPEC section 15) is reported as `skipped`, never faked.
- Tests: `agent-host/.venv/bin/python` (Python 3.13, gitignored; `tools/release.py` uses it off CI — how to rebuild it is at its `PY`).

## Owner rules that stand (the decision and its date are in ARCHITECTURE.md)
- SKILLS BEFORE CODE (mandatory): whatever a skill can define (sections, thresholds, wording, routes, which scripts run, which rules are alerts) lives in the skill, never in `vesta_agent/`. No threshold in code: a missing one is named, not guessed.
- Only the asker's role decides which tools the AI may use; a skill's `tools:` limits nothing, the skill adapts.
- A critical alert never depends on the agent: Home Assistant formats and sends its own (`homeassistant/custom_templates/vesta_message.jinja`, plain-text fallback). Never make a blueprint wait on the agent.
- One message layout (`vesta_shared/message_format.py`); "To:" names roles only. Never reintroduce "For:" or a "-------" line.
- In a conversation the AI only OFFERS a Kiosk fault; it never creates one unasked.
- A report's READINGS are the AI's own conclusions, marked and unchecked — do not reinstate the check on readings.
- Reports are self-contained HTML pages, never PDF. Dockerfile: agent code in the LAST layer.
- `rootfs/opt/vesta/host/agent-contract.json` is a copy of the Kiosk's; when the Kiosk changes it, copy and release — never edit one side alone.
- A restart is Home Assistant's own "started" entry; never reintroduce a crowd count.

## Where the rest is
`agent-host/ARCHITECTURE.md`: verified facts (SPEC section 14), the agreement with the Kiosk, and every architecture review's module map — which module owns which job (e.g. `outcome.py` carries out every result, `layout.py` a message's layout, `approvals.Approvals` an approval). Read the review entry for the module you touch before changing it.
