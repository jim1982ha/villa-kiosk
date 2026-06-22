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
| **On-demand rendering** | The GPU idles when nothing moves — essential for a 24/7 tablet. |
| **Runtime config** | Map meshes → entities, calibrate teleport points, set thresholds — all in-app, no code edits. |
| **PWA + backup** | Installable, works briefly offline, export/import full config (+ model) as a ZIP. |

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
| SSH or Samba access to HA `/config` | via the Advanced SSH or Samba add-on |
| The villa `.glb` model | exported per [MODEL_PIPELINE.md](./MODEL_PIPELINE.md) |
| A tablet | Samsung Tab S8+ or better for smooth rendering |

### 2. Build

```bash
npm install
npm run build       # type-check + Vite → dist/
```

### 3. Deploy to Home Assistant

**Automated:**
```bash
# Copy .env.example → .env and fill in VITE_DEPLOY_HOST, VITE_DEPLOY_USER, VITE_DEPLOY_PATH
npm run deploy      # scp dist/ to /config/www/villa-kiosk/ on HA
```

**Manual scp:**
```bash
scp -r dist/. root@homeassistant.local:/config/www/villa-kiosk/
```

**Samba:** mount the share and copy the contents of `dist/` into `config/www/villa-kiosk/`.

Then open `http://<HA_HOST>:8123/local/villa-kiosk/` on the tablet.

> If `/config/www` didn't exist before, restart HA once so it starts serving `/local/`.

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
| Start URL | `http://homeassistant.local:8123/local/villa-kiosk/` |
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
| Mixed content error | Keep the kiosk and HA both on `http` on the LAN, or put HA behind a proper TLS proxy and use `https` for both. |

---

## Development

```bash
npm install
npm run dev         # http://localhost:5173
npm run build       # production build
npm run typecheck   # type-check without building
```

On first run, the onboarding wizard asks for your HA URL + token (dev mode) or auto-connects (add-on). Then upload your `.glb` and confirm your location.

---

## Works with any villa

The app is not tied to any specific villa. The only required input is a `.glb` model. To wire up a new villa:

1. **Import the GLB** (onboarding or Settings → 3D model).
2. Wire it up — two ways, mix freely:
   - **Bind real objects** (Settings → *Bind 3D objects*): tap a lamp/curtain mesh, pick the live HA entity.
   - **Drop control markers** (Settings → *Drop control markers*): for fused models or entities not yet in HA — tap any spot, a floating control is placed and linked to an entity_id (activates automatically when the entity appears).
3. Done — controls, panels and visual feedback work immediately.

Entity names change? Re-point the binding in the app or Config Editor. No rebuild needed.

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
├── pages/        # Dashboard (main) + Config editor
├── hooks/        # useHAEntity, useHAEntities, useSceneReady
├── types/        # Shared TS types
└── utils/        # colour, sun, storage, backup, transforms
```

The 3D scene never re-renders from React — HA state changes are pushed imperatively into Babylon via `HAStateStore.subscribeAll`, keeping the canvas and the React UI fully decoupled.

---

## Runtime configuration

- **Settings** (gear icon): title, location, model upload, backup/restore, Inspector. HA URL/token shown only in standalone mode.
- **Config editor** (`/config`): map any `entity_id` to a panel type + label + room, mark entities requiring confirmation, edit alert thresholds.
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
