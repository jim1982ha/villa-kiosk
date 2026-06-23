# 🧩 Run Villa Kiosk as a Home Assistant Add-on (Ingress)

This turns the kiosk into a **one-click add-on** in your Home Assistant sidebar.
HA handles auth and TLS, there is no exposed port and no token-in-URL, and it
auto-starts/restarts with HA.

Installation is by **image pull** — you add this GitHub repo as a custom add-on
repository and install; HA pulls a prebuilt image from GHCR, **no on-device
build**. Works on any HA OS / Supervised box.

> Requires **Home Assistant OS** or **Supervised** (add-ons need the Supervisor).
> On a *Core*/*Container* install use the `/config/www` method in
> [README.md](./README.md).

---

## One-time publish (maintainer)

The images are published by GitHub Actions (`.github/workflows/build.yaml`). The
**first time only**, after the workflow has run once:

1. Push to `main` (or run the workflow manually: **Actions → Build & publish
   add-on images → Run workflow**). It builds and pushes:
   - `ghcr.io/jim1982ha/villa-kiosk-amd64:<version>`
   - `ghcr.io/jim1982ha/villa-kiosk-aarch64:<version>`
2. **Make the packages public** so HA can pull them without a login:
   GitHub → your profile → **Packages** → `villa-kiosk-amd64` →
   **Package settings → Change visibility → Public**. Repeat for `-aarch64`.
   (They're already linked to this repo via the image `source` label.)

That's it — every later push to `main` republishes the current `version`.

---

## Install in Home Assistant

1. **Settings → Add-ons → Add-on Store → ⋮ (top-right) → Repositories.**
2. Paste `https://github.com/jim1982ha/villa-kiosk` and **Add**.
3. The **Villa Kiosk** add-on now appears in the store. Open it → **Install**
   (a quick image pull — no compiling).
4. Enable **Start on boot** + **Watchdog**, then **Start**.
5. Click **Villa Kiosk** in the sidebar (or *Open Web UI*) and complete the
   one-time onboarding (upload `.glb`, confirm location). **No URL or token** —
   the add-on connects to HA automatically through the Supervisor proxy.

---

## Updating

Bump `version` in `villa-kiosk/config.yaml`, commit, and push. Actions
republishes that tag; Home Assistant then shows an **Update** button on the
add-on. Your config and uploaded model live in the browser, so they survive
updates.

---

## How it works

```
HA sidebar ─Ingress─► nginx :8099 (172.30.32.2 only) ─┬─► /var/www (the built SPA)
                                                       └─► /core/* ─► supervisor-proxy.py
                                                                       ─► http://supervisor/core
```

- `image:` in `config.yaml` makes the Supervisor pull the prebuilt image instead
  of building.
- nginx serves the static build on port **8099** behind **Ingress**, and only
  accepts the Ingress gateway (`172.30.32.2`) — direct access is denied.
- The app uses `HashRouter` + a relative asset base, so it runs unmodified under
  the dynamic Ingress path (`/api/hassio_ingress/<token>/`).
- **No long-lived token.** With `homeassistant_api: true`, a small bundled proxy
  (`supervisor-proxy.py`) injects the add-on's `SUPERVISOR_TOKEN` server-side for
  the HA WebSocket + REST, so the browser talks to Core token-lessly. nginx
  forwards the `/core/*` paths to it.

### Repository layout

| Path | Purpose |
|---|---|
| `repository.yaml` | Marks the repo as an HA add-on repository |
| `villa-kiosk/config.yaml` | Add-on manifest — `image:` (pull), Ingress, port 8099 |
| `villa-kiosk/DOCS.md`, `icon.png`, `logo.png` | Store docs + artwork |
| `Dockerfile` | Two-stage build (Node → nginx on HA base); used by CI, context = repo root |
| `rootfs/etc/nginx/nginx.conf` | Serves `/var/www`, **Ingress-only** allow-list, proxies `/core/*` |
| `rootfs/usr/bin/supervisor-proxy.py` | Token-injecting HA Core proxy (WebSocket + REST) |
| `rootfs/etc/s6-overlay/...` | s6-overlay v3 services supervising nginx + the proxy |
| `.github/workflows/build.yaml` | Builds & pushes per-arch images to GHCR |

The build stage is pinned to `--platform=$BUILDPLATFORM`, so the heavy
Babylon/Vite compile runs natively on the CI runner even for the arm64 image;
only the light nginx layer is emulated.

---

## Local build fallback (no GHCR)

To run without published images — e.g. a quick local test — build the image
yourself and skip the store:

```bash
docker build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest \
  -t villa-kiosk-addon .
```

This is only for testing; the image-pull store install above is the normal path.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Add-on not in store after adding repo | **⋮ → Check for updates**; confirm the repo URL was accepted. |
| Install fails pulling the image | The GHCR packages must be **Public** (see *One-time publish*), and the Actions run must have finished. |
| Wrong architecture | Only `amd64` + `aarch64` are published; add more arches in `config.yaml` + the workflow matrix. |
| Blank sidebar panel | Check the add-on **Log** tab; confirm nginx + the proxy started. |
| 403 if you hit the port directly | Expected — nginx only allows the Ingress gateway `172.30.32.2`. |
| Connects but no entities | Confirm `homeassistant_api: true` is set and the `supervisor-proxy` service is running (add-on **Log**). |
