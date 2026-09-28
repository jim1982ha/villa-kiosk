# VESTA Agent host

Home Assistant app that will host the VESTA Agent. The specification is
`docs/agent-host/SPEC.md` in the repository.

## Current state (0.1.x)

The app installs and starts, and does nothing else yet: the agent slot is
empty, no option is read and no connection is made. Later releases add the
start-up checks, the self-test stub and the Home Assistant MCP sidecar.

## Verified facts (SPEC section 14)

Filled in as each item is confirmed against the real system or upstream
documentation.
