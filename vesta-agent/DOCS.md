# VESTA Agent host

Home Assistant app that will host the VESTA Agent. The specification is
`docs/agent-host/SPEC.md` in the repository.

## Current state (0.2.x)

The app reads and checks its settings, prints a start-up summary, creates its
folders and then waits: the agent slot is empty and no connection is made yet.
Later releases add the self-test stub and the Home Assistant MCP sidecar.

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

Filled in as each item is confirmed against the real system or upstream
documentation.
