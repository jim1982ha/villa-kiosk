# 3D Model Pipeline — SweetHome 3D → GLB

How the villa's `.glb` is produced. One Python script drives Blender and does
the whole conversion; there is no manual Blender work in the normal path.

---

## What is actually required

**The only hard prerequisite is a `.glb` file.** Everything below improves the
result but is not a gate — the app's runtime **tap-to-bind** means you do not
have to name meshes or hand-prepare the model to get a working kiosk.

| Step | Status | Why |
|---|---|---|
| Export a **`.glb`** | **Required** | The app loads GLB only, never `.sh3d`. |
| Name furniture with entity IDs | **Optional** | Gives automatic mesh↔entity mapping. Tap-to-bind does the same at runtime with zero naming. |
| Pose copies (`__open`/`__closed`/…) | **Optional** | Per-device live state on the mesh itself. |
| Solid walls | **Handled for you** | SweetHome walls are real geometry, and the kiosk collides against them directly. No `collision_*` boxes to author. |
| Decimation, normals, ceiling removal | **Handled for you** | The script does all of it. |
| Teleport anchors | **Not authored** | Rooms come from the plan's own polygons, solved at runtime. |

**Minimum path:** run the script → upload the GLB → wire anything unnamed by
tapping it in Advanced Settings.

---

## The script

`blender_pipeline.py` (kept outside this repository — it holds site-specific
paths and per-property bake tuning, which must never ship in the app). It needs
**Blender 3.6+ or 4.x** installed; everything else it does itself.

### Normal use

Run it directly with Python. It acts as a driver: for each texture size you
give it, it launches Blender once per configured job.

```bash
python3 blender_pipeline.py                 # default bake size
python3 blender_pipeline.py 2048            # one size
python3 blender_pipeline.py 512 1024 2048   # sequentially, three sizes
python3 blender_pipeline.py 2048 MyVilla    # only the job labelled "MyVilla"
python3 blender_pipeline.py --help          # jobs, options, full flag reference
```

`--help` prints the configured job list, so it is the fastest way to see what
the script will actually do before committing to a long bake.

Two wrapper options apply to every run:

| Option | Effect |
|---|---|
| `--no-room-sidecar` | Skip the `.rooms.json` file. Room data is embedded in the GLB itself and the app reads that first; the sidecar only matters for app builds older than pipeline 2.14.0. |
| `--no-atlas-png` | Don't leave `villa_bake_atlas[_night].png` in the output folder. They are inspection copies — the atlas that matters ships inside the GLB. |

### Configuring jobs

Jobs live in the **`_BAKE_JOBS` list near the bottom of the script**, which is
the single source of truth. Each entry is a label, the `.sh3d`, the `.obj`, the
output `.glb` path, and the flags for that property. `{size}` in the output path
is substituted with each requested bake size, so one job can produce several
resolutions.

There are commented-out examples in the list to copy from. Because those values
are per-property configuration living inside a script that also gets updated,
**edit that list in place and never overwrite it wholesale when taking a script
update.**

### One-off custom bake

To bake a file that isn't in the job list, or to override any flag, call
Blender directly instead of using the wrapper:

```bash
blender --background --python blender_pipeline.py -- INPUT.sh3d INPUT.obj OUTPUT.glb [options]
```

`python3 blender_pipeline.py --help` ends with the complete generated parameter
reference for this form — that is authoritative, and this document deliberately
does not duplicate it.

### Getting the OBJ out of SweetHome 3D

`3D View → Export to OBJ format`. Keep the `.obj`, its `.mtl` and the texture
folder together. Only those three things are needed; a macOS export onto a
non-native filesystem also produces `._*` and `.DS_Store` files, which are
noise and can be deleted.

The `.obj` for a detailed villa is plain ASCII and will be **hundreds of MB to
~1 GB**. That is normal and affects only pipeline runtime, not the app.

---

## Flags worth knowing

The script has around thirty flags; `--help` lists them all with current
defaults. These are the ones that change the result most.

### Lighting and baking

| Flag | What it does |
|---|---|
| `--bake` | Bake lighting into textures at all. Without it the GLB ships with plain albedo and relies entirely on the app's runtime lights. |
| `--bake-lightmap` | The shipping mode: a lightmap atlas, with a second sun-free **night** bake of the same atlas layout so the app can cross-fade day↔night with no second model. |
| `--bake-size N` | Atlas resolution. **Use 2048** for a plan with detailed curtain/fabric geometry — 1024 leaves too little texel budget once dense geometry re-packs the atlas, and light bleeds between islands (stray brightness smeared onto nearby benches and frames). |
| `--bake-samples N` | Cycles samples per texel. Higher is cleaner and slower. |
| `--sun-angle`, `--sun-strength`, `--sky-strength` | The daytime key light and sky contribution. |
| `--bake-day-ambient`, `--night-fill`, `--night-ambient` | Ambient floors for the day and night atlases — what stops unlit interiors going pure black. |
| `--bake-margin`, `--bake-island-margin`, `--bake-micro-island-px` | UV island padding. These exist to control bleed; raise them before dropping bake quality if you see it. |

### Geometry budget

A villa GLB is **~92 % geometry, ~6 % textures**, so shrinking images barely
moves the file size — the geometry caps are what matter.

| Flag | Default | Applies to |
|---|---|---|
| `--max-object-faces` | 5 000 | Structural geometry: walls, floors, plot, vegetation |
| `--max-entity-faces` | 20 000 | Bound devices: curtains, lamps, cameras… |

Anything under its budget passes through byte-identical; only runaway objects
are collapse-decimated. Both run **before** the join/UV/bake phases, so they
also make those phases dramatically cheaper.

The two worst offenders in practice, both from the SweetHome catalog:

- **Cloth-sim curtains** — ~248 000 faces *per pose*. Eight multi-pose curtains
  were 37 % of one villa's entire 29 MB GLB. Every pose is its own mesh and
  every pose goes through `--max-entity-faces`; a gathered `__open` pose is
  only a few hundred faces so it passes untouched, while its `__closed` sibling
  is collapsed.
- **Plants and vegetation** — 20 k–70 k faces per *placed copy*, and the OBJ
  export writes full geometry for every copy, so a garden multiplies fast (one
  reached 5.2 M triangles). They are **not** excluded from the light bake; they
  are decimated first by `--max-object-faces`, which is also what makes the bake
  affordable. A bush keeps its silhouette at 5–10 % of its faces at kiosk
  viewing distance. Prefer low-poly plants in SweetHome anyway — the cap is a
  backstop, not a substitute.

Vegetation and ground materials are separately pinned to an always-visible
exterior group, so palm crowns and the plot survive a floor toggle instead of
vanishing with the storey they were nearest.

### Material tuning

| Flag | What it does |
|---|---|
| `--max-base-color F` | Clamp the peak of **flat, untextured** albedo, so SweetHome's pure-white default walls and cabinets don't blow out. Textured surfaces are unaffected. |
| `--min-roughness F` | Raise low roughness so nothing renders mirror-flat. |
| `--metallic F` | Force metallic on every material — SweetHome sometimes exports stray metallic values. |
| `--glass-alpha-max F` | Ceiling on glass transparency. |

> **Human figures and mannequins:** delete them in SweetHome 3D before
> exporting. The pipeline does not strip furniture — what is in the plan is what
> ends up in the GLB.

### KTX2 textures

`--ktx2` exists and re-encodes the GLB's textures to KTX2/ETC1S. **It is
deliberately not used.** Textures are not where load time goes for this model —
measured, not assumed — and running it through `gltf-transform` decompresses the
geometry, which does not get Draco re-applied unless a separate step runs
afterwards. The result measured roughly **five times larger** for no visible
gain. The app ships its own offline KTX2 decoder, so the capability is there if
a future model is genuinely texture-bound; today it is not.

---

## Uploading the result

**Advanced Settings → 3D model source → Upload** (Owner profile). Since pipeline
2.14.0 the room and entity plan data — names, shapes, device positions — is
embedded directly in the `.glb`, so selecting that one file is enough.

If a GLB carries no embedded room data (an older or hand-built file), the app
clears any room data left over from a *previous* upload rather than keep showing
it against a model it may no longer match. Select the matching `.rooms.json`
alongside the GLB in the same picker, or upload it separately afterwards to
refresh only the room data.

That sidecar is named after the **`.sh3d`**, not the GLB: its contents come from
the floor plan and are identical whatever bake size produced the model, so a
multi-size run writes one file rather than one per size.

Every kiosk then loads that same central file automatically — there is no
per-device upload.

---

## Configuring interactive assets in SweetHome 3D

All optional. Authoring to these conventions gets automatic mapping and richer
live feedback with no code or config; skipping them leaves you binding by tap,
which works just as well.

### Name a piece with its HA `entity_id`

Set a furniture piece's **Name** to the exact entity ID (`light.kitchen_ceiling`,
`climate.living_room_ac`, `camera.patio_cam`, …) and the mesh binds to that
entity on import. The pipeline matches by **3D position**, not by the internal
OBJ part names, so this works even though SweetHome renames parts to things like
`Sphere_1_1017`.

If the dry run shows no entities, the names are wrong: click the piece,
Properties → **Name**, type the exact entity ID, re-export and re-run.

### Live state via pose copies

**Any** entity can show its live state by giving it one mesh per state: place
the same object 2+ times in the same spot, posed differently, and suffix each
Name with the state it represents.

```
cover.living_room_curtain__open      cover.living_room_curtain__closed
cover.living_room_curtain__half      (optional — see below)
lock.front_door__locked              lock.front_door__unlocked
switch.gate_relay__on                switch.gate_relay__off
binary_sensor.front_door_contact__on binary_sensor.front_door_contact__off
```

**One rule, no per-domain table: the suffix is the entity's own Home Assistant
state**, lowercased with anything that isn't a letter or digit removed. A
`switch` uses `__on`/`__off`, a `cover` `__open`/`__closed`, a `lock`
`__locked`/`__unlocked`, a sensor reporting `not_home` uses `__nothome`. If
unsure what to name a pose, read the entity's current state in Home Assistant —
that is the word.

**`half` is the one special word.** No entity reports "half", so it is offered
as a virtual pose for every type. A device counts as part-way when a numeric
level attribute sits between its extremes — `current_position`, `brightness`,
`percentage`, `volume_level`, band 15 %–85 % — or when its state is transitional
(`opening`, `closing`, `locking`…). So `cover.x__half` and `light.y__half` work
identically. Always optional: with only two poses authored, a part-way device
falls back to the nearer one.

**Unknown and offline states fall back to the rest pose.** A state you didn't
author — including `unavailable`, `unknown`, or a lock's `jammed` — shows the
lowest-ranked authored pose (`off`/`closed`/`locked`/`idle`), so a lock never
implies a door is open when its real state isn't known.

Further rules:

- All suffixed copies are **one entity**; the suffix never affects binding,
  tapping or RBAC.
- **Every pose needs an explicit `__word` suffix, including the rest one.** An
  unsuffixed piece is never a pose — it is always-visible base geometry that
  coexists with the poses. That is what lets you model a fixed device body (a
  keypad housing named plain `lock.front_door`) plus a swinging leaf with its
  own two poses. If you want one always-there mesh and no swapping, leave the
  name unsuffixed and skip pose authoring.
- Fully **per-device**: mix multi-pose and single-mesh devices freely.
- Poses may use **different catalog models and widths** — a slim gathered
  curtain for `__open`, a full-width one for `__closed`. Detailed catalog assets
  are fine; the face caps handle them.

Place curtains and door frames/glass **directly over their window**. The
pipeline keeps the window's own glass and frame in the structural shell so it
stays transparent and correctly lit, rather than letting the curtain absorb it.
Only one pose per device casts shadows into the bake, so no hidden pose's shadow
is frozen onto the floor: the unsuffixed base mesh if you modelled one,
otherwise `__open` for a `cover` and `__off` for everything else.

### Camera view cones

A camera shows its red beam only when all of these hold:

1. The entity maps to at least one mesh in the model.
2. That piece carries a **rotation** in SweetHome 3D. Set the furniture's
   **angle** to aim it — a camera left at angle 0 gets no beam rather than a
   guessed direction. The beam always tilts **30° down** from horizontal, which
   is what a ceiling- or high-wall-mounted camera actually watches, and it clips
   against walls.
3. The camera has a **motion sensor** wired to it (the linked-entity field on
   its device card) and that sensor is `on`.

The beam's compass heading comes from `angle` plus a fixed correction for which
way the catalog CCTV model faces at `angle=0`
(`CAMERA_MODEL_FRONT_OFFSET_RAD` in `SceneManager.ts`). The affine transform
placing every camera is independently proven correct — camera *positions* always
render right — so if a heading is still off after aiming `angle` at the intended
target, that constant is the one place to adjust, not the transform.

Load the app with `?debug` to print which cameras qualified and, for the rest,
exactly why they were skipped (`no mesh`, `no sh3d angle data`, `angle is 0`).

### What the script reports

On completion it prints the mesh inventory, so you can confirm the entity
meshes survived as separate objects:

```
Done!  14 mesh(es) in the GLB:
  • Structure                                         212,847 tris
  • camera.livingroom_cam                               1,204 tris  ← entity (clickable)
  • climate.living_room_air_conditioner                   892 tris  ← entity (clickable)
  • cover.curtain_living_room_big                         180 tris  ← entity (clickable)
  ...
```

Once uploaded: tapping the lock mesh opens the lock control, tapping the AC
opens temperature, tapping a camera opens its stream, and visual state updates
live.
