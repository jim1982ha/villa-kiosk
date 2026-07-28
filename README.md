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

## Run as a Home Assistant add-on

The kiosk runs **only** as a Home Assistant add-on (requires **HA OS** or
**Supervised** — the Supervisor provides the token-less Core proxy and the
private storage the app depends on). One add-on, reachable two ways from the
same build. Full install instructions: **[ADDON.md](./ADDON.md)**.

- **In the HA sidebar (Ingress):** sidebar entry, HA-managed auth, nothing to
  enter. This is the zero-setup path.
- **On the add-on's own hostname (direct / Cloudflare):** the add-on also
  publishes host port **8099**, so you can point a Cloudflare Tunnel (or any
  reverse proxy) at `http://<HA-host-ip>:8099` and open the kiosk on its own
  URL, with none of the HA UI around it, and **install it as a PWA**.

### Access outside the sidebar, securely

Because port 8099 is internet-reachable once you map it, the add-on
authenticates itself — the client-side profile screen alone is not the gate:

- A profile passcode (`guest_pin` / `owner_pin` / `ops_pin` in the add-on
  options, verified server-side) mints a **signed, httpOnly session cookie**.
- Home-Assistant control (`/core`) and the villa floor plan (`/model`) refuse
  any direct request without that cookie. Sidebar (Ingress) requests are exempt
  — HA already authenticated them, and nginx tags them from the real gateway IP
  so the flag can't be forged.
- Set at least one passcode before mapping the port, and put **Cloudflare
  Access** (or equivalent) in front of the hostname for defence-in-depth.

To keep the kiosk sidebar-only, just leave port 8099 unmapped in the add-on's
**Network** panel.

### Installing as a PWA (the "Install" button)

The browser only offers **Install** on a **secure origin with a _trusted_
certificate** — i.e. the add-on's hostname reached over real HTTPS (a Cloudflare
Tunnel gives you this for free). Served at `/`, the PWA gets a clean root scope.

Two things that will **hide** the Install button:

- **Plain `http://`, or HTTPS with a self-signed/untrusted cert** → not a secure
  origin, no service worker, no install.
- **The Ingress sidebar path** (`/api/hassio_ingress/…`) → the service worker is
  disabled there on purpose (the session path rotates), so there is **no install
  button via the sidebar**. Use the add-on's own hostname for an installable PWA.

### Building it yourself (dev)

```bash
npm install
npm run build       # type-check + Vite → dist/  (baked into the add-on image)
```

> `dev`, `build` and `preview` auto-run **`npm run clean`** first (removes `dist/`,
> the Vite dep cache `node_modules/.vite`, and `tsconfig.tsbuildinfo`), so every run
> starts from a clean slate. For `npm run dev` against a real Home Assistant, set
> `VITE_DEV_PROXY` (see `.env.example`) to a running add-on's hostname so Vite
> forwards the backend routes (`/core`, `/auth`, `/model`, …) to it.

### Tablet kiosk mode

**iOS — Guided Access**

1. Settings → Accessibility → Guided Access → enable, set a passcode.
2. Settings → Display & Brightness → Auto-Lock → Never.
3. Safari → navigate to the kiosk URL → Share → **Add to Home Screen** (installs the PWA full-screen).
4. Open the installed app → triple-click the side button → **Start Guided Access**.

**Android — Fully Kiosk Browser** (recommended, ~€7)

| Setting | Value |
|---|---|
| Start URL | the add-on's own hostname, e.g. `https://kiosk.your-domain.com/` (via Cloudflare Tunnel → `http://<HA-host-ip>:8099`) |
| Prevent sleep / keep screen on | ON |
| Auto-reload on error | ON (30 s) |
| Hide navigation/status bar | ON |
| Allow camera | ON (for MJPEG streams) |
| Motion detection wake | ON |
| Brightness | ~70% |
| Launch on boot | ON |

**Android — free alternative:** Chrome → ⋮ → Add to Home screen, then enable the longest screen timeout and pin the app (Settings → Security → App pinning).

### Troubleshooting

| Symptom | Fix |
|---|---|
| Can't reach the kiosk on its own hostname | Check the Cloudflare Tunnel host points at `http://<HA-host-ip>:8099` and port 8099 is mapped in the add-on's **Network** panel. |
| Signed in but the villa/HA controls don't load | The session cookie isn't reaching the origin — direct access must be **HTTPS** (the cookie is `Secure`); confirm you're on `https://` and not plain LAN `http://`. |
| PIN pad rejects every code / no session | Set the matching `guest_pin`/`owner_pin`/`ops_pin` in the add-on options (4 digits), then reload. |
| Camera panel black | Verify the `camera.*` entity works in HA; frames route through the add-on proxy (no token needed). |
| Walks through walls | The GLB needs solid wall meshes or `collision_*` boxes — see MODEL_PIPELINE.md. |
| Teleport lands wrong | Recalibrate: Rooms → walk to the correct spot → long-press the room card. |
| Inspector won't open | It's a large lazy chunk; first open needs network. Rebuild + reinstall the add-on. |
| No install button | Only the add-on's own HTTPS hostname is installable — the Ingress sidebar path never is (service worker disabled there by design). |

---

## Development

```bash
npm install
npm run dev         # http://localhost:5173
npm run build       # production build
npm run typecheck   # type-check without building
```

There's no connection onboarding: the kiosk always reaches Home Assistant token-less through the add-on's Supervisor proxy, so it connects automatically. The only gate is the **profile passcode** (server-verified, and the basis for the session cookie on direct access). The 3D model auto-loads from the add-on's central `/data` store (see *Works with any villa* below for the first-run upload), and the villa's location silently adopts the connected HA instance's own lat/lng. For `npm run dev` against a real HA, set `VITE_DEV_PROXY` (see `.env.example`).

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

## Configuring interactive assets in SweetHome 3D

Everything below is **optional** — the app's runtime tap-to-bind works with an
unprepared model. But if you author your plan with these conventions, devices
auto-map **and** get richer live visual feedback with zero code or config. Full
detail: **[MODEL_PIPELINE.md](./MODEL_PIPELINE.md)**.

### 1. Name a piece with its HA `entity_id` → it auto-maps

Set a furniture piece's **Name** (SweetHome Properties panel) to the exact HA
entity_id (`light.kitchen_ceiling`, `climate.living_room_ac`, `camera.patio_cam`,
`lock.front_door`, `cover.living_room_curtain`, `fan.bedroom_ceiling`, …). On
import the mesh binds to that entity automatically — no tapping needed. The
pipeline matches by **3D position**, not the internal OBJ part names, so it works
even though SweetHome renames parts to things like `Sphere_1_1017`.

### 2. Any device — real state feedback via pose copies

**Any** entity — a `cover`, `lock`, `switch`, `light`, `fan`, `binary_sensor`,
`sensor`, anything — can show its **live state** by giving it one mesh per
state. Place the **same object 2+ times in the same spot**, each copy posed
differently, and suffix each Name with the state it represents:

```
cover.living_room_curtain__open      cover.living_room_curtain__closed
cover.living_room_curtain__half      (optional — see "half" below)

lock.front_door__locked              lock.front_door__unlocked

switch.gate_relay__on                switch.gate_relay__off

binary_sensor.front_door_contact__on binary_sensor.front_door_contact__off

sensor.pool_status__clean            sensor.pool_status__dirty
```

**One rule, no per-domain table: the suffix is the entity's own Home Assistant
state**, lowercased with anything that isn't a letter or digit removed. So a
`switch` uses `__on`/`__off` (that's what HA reports), a `cover` uses
`__open`/`__closed`, a `lock` uses `__locked`/`__unlocked`, and a sensor
reporting `not_home` uses `__nothome`. If you're unsure what to name a pose,
look at the entity's current state in Home Assistant — that's the word.

> Earlier versions had per-domain vocabularies (notably `__open`/`__closed` for
> door/window `binary_sensor` contacts). That translation is gone: a
> `binary_sensor` now uses `__on`/`__off` like everything else. If you authored
> contact poses under the old names, rename them.

**`half` — the one special word.** No entity ever reports "half" as a state, so
it's provided as a **virtual** pose available to **every** type. A device counts
as part-way when either:
- a numeric level attribute sits between its extremes — `current_position` (a
  cover), `brightness` (a light), `percentage` (a fan), `volume_level` (a media
  player); the band is 15 %–85 %, or
- its state is transitional (`opening`, `closing`, `locking`, …).

So `cover.x__half` (a half-drawn curtain) and `light.y__half` (a dimmed lamp)
work identically. `__half` is always optional — with only two poses authored,
a part-way device falls back to the nearer one.

**Unknown / offline states fall back to the rest pose.** A state you didn't
author a mesh for — including `unavailable`, `unknown`, or a lock's `jammed` —
shows the lowest-ranked authored pose (`off` / `closed` / `locked` / `idle`).
A lock never implies a door is open when its real state isn't known.

- All suffixed copies are treated as **one entity** (the suffix never affects
  binding, tapping, or RBAC).
- **Every pose needs an explicit `__word` suffix — including the rest one.**
  An **unsuffixed** piece is *never* treated as a pose; it's always-visible
  base/detail geometry that coexists alongside the suffixed poses (e.g. the
  physical keypad housing next to a `lock.front_door__locked`/`__unlocked`
  door leaf, visible either way). This is what lets you author, say, a fixed
  device body plus a swinging door/leaf without the two fighting over
  visibility. If you only ever want ONE always-there mesh for a device, just
  leave its name unsuffixed and skip pose authoring entirely — it behaves
  exactly as a plain bound object.
- Multi-pose authoring is fully opt-in and **per-device**: mix multi-pose
  devices with plain single-mesh ones freely in the same villa.
- You can use **different catalog models per pose** (e.g. a slim gathered curtain
  for `__open`, a full-width one for `__closed`) and different widths — the
  pipeline handles it. Detailed/high-poly catalog assets are fine.

### 3. Curtains & doors over windows — nothing special needed

Place curtains (or a door's frame/glass) **directly over their window**; the
pipeline keeps the window's glass/frame in the structural shell (so it stays
transparent and correctly lit) and never lets the curtain/door "absorb" it.
Only **one pose per device casts a shadow** into the light bake, so you won't
see a hidden pose's shadow ghosted onto the floor. The rule:
- if you also modelled an **unsuffixed** base mesh for that device, that's the
  one that bakes (every `__word` pose is excluded);
- otherwise the baked pose is **`__open` for a `cover`**, and **`__off` for
  everything else** — falling back to the lowest-ranked authored pose if
  neither exists.

### 4. Bake resolution

If your plan uses **detailed curtain/fabric geometry**, bake the lightmap at
**`--bake-size 2048`** (not 1024). The extra texel budget prevents lightmap-atlas
bleed (stray light smearing onto benches/frames) once the denser geometry re-packs
the atlas. See [MODEL_PIPELINE.md](./MODEL_PIPELINE.md) for all bake flags.

---

## Project structure

```
src/
├── babylon/      # ALL Babylon code (no React): scene, camera, lighting, picking, floors…
├── ha/           # Home Assistant: WebSocket, state store, service calls, history, cameras
├── config/       # AppConfig, EntityMap, TeleportPoints, thresholds (persisted to localStorage)
├── components/   # React UI: canvas, HUD, panels, teleport, settings, auth (profile gate)
├── pages/        # Dashboard (the only route — Advanced Settings is a modal over it, not a separate page)
├── hooks/        # useHAEntity, useHAEntities, useSceneReady
├── types/        # Shared TS types
└── utils/        # colour, sun, storage, backup, transforms
```

The 3D scene never re-renders from React — HA state changes are pushed imperatively into Babylon via `HAStateStore.subscribeAll`, keeping the canvas and the React UI fully decoupled.

---

## Runtime configuration

- **Settings** (gear icon): title, render quality, first-person/overview feel, device icon size, theme. No HA URL/token — the connection is automatic through the add-on proxy.
- **Advanced Settings** (Settings' footer → *Advanced Settings*, a modal over the live dashboard, not a page reload): 3D model source (upload the central GLB/room-data straight into the add-on's `/data` store), per-device configuration backup/restore, auto-detected entity settings (map any `entity_id` to a panel type + label + room, mark entities requiring confirmation), bound 3D objects, grouped devices.
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
