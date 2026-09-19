# Two stages: build the Vite SPA with Node, then serve the static output with
# nginx on the HA base image (s6-overlay v3 supervises nginx; Ingress fronts it).
# CI passes the per-arch base via BUILD_FROM; the default keeps a plain
# `docker build` working for local testing.
#
# Both this default and node:24-alpine below are floating tags, not pinned
# digests — a deliberate choice, not an oversight: it means every build picks
# up HA's/Node's current security patches automatically, at the cost of
# builds not being byte-for-byte reproducible (a `latest` update could
# silently change what ships). Revisit only if that trade-off stops being
# the right one for this project.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest

# ---- build the static SPA -------------------------------------------------
# Pin this stage to the BUILD platform (the CI runner / your machine), not the
# target arch: the output is arch-neutral static JS/HTML, so even when we build
# an arm64 image the heavy Babylon/tsc compile runs natively instead of under
# slow QEMU emulation. node:24 ships npm 11 (matches package-lock.json).
FROM --platform=${BUILDPLATFORM:-$TARGETPLATFORM} node:24-alpine AS build
WORKDIR /app
# Install deps first so this layer caches across code edits.
#
# ⚠️ `npm install`, AND CI USES THE SAME — BUT NOT FOR THE REASON THIS COMMENT
# ONCE GAVE. It used to say "`npm ci` would hard-fail" on an unresolved
# transitive peer (babylonjs-gltf2interface). 2.496.33 called that stale on the
# strength of `npm ci --dry-run` exiting 0 locally and switched this line to
# `npm ci`. That was the wrong test: `npm ci` succeeds in a clean local
# checkout of this exact lockfile AND fails on a GitHub runner, every time,
# which is why ci.yaml's Install step had never once passed. The two facts
# together say the failure is environmental, not a lockfile defect — and the
# command that provably builds this image on a runner is this one.
#
# The original point stands and is now actually met: ONE resolver on both
# paths, so a green CI build says something about the image's build stage.
# Do not switch either side alone.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- serve it behind Home Assistant Ingress -------------------------------
FROM ${BUILD_FROM}

# nginx serves the static build; python3 + aiohttp run the token-injecting
# Supervisor proxy (supervisor-proxy.py). /run/nginx holds the pid/temp files.
# nginx serves the static build; python3 + aiohttp run BOTH the token-injecting
# Supervisor proxy and the AI layer.
#
# ⚠️ tzdata IS FOR THE AI LAYER AND IS NOT OPTIONAL. alpine ships no zone
# database, so `zoneinfo` raises for every name and the layer's `timezone`
# option would silently fall back to UTC — correct on a developer's machine and
# wrong on the wall.
RUN apk add --no-cache nginx python3 py3-aiohttp tzdata && mkdir -p /run/nginx

# Our nginx config, the Supervisor proxy, and the s6 services that run them.
COPY rootfs /
# ⚠️ THE SHAPE, NOT A LIST OF PATHS. git stores every rootfs file as 0644,
# including both s6 `run` scripts, so this chmod is load-bearing — and it used
# to enumerate its targets by hand. Add a third longrun, forget to add its path
# here, and the image builds green, the push succeeds, the manifest syncs, HA
# offers the update, and s6 fails to exec the script on the wall. No build-time
# signal anywhere. .gitignore already records this exact lesson for a different
# file: "THE PATTERN, NOT ONE FILE. A negation naming one file is a negation
# somebody has to remember."
RUN find /etc/s6-overlay/s6-rc.d -name run -exec chmod a+x {} + \
 && chmod a+x /usr/bin/supervisor-proxy.py

# The compiled SPA from the build stage.
COPY --from=build /app/dist /var/www

# ── the AI layer ───────────────────────────────────────────────────────────
# ⚠️ ONE ADD-ON, AND ONLY ON THIS CHANNEL. This shipped first as a second,
# headless add-on; the owner's verdict on seeing it was one add-on containing
# the baseline kiosk and this, with the screens. `main` and `dev2` carry no
# `agent/` tree, so this COPY is a no-op nowhere — it simply does not exist on
# those branches, which is what keeps the stable image free of it.
COPY agent /usr/lib/vesta/agent
# The tests are not part of the product, and a guard depends on their absence:
# `tests/hard-rules.py` exempts that tree from the "nothing is fetched from a
# third party" rule on the stated grounds that a fixture's fake address never
# reaches an image.
RUN rm -rf /usr/lib/vesta/agent/tests
# ⚠️ `agent/skills/` STAYS. It is the starter set the layer copies into the
# owner's folder on first start — deleting it with the tests would leave every
# fresh install with an empty Skills screen and no way to discover what one
# looks like.

# ⚠️ BAKED IN, BECAUSE SUPERVISOR DOES NOT TELL AN ADD-ON ITS OWN VERSION. The
# layer read this from the environment and nothing set it, so its first real
# install published `version: "0"` in its own status entity and its own log.
ARG VESTA_AI_VERSION=0
ENV VESTA_AI_VERSION=${VESTA_AI_VERSION}

LABEL \
  io.hass.name="VESTA" \
  io.hass.description="3D Home Assistant villa dashboard served via Ingress" \
  io.hass.type="addon"
# Note: the add-on version is the single source of truth in config.yaml; the
# Supervisor reads it from there, so it is intentionally NOT duplicated here.

# No CMD/ENTRYPOINT: the base image's /init (s6-overlay) starts the longrun
# services registered under rootfs/etc/s6-overlay/s6-rc.d/ — nginx, the
# Supervisor proxy, and the AI layer.
