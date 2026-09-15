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
RUN apk add --no-cache nginx python3 py3-aiohttp && mkdir -p /run/nginx

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

LABEL \
  io.hass.name="VESTA" \
  io.hass.description="3D Home Assistant villa dashboard served via Ingress" \
  io.hass.type="addon"
# Note: the add-on version is the single source of truth in config.yaml; the
# Supervisor reads it from there, so it is intentionally NOT duplicated here.

# No CMD/ENTRYPOINT: the base image's /init (s6-overlay) starts the nginx
# longrun service registered under rootfs/etc/s6-overlay/s6-rc.d/.
