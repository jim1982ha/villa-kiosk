# VESTA Agent host

Home Assistant app that will host the VESTA Agent. The specification is
`docs/agent-host/SPEC.md` in the repository.

## Current state (0.3.x)

The app reads and checks its settings, prints a start-up summary, creates its
folders, runs the self-test and starts the stub. The Home Assistant MCP
sidecar comes in a later release; until then its check reports `skipped`.

## Self-test

Run at every start; one log line per link, also saved in `/data/host/selftest.json`.

| Link | Check | Skipped when |
|---|---|---|
| Home Assistant | `GET <ha_url>/api/` with the token → HTTP 200 | no `ha_token` |
| HA MCP | MCP initialize + list tools → at least one tool | sidecar not running, or no external address |
| VESTA Kiosk | `GET <kiosk_url>/agent/v1/info` → contract `1` | no `kiosk_agent_token`, or the Kiosk has no agent interface yet (404 or its web page) |
| Anthropic | list models with the key → HTTP 200 | no `anthropic_api_key` |
| Telegram | `getMe` only — never `getUpdates` | `telegram_takeover` off (no call at all) |
| Presence | `POST <kiosk_url>/agent/v1/heartbeat` → HTTP 200 | `stub_heartbeat` off, agent mode, or no agent interface |

A fresh run without restarting: `docker exec addon_<id>_vesta_agent_dev vesta-selftest`.

## Modes

- **stub** (default): starts with nothing configured. A missing key or token
  only means the matching check is skipped.
- **agent**: needs the Anthropic API key and the Home Assistant token (and the
  external MCP address in external mode); without them the app stops at once
  and its log says which setting is missing.

## Folders

| In the app | In Home Assistant | Content |
|---|---|---|
| `/config/skills` | `/addon_configs/<id>_vesta_agent[_dev]/skills` | VESTA Skills, editable, never overwritten |
| `/config/agent` | `/addon_configs/<id>_vesta_agent[_dev]/agent` | agent-owned settings |
| `/data/agent` | app data (in backups) | agent state |
| `/data/host` | app data (in backups) | start information |

## Running outside Home Assistant

The same image reads `VESTA_OPT_<OPTION>` environment variables instead of
the Configuration page, e.g. `VESTA_OPT_AGENT_MODE=stub`,
`VESTA_OPT_KIOSK_URL=https://…`.

## Verified facts (SPEC section 14)

Checked on 2026-09-28 against the running system and upstream sources.

1. **HA MCP.** The installed app is `homeassistant-ai/ha-mcp` 8.5.0 (PyPI
   `ha-mcp`, Python >=3.13,<3.15). HTTP mode: `ha-mcp-web`, configured by
   `HOMEASSISTANT_URL`, `HOMEASSISTANT_TOKEN`, `MCP_HOST`, `MCP_PORT`,
   `MCP_SECRET_PATH` (default `/mcp`), `HA_MCP_DISABLE_SETTINGS_UI`; transport
   streamable HTTP. The self-test's handshake was run against 8.5.0: pass,
   77 tools.
2. **Hostnames.** An app's hostname is its slug with `_` → `-`
   (Supervisor `apps/model.py`): `e66a2348-villa-kiosk` (confirmed live),
   `e66a2348-villa-kiosk-dev2`. Home Assistant's container is `homeassistant`.
   Reachability from this app on the HA Yellow: *still to confirm on the device.*
3. **`map` and schema.** `- type: addon_config` + `read_only: false` is the
   current form (the `addon_config:rw` string is still converted). All schema
   types used are in the Supervisor's grammar (`apps/options.py`); `timeout`
   must be 10–300 s.
4. **Base image.** `ghcr.io/home-assistant/{arch}-base-debian`; tags `latest`,
   `trixie`, `bookworm` and dated ones. This app uses `trixie` (Python 3.13).
5. **Claude Agent SDK (Python)** does not need Node.js: its per-architecture
   wheels bundle a native `claude` binary (about 240 MB unpacked).
6. **Time zone.** The Supervisor sets `TZ` in every app container
   (`docker/app.py`); the host passes it on unchanged.
