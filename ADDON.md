# 🧩 Run Villa Kiosk as a Home Assistant Add-on (Ingress)

This turns the kiosk into a **one-click add-on** that shows up in your Home
Assistant sidebar. HA handles the authentication and TLS, there is no exposed
port and no token-in-URL, and it auto-starts/restarts with HA.

It is the recommended way to run on your **test instance**
(`https://192.168.40.203:8123`) and on any HA OS / Supervised box.

> Requires **Home Assistant OS** or **Supervised** (add-ons need the Supervisor).
> A *Core*/*Container* install has no add-ons — use the `/config/www` method in
> [DEPLOYMENT.md](./DEPLOYMENT.md) instead.

---

## How it works

```
HA sidebar ──Ingress──► nginx :8099 (172.30.32.2 only) ──► /var/www (the built SPA)
```

- A two-stage Docker build (`Dockerfile`) compiles the Vite app with Node, then
  serves the static `dist/` with nginx on port **8099** behind **Ingress**.
- `ingress: true` in `config.yaml` puts it in the sidebar; nginx only accepts the
  Ingress gateway (`172.30.32.2`) and denies everything else.
- The app uses `HashRouter` + a relative asset base, so it works unmodified under
  the dynamic Ingress path (`/api/hassio_ingress/<token>/`).
- The app still connects to Home Assistant with the **URL + long-lived token** you
  enter in onboarding (same as before) — Ingress fronts the *UI*, not the HA API.

---

## Install (local add-on — builds on the device, no registry/CI)

1. **Get the files onto HA.** SSH or Samba into HA (the *Advanced SSH & Web
   Terminal* or *Samba share* add-on), then clone the repo into `/addons/`:

   ```bash
   cd /addons
   git clone https://github.com/jim1982ha/villa-kiosk.git villa-kiosk
   ```

   (Or copy this folder to `/addons/villa-kiosk/` over Samba.)

2. **Find it in the store.** Home Assistant → **Settings → Add-ons → Add-on
   Store** → top-right **⋮ → Check for updates**. *Villa Kiosk* appears under
   **Local add-ons**.

3. **Install.** Open it → **Install**. The first build compiles the app on the
   device (a few minutes — Babylon is large). Then enable **Start on boot** and
   **Watchdog**, and click **Start**.

4. **Open it.** Click **Villa Kiosk** in the sidebar (or *Open Web UI*). Run the
   onboarding once: paste your HA URL + long-lived token, upload the `.glb`,
   confirm Bali coordinates.

> First boot only: if you used `/config/www` before, that copy still works
> independently — the add-on is a separate, cleaner path.

---

## Update later

```bash
cd /addons/villa-kiosk
git pull
```

Then in the add-on page: **⋮ → Rebuild**. Your config and uploaded model live in
the browser (localStorage/IndexedDB), so they survive rebuilds.

---

## Files that make up the add-on

| File | Purpose |
|---|---|
| `config.yaml` | Add-on manifest (slug, arch, `ingress: true`, port 8099, sidebar icon/title) |
| `build.yaml` | Per-arch HA base image for the runtime stage |
| `Dockerfile` | Stage 1: `npm ci && npm run build`. Stage 2: nginx on the HA base image |
| `.dockerignore` | Keeps `node_modules`/`dist`/`.git` out of the build context |
| `rootfs/etc/nginx/nginx.conf` | Serves `/var/www` on :8099, **Ingress-only** allow-list |
| `rootfs/etc/s6-overlay/s6-rc.d/nginx/*` | s6-overlay v3 service that supervises nginx |
| `icon.png` / `logo.png` | Store artwork |

---

## Going further — publish for true one-click installs (optional)

The local add-on above builds on each device. To let anyone install from a URL
without an on-device build, publish prebuilt images and convert this into an
**add-on repository**:

1. Add a GitHub Actions workflow that builds the `Dockerfile` per-arch with
   `docker buildx` and pushes to `ghcr.io/jim1982ha/villa-kiosk-{arch}`.
2. Move `config.yaml`/`icon.png` into a `villa-kiosk/` subfolder, add a root
   `repository.yaml`, and set `image: ghcr.io/jim1982ha/villa-kiosk-{arch}` +
   matching `version` in `config.yaml` (HA then *pulls* instead of building).
3. Users add the repo in **Add-on Store → ⋮ → Repositories** by pasting the
   GitHub URL.

This is a productionization step; the local add-on is all you need for the test
instance today.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Add-on not in the store | It must be in `/addons/villa-kiosk/`; then **⋮ → Check for updates**. |
| Build fails on `npm ci` | Ensure the full repo was cloned (not just a few files); check device disk space. |
| Blank sidebar panel | Watch the add-on **Log** tab; confirm nginx started and is listening on 8099. |
| "Connection failed" in onboarding | URL must include `http://…:8123`; token valid; tablet on the same LAN. |
| 403 if you hit the port directly | Expected — nginx only allows the Ingress gateway `172.30.32.2`. |
