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
# Install deps first so this layer caches across code edits. We use `npm install`
# (not the stricter `npm ci`) because the project pins mixed @babylonjs/* minor
# versions, which leaves a transitive peer (babylonjs-gltf2interface) unresolved
# in the lockfile — `npm install` reconciles it, `npm ci` would hard-fail.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- serve it behind Home Assistant Ingress -------------------------------
FROM ${BUILD_FROM}

# nginx serves the static build; python3 + aiohttp run the token-injecting
# Supervisor proxy (supervisor-proxy.py). /run/nginx holds the pid/temp files.
RUN apk add --no-cache nginx python3 py3-aiohttp py3-pip && mkdir -p /run/nginx

# The Anthropic SDK, for the agent's reasoning tiers.
#
# ⚠️ PINNED, WHILE THE BASE TAGS ABOVE DELIBERATELY FLOAT, AND THE INCONSISTENCY
# IS THE POINT. A floating base is right for security patches: the thing that
# changes is the OS underneath, and taking its fixes automatically is worth
# losing byte-for-byte reproducibility. This is the opposite kind of
# dependency. The SDK decides how the agent talks to a model — retry
# behaviour, streaming, tool-call shapes, defaults — so a floating version
# means the villa's supervision can change because a package was published,
# with no release here and nothing in the changelog to explain it. Agent
# behaviour must move when WE move it, and the eval corpus is what proves a
# move was safe (ADR-016). Raise this number deliberately, then run the evals.
#
# ⚠️ `--break-system-packages` is required because Alpine's python3 marks its
# site-packages externally managed (PEP 668). This image has exactly one
# consumer of that directory and no system Python tooling to conflict with, so
# the flag is stating a fact about this container rather than overriding a
# safety rule that applies here.
#
# ⚠️ IT REPLACES THE apk-PROVIDED `idna`, AND THAT WAS VERIFIED RATHER THAN
# ASSUMED. The SDK's dependency chain pulls idna 3.19 over Alpine's 3.16, which
# `aiohttp` also uses — so this line reaches a package the proxy depends on.
# Built against the real base image and confirmed both still import
# (anthropic 1.0.0, aiohttp 3.13.5). If a future SDK bump breaks the proxy, this
# is the interaction to look at first; nothing else in this image shares a
# dependency tree with it.
RUN pip install --no-cache-dir --break-system-packages 'anthropic==1.0.0'

# Our nginx config, the Supervisor proxy, and the s6 services that run them.
COPY rootfs /
RUN chmod a+x /etc/s6-overlay/s6-rc.d/nginx/run \
              /etc/s6-overlay/s6-rc.d/supervisor-proxy/run \
              /usr/bin/supervisor-proxy.py

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
