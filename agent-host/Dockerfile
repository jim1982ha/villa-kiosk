# VESTA Agent host image. Specification: docs/agent-host/SPEC.md (4.4, 9).
#
# CI passes the per-arch Debian base via BUILD_FROM; the default keeps a plain
# `docker build agent-host` working for local testing.
#
# ⚠️ DEBIAN, NOT ALPINE: the Claude Agent SDK's bundled CLI is a glibc binary.
# ⚠️ `trixie`, NOT `latest` (owner, 2026-09-28). Both float and both pick up the
# HA base image's security patches; `latest` would also move to the next Debian
# release on its own, and with it the system Python — the HA MCP server
# requires Python >=3.13,<3.15 (trixie ships 3.13).
#
# ⚠️ THE VERSIONS ARE NOT WRITTEN HERE. HA_MCP_VERSION and the VESTA Agent's
# source come from agent-host/versions.json, which CI reads and the hourly
# update check (tools/check_updates.py) moves forward; there are no defaults
# below, so an image can never be built from a stale number by accident. A
# local build passes them: --build-arg HA_MCP_VERSION=$(jq -r .ha_mcp agent-host/versions.json)
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:trixie
# Node.js 24 LTS, copied from the official image. Debian trixie packages Node
# 20, which reached end of life in April 2026.
ARG NODE_FROM=node:24-trixie-slim

# Resolved for the TARGET platform (no --platform pin): the node binary is
# copied into the final image, so it must match its architecture.
FROM ${NODE_FROM} AS node

# ---- the HA MCP sidecar (SPEC 12) -------------------------------------------
# ⚠️ EXACTLY ONE RELEASE PER IMAGE, MOVED FORWARD AUTOMATICALLY. The version is
# versions.json's; the update check raises it when PyPI has a newer stable
# release, and every image then starts the sidecar and lists its tools in
# container_test.sh BEFORE it can be published — a past `mcp` SDK release
# broke mcp-proxy without warning (PLAN B4), and that test is what stops such
# a release reaching the Yellow. Built on the same base as the final image so
# the venv's Python is the one that runs it. `--only-binary`: a dependency that
# would need a compiler fails the build here instead of pulling a toolchain
# into the image (SPEC 4.4).
FROM ${BUILD_FROM} AS ha-mcp
ARG HA_MCP_VERSION
RUN test -n "${HA_MCP_VERSION}" || { echo "HA_MCP_VERSION is required (agent-host/versions.json)"; exit 1; } \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/vesta/ha-mcp \
 && /opt/vesta/ha-mcp/bin/pip install --no-cache-dir --only-binary=:all: "ha-mcp==${HA_MCP_VERSION}" \
 && /opt/vesta/ha-mcp/bin/python -c "import ha_mcp" \
 && find /opt/vesta/ha-mcp -name __pycache__ -prune -exec rm -rf {} +

# ---- the VESTA Agent (SPEC 8) ----------------------------------------------
# CI checks the agent's repository out into agent-src/ at the release named in
# versions.json (empty: only the README, and the image carries the stub alone).
# Its manifest's `install` runs HERE, in a virtualenv inside its folder, on the
# same base as the final image — so anything it builds is built once, in CI,
# and nothing is installed on the Yellow. The slot puts that virtualenv first
# on the agent's PATH (vesta-agent-slot).
FROM ${BUILD_FROM} AS agent
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-yaml ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY agent-src /opt/vesta/agent
# The manifest is read by vesta_host.manifest, here as in the slot.
COPY rootfs/opt/vesta/host /opt/vesta/host
RUN set -e; cd /opt/vesta/agent; rm -f README.md; \
    if [ -f vesta-agent.yaml ]; then \
      python3 -m venv .venv; \
      install=$(PYTHONPATH=/opt/vesta/host python3 -m vesta_host.manifest install vesta-agent.yaml); \
      if [ -n "$install" ]; then PATH="/opt/vesta/agent/.venv/bin:$PATH" sh -c "$install"; fi; \
      find . -name __pycache__ -prune -exec rm -rf {} +; \
    fi

FROM ${BUILD_FROM}

# python3: runs the host, the stub, and the virtualenvs the two stages above
# built (the VESTA Agent's in its own folder, the HA MCP sidecar's). python3-yaml: the host reads the
# agent manifest (the host itself uses nothing else outside the standard
# library). No compilers here — anything that needs one is built in a separate
# stage (SPEC 4.4).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-yaml ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version && python3 --version

COPY --from=ha-mcp /opt/vesta/ha-mcp /opt/vesta/ha-mcp
COPY --from=agent /opt/vesta/agent /opt/vesta/agent

COPY rootfs /
# The self-test stub fills the slot in stub mode. The VESTA Agent is in
# /opt/vesta/agent (the stage above); the stub stays beside it, so switching
# agent_mode never needs a different image.
COPY stub /opt/vesta/stub
# ⚠️ THE SHAPE, NOT A LIST OF PATHS — as in the VESTA Kiosk Dockerfile: git
# stores rootfs files as 0644, and an s6 `run` script that is not executable
# builds green and fails only on the device.
RUN find /etc/s6-overlay/s6-rc.d -name run -exec chmod a+x {} + \
 && chmod a+x /usr/bin/vesta-entrypoint /usr/bin/vesta-agent-slot /usr/bin/vesta-selftest /usr/bin/vesta-sidecar

# The start banner and the environment contract read these. VESTA_INSTANCE is
# per channel: CI passes `prod` from main and `dev` from any other branch.
ARG BUILD_VERSION=dev
ARG BUILD_INSTANCE=dev
ARG HA_MCP_VERSION
ENV VESTA_HOST_VERSION=${BUILD_VERSION} \
    VESTA_BUILD_INSTANCE=${BUILD_INSTANCE} \
    VESTA_HA_MCP_VERSION=${HA_MCP_VERSION}

# ⚠️ s6 WAITS 3 s FOR A SERVICE TO STOP BY DEFAULT, then kills it. The agent is
# promised stop_grace_seconds (up to 22 s, see vesta-agent-slot) and the
# sidecar 3 s after it, all inside the Supervisor's 30 s `timeout`.
ENV S6_SERVICES_GRACETIME=27000 \
    S6_KILL_GRACETIME=2000
LABEL \
  io.hass.name="VESTA Agent" \
  io.hass.description="Host for the VESTA Agent (Claude Agent SDK)" \
  io.hass.type="addon" \
  io.hass.version="${BUILD_VERSION}"

# No CMD/ENTRYPOINT: the base image's /init (s6-overlay) starts the services
# registered under rootfs/etc/s6-overlay/s6-rc.d/.
