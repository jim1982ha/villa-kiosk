# 🧩 Run Vesta Kiosk as a Home Assistant Add-on

This turns the kiosk into a **one-click add-on**. Open it in the HA sidebar
(Ingress — HA handles auth and TLS), **or** publish its own port and open it on
its own hostname (direct / Cloudflare Tunnel) as a full-screen installable PWA.
Same single build, and it auto-starts/restarts with HA.

Installation is by **image pull** — you add this GitHub repo as a custom add-on
repository and install; HA pulls a prebuilt image from GHCR, **no on-device
build**. Works on any HA OS / Supervised box.

> Requires **Home Assistant OS** or **Supervised** — add-ons need the
> Supervisor, which provides the token-less Core proxy and the private storage
> this app relies on. There is no Core/Container deployment path.

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
3. The **Vesta Kiosk** add-on now appears in the store. Open it → **Install**
   (a quick image pull — no compiling).
4. Enable **Start on boot** + **Watchdog**, then **Start**.
5. Click **Vesta Kiosk** in the sidebar (or *Open Web UI*) — it connects
   automatically through the Supervisor proxy with **no URL or token to enter**,
   and no onboarding screens at all. Upload your villa's `.glb` (and its
   `.rooms.json` room-data sidecar) once from **Advanced Settings → 3D model
   source** — every client then loads that same central file automatically.

---

## Access it outside the sidebar (optional)

The add-on also publishes host port **8099** (`ports:` in `config.yaml`), so you
can reach the kiosk on its own hostname — point a **Cloudflare Tunnel** at
`http://<HA-host-ip>:8099` — and install it as a PWA at `/`.

Because that port is internet-reachable, the add-on authenticates itself: a
profile passcode (`guest_pin`/`owner_pin`/`ops_pin` options, verified
server-side) mints a **signed, httpOnly session cookie**, and `/core`, `/model`
and uploads refuse any direct request without it. Sidebar (Ingress) requests are
exempt — HA already authenticated them, tagged by their real gateway source IP.
Set at least one passcode before mapping the port, and add **Cloudflare Access**
in front for defence-in-depth. To stay sidebar-only, leave port 8099 unmapped in
the add-on's **Network** panel.

---

## Updating

Bump `version` in `villa-kiosk/config.yaml`, commit, and push. Actions
republishes that tag; Home Assistant then shows an **Update** button on the
add-on. Per-device settings live in the browser and the uploaded model lives in
the add-on's `/data` volume, so both survive updates.

---

## How it works

```
HA sidebar ──Ingress──►┐
                       ├─► nginx :8099 ─┬─► /var/www (the built SPA)
Cloudflare / direct ──►┘  (geo-tags     ├─► /model/* ─(auth_request)─► /data store
                          Ingress vs     └─► /core/*, /auth/*, /addon-config,
                          direct)            /model-upload ─► supervisor-proxy.py
                                                              ─► http://supervisor/core
```

- `image:` in `config.yaml` makes the Supervisor pull the prebuilt image instead
  of building.
- nginx serves the static build on port **8099**, reachable via Ingress AND the
  published port. A `geo` block tags each request Ingress-vs-direct by source IP
  (`X-VK-Ingress`), which the proxy trusts to decide whether a session cookie is
  required. The app shell + hashed assets are public; every sensitive route is
  authenticated.
- The app uses `HashRouter` + a relative asset base, so it runs unmodified under
  both the dynamic Ingress path (`/api/hassio_ingress/<token>/`) and the direct
  hostname root.
- **No long-lived token.** With `homeassistant_api: true`, a small bundled proxy
  (`supervisor-proxy.py`) injects the add-on's `SUPERVISOR_TOKEN` server-side for
  the HA WebSocket + REST, so the browser talks to Core token-lessly. It also
  verifies profile passcodes and issues the session cookie.

### Repository layout

| Path | Purpose |
|---|---|
| `repository.yaml` | Marks the repo as an HA add-on repository |
| `villa-kiosk/config.yaml` | Add-on manifest — `image:` (pull), Ingress + published port 8099, PIN options |
| `villa-kiosk/DOCS.md`, `icon.png`, `logo.png` | Store docs + artwork |
| `Dockerfile` | Two-stage build (Node → nginx on HA base); used by CI, context = repo root |
| `rootfs/etc/nginx/nginx.conf` | Serves `/var/www`, Ingress/direct `geo` tag, `auth_request`-gated `/model/`, proxies `/core/*` |
| `rootfs/usr/bin/supervisor-proxy.py` | Token-injecting HA Core proxy + session auth + model uploads |
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
| Direct hostname loads the shell but HA/model won't load | No valid session — sign in with a profile passcode, and make sure direct access is over **HTTPS** (the session cookie is `Secure`). |
| `401` on `/core` or `/model` directly | Expected without a session cookie; only Ingress requests are exempt. Set a passcode and sign in. |
| Connects but no entities | Confirm `homeassistant_api: true` is set and the `supervisor-proxy` service is running (add-on **Log**). |
