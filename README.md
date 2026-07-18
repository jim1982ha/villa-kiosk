# Villa Kiosk

> Browser-based first-person 3D walkthrough of your villa, wired live to Home Assistant.

Walk through your villa in 3D on a wall-mounted tablet, teleport between rooms, and control every Home Assistant entity — lights, AC, locks, cameras, curtains, fans, sensors, media — by tapping the object in the scene or using a control panel.

Built with **React + TypeScript + Babylon.js**.

---

## Features

| Area | What it does |
|---|---|
| **First-person navigation** | Walk with a touch virtual joystick, look around by dragging, teleport to any room from a grid. |
| **Tap-to-control** | Tap a 3D object → the right control panel slides up (light/AC/lock/camera/sensor/curtain/fan/switch/media). |
| **Live visual feedback** | Lights glow and illuminate the room; curtains show open/half/closed; fans spin; locks go green/red; leak sensors pulse red. |
| **Live HA sync** | WebSocket connection with auto-reconnect; mesh visuals update within ~300 ms of a state change. |
| **Tap-to-bind** | Wire any imported model to HA by tapping objects and picking the entity — no entity-named meshes required. |
| **Live cameras** | Full-screen MJPEG stream popups via the HA camera proxy. |
| **Day / night** | Scene lighting follows the real sun position for your location (or HA's `sun.sun`). |
| **Render quality** | Live, per-effect look controls (Settings → *Render quality*): tone mapping, exposure/contrast, light balance, ambient occlusion, sun shadows, environment lighting — tune for quality or tablet performance with no rebuild. |
| **On-demand rendering** | The GPU idles when nothing moves — essential for a 24/7 tablet. |
| **Runtime config** | Map meshes → entities, calibrate teleport points, set thresholds — all in-app, no code edits. |
| **PWA + backup** | Installable, works briefly offline, export/import a JSON config backup (device↔room bindings, room viewpoints, device icons, render/UI settings — deliberately not the model or HA credentials) from Advanced Settings. |

---

## Tech stack

- **React 18** + **TypeScript** (strict, functional components + hooks only)
- **Babylon.js 7** (`@babylonjs/core`, `loaders`, `materials`, `inspector`)
- **Vite 5** build
- **lucide-react** icons · **jszip** backups
- **IndexedDB** for the GLB model · **localStorage** for all config
- Plain CSS with custom properties — no CSS framework

---

## Run as a Home Assistant add-on (recommended)

On **HA OS or Supervised**, the cleanest path is the **Ingress add-on**: sidebar entry, HA-managed auth, no exposed port, no token, auto-restart. Full install instructions: **[ADDON.md](./ADDON.md)**.

> Requires HA OS or Supervised. On Core/Container installs, use the standalone deploy below.

---

## Standalone deployment (Core / Container / dev)

### 1. Prerequisites

| You need | Notes |
|---|---|
| Node.js 18+ | `node -v` |
| A Home Assistant instance | Any install type |
| A way to copy files into HA `/config/www` | Samba share, Studio Code Server, the File editor add-on, or scp — whatever you already use |
| The villa `.glb` model | exported per [MODEL_PIPELINE.md](./MODEL_PIPELINE.md) |
| A tablet | Samsung Tab S8+ or better for smooth rendering |

### 2. Build

```bash
npm install
npm run build       # type-check + Vite → dist/
```

> `dev`, `build` and `preview` auto-run **`npm run clean`** first (removes `dist/`,
> the Vite dep cache `node_modules/.vite`, and `tsconfig.tsbuildinfo`), so every run
> starts from a clean slate — no stale artifacts in dev or prod. Run `npm run clean`
> on its own any time. (Cost: the first dev request re-prebundles deps, ~a few seconds.)

### 3. Copy the build to Home Assistant (manual)

`npm run build` produces a self-contained **`dist/`** folder. Copy the **contents
of `dist/`** into `config/www/villa-kiosk/` on your HA instance, using whatever
file access you already have — there is no deploy script, do it by hand:

- **Samba share** add-on → open `\\<HA_HOST>\config\www\` and drop the files in a
  `villa-kiosk` folder.
- **Studio Code Server** / **File editor** add-on → upload into `/config/www/villa-kiosk/`.
- **scp** (if you run an SSH add-on):
  ```bash
  scp -r dist/. root@<HA_HOST>:/config/www/villa-kiosk/
  ```

The result must be `config/www/villa-kiosk/index.html` (+ `assets/`, `sw.js`, …).
HA serves `config/www/` at `/local/`, so the app is then at:

```
https://<HA_HOST>:8123/local/villa-kiosk/
```

> If `config/www` didn't exist before, create it and restart HA once so it starts
> serving `/local/`. Re-deploying a new version = copy the fresh `dist/` over the
> old folder (replace all files; the hashed `assets/*` filenames change per build).
> If you instead zip `dist/` and unzip it *into* `villa-kiosk/` (rather than
> extracting its contents directly), you'll get an extra `dist/` segment in the
> path (`config/www/villa-kiosk/dist/index.html`) — both work identically, the
> app doesn't care which; just be consistent about which URL you bookmark.

#### Installing as a PWA (the "Install" button)

The browser only offers **Install** when the app is served from a **secure origin
with a _trusted_ certificate** — so the `/local/villa-kiosk/` path reached over a
real, trusted HTTPS domain in front of HA (a Dynamic DNS + Let's Encrypt setup, a
Cloudflare Tunnel, etc.) is what shows the button on both laptop and phone:

```
https://<your-trusted-ha-domain>/local/villa-kiosk/   ← installable
```

Two things that will **hide** the Install button:

- **Plain `http://`, or HTTPS with a self-signed/untrusted cert** → not a secure
  origin, no service worker, no install. (`npm run dev` uses a self-signed cert by
  default; drop a trusted `mkcert` cert in `./certs/` to test install locally.)
- **The Ingress add-on** (`/api/hassio_ingress/…`) → the service worker is
  disabled there on purpose (the session path rotates), so there is **no install
  button via the sidebar**. Use the `/local/` HTTPS URL above for an installable PWA.

### 4. Get a Home Assistant token (standalone only)

1. HA → your profile → **Security** tab → **Long-lived access tokens** → **Create token**.
2. Paste it into the kiosk's onboarding / Settings.

> The token is stored in `localStorage` on the tablet — acceptable for a local-only LAN kiosk.

### 5. Tablet kiosk mode

**iOS — Guided Access**

1. Settings → Accessibility → Guided Access → enable, set a passcode.
2. Settings → Display & Brightness → Auto-Lock → Never.
3. Safari → navigate to the kiosk URL → Share → **Add to Home Screen** (installs the PWA full-screen).
4. Open the installed app → triple-click the side button → **Start Guided Access**.

**Android — Fully Kiosk Browser** (recommended, ~€7)

| Setting | Value |
|---|---|
| Start URL | `https://<HA_HOST>:8123/local/villa-kiosk/` |
| Prevent sleep / keep screen on | ON |
| Auto-reload on error | ON (30 s) |
| Hide navigation/status bar | ON |
| Allow camera | ON (for MJPEG streams) |
| Motion detection wake | ON |
| Brightness | ~70% |
| Launch on boot | ON |

**Android — free alternative:** Chrome → ⋮ → Add to Home screen, then enable the longest screen timeout and pin the app (Settings → Security → App pinning).

### 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page / 404 at `/local/...` | Ensure files are in `/config/www/villa-kiosk/` and you restarted HA after first creating `www`. |
| "Connection failed" in onboarding | Check URL (include `http://` and `:8123`), token validity, and that the tablet is on the same LAN. |
| Camera panel black | Browser must allow the http camera proxy; verify `camera.*` entity works in HA; check token. |
| Walks through walls | The GLB needs solid wall meshes or `collision_*` boxes — see MODEL_PIPELINE.md. |
| Teleport lands wrong | Recalibrate: Rooms → walk to the correct spot → long-press the room card. |
| Inspector won't open | It's a large lazy chunk; first open needs network. Re-deploy after `npm run build`. |
| Mixed content error | Keep the kiosk and HA both on `http` on the LAN, or put HA behind a proper TLS proxy and use `https` for both — a Cloudflare Tunnel (with Home Assistant's own login as the actual gate) is a common, well-supported way to get a trusted cert without exposing any port. |

---

## Development

```bash
npm install
npm run dev         # http://localhost:5173
npm run build       # production build
npm run typecheck   # type-check without building
```

On first run, the onboarding wizard is a single screen asking for your HA URL + token (standalone) — the URL field prefills a guess (`ha-<this page's own hostname>`, matching a split-subdomain Cloudflare Tunnel setup) — or nothing at all, auto-connecting immediately (add-on, via the Ingress Supervisor proxy). The 3D model auto-loads from the add-on's centrally-configured GLB with no upload step (see *Works with any villa* below for the rare case nothing central is configured), and the villa's location silently adopts the connected HA instance's own lat/lng.

---

## Works with any villa

The app is not tied to any specific villa. The only required input is a `.glb` model. To wire up a new villa:

1. **Import the GLB** (Advanced Settings → *3D model source*).
2. Wire it up — two ways, mix freely:
   - **Bind real objects** (Advanced Settings → *Bound 3D objects*): tap a lamp/curtain mesh, pick the live HA entity.
   - **Drop control markers**: for fused models or entities not yet in HA — tap any spot, a floating control is placed and linked to an entity_id (activates automatically when the entity appears).
3. Done — controls, panels and visual feedback work immediately.

Entity names change? Re-point the binding in Advanced Settings. No rebuild needed.

> **Prerequisite:** a `.glb` of the villa. If you have a SweetHome 3D `.sh3d`, see [MODEL_PIPELINE.md](./MODEL_PIPELINE.md). If you already have a GLB, skip straight to import + bind.

---

## 3D model pipeline

Start from your villa's SweetHome 3D plan (`.sh3d`). Export to an optimised `.glb`. Full step-by-step: **[MODEL_PIPELINE.md](./MODEL_PIPELINE.md)**. Summary:

```
SweetHome 3D → Export to OBJ
   → Blender → Decimate (≈0.3) → Recalculate normals → remove ceiling
   → name interactive meshes with their HA entity_id
   → Export glTF 2.0 (Binary .glb, Draco ON)  →  target < 40 MB
```

> If your interactive objects are named with their full HA entity IDs (e.g. `camera.livingroom_cam`, `climate.living_room_air_conditioner`), the app matches meshes to entities automatically.

---

## Project structure

```
src/
├── babylon/      # ALL Babylon code (no React): scene, camera, lighting, picking, floors…
├── ha/           # Home Assistant: WebSocket, state store, service calls, history, cameras
├── config/       # AppConfig, EntityMap, TeleportPoints, thresholds (persisted to localStorage)
├── components/   # React UI: canvas, HUD, panels, teleport, settings, onboarding
├── pages/        # Dashboard (the only route — Advanced Settings is a modal over it, not a separate page)
├── hooks/        # useHAEntity, useHAEntities, useSceneReady
├── types/        # Shared TS types
└── utils/        # colour, sun, storage, backup, transforms
```

The 3D scene never re-renders from React — HA state changes are pushed imperatively into Babylon via `HAStateStore.subscribeAll`, keeping the canvas and the React UI fully decoupled.

---

## Runtime configuration

- **Settings** (gear icon): title, render quality, first-person/overview feel, device icon size, theme. HA URL/token shown only in standalone mode.
- **Advanced Settings** (Settings' footer → *Advanced Settings*, a modal over the live dashboard, not a page reload): villa location, 3D model source (add-on: central GLB/room-data upload; standalone: reads the same central model automatically if one exists, else a per-browser uploader), per-device configuration backup/restore, auto-detected entity settings (map any `entity_id` to a panel type + label + room, mark entities requiring confirmation), bound 3D objects, grouped devices.
- **Render quality** (Settings → *Render quality &amp; look*): independently toggle/tune tone mapping (Khronos Neutral / ACES / Standard), exposure, contrast, fill + key + ambient light balance, ambient occlusion (SSAO), sun shadows and environment lighting (IBL). All apply live and persist with your config; start with tone mapping + lower **Fill light** to cure a washed-out render. The same knobs can be baked into the GLB via the [Blender pipeline](MODEL_PIPELINE.md) flags.
- **Teleport calibration**: open **Rooms**, then right-click / long-press any room card to save your current spot as that room's anchor.

---

## Performance targets

| Metric | Target |
|---|---|
| Initial load | < 8 s on local WiFi |
| Frame rate | 30 fps min / 60 fps target (idles at ~0 when still) |
| GLB size | < 40 MB (Draco) |
| HA state latency | < 300 ms |
| Reconnect after HA restart | < 10 s |

---

## License

A generic, self-hostable Home Assistant villa dashboard. Bring your own `.glb`.
