# Villa Kiosk

> Browser-based first-person 3D walkthrough of your villa, wired live to Home Assistant.

Walk through your villa in 3D on a wall-mounted tablet, teleport between rooms, and control every Home Assistant entity — lights, AC, locks, cameras, curtains, fans, sensors, media — by tapping the object in the scene or using a control panel.

Built with **React + TypeScript + Babylon.js**.

---

## Features

| Area | What it does |
|---|---|
| **First-person navigation** | Walk with a touch virtual joystick, look around by dragging, teleport to any room from the dial on a floor button. |
| **Tap-to-control** | Tap a light/switch/fan to toggle it instantly; long-press any device (or tap a cover/thermostat/camera/sensor/media player, which always opens on a plain tap) for its full control panel. |
| **Live visual feedback** | Lights glow and illuminate the room; curtains show open/half/closed; fans spin; locks go green/red; leak sensors pulse red. |
| **Live HA sync** | WebSocket connection with auto-reconnect; mesh visuals update within ~300 ms of a state change. |
| **Tap-to-bind** | Wire any imported model to HA by tapping objects and picking the entity — no entity-named meshes required. |
| **Live cameras** | Full-screen HLS stream, falling back to MJPEG then polled snapshots automatically, via the HA camera proxy. |
| **Day / night** | Scene lighting follows the real sun position for your location (or HA's `sun.sun`). |
| **Render quality** | Fixed at a tuned "high" look, with exposure, night dimming and lit-fixture glow strength individually adjustable (Settings) — no rebuild needed. |
| **On-demand rendering** | The GPU idles when nothing moves — essential for a 24/7 tablet. |
| **Runtime config** | Map meshes → entities, calibrate teleport points, set thresholds — all in-app, no code edits. |
| **Cockpit** | One tap → villa-wide status: what needs attention (offline devices, open faults, overdue maintenance, alarm-state sensors), a room/floor/category breakdown, today's energy use, recent activity from HA's own Logbook, and pending firmware updates. |
| **HA Scenes** | Any `scene.*` you've created in Home Assistant's own Scene Editor appears automatically — no separate kiosk-side scene system. Run one from the bottom dock's Scene tile, or from a room-scoped shortcut when opening that room's device list. |
| **Device groups** | Fold entities that are really one physical device (e.g. a combo sensor's separate temperature/humidity entities) into a single map badge, with a combined detail view for the rest. |
| **Room/floor navigation** | Long-press a floor button for a radial dial of that floor's rooms; tap one to fly there. A pinned "Manage rooms" chip adds/removes rooms from wherever the camera currently stands. |
| **Three profiles** | Guest (comfort control, narrower climate range, no cameras/energy), Owner (everything, plus config/model administration), Facility Manager (everything, plus Facility access, no config administration) — each optionally PIN-gated, verified server-side. |
| **Facility workspace** | Maintenance schedule with photo evidence, guest-readiness check, fault queue with resolution times, maintenance spend against a monthly cap, and a one-click monthly operations report — see [Facility Manager](#facility-manager) below. |
| **PWA** | Installable, works briefly offline; shared config (device↔room bindings, room viewpoints, device groups) auto-syncs across every client through the add-on's own store, so there's nothing to manually back up or restore. |

---

## Tech stack

- **React 18** + **TypeScript** (strict, functional components + hooks only)
- **Babylon.js 7** (`@babylonjs/core`, `@babylonjs/gui`, `@babylonjs/loaders`, `@babylonjs/materials`)
- **Vite** build
- **lucide-react** icons · **hls.js** for camera streaming (HLS, with MJPEG/snapshot fallback)
- **IndexedDB** for the GLB model · **localStorage** for per-device config
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

#### `.env` — optional, and only for local development

`.env.example` is a template you copy to `.env` when running `npm run dev` on
your own machine. **Nothing in it is needed to run the add-on**, and no `.env`
is baked into the published image — a normal install never has one. Every value
is optional.

| Variable | What it does |
|---|---|
| `VITE_DEV_PROXY` | The only one you are likely to want. Points `npm run dev` at a running add-on's hostname (e.g. `http://homeassistant.local:8099`) so Vite forwards `/core`, `/auth`, `/addon-config`, `/model` and `/model-upload` to it. Leave it unset to work on the UI shell alone — backend calls then 404, which is fine for pure visual work. |
| `VITE_LAT` / `VITE_LNG` | A fallback villa location for sun position, used only in the moments before the app adopts the connected Home Assistant instance's own coordinates. Ships as `0`/`0`; there is no reason to change it for a real install, since HA supplies the real value on connect. |

There is deliberately **no** Home Assistant URL or token here. The kiosk is
always served by the add-on and reaches Core token-lessly through its Supervisor
proxy, and profile passcodes are add-on options verified server-side — none of
that ever lives in the client bundle.

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
| Allow camera | ON (for live camera streams) |
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
| Teleport lands wrong | Recalibrate: long-press a floor button → the pinned "Manage rooms" chip → walk to the correct spot → long-press the room card. |
| No install button | Only the add-on's own HTTPS hostname is installable — the Ingress sidebar path never is (service worker disabled there by design). |

---

## Security model

The add-on's proxy is the security boundary — **not** the React UI. Anything
the client enforces (`permissions.ts` categories, hidden buttons) is a
rendering convenience; a browser can send whatever it likes, so every rule that
matters is also enforced in `rootfs/usr/bin/supervisor-proxy.py`.

| Surface | Rule |
|---|---|
| Sessions | HMAC-signed cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), 30-day life, key persisted 0600 in `/data` |
| Log out | The profile chip's sign-out clears this browser's cookie only. **Advanced Settings → Session → Log out all devices** (Owner) instead bumps a signing epoch server-side, invalidating **every** outstanding session at once — including the device that clicked it |
| PIN entry | 4 digits, constant-time compare, rate-limited per client IP **and** globally per role |
| Blank PIN | The add-on ships `guest_pin`, `owner_pin` and `ops_pin` all **empty**. Empty means different things per role: `owner`/`ops` become *unavailable* (never open), while `guest` becomes *open to anyone* — no prompt at all. Since guest can unlock doors, leave `guest_pin` blank only on a villa you are happy for any visitor to control. There is no second PIN to add; this is the same field in the add-on options |
| HA REST (`/core/api/*`) | Default **deny** for non-owners: ambiguous paths refused outright, then an allowlist of what the kiosk actually calls |
| HA websocket | Default **deny** for non-owners: only the seven frame types the kiosk sends. Blocks `execute_script`, which otherwise wraps a forbidden service call and walks straight past the service allowlist |
| Facility data + evidence photos | `owner`/`ops` only, on both read and write |
| Erasing a facility record | A fault, a spend entry or a logged completion can be **destroyed** only with the 6-digit `superadmin_pin`, entered per deletion. The server refuses any write that removes one without a fresh single-use authorisation, so this is not a UI-level rule; leaving `superadmin_pin` empty makes the records permanently un-erasable from the app. Reached by pressing and holding the row — not a fourth profile, and additive: you still need `owner`/`ops` |

### Tunable policy (add-on options)

Four values that are policy rather than preference — no single number is right
for every property — are add-on options instead of constants in the code. All
are read live (no restart needed) and clamped server-side, so a hand-edited
`options.json` can't turn one into "keep nothing" or "never expire".

| Option | Default | What it decides |
|---|---|---|
| `evidence_retention_days` | 550 | Age at which a photo is deleted (~18 months = a 12-month agreement plus the dispute window). `0` switches age-based deletion off entirely. Independent of the automatic clean-up of photos nothing references, which always runs |
| `session_days` | 30 | How long a profile stays signed in before the passcode is asked again. Long for a wall tablet; short where guests use their own phones, so a departing guest's session lapses on its own |
| `telemetry_max_events` | 500 | How much diagnostic history is kept. Raise it while chasing an intermittent fault on someone else's device |
| `pin_lockout_minutes` | 5 | How long a device that entered five wrong passcodes must wait. Per source address, so raising it punishes a guesser rather than the household |
| Uploads | Owner only, magic-byte checked, size-capped, destination path traversal-checked |

Run the regression suite — every assertion is a hole that was once open:

```bash
python3 tests/security_test.py
```

### Reviewing the Content-Security-Policy

The CSP ships as `Content-Security-Policy-Report-Only`. A wrong CSP bricks a
kiosk someone has to be physically present to recover, so it reports before it
enforces. To promote it: load the kiosk on a phone and a laptop, exercise
cameras, uploads and the 3D view, and if the console reports no violations,
rename that one header in `nginx.conf` to `Content-Security-Policy`.

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

1. **Upload the GLB** (Advanced Settings → the upload icon in the modal header, Owner profile).
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

### 3. Camera view cones (the red beam)

A camera shows a red beam only when **all** of these hold:

1. The entity maps to at least one mesh in the model.
2. That piece carries a **rotation** in SweetHome 3D — the beam points where
   the camera points, so a camera left at angle 0 gets no beam rather than a
   guessed direction. Set the furniture's **angle** to aim it; that is the only
   thing you need to author. The beam always tilts **30° down** from horizontal,
   which is what a ceiling- or high-wall-mounted camera is actually looking at
   — a level beam would run along the same plane as the mesh instead of toward
   the floor below it. The beam clips against walls.
3. The camera has a **motion sensor** wired to it (the optional linked-entity
   field on the device card), and that sensor is `on`.

The beam's compass heading is derived from `angle` plus a fixed correction for
which way the catalog CCTV model itself faces at `angle=0` (see
`CAMERA_MODEL_FRONT_OFFSET_RAD` in `SceneManager.ts`) — the affine world
transform that places every camera is independently proven correct (camera
*positions* always render correctly), so if a beam's heading is still off
after aiming `angle` at the intended target, that constant is the one place
to adjust, not the transform itself.

Load the app with `?debug` and it prints which cameras qualified and, for the
rest, exactly why they were skipped (`no mesh`, `no sh3d angle data`,
`angle is 0`).

### 4. Bake resolution

If your plan uses **detailed curtain/fabric geometry**, bake the lightmap at
**`--bake-size 2048`** (not 1024). The extra texel budget prevents lightmap-atlas
bleed (stray light smearing onto benches/frames) once the denser geometry re-packs
the atlas. See [MODEL_PIPELINE.md](./MODEL_PIPELINE.md) for all bake flags.

### 5. Geometry budget — why the GLB is big, and what actually helps

A villa GLB is **~92 % geometry, ~6 % textures** — so shrinking images barely
moves the needle, and a heavy source model is what makes both the pipeline and
the app's load slow. The pipeline caps runaway meshes automatically:

| Flag | Default | Applies to |
|---|---|---|
| `--max-object-faces` | 5 000 | structural geometry (walls, plants, plot) |
| `--max-entity-faces` | 20 000 | bound devices (curtains, lamps, …) |

Anything under its budget passes through byte-identical; only the runaway
cases are collapse-decimated. The two worst offenders in practice, both from
the SweetHome catalog:

- **Cloth-sim curtains** — ~248 000 faces *per pose*. Eight multi-pose curtains
  were 37 % of one villa's entire 29 MB GLB. **Every pose is its own mesh and
  every pose goes through the same `--max-entity-faces` cap** — `__open`,
  `__half` and `__closed` alike. Nothing is exempt; a gathered `__open` pose is
  simply a few hundred faces already, so it passes the cap byte-identical while
  its 248 k-face `__closed` sibling gets collapsed.
- **Plants/vegetation** — 20 k–70 k faces per *placed copy*, and the OBJ export
  writes the full geometry for every copy, so a bushy garden multiplies fast
  (one garden reached 5.2 M triangles). These are **not** exempted from the
  light bake — they are decimated *before* it, by the structural
  `--max-object-faces` budget, which is also what makes the UV-unwrap and bake
  passes affordable. A bush keeps its silhouette at 5–10 % of its faces at
  kiosk viewing distance. Vegetation materials are separately pinned to the
  always-visible exterior group, so palm crowns and the plot survive a floor
  toggle instead of vanishing with the storey they were nearest. Prefer
  low-poly plants in SweetHome anyway — the cap is a backstop, not a substitute.

The `.obj` handed to the pipeline is plain ASCII and will be **~1 GB** for a
detailed villa — that's normal and only affects pipeline runtime, not the app.
Only three things are actually needed from the export: the `.obj`, its `.mtl`,
and the texture images the `.mtl` references. If you export from macOS onto a
non-native filesystem you'll also get `._*` AppleDouble files and `.DS_Store` —
pure noise, safe to delete.

---

## Facility Manager

The kiosk ships three profiles — **Guest**, **Owner** and **Facility manager**
(`ops`). The Facility manager and the Owner both get a **Facility** workspace,
opened from the clipboard icon in the top bar.

It exists because a villa under professional management has obligations that
have to be *evidenced*, not just performed. The tabs map to that:

| Tab | What it answers |
|---|---|
| **Today** | What maintenance is due or overdue, worst first, each card showing the target date its interval implies. Logging a completion records who did it, when, an optional cost, and photo evidence. A task can be removed individually or all at once (with a confirm step). |
| **Readiness** | Is the villa fit for the next guest? Every check is derived from live device state — devices reporting, doors locked, lights off, AC reachable, cameras online, pool serviced, no open faults — so it can't be ticked off without being true. "All devices reporting" links straight to the same Unavailable-devices list the HUD's own alert badge opens, so the two counts can never disagree. |
| **Faults** | The work queue. Devices Home Assistant already reports as offline can be turned into a fault in one tap, or search across every configured device (with free text for one that isn't in the list — a spare part, something not yet in Home Assistant). The app stamps the resolution time itself, which is what makes mean-time-to-resolution meaningful. |
| **Spend** | Maintenance spend this month against a configurable monthly cap, optionally tied to a device the same way Faults is, with the projected total shown *before* an entry is saved — the point at which the decision is still open. |
| **Schedule** | Add, edit, pause or remove maintenance tasks — interval (with presets like "twice a month"), optional room, optional contract reference. Every task shows the target date its interval implies, from its last completion or (if never done) from when it was created — the same date the Today board shows. Removing a task keeps the completions already logged against it; "Delete all" clears the schedule the same way. |
| **Report** | Press **Generate report** to snapshot the villa's current Readiness/Faults/Spend/Schedule status into a formatted preview for any month. **Download .md** saves the underlying Markdown unchanged. |

Every device panel's footer also has a **Report a fault** shortcut, open to every profile including Guest. A Guest gets a minimal one-screen form (what's wrong, optional notes, optional photo) that files a ticket flagged as guest-reported — visually tagged in the Faults tab so triage staff know they're reading a symptom, not a diagnosis — with no visibility into the fault history, cost or status afterward. An Owner/Facility manager instead lands directly in the Faults tab with that device pre-selected.

Faults and spend entries are *evidence*, so nothing in the normal interface
deletes one — resolving a fault keeps it, and the record of what was spent is
what an audit rests on. When an entry genuinely has to go (a duplicate, a test
row, a figure entered against the wrong villa), press and hold it: a prompt
asks for the 6-digit `superadmin_pin` from the add-on options, and only then is
the record — with its evidence photos — destroyed. A faint dot in the corner of
a row marks one that can be erased this way. Schedules and saved reports are
not covered: a schedule is a plan and a report can be regenerated, so both keep
their ordinary delete buttons.

### Evidence storage

Photos are downscaled in the browser to ~1600 px JPEG before upload, then
stored in the add-on's own `/data` volume alongside the maintenance record.
They're pruned automatically after ~18 months. A year of routine evidence is
tens of megabytes, which is why this is local rather than pushed to a cloud
album: it keeps the evidence with the data it belongs to, and works when the
villa's uplink doesn't.

---

## Project structure

```
src/
├── assets/       # Vendored binaries that must ship offline (the KTX2 transcoder)
├── auth/         # Profiles, PIN verification, RBAC permissions, superadmin elevation
├── babylon/      # ALL Babylon code (no React): scene, camera, lighting, picking, floors…
├── components/   # React UI: canvas, HUD, panels, teleport, settings, auth, cockpit, fm
├── config/       # AppConfig, EntityMap, TeleportPoints, thresholds, device-config sync
├── fm/           # Facility Manager: engine, report builder, data context
├── ha/           # Home Assistant: WebSocket, state store, service calls, history, cameras
├── hooks/        # useHAEntity, useEntityLabel, useLongPress, useOptimisticToggle…
├── pages/        # Dashboard (the only route — every settings screen is a modal over it)
├── types/        # Shared TS types
└── utils/        # colour, sun position, storage, telemetry, geometry, boot timeline
```

The 3D scene never re-renders from React — HA state changes are pushed imperatively into Babylon via `HAStateStore.subscribeAll`, keeping the canvas and the React UI fully decoupled.

---

## Using the kiosk

### The HUD

The top bar has three zones. **Left**: a home/brand chip — tap it to jump to this device's own saved bird's-eye default view; while already in bird's-eye view, long-press it (right-click / hold Space on desktop) to save the current framing as that default. **Centre**: one filter icon per device category (Comfort, Light, Network, Energy, Access Control, Others — only the categories your profile can see appear at all) — tap to show/hide that category's badges on the map, long-press to open a plain list of every device in it instead; a "?" at the end opens the **colour Legend**. Next to it, a −/+ stepper resizes every badge/label on the map. **Right**: Cockpit, Facility (Owner/Facility Manager), the first-person/bird's-eye view toggle, the profile chip (with sign-out), and Settings — collapsing into a single "⋮" overflow menu on a phone.

Below the brand chip, a vertical stack of floor buttons ("1F"/"2F", …) sits in the left column, with the view-mode toggle just under it. Tap a floor button to switch storeys; **long-press** one instead opens the **Rooms dial** — a radial fan of tappable room chips for that floor, with a pinned "Manage rooms" chip that opens the full Rooms grid (add a room at wherever the camera currently stands, delete one, or tap a card to teleport there). The bottom bar carries only the movement joystick, shown while walking in first-person.

On the 3D map itself: tapping a light/switch/fan toggles it instantly (confirmed with a tap-point ripple, not a popup); **long-press (500ms)** any device to open its full control panel; covers/thermostats/media/cameras/sensors always open their panel on a plain tap since a quick toggle doesn't make sense for them; a device flagged "confirm before toggling" always asks first. Tapping a zoomed-out cluster of nearby badges navigates to that room, same as picking it from the Rooms dial.

### Cockpit

One tap on the alert icon opens a villa-wide status report, open to every profile: a health headline, a list of everything that needs attention (offline devices, open faults, overdue maintenance, alarm-state sensors — each tap-through to its own device panel), a Room/Floor/Category breakdown of every device in the house, today's energy total (if HA's Energy Dashboard is configured), the last few hours of HA's own Logbook filtered to real villa devices and phrased in plain language, and — for Owners — a count of pending firmware/add-on updates. The same "needs attention" count drives the HUD's own alert badge, so the two numbers can never disagree.

### The bottom dock

A horizontally-scrolling strip of tiles, derived automatically from whatever entities exist — nothing to configure: **Door Lock(s)**, **Pool** (any switch named/roomed like pool/jacuzzi/spa equipment), **Lights** ("N on"), **AC** (average current room temperature across running units), **Energy** (total instantaneous wattage, read-only), and **Scene** (present whenever any `scene.*` entities exist). Every tile opens a grouped list of its devices, individually controllable inline; a profile without control rights over that category still sees the tile, read-only. The dock can be hidden entirely from Settings.

### Entity control panels

Tapping into a device opens the panel for its domain: **Light** (on/off, brightness, colour temperature, 24h history), **AC/Climate** (current + target temperature, mode buttons, fan-speed buttons — Guests get a narrower adjustable range clamped from the device's real limits), **Lock** (status pill, lock/re-lock, unlock behind a confirm step, 24h history), **Camera** (full-screen HLS → MJPEG → snapshot fallback, prev/next cycling with swipe support and a long-press picker list, pinch/wheel zoom and pan, a merged online/motion/offline 24h timeline), **Cover** (open/stop/close, a position slider if supported, 24h history), **Fan** (on/off, named speed and preset buttons, 24h history), **Switch/media/sensor/binary_sensor**, a **Generic** fallback for anything with no dedicated panel, and a **Device group** combined view (dual-axis sparkline for a two-member group, stacked sparklines otherwise). Every panel's header badge is tappable (for a profile allowed to edit config) to recolour just that device on the map.

### HA Scenes

Scenes are read live from Home Assistant's own `scene.*` entities and Scene Editor — there is no separate kiosk-side scene system to keep in sync. The dock's **Scene** tile lists every scene by name; picking one runs it. Opening a room's device list also surfaces a "Scenes for this room" shortcut row, scoped to whichever scenes actually touch that room's entities.

### Device groups

Some physical devices report as two or more HA entities (a combo temperature/humidity sensor, for instance) — grouping folds them into one map badge, with every member's value and 24h history in that badge's own detail view instead of a second badge cluttering the map. Set one up in **Advanced Settings → Grouped devices**: pick the primary entity that keeps the badge, add members via the inline picker, or accept an auto-suggested pairing (from HA's own device registry first, a naming-convention fallback second) — nothing is grouped without an explicit tap.

### Settings

**Settings** (gear icon, all profiles) covers personal comfort and appearance: theme (Light/Dark/Auto), dashboard title (Owner-only shared branding), Clickable Glow and Natural Scroll toggles, Brightness and Night-dimming sliders, a Day/Auto/Night preview override (baked-lighting villas only), Light-effect strength, badge style (Default vs. Card), the dock show/hide toggle, and first-person eye-height/walk-speed sliders. Everything applies and persists live — there's no separate save step.

**Advanced Settings** (Settings' footer, Owner-only except device telemetry) is villa administration: an icon-only GLB/room-data upload button in the modal's own header (next to a model-info tooltip showing filename, size, mesh count, load timings and SHA-256), villa latitude/longitude, the auto-detected entity table (every mesh already named after its own entity_id — toggle visibility, set type/category/label, flag "confirm before toggling", per-light intensity override, link a secondary entity or a camera's motion sensor, redirect a mesh to a different entity_id), **Bound 3D objects** (manually bind an unnamed mesh to any entity via a live searchable picker, plus audit lists of unbound objects and entities with no 3D object at all), **Grouped devices**, **Device telemetry** (per-device load/error diagnostics, exportable), and **Session** (Log out all devices — immediately invalidates every signed-in session, including the one clicking it, for a lost tablet or a PIN someone saw).

### Profiles & access control

Three profiles, chosen at first launch and optionally PIN-gated (verified server-side, never client-side): **Guest** (comfort control only — Comfort/Light/Network/Access-Control categories, a narrower climate range, no cameras, no config), **Owner** (everything, plus config and model administration), **Facility Manager** (everything, plus Facility access, but not config administration). A separate, session-less **superadmin** code (distinct from any profile PIN, configured in the add-on options) permanently erases a Facility record — a fault, a spend entry, a saved report, or a logged completion — reached only by press-and-holding a row inside the Facility workspace; a correct code authorises exactly one deletion and is never cached or reusable.

### Teleport calibration

Long-press a floor button → the pinned "Manage rooms" chip → walk to the correct spot → long-press the room card to save it as that room's anchor. A room's framing is computed live from its floor-plan polygon every time you arrive, not a hand-saved camera shot.

### Render quality

Render quality is fixed at the "high" look by design — there is no per-effect
picker to fight with — but three dials stay adjustable in Settings: overall
exposure, night dimming, and how strongly a lit fixture glows.

Those act on the *live* scene. The lighting actually baked into the GLB is set
separately, by the [Blender pipeline](MODEL_PIPELINE.md)'s own flags (sun angle
and strength, sky strength, day ambient, night fill and ambient), so a villa can
ship a tuned look and the runtime dials then trim it per device.

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

Proprietary — all rights reserved. The full terms are in [`LICENSE`](LICENSE) at
the repository root (a plain `LICENSE` file, not Markdown).

Being able to read this source grants no rights over it: there is no permission
to use, copy, modify, or distribute the software, and viewing the repository
does not create a licence. `package.json` is marked `UNLICENSED` to keep tooling
consistent with that. Contact the copyright holder for licensing enquiries.
