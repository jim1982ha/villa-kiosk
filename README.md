# 🏝️ Villa Kiosk

> Browser-based first-person 3D walkthrough of your villa, wired live to Home Assistant.

Walk through your villa in 3D on a wall-mounted tablet, teleport between rooms, and control every Home Assistant entity — lights, AC, locks, cameras, curtains, fans, sensors, media — by tapping the object in the scene or using a control panel.

Built from scratch with **React + TypeScript + Babylon.js**, informed by the architecture of the open-source [3Dash](https://github.com/Kdcius/3Dash_webapp) project.

---

## ✨ Features

| Area | What it does |
|---|---|
| **First-person navigation** | Walk with a touch virtual joystick, look around by dragging, teleport to any room from a grid. |
| **Tap-to-control** | Tap a 3D object → the right control panel slides up (light/AC/lock/camera/sensor/curtain/fan/switch/media). |
| **Live visual feedback** | Lights **glow and illuminate the room**; curtains show **open/half/closed**; fans **spin**; locks go green/red; leak sensors pulse red. |
| **Live HA sync** | WebSocket connection with auto-reconnect; mesh visuals update within ~300 ms of a state change. |
| **Tap-to-bind** | Wire any imported model to HA by tapping objects and picking the entity — no entity-named meshes required. |
| **Live cameras** | Full-screen MJPEG stream popups via the HA camera proxy. |
| **Day / night** | Scene lighting follows the real sun position for your location (or HA's `sun.sun`). |
| **Floor switching** | Walk up the staircase or tap the floor switch (Floor 2 ready for when it's modelled). |
| **On-demand rendering** | The GPU idles when nothing moves — essential for a 24/7 tablet. |
| **Runtime config** | Map meshes → entities, calibrate teleport points, set thresholds — all in-app, no code edits. |
| **PWA + backup** | Installable, works briefly offline, export/import full config (+ model) as a ZIP. |

---

## 🧱 Tech stack

- **React 18** + **TypeScript** (strict, functional components + hooks only)
- **Babylon.js 7** (`@babylonjs/core`, `loaders`, `materials`, `inspector`)
- **Vite 5** build
- **lucide-react** icons · **jszip** backups
- **IndexedDB** for the GLB model · **localStorage** for all config
- Plain CSS with custom properties (warm tropical theme) — no CSS framework

---

## 🚀 Quick start (development)

```bash
# 1. Install
npm install

# 2. (Optional) set defaults — copy and edit
cp .env.example .env        # HA URL, location, deploy target

# 3. Run the dev server
npm run dev                 # http://localhost:5173
```

On first run the **Onboarding wizard** asks for:
1. Your Home Assistant URL + a long-lived access token *(dev only — when run as a
   Home Assistant **add-on**, this step is skipped and the connection is automatic
   via the Supervisor proxy; see [ADDON.md](./ADDON.md))*
2. The villa **`.glb`** model (see [Model pipeline](#-3d-model-pipeline))
3. Your location (pre-filled from your HA instance when connected)

Everything is stored locally in the browser. No server-side config files.

---

## 🔑 Getting a Home Assistant token

1. In Home Assistant, click your **profile** (bottom-left).
2. **Security** tab → scroll to **Long-lived access tokens** → **Create token**.
3. Copy it and paste it into the kiosk's onboarding / settings.

> The token is stored in `localStorage` on the tablet. This is acceptable for a local-only kiosk on your LAN. Don't bake it into a build that leaves the property.

---

## 🗝️ Works with any villa (turnkey)

The app is **not** tied to any specific villa. The only required input is a **`.glb`
model** (the `.sh3d` is just one possible *source* you export from — the app
never loads `.sh3d`). To wire up a brand-new villa:

1. **Import the GLB** (onboarding or Settings → 3D model).
2. Wire it up — **two ways**, mix freely:
   - **Bind real objects** (Settings → *Bind 3D objects*): tap a lamp/curtain that
     exists as its own mesh, pick the live HA entity. The real object then reacts.
   - **Drop control markers** (Settings → *Drop control markers*): for devices that
     are **not** separate objects (a fused model), or **entities that don't exist
     yet** — tap any spot, a floating control is placed and linked to an entity_id
     (which can be added to HA later; it activates automatically when it appears).
3. Done — controls, panels and visual feedback work immediately.

**Entity names change over time?** No problem, and **no reload/rebuild needed**:

| Situation | What you do |
|---|---|
| Entity renamed in HA | Re-point the binding (tap object → pick new entity, or edit in the bindings table). |
| New device added | Bind any object to the new entity. |
| Device moved to another spot | Bind a different object; unbind the old one. |
| Panel/behaviour wrong | Change the entity **type** in the Config Editor (e.g. force `switch`). |

Everything persists in `localStorage`. The 3D model is independent of the entity
wiring, so you only re-import a model when the *building geometry* changes.

> 🔑 **Prerequisite:** a `.glb` of the villa. If you have a SweetHome 3D `.sh3d`,
> see the pipeline below to export one. If you already have a GLB from any tool,
> skip straight to import + bind.

## 🏠 3D model pipeline (.sh3d → .glb)

Start from your villa's SweetHome 3D plan (`.sh3d`). It must be exported to an optimised **GLB**. Full step-by-step in **[MODEL_PIPELINE.md](./MODEL_PIPELINE.md)**, summary:

```
SweetHome 3D → Export to OBJ
   → Blender → Decimate (≈0.3) → Recalculate normals → remove ceiling
   → name interactive meshes with their HA entity_id
   → add collision_* boxes + trigger_stair_up/down + teleport_* anchors
   → Export glTF 2.0 (Binary .glb, Draco ON)  →  target < 40 MB
```

> 💡 **Good news:** if your interactive objects are named with their full HA
> entity IDs (e.g. `camera.livingroom_cam`,
> `climate.living_room_air_conditioner`), the app matches meshes to entities
> automatically — so a clean export already "just works".

Upload the resulting `.glb` in the onboarding wizard or **Settings → 3D model**.

---

## 📁 Project structure

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

The 3D scene **never re-renders from React** — HA state changes are pushed
imperatively into Babylon via `HAStateStore.subscribeAll`, keeping the canvas
and the React UI fully decoupled.

---

## 🎛️ Runtime configuration

- **Settings** (gear icon): HA URL/token, location, model upload, backup/restore, Inspector.
- **Config editor** (`/config`): map any `entity_id` to a panel type + label + room, mark entities as "requires confirmation", and edit alert thresholds.
- **Teleport calibration**: open **Rooms**, then **right-click / long-press** any room card to save your current spot as that room's anchor.

---

## 📐 Calibrating teleport coordinates

Teleport anchors are derived from the real room geometry in the `.sh3d` (room
centroids, cm → m, recentred). If your GLB export uses different axes/scale:

1. Open **Settings → Inspector** (Babylon Inspector) to read world coordinates, **or**
2. Just walk to a room and **long-press its card** in the Rooms menu to set the anchor live.

Both paths update `localStorage` immediately — no rebuild.

---

## 📦 Building & deploying

```bash
npm run build      # type-checks then builds to dist/
npm run deploy     # scp dist/ to Home Assistant (reads VITE_DEPLOY_* from .env)
```

Then open: `http://<HA_HOST>:8123/local/villa-kiosk/`

Full production + kiosk setup (iOS Guided Access, Android Fully Kiosk, burn-in)
is in **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

---

## ⚡ Performance targets

| Metric | Target |
|---|---|
| Initial load | < 8 s on local WiFi |
| Frame rate | 30 fps min / 60 fps target (idles at ~0 when still) |
| GLB size | < 40 MB (Draco) |
| HA state latency | < 300 ms |
| Reconnect after HA restart | < 10 s |

---

## 🧭 Development phases (from the spec)

1. **Foundation** — scene loads, first-person camera, on-demand render ✅
2. **HA connection** — WebSocket, state store, mesh visuals ✅
3. **Tap + panels** — pick handler + all entity panels ✅
4. **Navigation polish** — teleport, room labels, alerts, day/night ✅
5. **Polish + kiosk** — theme, PWA, onboarding, config editor, backup, deploy ✅

---

## 📄 License & status

A generic, self-hostable Home Assistant villa dashboard. Bring your own `.glb`.
