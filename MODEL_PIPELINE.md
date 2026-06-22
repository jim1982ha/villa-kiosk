# 🏠 3D Model Pipeline — SweetHome 3D → GLB

How to turn `TheLysHouse_1F.sh3d` into the optimised `.glb` the kiosk loads.

---

## ⛳ What is actually required vs optional

The **only hard prerequisite is a `.glb` file.** Everything else below improves
quality but is not a gate — the app's runtime **tap-to-bind** system means you do
**not** have to name meshes or hand-prepare the model the way you might assume.

| Step | Status | Why |
|---|---|---|
| Export a **`.glb`** | **Required** | The app loads GLB only (never `.sh3d`). |
| Decimate (reduce polys) | **Recommended** | Smooth FPS on a tablet; skip it on a powerful device. |
| Recalculate normals | **Recommended** | Avoids black/invisible walls in first-person. |
| Remove ceiling | **Recommended** | Cleaner first-person view; harmless to keep. |
| Solid walls **or** `collision_*` boxes | **Recommended** | Needed only because we *walk* (3Dash orbits, so it skips this). Without it you can walk through walls. |
| Separate meshes per device | **Optional** | Only needed to control the *real* object. If devices aren't separate objects, use **marker mode** (drop a floating control at a tapped point) — works on a single fused mesh. |
| Name meshes with entity IDs | **Optional** | Nice auto-mapping, but **tap-to-bind** does the same at runtime with zero naming. |
| `teleport_*` anchors | **Optional** | We ship computed coordinates + live calibration. |
| `trigger_stair_*` | **Optional** | Only for walk-up floor switching; the floor button works without it. |

> **Why 3Dash needs none of this:** it uses an *orbital* camera (no walking → no
> collisions/teleports) and spawns its **own** marker meshes for lights/sensors
> (`LightMeshFactory` etc.) instead of using your model's meshes (no naming). We
> go further — first-person walking + controlling the *real* objects — which is
> what introduces the recommended prep. With tap-to-bind, our true minimum is the
> same as 3Dash's: **just import a GLB.**

**Minimum turnkey path:** export GLB → import → wire up by tapping:
- **Bind 3D objects** for things that are separate meshes, and/or
- **Drop control markers** for things that aren't (fused model) or for entities
  you'll add to HA later.

That's it — no naming, no collision boxes, no teleport baking required.

---

## Why this step exists

SweetHome 3D produces high-quality but heavy geometry. Babylon needs a compact,
correctly-named GLB so that:

- the tablet GPU can render it smoothly (< 200k polys, Draco-compressed),
- the first-person camera doesn't fall through floors or walk through walls,
- tapping an object resolves to the right Home Assistant entity.

**Target: a single `.glb` under 40 MB.**

---

## ✅ Already done for you in this model

In `TheLysHouse_1F.sh3d`, the interactive objects are **already named with their
full Home Assistant entity IDs**, for example:

```
camera.livingroom_cam
camera.kitchen_cam
climate.living_room_air_conditioner
lock.living_room_aqara_smart_door_lock_0aa9_lock_mechanism
cover.curtain_living_room_big        (×2 panels)
cover.curtain_master_bedroom         (×2 panels)
fan.guest_bathroom_guest_bathroom_fan
binary_sensor.water_leak_water_heater_1f_water_leak
sensor.sensor_t1_temperature
media_player.tv
assist_satellite.macbook_satellite
```

The kiosk's `resolveMeshToMapping()` matches these automatically (it also
tolerates `dots → underscores` if the exporter renames them, and the spec's
`[type]_[room]` aliases). **So you mostly just need to export cleanly.**

What you still add manually (invisible helpers): collision boxes, staircase
triggers, and optional teleport anchors (the app already ships sensible teleport
coordinates derived from the room geometry, so anchors are optional).

---

## 💡 Lights & activatable devices — visual feedback

**Yes, lights are fully handled and configurable** — they just weren't called out
before because the *current* `TheLysHouse_1F.sh3d` contains no `light.*` entity
yet. The moment you bind a light, it works. Here's exactly what each device type
does in the 3D scene, all driven by the binding's **type** (editable in the
Config Editor, so you choose what each object does):

| Entity type | What happens in the visualisation |
|---|---|
| **light** | The bound object **glows**, *and* a real light source **illuminates the room**. Colour follows the bulb's `hs_color` / `color_temp`, brightness follows the dimmer, OFF = dark. |
| **cover** (curtain/blind) | **Three states**: fully **closed** (mesh full height) · **half / partial** (when opening, closing, or any position between) · fully **open** (mesh retracts & fades). If the device reports `current_position`, it's continuous 0–100%. |
| **fan** | Blades **spin** while on, stop when off. |
| **switch** | Object lights up with an "active" tint when on (good for pumps, etc.). |
| **media_player** | "Active" tint when playing/on. |
| **lock** | **Green** when locked, **red** when unlocked. |
| **binary_sensor** | **Pulsing red** when triggered (e.g. water leak). |
| **climate / camera / sensor** | No state-driven mesh change; tapping opens the control/stream/reading panel. |

### How you choose what's activatable

1. **Bind it** — in the villa, open **Settings → Bind 3D objects (tap mode)**,
   tap the lamp / curtain / fan, and pick the HA entity. Or use the
   **Config Editor → 3D object → entity bindings** table.
2. **Pick the behaviour** — the visual reaction is decided by the entity **type**.
   It's auto-detected from the entity's domain (`light.*`, `cover.*`, …) and you
   can override it per entity in the **Config Editor → Entity metadata** table.
3. That's it — the scene updates **live**, no model reload, no rebuild.

> A light doesn't need a special "lamp" mesh: bind a `light.*` entity to **any**
> object (a ceiling, a pendant, a wall plate) and a light source is placed at
> that object's position. For the most realistic result, bind to the actual
> light-fixture mesh.

### Optional: pre-name light meshes in the model

If you'd rather not bind by tapping, name the fixture meshes after the light's
`entity_id` (or the `light_<room>_<id>` alias) and they auto-map on import — same
as the other devices already named in TheLysHouse:

```
light.living_room_ceiling          (or alias: light_living_room_ceiling)
light.kitchen_ceiling
light.master_bedroom_ceiling
light.pool_area
…
```

---

## Step 1 — Export from SweetHome 3D

```
3D View → Export to OBJ format
```

Output: `TheLysHouse_1F.obj` + `.mtl` + a `textures/` folder. Keep them together.

---

## 🧭 Blender navigation primer (read first if you're new)

You only need a few moves. Do them with the mouse **over the big 3D area**:

| Action | How |
|---|---|
| Rotate the view | Hold **middle mouse button** and drag (trackpad: two-finger drag, or drag the coloured axis-ball, top-right of the viewport). |
| Pan | **Shift + middle mouse** and drag. |
| Zoom | Mouse **scroll wheel**. |
| **See everything** | Press **Home**. |
| Frame the selected object | Press **`.`** on the numpad (or View → Frame Selected). |
| Select an object | **Left-click** it (in the viewport or in the Outliner list, top-right). |
| Select all / none | **A** / **Alt+A**. |
| Delete selected | **X** then confirm (or the Delete key). |

The **Properties panel** is the column of icons on the right. The blue **wrench**
icon = *Modifiers*. The orange **square** icon = *Object*.

---

## Step 2 — Import into Blender

```
File → Import → Wavefront (.obj)   →  pick TheLysHouse_1F.obj
```

(If you already have a `.glb` instead, use **File → Import → glTF 2.0** — but if
that GLB already shows the full villa, you can skip Blender entirely and just
upload it to the kiosk.)

After importing, press **Home** to frame everything. **You should see the rooms
and walls.** If you only see a small grey cube, the import brought in nothing —
your source file is empty; redo Step 1.

---

## Step 2b — Clean the scene (do this every time)

A fresh Blender file ships with a **Cube, Camera and Light** you don't want.

1. In the **Outliner** (top-right list), left-click **Cube** → press **X** → confirm.
2. Do the same for **Camera** and **Light** (we don't need them).
3. Press **Home** again. Now only your villa remains.

---

## Step 3 — ⚠️ Do NOT join the objects

**Keep the objects separate.** Earlier this guide suggested joining everything —
that was wrong: **joining merges all meshes and deletes their names**, including
the entity-named meshes (`camera.kitchen_cam`, `climate.*`, …). The app relies on
those names to:

- **auto-detect scale + place rooms** (it reads their known plan positions),
- **label rooms** correctly,
- **tap objects to control them**.

If you joined them, the app will log `room calibration skipped (0 reference
meshes)` and rooms won't be detected. So: **skip joining entirely** — just import
and export. (Decimate in the next step can still be applied per-object or to a
multi-selection without joining.)

---

## ✅ Do Steps 4–7 matter? Usually **no** — export first

The **only mandatory cleanup is deleting the default Cube** (Step 2b). Steps 4–7
are optional or not relevant to Floor 1. The recommended workflow is:

> **Export now (Step 8), upload to the kiosk (Step 9), and test.** Only come back
> to Blender if you actually see one of these symptoms:

| Symptom in the kiosk | Then do | Otherwise |
|---|---|---|
| Movement is **choppy / slow** on the tablet | **Step 4** (Decimate) | skip it |
| Walls look **see-through or black** from inside | **Step 5** (Recalculate Normals) | skip it |
| — | **Steps 6 & 7** | always skip for Floor 1 |

If you'd like to do the one quick, safe step before exporting anyway, do **Step 5**
(30 seconds, never hurts). Everything below is reference for *if/when* you need it.

---

## Step 4 — Decimate (reduce polygons) — *only if it runs slow*

Makes the file lighter so it runs smoothly on a tablet.

1. Click the object to select it.
2. In the Properties column, click the blue **wrench** (Modifier Properties).
3. **Add Modifier → Generate → Decimate**.
4. In the **Ratio** field, type **0.3** and press Enter. (Lower = lighter/rougher.)
5. Click the **dropdown (˅)** on the modifier's header → **Apply**.

To watch the triangle count: top-right of the viewport open the **Overlays**
dropdown (two overlapping circles) → tick **Statistics**. Aim under ~200k triangles.

> On a powerful PC you can skip this entirely.

---

## Step 5 — Fix normals — *only if walls look see-through*

Stops walls turning black or see-through when you're inside a room.

1. Select the object, hover the 3D area, press **Tab** to enter **Edit Mode**.
2. Press **A** to select all.
3. Top menu: **Mesh → Normals → Recalculate Outside** (shortcut **Shift + N**).
4. Press **Tab** again to return to Object Mode.

---

## Step 6 — Ceiling & collisions (you can skip)

- **Ceiling:** the kiosk camera stands at 1.7 m, so the ceiling rarely gets in the
  way. If your model has an annoying separate roof object, click it → **X**.
  Otherwise skip.
- **Collisions:** the kiosk treats your **solid walls** as collision automatically —
  no special boxes needed. Just make sure walls are real geometry (they will be
  from SweetHome). Skip unless you want perfectly tuned movement.

---

## Step 7 — Staircase triggers & teleport anchors (skip for now)

Both are **optional**:
- Staircase triggers only matter once you add **Floor 2**.
- Teleport anchors are already computed by the app, and you can re-anchor any room
  live (**Rooms → long-press a card**). Floor 1 needs neither.

Skip straight to export.

---

## Step 8 — Export GLB

1. **File → Export → glTF 2.0 (.glb/.gltf)**.
2. In the panel on the right of the save dialog, set:

| Option | Value |
|---|---|
| **Format** | **glTF Binary (.glb)** |
| **Include → Selected Objects** | off (export everything) |
| **Data → Mesh** | keep **Apply Modifiers**, **UVs**, **Normals** ticked |
| **Data → Material → Images** | keep on (textures) |
| **Data → Compression (Draco)** | see note below |
| **Transform → +Y Up** | on (default) |

3. Name it `TheLysHouse_1F.glb` and click **Export glTF 2.0**. Aim for **< 40 MB**.

> **Draco note:** Draco shrinks the file a lot, but to *decode* it the kiosk needs
> a small helper that Babylon fetches from the internet by default. If your tablet
> is **local-only (no internet)**, either **leave Draco OFF** (simplest — fine if
> the file is already under ~40 MB), or ask to have the Draco decoder bundled into
> the app so it works fully offline.

---

## Step 9 — Load it into the kiosk

- Onboarding wizard **step 2**, or
- **Settings → 3D model → Upload .glb**.

It's stored in the browser (IndexedDB), so it survives refreshes — you upload once.
Then wire it up by tapping: **Settings → Bind 3D objects** and/or **Drop control
markers**.

---

## Coordinate reference (already baked into the app)

Derived from the `.sh3d` (SweetHome cm → metres, recentred on the model centre
`(1206, 614) cm`, scale `0.01`). These are the default teleport anchors:

| Room | Babylon (x, y, z) |
|---|---|
| Living Room | (−1.56, 1.70, 1.36) |
| Kitchen | (−9.06, 1.70, −1.94) |
| Dining Area | (−5.46, 1.70, 2.06) |
| Entrance | (−2.94, 1.70, −2.30) |
| Guest Bathroom | (3.77, 1.70, −1.82) |
| Bedroom 1 | (2.73, 1.70, 2.26) |
| Master Bedroom | (6.53, 1.70, 1.13) |
| Master Bathroom | (10.20, 1.70, 2.26) |
| WIC / Dressing | (7.40, 1.70, −1.17) |
| Storage / Laundry | (10.20, 1.70, −1.17) |
| Pool / Garden | (−10.56, 1.70, −4.64) |

If your export uses a different scale/axis, adjust `DEFAULT_MODEL_TRANSFORM` in
`src/config/AppConfig.ts`, or just recalibrate live (no rebuild).

---

*Smart Resilient Property OS · TheLysHouse · Confidential*
