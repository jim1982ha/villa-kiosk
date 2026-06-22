# Two stages: build the Vite SPA with Node, then serve the static output with
# nginx on the HA base image (s6-overlay v3 supervises nginx; Ingress fronts it).
# CI passes the per-arch base via BUILD_FROM; the default keeps a plain
# `docker build` working for local testing.
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
RUN apk add --no-cache nginx python3 py3-aiohttp && mkdir -p /run/nginx

# Our nginx config, the Supervisor proxy, and the s6 services that run them.
COPY rootfs /
RUN chmod a+x /etc/s6-overlay/s6-rc.d/nginx/run \
              /etc/s6-overlay/s6-rc.d/supervisor-proxy/run \
              /usr/bin/supervisor-proxy.py

# The compiled SPA from the build stage.
COPY --from=build /app/dist /var/www

LABEL \
  io.hass.name="Villa Kiosk" \
  io.hass.description="3D Home Assistant villa dashboard served via Ingress" \
  io.hass.type="addon" \
  io.hass.version="2.1.0"

# No CMD/ENTRYPOINT: the base image's /init (s6-overlay) starts the nginx
# longrun service registered under rootfs/etc/s6-overlay/s6-rc.d/.
