# 🚀 Deployment Guide — Villa 3D Kiosk

This guide takes you from a fresh checkout to a tablet running the kiosk 24/7,
served by Home Assistant. Follow it top to bottom the first time.

> **Prefer the one-click add-on?** On HA OS / Supervised, the cleanest path is the
> **Ingress add-on** — sidebar entry, HA-handled auth, no port, auto-restart. See
> [ADDON.md](./ADDON.md). The `/config/www` steps below are the lightweight
> alternative (and the only option on Core/Container installs).

---

## 0. Prerequisites

| You need | Notes |
|---|---|
| Node.js 18+ | `node -v` |
| A Home Assistant instance | HA Yellow, Green, or any HA OS / supervised install |
| SSH/Samba access to HA's `/config` | via the **Advanced SSH & Web Terminal** or **Samba share** add-on |
| The villa `.glb` model | exported per [MODEL_PIPELINE.md](./MODEL_PIPELINE.md) |
| A tablet | Samsung Tab S8+ or better recommended for smooth GLB rendering |

---

## 1. Configure environment defaults (optional but recommended)

```bash
cp .env.example .env
```

Edit `.env`:

```ini
VITE_HA_URL=http://homeassistant.local:8123     # your HA IP (find it in HA → Settings → System → Network)
VITE_HA_PORT=8123
VITE_LAT=-8.3405                          # your villa's latitude
VITE_LNG=115.0920

# Used by `npm run deploy`:
VITE_DEPLOY_HOST=homeassistant.local
VITE_DEPLOY_USER=root
VITE_DEPLOY_PATH=/config/www/villa-kiosk
```

> These are only **defaults** to pre-fill the onboarding screen and the deploy
> script. The token is **not** put here — you enter it in the app (safer).

---

## 2. Build the app

```bash
npm install
npm run build
```

This runs the TypeScript compiler then Vite, producing a static site in `dist/`.
The base path is relative (`./`) so it works under HA's `/local/` mount.

---

## 3. Create the HA web folder

The `/config/www/` folder in Home Assistant is served publicly at `/local/`.
Anything in `/config/www/villa-kiosk/` is reachable at
`http://<HA>:8123/local/villa-kiosk/`.

On the HA host (via SSH add-on terminal):

```bash
mkdir -p /config/www/villa-kiosk
```

> If `/config/www` didn't exist before, **restart Home Assistant once** after
> creating it so HA starts serving `/local/`.

---

## 4. Deploy the build

### Option A — automated (recommended)

```bash
npm run deploy
```

This reads `VITE_DEPLOY_*` from `.env` and `scp`s `dist/` to the HA folder. For
a password-free deploy, copy your SSH key first:

```bash
ssh-copy-id root@homeassistant.local
```

### Option B — manual scp

```bash
scp -r dist/. root@homeassistant.local:/config/www/villa-kiosk/
```

### Option C — Samba / file copy

Mount the HA Samba share and copy the **contents** of `dist/` into
`config/www/villa-kiosk/`.

---

## 5. First open & onboarding

On the tablet browser, open:

```
http://homeassistant.local:8123/local/villa-kiosk/
```

The onboarding wizard runs once:

1. **Connect HA** — paste URL + long-lived token → **Test connection** (must succeed).
   - Token: HA → your profile → **Security** → **Long-lived access tokens** → **Create**.
2. **Upload model** — pick your `.glb`. It is stored in the browser's IndexedDB.
3. **Location** — confirm your coordinates (for sun position).
4. **Done** — open the dashboard.

> ⚠️ **Mixed content:** if you load the kiosk over **https** but HA is **http**,
> the browser blocks the camera/WebSocket. Keep both on **http** on the LAN, or
> put HA behind a proper TLS reverse proxy and use https for both.

---

## 6. Calibrate (one-time, if needed)

Teleport anchors are pre-derived from the model geometry. If a room teleport
lands in the wrong spot (different export axes/scale):

- Open **Rooms** → walk to the correct spot → **long-press the room card** to
  save your current position as that anchor. Repeat per room.
- Or use **Settings → Inspector** to read exact world coordinates.

No rebuild needed — changes persist in `localStorage`.

---

## 7. Tablet kiosk mode

### iOS — Guided Access

1. **Settings → Accessibility → Guided Access** → enable, set a passcode.
2. **Settings → Display & Brightness → Auto-Lock → Never**.
3. Open **Safari** → navigate to the kiosk URL → **Share → Add to Home Screen**
   (installs the PWA full-screen).
4. Open the installed app → **triple-click** the side button → **Start Guided Access**.

### Android — Fully Kiosk Browser (recommended, ~€7)

Install *Fully Kiosk Browser* and set:

| Setting | Value |
|---|---|
| Start URL | `http://homeassistant.local:8123/local/villa-kiosk/` |
| Prevent sleep / keep screen on | ON |
| Auto-reload on error | ON (30 s) |
| Hide navigation/status bar | ON |
| Allow camera | ON (for MJPEG streams) |
| Motion detection wake | ON |
| Brightness | ~70% |
| Launch on boot | ON |

### Android — free alternative

Chrome → kiosk URL → **⋮ → Add to Home screen** (installs the PWA). Then enable
**Settings → Display → Screen timeout → longest**, and pin the app
(**Settings → Security → App pinning**).

---

## 8. 24/7 burn-in test (acceptance)

Before signing off:

- [ ] Leave the kiosk running **72 hours** untouched.
- [ ] Reboot Home Assistant mid-test → kiosk reconnects within ~10 s (watch the
      WiFi dot in the top bar go amber → green).
- [ ] Toggle a light in HA → the 3D mesh glows within ~300 ms.
- [ ] Memory stays stable (no creeping growth) — on-demand rendering keeps the
      GPU idle when the scene is still.
- [ ] Open a camera stream for several minutes, close it → memory returns to baseline.

---

## 9. Updating the kiosk later

```bash
git pull          # or edit code
npm run build
npm run deploy
```

On the tablet, pull-to-refresh or restart the kiosk app. The service worker
serves the app shell instantly and fetches the new build in the background; a
second refresh picks it up. Config and the stored model are preserved.

To force a clean reload after a big change, bump `CACHE` in `public/sw.js`.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page / 404 at `/local/...` | Ensure files are in `/config/www/villa-kiosk/` and you restarted HA after first creating `www`. |
| "Connection failed" in onboarding | Check URL (include `http://` and `:8123`), token validity, and that the tablet is on the same LAN. |
| Camera panel black | Browser must allow the http camera proxy; verify `camera.*` entity works in HA; check token. |
| Walks through walls | The GLB needs `collision_*` meshes (or solid wall meshes). See MODEL_PIPELINE.md step 5. |
| Teleport lands wrong | Recalibrate via long-press a room card (step 6). |
| Floor 2 button disabled | Floor 2 isn't modelled in the GLB yet — expected. |
| Inspector won't open | It's a large lazy chunk; first open needs network. Re-deploy after `npm run build`. |

---

*Villa Kiosk — a generic Home Assistant villa dashboard.*
