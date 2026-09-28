# VESTA Agent host

The Home Assistant app that hosts the **VESTA Agent**. Until the agent is
delivered, its slot holds a **stub** that tests every connection the agent will
use. Specification: `docs/agent-host/SPEC.md` in the repository.

The app has no web page and no port: nothing connects to it; it only connects
out (Home Assistant, the VESTA Kiosk, Anthropic, and Telegram after go-live).
It is installed by downloading a ready-made image; nothing is built on the
HA Yellow.

## Modes

- **stub** (default) — runs the self-test and the stub. Starts with nothing
  configured: a missing key or token only means the matching check is skipped.
- **agent** — runs the VESTA Agent. Needs the Anthropic API key and the Home
  Assistant token (and the external MCP address in external mode); without
  them the app stops at once and its log says which setting is missing. It
  starts the agent only once Home Assistant and Anthropic both answer,
  retrying from every 5 s up to every 5 min.

## What the log shows

A start summary (version, each connection and whether its key or token is set
— never the value), then one self-test line per connection:

| Connection | Check | Skipped when |
|---|---|---|
| Home Assistant | `GET <ha_url>/api/` with the token → HTTP 200 | no `ha_token` |
| HA MCP | MCP initialize + list tools → at least one tool | sidecar not started (no `ha_token`), or no external address |
| VESTA Kiosk | `GET <kiosk_url>/agent/v1/info` → contract `1` | no `kiosk_agent_token`, or the Kiosk has no agent interface yet (404 or its web page) |
| Anthropic | list models with the key → HTTP 200 | no `anthropic_api_key` |
| Telegram | `getMe` only — never `getUpdates` | `telegram_takeover` off (no call at all) |
| Presence | `POST <kiosk_url>/agent/v1/heartbeat` → HTTP 200 | `stub_heartbeat` off, agent mode, or no agent interface |

**Stub heartbeat — the end-to-end test.** With it on, the stub keeps the agent
online in the VESTA Kiosk (a heartbeat every minute) and, at each start, posts
one test message with the buttons *Looks good* and *Not now*. Answer it in the
Kiosk's VESTA Agent area (owner or facility manager): within about 15 seconds
this app's log shows `stub: answer received: "looks_good" pressed by owner …`.
That is the full path a real agent's question and a person's decision take.

Each line is **pass**, **fail** or **skipped** with the reason; the result is
also saved in `/data/host/selftest.json`. For a fresh run without restarting:
`docker exec addon_<id>_vesta_agent_dev vesta-selftest`.

Keys and tokens never appear in the log: any line that contains one — from the
host, the HA MCP server or the agent — has it replaced by `***`.

## Telegram

While **Telegram takeover** is off, the bot token is not given to the agent at
all and no Telegram call is made, so Home Assistant keeps receiving the bot's
messages and button presses. Turn it on only at the Telegram switch-over
(PLAN section 8).

## Folders

| In the app | In Home Assistant | Content |
|---|---|---|
| `/config/skills` | `/addon_configs/<id>_vesta_agent[_dev]/skills` | VESTA Skills — edit here; seen by the agent without a restart |
| `/config/agent` | `/addon_configs/<id>_vesta_agent[_dev]/agent` | agent-owned editable settings |
| `/data/agent` | app data | agent state |
| `/data/host` | app data | `selftest.json`, `crashes.json`, `last_start.json` |

All four are kept across restarts and updates and are included in Home
Assistant backups. The app creates them on first start and never overwrites a
file in them.

## HA MCP sidecar

- The agent's own HA MCP server, pinned to **HA MCP 8.5.0** (the same release
  as the development instance). Upgraded only deliberately, with a changelog
  entry.
- Runs only in `sidecar` mode and only when `ha_token` is set, with that token.
  Listens on `127.0.0.1:9583/mcp` — reachable only from inside the app.
- Its own update checks, and the HACS refresh they would trigger in Home
  Assistant at start-up, are switched off.
- `external` mode: no sidecar; the agent uses `ha_mcp_url` / `ha_mcp_secret`.

## Restarts and stop

- A crashed agent restarts after 5 s, doubling to 5 min; a run longer than
  10 min resets the delay. The sidecar restarts the same way.
- After 5 agent crashes within 10 min it is no longer restarted. The app keeps
  running and says so in its log; heartbeats stop, so the VESTA Kiosk shows the
  agent offline. Restarting the app tries again.
- On stop the agent receives SIGTERM and up to its `stop_grace_seconds`
  (capped at 22 s); then the sidecar stops. Everything fits in the app's 30 s.

## Running outside Home Assistant

The same image runs as a plain container; only the source of the options
changes — `VESTA_OPT_<OPTION>` environment variables instead of the
Configuration page. A ready-made setup is in `agent-host/standalone/`:

```
cp vesta-agent.env.example vesta-agent.env    # fill in; never commit it
docker compose up -d && docker compose logs -f
```

Remote deployments also set `VESTA_CF_ACCESS_CLIENT_ID` and
`VESTA_CF_ACCESS_CLIENT_SECRET` (the Cloudflare Access service token); every
request to Home Assistant, the HA MCP endpoint and the VESTA Kiosk then carries
it. Use the image for the machine's architecture (`-amd64` or `-aarch64`).

## For the VESTA Agent's developer

**The agent receives only these environment variables** (and `PATH`, `HOME` =
`/data/agent`, `LANG`) — the same names in every deployment:

| Variable | Content |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic key |
| `VESTA_HA_URL`, `VESTA_HA_TOKEN` | Home Assistant address and VESTA Agent user token |
| `VESTA_HA_MCP_URL` | sidecar `http://127.0.0.1:9583/mcp`, or the external address |
| `VESTA_HA_MCP_SECRET` | external mode only, else empty |
| `VESTA_KIOSK_URL`, `VESTA_KIOSK_TOKEN` | VESTA Kiosk agent interface and its bearer token |
| `VESTA_CF_ACCESS_CLIENT_ID`, `VESTA_CF_ACCESS_CLIENT_SECRET` | empty on the Yellow; set when remote |
| `VESTA_TELEGRAM_ENABLED` | `true` / `false` |
| `VESTA_TELEGRAM_BOT_TOKEN` | present **only** when enabled |
| `VESTA_SKILLS_DIR`, `VESTA_AGENT_CONFIG_DIR`, `VESTA_DATA_DIR` | `/config/skills`, `/config/agent`, `/data/agent` |
| `VESTA_LOG_LEVEL`, `TZ` | log level; Home Assistant's time zone |
| `VESTA_DEPLOYMENT`, `VESTA_INSTANCE` | `ha_app`/`standalone`; `dev`/`prod` |

**The agent ships `vesta-agent.yaml`** at the root of its folder
(`/opt/vesta/agent` in the image):

```yaml
name: vesta-agent
version: "x.y.z"
runtime: python            # python | node
install: "pip install --no-cache-dir -r requirements.txt"   # run at image build
start: "python -m vesta_agent"
stop_grace_seconds: 20     # at most 22
```

Rules: read configuration only from the variables above; write only under
`VESTA_DATA_DIR`; read skills from `VESTA_SKILLS_DIR` and pick up changes
without a restart; log to stdout, never a secret; stop within
`stop_grace_seconds` of SIGTERM; never contact Telegram while
`VESTA_TELEGRAM_ENABLED` is `false`. The stub in `agent-host/stub/` follows the
same rules and is a working example.

## Resources

| | Measured |
|---|---|
| Image download (compressed) | about 120 MB per architecture (0.4.0: amd64 122 MB, aarch64 120 MB) |
| Image on disk | about 380 MB |
| Idle memory, stub + HA MCP sidecar | **142 MB on the HA Yellow** (3.4 % of 4 GB), 0.5.1, 28 September 2026 — about 34 MB without the sidecar |

The real VESTA Agent will add to both: the Claude Agent SDK alone is about
100 MB compressed and 240 MB unpacked. SPEC 12 asks for at least 500 MB free
on the Yellow once the agent runs.

## Verified facts (SPEC section 14)

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
