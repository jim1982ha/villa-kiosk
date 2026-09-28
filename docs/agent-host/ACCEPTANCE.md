# VESTA Agent host — acceptance record

Against [SPEC.md](SPEC.md) section 17, at VESTA Agent host **0.5.0** (branch
`agent-dev`, 28 September 2026). Each criterion is **met**, **skipped** (waits on
a dependency outside this work, SPEC 15, or on a check on the HA Yellow) or
**open**. Nothing skipped is reported as met.

| Area | Status | Evidence |
|---|---|---|
| Build | **met** (CI) · Yellow install: *skipped — owner* | `agent-host.yaml` publishes `vesta-agent-agent-dev-{amd64,aarch64}`; its "Pullable without credentials" step pulls each image anonymously, as the Supervisor does, before the store is updated. Supervisor reports the app `build: false`. The install on the Yellow is left to the owner. |
| Isolation | **met** | `tests/check_isolation.sh` (CI, every push): no file under `villa-kiosk/`, `villa-kiosk-dev2/`, `Dockerfile`, `rootfs/`, `src/`, `build.yaml`, `ci.yaml` changed since `agent-dev` forked from `main`. Mutation-checked. |
| Stub | **met** | Every link logs pass / fail / skipped (`test_selftest.py`, container case 1); no secret in any log, `selftest.json`, `/config` (`test_host.py`, container cases 1, 4, 5, standalone case 1). |
| Telegram | **met** | With takeover off the token is absent from the agent's environment and the fake Telegram receives no request at all; with it on, only `getMe` (`test_selftest.py` Telegram tests, `test_host.py`, container case 1). |
| Persistence | **met** for restart · update and backup/restore: *skipped — HA Yellow* | Folders survive a container restart and an edited README is kept (container case 2). `/data` and `/addon_configs/<slug>` are the Supervisor's own persistent, backed-up volumes; an update and a backup/restore on the Yellow are still to be done. |
| Live skills | **met** | A skill folder added from outside while the app runs is visible inside it at once (container case 2b). |
| Privileges | **met** | `check_manifest.py`: `homeassistant_api` and `hassio_api` false; no `ports`, `ingress`, `host_network`, `privileged`, `full_access`, `docker_api`. The sidecar listens on 127.0.0.1 only (container case 5). |
| Supervision | **met** | Restart after 5 s then 10 s, container keeps running (container case 8); crash-loop stop after 5 crashes in 10 min, backoff cap, grace kill (`test_supervise.py`); a 15 s agent shutdown completes and the app stops in 17 s (container case 7). |
| Portability | **met** against a fake villa · real remote: *skipped — PLAN section 7* | `standalone_test.sh` (CI, amd64): the shipped `docker-compose.yaml` passes the self-test with every link going through a fake Cloudflare Access, and fails correctly without the service token. The real test from outside the villa needs the Cloudflare routes. |
| Resources | **met** for image size and local RAM · Yellow RAM: *skipped — HA Yellow* | `vesta-agent/DOCS.md`: about 120 MB compressed per arch; idle stub + sidecar about 136 MiB on amd64. The Yellow measurement needs the install. |

## Self-test links waiting on dependencies (SPEC 15)

| Link | Reports today | Passes once |
|---|---|---|
| Home Assistant, HA MCP | skipped (no token) | the "VESTA Agent" HA user and token exist (PLAN B3) |
| VESTA Kiosk, Presence | skipped (no agent interface: the Kiosk answers with its web page) | VESTA Kiosk agent interface v1 exists (PLAN workstream A) |
| Anthropic | skipped (no key) | an Anthropic Console key is set |
| Telegram | skipped (takeover off) | the Telegram switch-over, at go-live only (PLAN 8) |

## Open

- **The repository's hard-rules check.** `tests/hard-rules.py` (run by the VESTA
  Kiosk's `ci.yaml` on `main` and `dev2`, not on `agent-dev`) refuses LLM
  provider and third-party hosts in all tracked files, including this app's —
  which must reach Anthropic and name Supervisor hostnames. The owner approved
  scoping those two rules to the VESTA Kiosk (villa-name rule unchanged) on
  28 September 2026; the edit was refused by the coding tool's permission guard
  and is not made. **Until it is, merging `agent-dev` into `main` turns
  `ci.yaml` red.**

## Checks on the HA Yellow (owner)

1. Install **VESTA Agent (dev)** and start it: the log shows the start summary
   and six self-test lines; nothing is built on the device.
2. Set any long-lived token in *Home Assistant token*: *Home Assistant: pass*
   and *HA MCP: pass* (confirms `homeassistant:8123` is reachable from the app).
3. Set any text in *VESTA Kiosk agent token*: *VESTA Kiosk: skipped — … (web
   page, not JSON)* confirms the Kiosk hostname is reachable (the interface
   itself does not exist yet).
4. Note the app's memory in its Info tab after a few minutes.
5. Update to a newer version, and take and restore a backup: `/addon_configs/…/skills`
   and the app data are still there.
