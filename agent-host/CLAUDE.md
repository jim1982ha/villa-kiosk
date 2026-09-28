# Working rules — VESTA Agent host (`agent-host/`)

You are building the **VESTA Agent host**: a Home Assistant app that hosts the future VESTA Agent. You are NOT building the VESTA Agent.

## Read before any change
1. `docs/agent-host/SPEC.md` — the specification you implement (source of truth).
2. `docs/agent-integration/PLAN.md` — names, foundations F1–F10, and the systems this app talks to.
3. The existing patterns to mirror: `villa-kiosk/config.yaml`, `.github/workflows/build.yaml`, `.github/workflows/ci.yaml`.

## Hard rules
- Work on branch `agent-dev`. Never commit to `main` except through the CI manifest-sync job.
- Never modify `villa-kiosk/`, `villa-kiosk-dev2/`, the root `Dockerfile`, `rootfs/`, `src/`, `build.yaml` or `ci.yaml`.
- Never build on the HA Yellow. Images come from GitHub Actions and GHCR only.
- `homeassistant_api: false`, `hassio_api: false`, no published port, no ingress.
- Never export the Telegram token or call Telegram unless `telegram_takeover` is true. Never call `getUpdates` from the host or the stub.
- Never write a secret to a log, a file under `/config`, the repository, or a CI log.
- No agent logic in the host. The host only knows the agent manifest and the environment contract.
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
