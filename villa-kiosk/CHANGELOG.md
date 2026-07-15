# Changelog

## 2.13.2

- **Offline devices are now clearly distinct from switched-off ones.** Both were
  dark discs separated only by a small opacity gap, so they looked the same. A
  switched-off device now shows a solid, fully-opaque disc with a clear glyph and
  a defined ring ("here, just off"); an offline/unavailable device is heavily
  ghosted — translucent disc, faint ring, faded glyph — so it visibly recedes.

## 2.13.1

- **Fix: badges were shaking.** The declutter eased offsets toward the target
  each frame and requested a render while "moving" — which kept the render loop
  (and the overview camera's inertia) alive, nudging the projected positions and
  keeping it "moving": a feedback loop. The layout is now a deterministic
  function of the current positions, applied directly, so a static camera holds
  the badges perfectly still (no easing, no self-triggered renders).
- **Fix: sensor labels now fill too.** 2.13.0 filled on/alert devices but kept
  sensors as a dark disc, so in a scene where the visible tags were mostly
  sensors (power/temp/humidity) it looked unchanged. A sensor reporting a value
  is "live", so it now gets a filled badge as well — only genuinely off /
  unavailable devices stay dark.

## 2.13.0

- **Active devices now fill their whole badge with the state colour.** An "on"
  device (blue) or an alerting one (red) fills the entire disc instead of just
  tinting a thin ring, so a live device reads at a glance. Off devices and
  informational sensors keep the dark "glass" disc so they recede and let the
  active ones pop.
- **Labels no longer stack on top of each other.** When several devices sit at
  (nearly) the same point — e.g. a combined light + bathroom VMC fixture — their
  badges are now nudged apart in screen space by a light force-relaxation and
  spring back together as the camera separates them. Every label stays visible
  (nothing is hidden), and taps still hit the badge where it's actually drawn.

## 2.12.1

- **Blue "clickable" highlights are now contextual to the active floor.** The 2F
  view keeps the 1F shell and its fixtures rendered underneath (cumulative
  floors), so the ground-floor devices stayed outlined while you were on the 2nd
  floor (and the outline set was only ever computed once, at load). The outlines
  now match the entity badges — only the active storey's devices glow — and they
  recompute on every floor change (Rooms dial, stairs, or first-person).

## 2.12.0

First-person navigation UX pass — three fixes:

- **Walking speed is now frame-rate independent.** The joystick/keyboard walk
  added a fixed impulse *per frame* with no delta-time scaling, so on a slower
  tablet (fewer frames per second) you crawled — "barely moved forward". Movement
  now scales by frame time, so it holds the configured pace on any device, and
  your walk-speed setting is honoured consistently.
- **Spawns land on the floor, facing open space** — not on top of furniture or
  into a wall. Grounding now targets the structural shell (floor slabs) instead
  of grabbing the first surface below (a table/bed top), and every spawn turns to
  face the most open direction around it instead of an arbitrary heading.
- **Select a room in overview, switch to first-person → you land in that room.**
  Previously switching always dropped you at the staircase, discarding the room
  you'd navigated to. Now first-person entry lands in the last room you selected
  in overview (grounded, facing open space); a fresh/default overview still
  defaults to the ground-floor staircase.

## 2.11.2

- **First-person now really starts on the ground floor at the stairs.** The
  stairs are baked into the fused `Structure` mesh, so there was no stair
  geometry to detect — the spawn fell through to the first room, which happened
  to be the 2F gym. It now locates the stairwell from a stair-named element (a
  plan room, or an entity mesh like `camera.staircase_2f_cam`), grounds that XZ
  on floor 1, and always guarantees a ground-floor spawn (never a 2F room).
- **The Rooms dial now keeps your current view mode.** Tapping a floor chip used
  to force the bird's-eye view even when you were walking in first-person, so
  navigating to a room always kicked you out to overview. Now the floor chip only
  reframes the storey when you're already in overview; in first-person it just
  reveals that floor's room chips, and picking one teleports you there (switching
  floors as needed) while staying in first-person and honouring the room's saved
  landing position.

## 2.11.1

- **Fix: the first-person staircase spawn landed on the 2nd floor.** Grounding
  the camera raycasts down for the floor beneath it, but the predicate only
  filtered on `isVisible` — while FloorManager hides upper storeys with
  `setEnabled(false)`. The hidden 2F slab sits directly over the staircase, so it
  got picked first and the spawn snapped up onto it. Grounding (and click-to-walk
  targeting) now also require `isEnabled()`, so they only ever land on the active
  floor set — you now start on the ground floor next to the stairs as intended.

## 2.11.0

- **First-person view now starts at the foot of the staircase (ground floor),
  facing up the flight.** Switching into first-person (and the initial spawn)
  lands at a consistent, recognisable spot instead of wherever the camera was
  left. The spot is taken from a room the plan names as a staircase if there is
  one, otherwise derived from the stair geometry, otherwise the living room.
- **Floor management now works while walking between 1F and 2F.** The GLB ships
  no stair-trigger meshes, so climbing the stairs never revealed the upper
  storey — you walked up into a hidden floor. Floors are now switched from the
  walker's feet elevation (with hysteresis so it doesn't chatter mid-flight):
  cross onto the upper slab and 2F appears; come back down and it hides again.
  Only active in first-person — the overview's floor selection is unchanged.

## 2.10.1

- **Camera feeds now work in the standalone (non-add-on) build.** When the app
  is served from `/config/www` and talks to HA directly, its camera images were
  authenticated with the long-lived token as a `?token=` query param — but HA's
  `/api/camera_proxy[_stream]` rejects that (the long-lived token only works via
  the Authorization header, which an `<img>` can't send). The stream then errored
  and the snapshot fallback 401'd too, so the panel read "unavailable". It now
  uses the camera entity's own rotating `access_token` attribute (the token HA
  actually accepts on that endpoint), which rides on the live entity and stays
  valid. Ingress mode was unaffected (the Supervisor proxy injects real auth).

## 2.10.0

- **No more uploading the full `.sh3d`.** The SweetHome project file had grown to
  ~300 MB (it bundles the entire furniture catalog) while the kiosk only ever
  needed <20 KB of it — room polygons and HA-entity plan positions. The Blender
  pipeline now emits a compact `<model>.rooms.json` sidecar right next to the GLB
  carrying exactly that, and the app reads it instead. Settings now uploads the
  tiny `.rooms.json` (and the app auto-loads `<model_path>.rooms.json` centrally),
  so a re-skin is two small files, no 300 MB round-trip.
- All `.sh3d` import code is removed: the browser no longer unzips/parses the
  SweetHome file, the `sh3d_path` add-on option is gone, and the central upload
  now accepts `kind=rooms` (JSON) instead of `kind=sh3d`. Re-run the pipeline to
  produce the `.rooms.json`, then upload it once.

## 2.9.21

- **Two-finger tilt actually works now.** The previous attempt required both
  fingers to move within a single event, but touch delivers one finger per
  event — so a clean two-finger vertical drag produced no tilt (and its
  per-event distance changes cancelled out, so nothing happened at all). Tilt
  is now decided from how far each finger has drifted vertically since the
  gesture started: both fingers moving the same way = tilt (with zoom
  suppressed so it's a clean tilt), fingers moving apart/together = zoom.

## 2.9.20

- Overview two-finger tilt now actually tilts (was still zooming). Tilt is
  driven by the vertical distance BOTH fingers move TOGETHER — so a two-finger
  vertical drag (keeping them the same distance apart) tilts cleanly, while a
  pinch zooms. The two no longer contaminate each other. Tilt sensitivity
  nudged up so the effect is clearly visible.

## 2.9.19

- Rooms dial: a hovered room/floor chip now highlights with the solid accent
  colour (like every other button), not a faint translucent wash.
- Overview (touch): two-finger tilt works again. Moving one finger up/down (or
  both together) tilts the camera — the "pinch must stay perfectly still"
  guard that was swallowing tilt whenever the finger distance changed is gone,
  so zoom, rotate and tilt now all respond together.

## 2.9.18

- **Fixed the Rooms dial getting stuck** (open but unclickable). It's now driven
  by pointerdown instead of relying on the synthesised click that a tap emits —
  that click could land on the freshly-mounted backdrop (or be eaten as a
  "ghost click"), which is what froze it. Tapping a room, a floor, or outside
  the dial all work reliably now.
- **Tapping a floor (1F / 2F) in the dial now frames that whole floor** from the
  bird's-eye — it switches to overview and applies this device's saved default
  framing (and still reveals the floor's rooms for a further tap).

## 2.9.17

### Rooms dial: tap to open, long-press to edit

- **Swapped the Rooms interaction to be more natural.** A **single tap** now
  opens the radial dial (pre-expanded on your current floor) — tap a floor to
  switch to it and see its rooms, tap a room to zoom there, tap outside to
  dismiss. **Long-press** opens the full Rooms list for creating/editing rooms.
- **Bigger room wheel** so a long room list no longer stacks on top of itself
  (radius 152 → 228, wider arc).

## 2.9.16

- iOS: also disable the GlowLayer (blur render targets + an extra per-frame
  scene render) alongside SSAO/IBL/shadows, to shave more WebGL memory for
  the iPhone crash-loop case.

## 2.9.15

### Room dial reworked into the floor+room navigator

- **The Rooms dial replaces the 1F/2F buttons.** It sits vertically centred on
  the left edge (new compass icon). Tap it for the full Rooms list as before;
  long-press for the radial dial — its semicircle now fans out symmetrically
  over the whole height and never clips off the top. Slide onto a floor and
  **release to switch to that whole floor** (what the old 1F/2F buttons did), or
  dwell to reveal its rooms and release on one to zoom there.
- **Fixed the dial getting stuck open** after the first selection — releasing
  now always closes it (and commits) no matter where the finger lifts, so you
  can keep picking rooms.
- Tightened the 1F/2F spacing and widened the room arc so labels no longer
  overlap.
- **Config Editor now matches the Settings modal width** (both 780px on
  desktop).

## 2.9.14

### Room quick-dial, plus Settings/Config Editor fixes

- **New: long-press the Rooms button for a quick room dial.** A single tap still
  opens the full Rooms list. Press and hold, and a radial menu fans out beside
  the button: slide onto a floor (1F / 2F) to reveal its rooms, then release on
  a room to jump straight there. (Falls back to the list on a plain tap, so
  nothing you relied on changed.)
- **Facility Manager can open Settings** again (was hidden) — with the same
  appearance/comfort access as a guest; admin-only sections stay owner-only.
- **Config Editor**: removed the redundant "Back to Settings" button (the Done
  button already returns you there).
- **Fixed the Settings modal not actually widening on desktop** and the
  **device-icon labels sitting flush against their emoji** — both were CSS
  specificity bugs where base rules overrode the new ones.

## 2.9.13

### Settings & Config Editor polish, plus an iPhone load-crash fix

- **iPhone load crash fixed.** On iOS the villa could crash-loop on the
  "Loading the villa" spinner (fine on desktop + Android). The WebGL engine now
  runs iOS-aware — no MSAA, default power preference, render at ~device
  resolution instead of 2× supersampling, and the heavy SSAO/IBL/shadow render
  targets are dropped — keeping GPU memory under iOS WKWebView's hard ceiling.
- **Config Editor** now shows entity **cards on desktop too** (the cramped
  table is gone), with a **search box** to filter the long entity list.
- **Settings modal**: theme selector moved into the header as icon-only buttons
  (right-aligned); Eye height + Walk speed moved below the icons and onto one
  line; Glow strength + Night dimming share a line; the modal is 50% wider on
  desktop; the device-icon grid has proper spacing; redundant descriptions and
  the trailing blank space were removed; the model-details tooltip opens upward
  so it's no longer clipped.
- On **mobile**, the Settings footer keeps Config Editor left + Cancel/Save
  right on one line (no wrap).
- New default look: **Night dimming 0.5**, **Glow strength 0.8**.

## 2.9.12

### Config Editor as a modal, floor-correct highlights, working night dimming, and pipeline v2.7.8

- **Config Editor is now a modal over the live villa, not a page.** Leaving it
  no longer re-downloads and re-parses the whole model — it returns you to
  Settings, and every edit already applied live. Its button moved to the
  Settings footer (next to Save/Cancel); the "Advanced" section and the
  Babylon Inspector were removed (and the inspector dependency dropped).
- **Villa Latitude/Longitude** moved into the Config Editor with proper
  styling, and the **Room** column there is now a real dropdown of the villa's
  detected rooms (not a text field).
- **Loading a new .sh3d clears the old rooms** so the Rooms menu shows only the
  new plan's rooms.
- **2F motion highlight sits on the floor, not the ceiling** — the floor height
  is now found by a downward ray at the room's centre (a wall's tall
  bounding box no longer pulls the glow up to the ceiling).
- **"Night dimming" now dims the whole night scene**, structure included
  (previously it only touched the lamps in baked-lightmap mode).
- **Overview up/down swipe** direction corrected (both axes now follow the
  finger in natural mode, oppose it when off).
- **Wall collisions are always on** (redundant toggle removed); the device-icon
  pickers use 3 columns and the Settings modal is wider so they scroll less.
- **Pipeline v2.7.8:** ceiling FANS on 2F keep their blades (the top-ceiling cut
  now spares small ceiling-height objects via connected-component area, cutting
  only the room-sized lid), and 2F hedges/vegetation are culled with the 2F
  view (an object's SweetHome level now vetoes it from the always-visible
  exterior group, instead of the geometry heuristic mis-chaining it). Re-bake
  required to pick these up.

## 2.9.11

### Ten-issue batch: night sky, category-gated taps, floor-aware highlights, profile switching, and a Settings declutter

- **Night sky now reads as night in first-person.** The sky dome reused the
  same sun direction as scene lighting, which is floored just above the
  horizon after dark so interiors don't go pitch black — but that kept the
  procedural sky glowing like dusk all night. The dome now gets its own
  unclamped sun direction (real altitude, can sink below the horizon) while
  lighting keeps the floored one.
- **Tapping an asset in a hidden category no longer triggers it.** Switching
  a device category off in the top bar removed its highlight but the 3D
  object stayed tappable and still fired the HA action. Picks now honour the
  category filter too.
- **A 2F room's motion highlight no longer shows on the ground floor.** Room
  polygons never carried their storey through calibration, so every room's
  red presence-glow was drawn at ground level. Rooms now parse their
  SweetHome level into a floor number and the glow (and 2F teleport landings)
  sit at the correct height.
- **Temperature/humidity/power sensors no longer glow like lights, and get
  their own icons.** A sensor placed next to a larger device (an AC unit)
  could lose its geometry to that device in the pipeline's containment match
  and fall back to a lit placeholder. The pipeline now assigns each object to
  the *closest* containing entity, and the app forces sensor/climate meshes
  non-emissive as a backstop. Sensors also gain per-`device_class` badge
  icons (power/temperature/humidity now distinct), editable in Settings.
- **Switching profile no longer reloads the whole villa.** Guest/Owner/
  Facility-manager switching unmounted the 3D scene and re-downloaded +
  re-parsed the model; it now happens in an overlay while the scene stays
  loaded underneath.
- **The bird's-eye view is shown from the first frame** (the first-person
  joystick no longer flashes during load), and the overview's natural-
  scrolling up/down swipe direction is fixed to match left/right.
- **Settings decluttered.** Removed the redundant mirror-room-detection
  toggles and Export/Import backup buttons (and their dead code); moved the
  Inspector-adjacent villa Latitude/Longitude into the Config Editor.
- **Pipeline v2.7.7 (companion):** closest-entity containment match (above),
  plus the earlier v2.7.6 work — a pre-join, per-object decision for which
  vegetation is ground-rooted (so 2F planters stop showing on the 1F view)
  and a higher default night-ambient floor so a texel-starved two-storey
  bake's walls don't read as black. Re-bake required to pick these up.

## 2.9.10

### Guests no longer see camera badges or highlights

- **Fixed: RBAC type denials leaked through mesh-name inference.** The
  permission matrix already denies guests the `camera` and `binary_sensor`
  types, and `filterConfigForRole` strips those entities from the entity map
  and mesh bindings — but the mesh resolver has an inference fallback that
  fabricates a mapping from the MESH NAME alone, and a pipeline GLB names
  entity meshes with their entity_id (`camera.gate_cam`). So a guest still
  got the camera's icon badge, the blue interactive highlight, and a tap
  target for a stream they can never open. The role's denied types now ride
  the filtered config (`deniedTypes`) and every resolver call honours them:
  for guests a camera resolves to nothing — no badge, no blue highlight,
  not tappable — while the camera asset itself stays visible as plain
  geometry. Owner and ops are unaffected.
- **Pipeline v2.7.4 (companion, for the huge-GLB report):** collapse-
  decimates any non-entity object above 5,000 faces (`--max-object-faces`,
  0 disables) before joining/baking. SweetHome vegetation is 20k-70k faces
  per placed copy, so a bushy garden exploded Structure_Exterior to 5.2 M
  triangles / 119 MB of the 155 MB GLB. Re-bake required to shrink it.

## 2.9.9

### Window glass no longer glows white at night

- **Panes now dim with the rest of the villa after dark.** Detected glass
  gets a forced light albedo and a small constant emissive sheen so a clear
  pane over a dark background reads as glass rather than a black hole — but
  those were fixed DAY values, and panes are deliberately excluded from the
  bake/lightmap (a lightmap multiply would darken the view through them), so
  no night mechanism ever touched them. After sunset the whole villa dims
  while the panes stayed at full daytime brightness, tonemapping into
  glowing white panels. The pane colours now ramp down to 18 % over the same
  civil-twilight curve the sun controller uses for everything else — at
  night a pane keeps just a faint sheen instead of glowing. Applies in
  baked, lightmap and unbaked modes alike; daytime look is unchanged.

## 2.9.8

### 2F view keeps the ground floor (and the outdoor) underneath

- **Cumulative floor visibility.** Switching to 2F used to hide the entire
  ground floor, leaving the upper storey floating in mid-air over the
  garden. Floor toggles are now cumulative downward: the active floor AND
  every floor below it stay rendered, so the 2F view keeps the 1F exterior
  walls, windows and terraces underneath — the same way the outdoor group
  (ground, garden, palms) always stayed visible. Looking at 1F still cuts
  the upper storey away so you can see into the rooms from above.
- **Badges follow the active floor only.** With lower floors rendered, their
  entity badges would draw straight through the 2F slab (they are GUI
  overlay, not geometry). The label culler now compares each badge's storey
  against the active floor and shows only the active floor's badges.
- App-only update — no re-bake or re-upload of the GLB needed.

## 2.9.7

### Thin upper-storey slabs no longer vanish as "ceilings"

- **Fixed: 1 cm floor patches on the 2F storey rendered as a see-through
  hole.** `applyStructure` hides any flat mesh (height < 0.35 m) whose
  bottom sits above 2.5 m — a heuristic for un-named ceilings/roofs in old
  fused GLBs. Babylon splits a pipeline `Structure_L1` into one child mesh
  per material, so a thin SweetHome "Box" floor patch at 2.56 m became a
  lone flat primitive and was hidden. Pipeline-split structure groups
  (`Structure`, `Structure_L1…`, `Structure_Exterior`) are now exempt from
  the height heuristic — the Blender pipeline (≥ 2.6.0) already drops the
  top ceiling/roof before export. Name-matched ceilings are still hidden.
- **Pipeline v2.7.3 (companion fix, re-bake required): upper-storey devices
  are now clickable.** SweetHome stores a piece's elevation RELATIVE to its
  level; the pipeline ignored the level offset, so every upper-storey
  device's OBJ geometry was searched one storey too low — the device's real
  meshes were silently fused into the structure (not tappable) and whatever
  ground-floor part sat at that plan position was bound instead (a door
  hinge became `binary_sensor.leak4_water_leak`). Placeholder lights were
  buried at the storey below's ceiling. `_parse_entities` now adds each
  piece's `<level>` elevation.

## 2.9.6

### Central upload no longer fails at 16 MB (HTTP 413)

- **Chunked central uploads.** HA's Ingress gateway rejects any single
  request above ~16 MB with HTTP 413 — a Supervisor-level cap the add-on
  cannot raise, and a baked lightmap GLB (~17.5 MB) already exceeds it. The
  app now slices files above 12 MB into sequential 8 MB pieces
  (`upload_id`/`offset`/`last` query params); the supervisor-proxy
  accumulates them in a `.part` file next to the destination and atomically
  replaces the live model on the last piece — same magic-byte check, same
  200 MB total cap, same atomic-overwrite guarantee as before. Small files
  still upload in one request, and copying a file in via SSH/Samba still
  works unchanged. Abandoned part files are swept after 24 h.

### Lightmap GLBs missing their bake UVs are now called out

- **Console warning when a lightmap GLB has no TEXCOORD_1.** Blender's glTF
  exporter silently drops UV layers that no material references, which cost
  pipeline 2.7.0's lightmap GLBs their BakeUV channel — the lightmap then
  samples at the tiling texture UVs and the lighting looks smeared/wrong.
  The app now detects this and says exactly what to do (re-bake with
  blender_pipeline ≥ 2.7.1, which pins BakeUV into the export by wiring the
  atlas into each structure material's glTF occlusion slot — inert at render
  time, since these materials run with `environmentIntensity = 0`).

## 2.9.5

### Model info panel shows what was actually uploaded

- **The ⓘ panel now has an "Uploaded" row with the original filename and time
  of the last central upload.** A central upload overwrites the file AT the
  configured `model_path`, so the served name never changes (always e.g.
  `TheLysHouse_1F.glb`) no matter which file you picked — which repeatedly
  read as "the info panel shows the wrong file". The add-on now records the
  browser-side filename in a sidecar (`<model>.upload.json`) on every upload
  and reports it via `/addon-config`; the panel shows it next to the served
  path, and the footer text explains the overwrite. Files placed manually
  (SSH/Samba) or uploaded by an older add-on simply show no "Uploaded" row.

## 2.9.4

### Lightmap-mode GLBs: full texture sharpness + baked lighting

- **Support for `blender_pipeline.py ≥2.7.0 --bake-lightmap` GLBs.** The
  classic bake squeezes the whole villa's colour into ONE atlas — at 2048² over
  ~2,210 m² that is ~4 cm/texel, which is why re-baking at a bigger size never
  looked sharper (the original tiled textures resolve ~0.2 cm/px, ~20× finer).
  Lightmap mode splits the job: the GLB keeps every original crisp texture on
  UV0 and ships only the baked light (sun + sky + GI + shadows) as an atlas on
  UV1. The app detects the `BAKED_Lightmap` carrier material, multiplies the
  atlas onto every structure material (`useLightmapAsShadowmap`), lights the
  structure with a dedicated uniform white fill (excluded from the sun/hemi/IBL
  so nothing double-lights), and keeps all baked-mode behaviour (SSAO off, sun
  shadows off, no entity point lights, exposure dimming at night for day-only
  bakes; a night lightmap, when shipped, swaps in at twilight). Glass panes
  keep the runtime transparency treatment. Result: original texture detail
  with Cycles global illumination on top.

## 2.9.3

### Floor toggle works on baked multi-floor GLBs

- **The 2F floor slab showed on the 1F view (covering the ground-floor rooms
  from above) and vanished on the 2F view; the garden disappeared on 2F.**
  Babylon's glTF loader splits a multi-primitive mesh into child meshes renamed
  `Structure_primitive<N>` — and a baked Structure keeps one material slot per
  original material (~150 slots, all pointing at `BAKED_Structure`), so every
  structure mesh imports multi-primitive. FloorManager matched mesh names with
  anchored regexes (`^Structure$`, `^Structure_L1$`, `^Structure_Exterior$`)
  that none of the renamed pieces hit, so everything fell through to the
  bounding-box fallback: the 2F slab (centre ~2.5 m, below the 2.8 m split)
  classified as floor 1, and the garden lost its always-visible status.
  FloorManager now normalises mesh names (shared `normaliseMeshName`, the same
  helper entity resolution already uses) before classifying. The GLB itself was
  verified correct — the slab geometry is in `Structure_L1` where it belongs.

## 2.9.2

### Windows read as glass again over dark rooms

- **Detected glass panes get a faint constant sheen.** A pane is a clear PBR
  material, so it shows whatever is behind it. With the exclusive floor toggle
  (2.9.0) the other floor is hidden, so a ground-floor room loses its ceiling
  (the upper slab) and a window ends up framing the dim evening interior or the
  dark sky — a clear pane over near-black read as an opaque black panel. A small
  emissive sheen (independent of the dimmed night hemi light) plus a normalised
  light albedo keep every pane reading as a lit glass surface, even when what's
  behind it is dark, without glowing like a light. Verified the 2F GLB itself
  ships all six glass materials transparent (`alphaMode=BLEND`, α 0.25–0.5) with
  nothing baked opaque — the panes were see-through all along; they just framed
  darkness.

## 2.9.1

### 2F floor no longer punches black holes to the hidden 1F

- **Baked structure is now double-sided.** SweetHome exports thin floor/ceiling
  slabs whose covering can carry a *downward* face normal. Rendered unlit with
  Babylon's default `backFaceCulling`, the camera above the 2F saw the culled
  back of those floor faces and looked straight through to the exclusive-hidden
  1F — reading as black. The baked material's texture already IS the finished
  lit image, so drawing both faces costs nothing and fills the hole. (Measured:
  42 of 558 walkable-2F-floor faces had downward normals.)

## 2.9.0

### Exclusive floor toggle + always-visible exterior (garden & palms)

- **Floors are now shown one at a time.** `FloorManager` switched from
  cumulative (`floor <= current`) to **exclusive** (`floor === current`)
  visibility, so selecting **2F** hides the ground-floor rooms entirely and
  shows the second storey alone with its own floor texture — the previous
  behaviour left the 1F ceiling/2F slab showing through. On the **1F** view
  the result is unchanged (floor 1 was always the only floor ≤ 1).
- **New always-visible `Structure_Exterior` group.** Pipeline ≥2.5.0 peels
  the ground, garden and palm trees into a `Structure_Exterior` mesh that the
  floor toggle **never culls**, so the villa keeps its plot and the palms
  stay whole on every floor (fixes palm crowns getting truncated on the 1F
  view). Requires a GLB baked with `blender_pipeline` ≥2.5.0.
- Single-level / older GLBs are unaffected: with only one floor detected,
  switching to a non-existent floor still reports "coming soon" rather than
  blanking the model.

## 2.8.0

### Real 1F/2F floor toggle + per-device-class binary sensor icons

- **The floor toggle now actually hides the upper floor.** `FloorManager`
  classified meshes but never changed anything on screen. It now toggles
  visibility (`setEnabled`, orthogonal to the ceiling-hide) whenever the
  floor changes: meshes above the active floor disappear, lower floors stay
  visible from above so the staircase reads correctly. Works best with a
  pipeline ≥2.3.0 GLB, whose structure ships pre-split as `Structure`
  (ground) + `Structure_L1` (upper) sharing one baked atlas — switching
  floors is instant visibility, no model reload. Entity badges vanish with
  their floor (label anchors now inherit the mesh's enabled state), and
  teleporting to a room on another floor switches floors in the bird's-eye
  view too, not just first-person.
- **Binary sensors get per-device-class icons.** `binary_sensor` is a
  catch-all domain — a water-leak sensor and a motion sensor shared the one
  generic 🚨 badge. The badge glyph now reads the entity's `device_class`
  state attribute from Home Assistant (the same signal the details panel's
  wording already used): 💧 moisture, 🚶 motion, 👁️ occupancy, 🚪 door,
  🔥 smoke and ~25 more, each editable in Settings → Device state icons
  under "Binary sensors by device class" (the list shows the classes of
  your bound sensors when connected). Entities without a `device_class`
  keep the generic binary-sensor icon.

Also in this release cycle (pipeline, not shipped in the container):
blender_pipeline v2.3.0 — two changes. (1) Bake-verification backstop: on
Blender 5.1.2/Apple Metal, Cycles silently skipped rasterizing entire UV
islands (~6% of the covered atlas exact-zero in *every* pass — the
surviving black exterior strip in the v2.2.2 GLBs; Blender 4.2.3/CPU wrote
the same islands fine). The pipeline knows the exact rect every island and
micro-patch was packed into, so after the albedo pass it stamps any rect
that came back empty with the material's real base colour, and the
existing day/night ambient floors carry it into both atlases — deterministic,
whatever the Cycles version/backend does. (2) `--level-split` (default
auto): multi-level homes export `Structure` + `Structure_L1` split at the
.sh3d level elevations, assigned per 3D-connectivity island by lowest
point, so stairs and palms stay grounded. Re-export both GLBs with v2.3.0.

## 2.7.3

### Clickable-highlight fixes + first-person grounding

- **Lights now get the blue "clickable" glow.** `applyHighlight` explicitly
  skipped `type === "light"` mappings (old fear of tinting invisible
  placeholder spheres — moot, since invisible meshes are already filtered
  by the `isVisible` check). The skip is removed; visible light fixtures
  highlight like every other clickable object.
- **The glow respects the category chips.** Objects whose category is
  hidden (HUD filter) no longer advertise themselves as clickable: the
  highlight pass skips them, and toggling a category chip re-applies the
  highlight live (updateConfig now watches `hiddenCategories` too).
- **First-person no longer floats above the floor.** Two holes, both fixed:
  `followFloor()`'s down-ray only searched a 2.6 m band, so walking over
  any drop taller than 1 m (terrace edge → garden, stair void) left you
  hovering at the old height forever — it now falls back to a long ray and
  glides down to the real floor. And switching overview → first-person
  never grounded the camera (only teleports did); it now lands on the
  floor immediately via `groundCamera()`.

Also in this release cycle (pipeline, not shipped in the container):
blender_pipeline v2.2.2 — reverts the 2.2.1 experiment and fixes the black
rectangles on walls/floors at the source. Measured on the shipped GLBs:
~17% of the structure's surface area baked pitch black because SweetHome
exports overlapping boxes (wall filler above door/window openings, cabinet
backs, a second level roofing the rooms) — those faces are buried flush
against other geometry, get zero light in Cycles, and win the z-fight as
black rectangles. The day bake now applies an albedo-based ambient floor
(`--bake-day-ambient`, default 0.30), the same trick the night pass already
used: black area drops from 24.9% to 1.6% of the structure's surface.
Re-export both GLBs with v2.2.2 to see the fix on the kiosk.

## 2.7.2

### Fix unresponsive controls (taps that silently do nothing)

- Reported on the phone kiosk: tapping the TV panel's On/Off button did
  nothing. Two systemic causes, both fixed globally:
- **Dead sockets looked connected.** A phone that slept or roamed Wi-Fi kills
  the WebSocket without the browser firing `onclose` for minutes — the app
  kept saying "connected" while every service call went into a black hole.
  The HA connection now has a heartbeat (ping every 25s, force-reconnect if
  no pong within 5s), reconnects immediately when the tab becomes visible or
  the network comes back (no backoff wait), and every in-flight call times
  out after 10s instead of hanging forever.
- **Failures were invisible.** Every button fires its service call without
  awaiting it, so real HA errors (disconnected, unsupported service, backend
  error) vanished silently. All service-call failures now surface in a
  global toast — a tap that can't act tells you why, from any panel.
- The big power toggle also gets a pressed-state animation so a registered
  tap is visually distinct from a dead one.

## 2.7.1

### Fix night crossfade washing the whole villa in white glow

- First real-world night with a dual-atlas GLB (v2.7.0) looked WORSE than
  before: a scene-wide milky white halo. Root cause: the night image rides in
  the structure material's emissive slot (that's the crossfade mechanism), and
  the GlowLayer — which blooms anything emissive so lit fixtures stand out —
  happily bloomed the entire villa like one giant LED strip after sunset.
- The baked structure meshes are now excluded from the GlowLayer (stored
  exclusion, survives the layer's lazy creation and re-creation). Entity
  fixtures keep their glow untouched.
- Pipeline 2.1.1 companion fix: the villa model has no ceilings (top-down
  authoring), so the night bake's ambient fill lit every room straight from
  above — at the 2.1.0 defaults the night atlas was a flat warm wash at ~40%
  of daytime. Night defaults dropped to `--night-fill 0.10` +
  `--night-sky-strength 0.05` (~15% of daytime). A re-bake with pipeline
  ≥2.1.1 is needed for the darker night texture; the glow fix applies to the
  existing GLB immediately.

## 2.7.0

### Real night for baked GLBs — day/night atlas crossfade

- A baked GLB rendered a fixed *daytime* image around the clock: the sun and
  its shadows are painted into the texture, so after sunset the app could only
  dim the whole picture (exposure × ~0.6), and a dimmed sunny photo still
  reads as day — "how come I see sun light and shadows while the sun is set."
- The pipeline (v2.1.0) now bakes a SECOND, sun-free night atlas (dark
  moonlit sky + low warm interior fill) sharing the same UV layout, shipped as
  the base-colour texture of a `BAKED_Structure_Night` material on a hidden
  microscopic carrier plane (glTF can't ship an unreferenced texture).
- The app detects that material, disables the carrier, mounts the night image
  in the day material's emissive slot (Babylon's PBR shader adds emissive even
  on unlit materials), and crossfades albedo↓/emissive↑ with the real sun —
  ramping over civil twilight (0→1 as the sun sinks 0→6° below the horizon),
  so dusk is a gradual ~25-minute fade, not a snap.
- With a night atlas present the old night exposure dim is OFF (the night bake
  is already dark; dimming would double-darken). Single-atlas baked GLBs and
  non-baked GLBs behave exactly as before.
- Requires re-running the bake with pipeline ≥2.1.0 to get the night look;
  existing GLBs keep working unchanged. New pipeline dials:
  `--night-sky-strength` (default 0.10), `--night-fill` (default 0.30),
  `--bake-day-only` to skip the second pass.

## 2.6.3

### "Others" category icon no longer reads like the overflow menu

- Swapped the "Others" category-filter icon from the horizontal-dots
  `MoreHorizontal` glyph to `Puzzle`. At small mobile sizes the dots read too
  close to the new ⋮ overflow-menu button (v2.6.2), inviting mix-ups between
  "toggle the misc-device category" and "open the view/Settings/profile menu."

## 2.6.2

### Single menu button on phones for view / Settings / profile

- On narrow screens the three right-side controls (view-mode toggle, Settings,
  switch profile) collapse into one ⋮ button that opens a dropdown, freeing
  top-bar width for the category filter. Roomier screens keep the inline
  buttons exactly as before.
- The dropdown shows who is signed in, then: Overview/First-person view
  (label follows the current mode), Settings (only when the profile may open
  it), and Switch profile. It closes on outside tap, Escape, or after
  choosing any action; proper `menu`/`menuitem` roles + `aria-expanded`.

## 2.6.1

### Top bar no longer overflows the screen on phones

- **Fixed:** on narrow screens the header buttons (category filter + right-side
  controls) ran past the screen edge and overlapped. The centre grid track was
  `auto`, so it always claimed its full content width no matter how many
  category buttons the active profile/config produced.
- The category pill now takes only the width left over between the brand and
  the right-side controls, at ANY screen width and ANY button count. When the
  buttons don't fit, the pill pans horizontally (touch swipe / trackpad /
  wheel) instead of pushing anything off-screen; `overscroll-behavior` keeps
  the pan from leaking into the 3D canvas.
- Edge fades on the pill show when more buttons exist to the left/right,
  driven by real scroll metrics (updated on scroll, resize/rotation and
  category-set changes) — scrollbars stay hidden.
- The category row is now an accessible `toolbar` landmark.

## 2.6.0

### Photo-realistic baked lighting (pre-computed, offline) — full revamp
- The app now auto-detects a GLB produced by the Blender pipeline's new
  `--bake` mode (pipeline v2.0.0). The bake runs a full Cycles global-
  illumination render (sun + Nishita sky + bounce light + real shadows +
  ambient occlusion) of the villa structure into a single texture atlas,
  embedded in the GLB as WebP. Detection is by material name: a GLB whose
  structure material is named `BAKED_Structure` switches the app into baked
  mode; any other GLB renders exactly as before — nothing to configure.
- In baked mode the structure renders **unlit** (its texture IS the finished
  lit image), and every dynamic-light system stands down because its work is
  already painted in: SSAO off (the bake has real AO — stacking screen-space
  AO on top double-darkens corners), sun shadow maps off, and per-entity
  PointLights + their cube shadow maps are skipped entirely. Entity state
  feedback is fully kept: emissive glow, GlowLayer bloom, highlights, badges,
  camera beams, room glow — everything the kiosk uses to show live HA state.
- Night ambience in baked mode comes from a scene-wide exposure drop (scaled
  by the existing Night dimming setting) instead of relighting — the baked
  image is a fixed daytime render.
- Expected wins: near-photo-realistic look (real GI/shadows) AND faster
  rendering (no shadow passes, no SSAO, far fewer active lights) — it should
  run better than 2.5.x on tablets, not worse.
- Note: a baked GLB is larger (embedded 4K atlas, typically ~10–20 MB). The
  HA Supervisor Ingress proxy caps uploads at 16 MB — if a central upload
  fails with 413, either bake with `--bake-size 2048`, or place the file in
  `/config/www` and point `model_path` at it. Browser-local uploads
  (Settings → stored in this browser) are not affected by the cap.

## 2.5.5

### LED strips: off state now uses window-glass transparency
- The off-state fade now uses the exact same rendering technique as window
  panes (ModelLoader's glass handling): material alpha (0.25) with
  MATERIAL_ALPHABLEND and forceDepthWrite, instead of 2.5.4's mesh.visibility.
  Visually similar, but technically safer: forceDepthWrite keeps the
  transparent strip writing depth, so its draw order can't flip against the
  (also transparent) glass walls as the camera moves — the same
  camera-angle-dependent appear/disappear glitch already documented and fixed
  for glass-vs-strip in v2.4.83. When the light turns ON the material is
  restored to fully opaque (alpha 1, MATERIAL_OPAQUE), so the on-state glow
  render path is exactly the same as 2.5.2's confirmed-good behaviour.

## 2.5.4

### LED strips: off state fades out instead of painting a black frame
- 2.5.3's "dark housing" colour backfired: a near-black 6cm bar against white
  ceilings is maximal contrast, so from the overview the off strips printed
  as bold black rectangles above the beds — worse than the white tube it
  replaced. No base colour can make a bar sized for the ON-state glow look
  like the ~1cm recessed channel it really is, so the off state now fades the
  strip mesh itself to ~22% opacity with a soft plaster-grey base colour: a
  faint seam hinting where the strip runs, still clickable, gone as a shape.
  Turning the light on restores full visibility with the same warm glow as
  2.5.2. Only artificially-inflated strip meshes are affected — real lamp
  geometry keeps full visibility when off.

### Highlight clickable objects: visible at overview zoom (blue tint + rim)
- 2.5.3 fixed the outline width units, but a 2cm blue rim is only 1–3 screen
  pixels at the whole-villa overview zoom — technically rendering, practically
  invisible. Clickable meshes now also get a translucent blue overlay tint
  across their whole surface (Babylon `renderOverlay`), which stays obvious at
  any zoom, plus a thicker 4cm outline rim for close-up views. The overlay is
  drawn by the same forward-pass renderer as the outline — NOT an EffectLayer
  — so it cannot corrupt the LED strips' GlowLayer (the original reason the
  old HighlightLayer glow was removed in v2.4.76).

## 2.5.3

### LED strips: dark housing when off (same unit bug, new symptom)
- Now that v2.5.2 correctly inflates SweetHome's 1mm LED filament to a real
  ~6cm bar, its baked "self-lit" base material — bright near-white, meant to
  look like a light source in SweetHome's own renderer — became visible as a
  solid glossy white tube whenever the light was off (the app only ever
  overrode the emissive on/off glow, never that base colour). Strip meshes
  that get inflated now also get a dark, unobtrusive base colour, so off =
  a recessed channel and on = the same warm glowing line as before. Real
  fixture geometry (lamp bodies, housings) is untouched — only the meshes
  that are actually artificial filaments get the treatment.

### Fix: "Highlight clickable objects" no longer highlighted anything
- Root cause: the SAME local-cm-vs-world-metre unit trap as the LED strip
  bug, in a different subsystem. Babylon's mesh outline (`outlineWidth`) is a
  LOCAL-space vertex offset; this model's local vertex data is in
  centimetres, so the flat `outlineWidth = 0.02` meant "0.2mm before the
  ~100x root scale" — invisible on screen ever since outlines replaced the
  old HighlightLayer effect in v2.4.76. Outline width is now converted from
  the intended 2cm WORLD thickness into each mesh's own local units, so the
  blue "clickable" outline is visible again.
- Extracted the local↔world conversion (`axisWorldScale`) shared by both
  fixes into `src/babylon/meshUnits.ts` so future mesh-geometry code doesn't
  have to rediscover this the hard way.

## 2.5.2

### The actual LED-line fix: the strip repairs never ran (unit mismatch)
- Root cause of every "light line breaks up depending on camera/zoom" report,
  found and fixed for real this time: the GLB keeps SweetHome's **centimetre**
  vertex data and the loader converts to metres by scaling the **root node**,
  so each mesh's local geometry is ~100x its world size. All strip repairs
  (thin-axis inflation v2.4.74/v2.4.88, corner-joint extension v2.4.87)
  compared and applied **metre** constants directly on that local data — the
  1 mm LED filament measured "0.1 units", which is not "< 0.06 m", so the
  inflation **never modified a single vertex**, and corners were extended by
  0.2 mm instead of 2 cm. Meanwhile the light-placement logic (world-space,
  correct units) kept visibly changing per release, masking the dead code.
- All strip repairs are now unit-aware: sizes are compared in world metres
  and vertex edits converted into each mesh's own local units via its world
  matrix, so the SweetHome "Led Line" filament really becomes a ≥6 cm bar and
  corners really overlap by 2 cm. Also made the joint extension idempotent
  across re-indexing (it's additive on vertex data).

## 2.5.1

### Guests can now tune the look & feel
- The **Guest** profile can open Settings and use every visualisation / UI
  option: theme (light/dark/auto), render quality preset, brightness, shadows,
  live weather, glow, night dimming, device state icons + icon size, eye
  height, walk speed, natural scrolling and wall collisions.
- Administration stays owner-only inside the same Settings screen: dashboard
  title, Home Assistant connection, villa coordinates, room-detection
  calibration, 3D model source and the Advanced tools (Config Editor,
  Inspector, backups) are hidden for guests.
- Saving Settings no longer reconnects the Home Assistant websocket unless the
  connection details actually changed.

## 2.5.0

### Feature: profiles, passcodes and role-based access control
- New entry screen: pick a profile — **Guest**, **Owner** or **Facility
  manager** — before the dashboard opens. Each profile can be gated behind a
  4-digit passcode.
- Passcodes are configured in the add-on options (`guest_pin` / `owner_pin` /
  `ops_pin`; leave one empty to let that profile in with a single tap). In
  add-on mode PINs are verified **server-side** by the supervisor-proxy
  (constant-time compare, 5-failure lockout for 5 minutes) and never reach
  the browser. Standalone builds use `VITE_GUEST_PIN` / `VITE_OWNER_PIN` /
  `VITE_OPS_PIN` from `.env` (courtesy gate — Vite bakes env into the
  bundle).
- Role-based device visibility on top of the existing map categories
  (`src/auth/permissions.ts` is the single editable matrix):
  - **Guest** sees comfort, lights, wifi and doors — never energy devices,
    cameras or motion sensors — and gets a clamped A/C range (22–28 °C).
  - **Owner** sees everything and is the only profile with Settings, the
    Config Editor, model uploads and backups.
  - **Facility manager** sees all device categories for on-site orientation
    and can control devices, but has no settings/customization access.
- Enforcement is layered: the 3D scene receives a role-filtered config
  (denied categories hidden, denied entities stripped from the entity map
  and mesh bindings), taps on denied meshes are refused, the HUD only offers
  permitted category filters, the Settings button/model tools/Advanced
  section render per capability, and `/config` deep links redirect without
  the `editConfig` capability.
- The active profile lives in per-tab `sessionStorage` (never in backups,
  never synced across tabs/devices); signing out returns to the profile
  screen and fully unmounts/disposes the 3D scene. The PIN itself is never
  stored client-side.
- New `/auth/roles` + `/auth/verify` endpoints on the supervisor-proxy with
  whitelist input validation (role + strict 4-digit shape) and a 1 KB nginx
  body cap; `/addon-config` continues to expose model paths only, so the
  PINs stay server-side.

## 2.4.88

### Fix: v2.4.87's corner-gap fix was real but incomplete — mid-edge breaks that shift with zoom
- User correctly pushed back: v2.4.87 only explains gaps AT a rectangle's
  corners, not a break in the middle of an edge, and definitely not a break
  that moves to a DIFFERENT segment when you zoom in/out on the exact same
  wall. A fixed geometric gap wouldn't do that — something view-dependent
  was still going on.
- Found it: SweetHome's Led Line piece is authored 1cm wide **and** 3cm
  tall — TWO separate thin dimensions, not one. `inflateThinStrip` (v2.4.74)
  only ever thickened the SINGLE thinnest axis it could find, leaving the
  other short axis untouched. From a near-overhead camera looking down at a
  low cove strip, WHICH of the two short axes actually determines the
  strip's on-screen thickness depends on the exact camera elevation/zoom —
  so a segment could render fine at one zoom level (the now-6cm axis
  dominates its screen footprint) and vanish at another (the still-thin
  axis takes over). That's exactly "a different part goes dark when I
  zoom" — a single-axis fix could never fully solve this.
- `inflateThinStrip` now thickens EVERY short axis below the 6cm floor
  (excluding the strip's own long axis, left untouched), not just the
  thinnest one. Same fixed-offset approach as before (not a scale factor —
  see the v2.4.74 lesson about unbounded scaling), applied per-axis.
- The v2.4.87 corner-joint fix stays — it's a real, separate, additional
  issue (confirmed from the raw .sh3d coordinates) and worth keeping even
  though it wasn't the whole story.

## 2.4.87

### Fix: LED-strip rectangles had a real (tiny) gap baked in at each corner
- User asked whether a nearby object could be "absorbing" the strip's light,
  making the line look cut. Confirmed there's no such mechanism in Babylon —
  materials don't dim a neighbouring emissive surface. The actual cause,
  verified directly from the `.sh3d` source coordinates: each rectangular
  LED cove (dining-table/sofa perimeter) is built from 4 separate straight
  strip pieces, and their authored endpoints don't reach far enough to
  overlap at the corners — e.g. the sofa rectangle's top-right corner has
  the top piece ending at y≈654.05 while the right piece only starts at
  y≈654.84, a real ~0.8cm gap. GlowLayer has nothing emissive to bloom from
  in that gap, so it reads as a hard, camera-angle-INDEPENDENT cut — easy to
  mistake for nearby furniture blocking it, when nothing is actually in the
  way. Same pattern found at the dining-table rectangle too, so this is a
  structural side-effect of the asset (4 independent rods, not one
  continuous shape), not a one-off modelling slip.
- Fixed generally (not just for this villa): `EntityVisuals.extendStripJoints()`
  stretches every strip mesh belonging to a multi-piece light entity 2cm past
  its own modelled endpoint on its long axis, so adjacent pieces always
  overlap at their shared corner regardless of small placement gaps. Uses a
  fixed additive distance, not a scale factor, so it can't blow up the way
  v2.4.74's original inflateThinStrip bug did. No SweetHome changes needed.

## 2.4.86

### Fix: camera beam now stays inside small rooms, and is a rounded shape instead of a hard-edged cone
- The beam's LENGTH was already clipped by a raycast along its centreline so
  it stopped at the nearest wall — but that only controlled reach, not
  WIDTH. In a narrow room, the cone's wide far end was often wider than the
  room itself, so its sides visibly poked through the side walls into the
  next room even though the centre axis correctly stopped short.
  `CameraBeams.clippedLength()` now also samples several rays fanned out at
  the cone's own half-angle from the SAME apex point — a ray from a cone's
  apex at exactly its half-angle traces along the cone's actual surface, so
  this is a correct (not approximate) test of where that surface first hits
  a wall in every sampled direction, not just straight ahead. The shortest
  hit across all of them is what the whole cone is allowed to reach, so it
  now narrows itself to fit whatever room it's in instead of a fixed-size
  wedge crammed into the available space.
- Replaced the hard-edged cylinder-cone with a `CreateLathe`-based rounded
  profile: an eased curve widens smoothly from the apex, then rounds into a
  soft dome at the far end instead of an abrupt flat disc — reads as a
  rounded spotlight instead of a sharp-edged wedge, per feedback after the
  first size pass.
- Beam radius now scales with its (possibly wall-shortened) length rather
  than always using the same fixed far-end diameter, so a beam that gets
  clipped very short in a small room narrows proportionally too instead of
  looking like an oversized megaphone stub jammed into the space.

## 2.4.85

### Changed: camera motion-beam is a short, wide "spotlight" instead of a long thin streak
- User feedback after the pitch/tilt work landed: the beam's proportions
  (6m reach, 1.6m diameter at the far end) read as a long thin laser
  crossing multiple rooms, not a light coming OUT of the camera. Roughly
  halved the max reach (6m → 3m) and nearly doubled the far-end diameter
  (1.6m → 3m), which widens the cone's spread angle from about 7.6°
  half-angle to 30° — same direction/tilt as before, just a stubby wide
  spotlight instead of a laser streak.

## 2.4.84

### Add: camera tilt (pitch) now steers the motion-detection beam vertically
- The camera beam only ever used SweetHome's `angle` (yaw / rotation around
  the vertical Z axis), so changing a camera's TILT — the "Horizontal
  rotation around X axis" field in the Modify furniture dialog's Orientation
  section — had no effect on the beam at all, even though SweetHome already
  records it (as a `pitch` attribute in the `.sh3d` XML, radians, omitted
  when 0 exactly like `angle`). `sh3dParser.ts` now reads it;
  `SceneManager.ts` composes it with the existing yaw into a full 3D unit
  direction (horizontal part scaled by cos(pitch), vertical part
  −sin(pitch)); `CameraBeams`/`EntityVisuals` already built their cone/raycast
  from a general 3D vector, so no change was needed there beyond accepting a
  non-zero Y component.
- To use it: in SweetHome 3D, select the camera prop → Modify → Orientation →
  choose the **X axis** rotation field (not Y — that one is roll, which spins
  the camera around its own aim, not the aim itself) → set a tilt angle →
  save → re-upload the `.sh3d`. Positive/negative direction (tilts the beam
  down vs. up) is not yet verified against a real tilted camera in-app — if
  it goes the wrong way, that's a one-line sign flip in `SceneManager.ts`'s
  `vy = -Math.sin(pitch)`, tell me which way it actually went and I'll flip it.
- Also fixed a related gap while investigating: the ingress/add-on "Upload
  central SH3D" button uploaded the file to the server but never parsed it
  client-side, so `config.sh3dEntities`/`sh3dRooms` — and therefore every
  camera's beam direction — silently never updated after using that button.
  Only the separate standalone-mode uploader did this. Both now parse and
  apply the file's data immediately on upload.

## 2.4.83

### Fix: real WebGL error every frame — "Active draw buffers with missing fragment shader outputs"
- User reported this exact GL_INVALID_OPERATION spamming the console on every
  load. Cause: v2.4.78's `needDepthPrePass = true` on glass materials adds a
  whole SEPARATE render pass with its own shader. `GlowLayer` (used for lit
  fixtures) works by re-rendering every material in the scene into its own
  texture to composite the glow correctly — so that extra depth-prepass
  shader gets invoked there too, and its output didn't match what that
  render target expected, which is exactly what this GL error reports. A
  genuine WebGL error is far more serious than the visual glitch it was
  meant to fix (rendering corruption/dropped draw calls, not just "looks a
  bit off"), so this needed reverting immediately rather than living with it.
- Replaced with `forceDepthWrite = true` — a much lighter fix for the same
  underlying problem (opaque geometry near/behind glass depth-testing
  correctly regardless of alpha-blend sort order). It just makes the
  material's NORMAL alpha-blend pass also write depth, with no separate pass
  or shader, so it cannot produce this class of render-target mismatch.

## 2.4.82

### Improvement: debug logs now also go to the browser console
- `tapDebug()` (the diagnostic used for the camera-beam investigation, among
  others) now mirrors every line to `console.log` as well as the on-screen
  box, prefixed `[tapDebug]`. Plain `console.log` isn't stripped in
  production the way `devLog.ts`'s calls are, so this works in the deployed
  build exactly like the on-screen box does — but with the browser
  console's native scrollback, search and copy, for whenever real devtools
  ARE available (e.g. testing from a desktop browser pointed at the kiosk)
  instead of only the kiosk-tablet on-screen fallback.

## 2.4.81

### Fix: on-screen debug box couldn't be copied, and evicted its own useful lines too fast
- The v2.4.80 debug box (`tapDebug`) had `pointer-events:none` — completely
  unclickable/unselectable by design, so there was no way to actually copy
  its text off a kiosk tablet with no devtools. Changed to
  `pointer-events:auto` + `user-select:text` (safe: this element only exists
  at all when debug mode is deliberately opted into) so it can be
  long-pressed/dragged to select and copy. Also added scrolling
  (`max-height:60vh;overflow-y:auto`) and raised the rolling buffer 6 → 40
  lines, since routine per-tap logs (`pickBadgeAt`, `3D pick`) were evicting
  one-off summaries — like the camera-beam build report — within seconds.

### What the first debug capture already showed
- At page load, EVERY camera entity (`garden_and_terrace_cam`, `kitchen_cam`,
  `swimming_pool_cam`, `garden_public_wall_cam`, `livingroom_cam`,
  `patio_terrace_cam`) reports "NO BEAM MESH exists" — and the
  `buildCameraBeams()` summary line never appeared at all. That line only
  fires when at least one camera-typed entry is found in this session's
  `byEntity` index; total silence there means NONE of the 6 configured
  cameras currently have a matching 3D mesh in the loaded model, not just
  livingroom_cam's rotation being unresolved. That's a different, more basic
  problem than the angle bug fixed in v2.4.77 — worth confirming directly
  (can any camera prop be tapped/selected as a 3D object in the villa view
  at all?) rather than continuing to chase the angle.

## 2.4.80

### Diagnostic: camera motion-beam now reports WHY it isn't showing
- After the v2.4.77 radians/degrees fix, a camera set to a real 70° rotation
  still showed no beam at all — not just aimed wrong, genuinely invisible.
  That means the beam mesh likely isn't being created in the first place
  (missing sh3d angle data reaching this camera, a mesh/entity mismatch, or
  similar), which the code was previously silent about either way.
- `buildCameraBeams()` and `setBeamActive()` now report through `tapDebug` —
  a small on-screen log box (bottom-left), NOT the dev-only console logger,
  so it works on the actual kiosk/tablet, not just in a browser dev console.
  Enable it with `?debug` in the URL or `localStorage.setItem("villa:debug","1")`
  then reload. It reports, per camera entity: whether a beam was built, or
  the exact reason it was skipped (no mesh / no sh3d angle data / angle is
  zero / no world bounds) — and when motion turns a beam on/off, whether a
  beam mesh existed for that camera at all.
- Next step: with `?debug` on, trigger the motion sensor again and read what
  the on-screen box says — that pinpoints the actual failure instead of
  guessing at it.

## 2.4.79

### Fix: giant vertical "light beam" punching through the ceiling near the sofa
- Found from a close-up screenshot: a bright column of light shooting from
  floor to ceiling, made of the same warm glow as the LED strips. This was
  MY OWN bug from v2.4.74, not a lighting issue — `inflateThinStrip()`
  thickens a razor-thin strip mesh's thinnest axis by multiplying each
  vertex's offset from centre by `MIN_STRIP_THICKNESS / size[thin]`. That
  scale factor is unbounded as the measured thickness shrinks toward zero —
  and in practice it does: Draco compression quantises vertex positions, so
  a strip modelled 1cm thick in SweetHome can come out of the GLB at a
  fraction of a millimetre. A near-zero denominator produced a scale factor
  in the hundreds, stretching that one mesh into a vertical column reaching
  through the floor and ceiling.
- This is also very likely why the sofa-area rectangle kept looking broken
  even after v2.4.76's merged-light fix: `mergeStripEntityLights()` centres
  its one shared light on the bounding box merged across all 4 side meshes,
  and one wildly-stretched mesh drags that merged centre far from where it
  should be — corrupting the fix's input, not the fix's logic.
- Rewrote `inflateThinStrip` to push each vertex to a FIXED distance from
  centre (±3cm) instead of multiplying by a scale factor — bounded for any
  input, including exactly zero, so this class of blowup can't recur.

## 2.4.78

### Fix: LED strip still broke up near the glass wall with nothing actually in the way
- The dining-table strip's edge running along the glass sliding-door wall
  kept showing gaps in testing even with no furniture/plants overlapping it
  on screen — ruling out ordinary occlusion. Root cause: glass materials are
  alpha-blended (`ModelLoader.ts`), and alpha-blended surfaces don't write
  depth by default, so Babylon sorts them back-to-front by distance from the
  camera every frame. That sort order can flip relative to nearby OPAQUE
  geometry (the LED strip mounted right at the glass wall's top edge) as the
  camera moves, making the strip intermittently render as if it were behind
  the glass when it isn't — a camera-angle-dependent appear/disappear glitch
  with nothing actually between the two, exactly matching what was reported.
  Fixed by setting `needDepthPrePass = true` on glass materials — adds a
  depth-only pass before the colour pass so nearby opaque geometry is
  depth-tested correctly regardless of alpha-blend sort order.

## 2.4.77

### Fix: camera motion-detection beams pointed the wrong way (radians/degrees bug)
- `binary_sensor.livingroom_motiondetection` going active should show a red
  "detection beam" cone from `camera.livingroom_cam` (`CameraBeams.ts`), and
  its motion-sensor binding was already correctly configured. The beam was
  invisible anyway because `planAngleToDir()` (`roomCalibration.ts`) treated
  its input as DEGREES and converted it to radians a second time — but
  `sh3dParser.ts` stores `angle` straight from the `.sh3d` XML, which is
  ALREADY in radians (confirmed straight from the source file: values run
  0..~6.28, e.g. `angle='3.1415927'` for `camera.livingroom_cam`'s real
  180° rotation). The double conversion silently mangled every
  nonzero-rotation camera's direction into a near-arbitrary ~1°-equivalent
  facing, so the beam pointed into whatever was nearest (usually a wall) and
  got clipped to nothing — invisible, not merely wrong-facing. Every other
  camera in the villa happened to still be at the model's default angle=0,
  which is unaffected by this bug either way, so this went unnoticed until
  now. Fixed by taking the angle as radians directly, matching the source
  data — no unit conversion needed.
- The sin/cos → facing-direction mapping itself is still unverified against
  a real rotated camera's actual facing in-app (only the unit bug is
  confirmed fixed) — if the beam now shows but points the wrong way, that's
  a sign/axis convention issue in the same function, not this bug.

## 2.4.76

### Fix: found and fixed the actual cause of the LED-strip breakup (two causes, not one)
- **Cause 1 (confirmed by a user-provided side-by-side comparison): "Highlight
  clickable objects" corrupted nearby glowing meshes.** That toggle used a
  Babylon `HighlightLayer` — a screen-space post-process that, like `GlowLayer`
  (used for lit fixtures), renders the whole scene into its own off-screen
  buffer and composites back via a shared stencil test. Two active
  "EffectLayers" are a long-standing, only partially fixed Babylon limitation
  (BabylonJS/Babylon.js#4463): they corrupt each other's output exactly where
  their affected meshes overlap on screen. That's why an LED strip printed
  broken/cut segments specifically where it passed near a highlighted curtain,
  TV, etc., and why turning highlighting off made it render as a clean line.
  Replaced `HighlightLayer` with per-mesh `renderOutline`/`outlineColor` —
  drawn in the normal forward render pass (an extruded backface silhouette),
  not a competing screen-space effect layer, so it cannot corrupt any glow no
  matter what overlaps it. Same blue outline look, no interaction with glow.
- **Cause 2: a rectangular LED cove (dining-table / sofa-area perimeter) is
  modelled as 4 separate elongated meshes (one per side), so the room-wash
  logic gave it 4 separate PointLights — 4 hotspots instead of one even wash.**
  Bloom blends those into something passable from a distance, but up close
  they separate into visible "pools" — the "separate light bulbs" look
  explicitly not wanted. `EntityVisuals.mergeStripEntityLights()` now merges
  a light entity's PointLights into ONE shared light at the merged bounding
  box's centre whenever EVERY mesh of that entity is an elongated strip.
  Genuinely separate fixtures under one entity (e.g. two bedside lamps) are
  unaffected — they don't pass the "every mesh is a strip" test, so each
  keeps its own light exactly as before.
- Removed v2.4.75's unconfirmed z-fighting test nudge (ruled out — the user
  confirmed no visible change from it).
- Note: ordinary furniture/plants sitting between the camera and a thin,
  low-mounted strip WILL still occlude part of it from some angles — that's
  correct depth-tested 3D rendering, not a bug, and changes with viewpoint by
  nature. Worth telling apart from the two fixes above when checking results.

## 2.4.75

### Test: nudge LED strip meshes down, off whatever they're mounted flush against
- v2.4.74's geometry fix (thickening the strip's 1cm width to 6cm) did not
  change the reported flicker either — which rules out sub-pixel aliasing as
  the (sole) cause and points at something neither of the last three releases
  touched: the strip's *vertical* position. A cove LED strip is mounted right
  at the ceiling/wall junction; if it's touching or slightly overlapping a
  ceiling or beam surface there, the two coincident surfaces "z-fight" —
  flicker between which one renders on top as the camera angle changes, which
  matches the reported symptom exactly and would explain why nothing
  lighting-related has helped.
- This release nudges elongated fixture meshes down 4cm (`STRIP_CEILING_CLEARANCE`
  in `EntityVisuals.ts`) purely to test that theory. This is a diagnostic, not
  a confirmed fix: if the flicker goes away, the real fix is to lower the
  strip's Elevation in SweetHome 3D with a proper margin; if it doesn't change
  anything, z-fighting is ruled out too.

## 2.4.74

### Fix: found the actual cause of the LED-strip "changes with camera position" look
- v2.4.72/73 both targeted the strip's dynamic PointLight (the room-wash source)
  and made no visible difference, because the dynamic light was never what the
  user was looking at. The visible glowing LINE is the fixture MESH's own
  emissive surface, and that mesh — SweetHome's Led Line asset — is modelled
  only **1 cm wide** (3 cm tall, 2.5-3 m long). From nearly any camera distance
  that's under a pixel on screen, so the rasteriser only lights a scattered
  handful of sub-pixel samples along the strip's length — which samples "hit"
  depends on the exact camera position, so the line reads as patchy/broken and
  visibly reshuffles as the camera moves by even a little. Confirmed straight
  from the .sh3d source (`width='1.0'`/`depth='1.0'` on all 4 perimeter
  segments), independent of anything camera- or lighting-related.
- Fixed at the geometry: `EntityVisuals.inflateThinStrip()` thickens a light
  fixture mesh's thinnest axis to a 6 cm floor (still reads as a slim cove
  strip) by nudging vertex positions symmetrically about the mesh's own
  centre — no SweetHome re-export needed. No-op for normal (non-strip) light
  fixtures, whose thinnest dimension is already well above the floor.

## 2.4.73

### Fix: LED strips read as a chain of separate bulbs, and light pools shifted with the camera
- v2.4.72's approach (several point lights sampled along a strip) was wrong and
  is reverted. A point light sitting on a ceiling/wall-mounted strip is
  centimetres from that surface, so each sample printed its own hard bright
  pool — a dotted chain instead of a light line. Worse, up to 24 lights for one
  perimeter LED entity blew far past the per-material simultaneous-light cap
  (6), and Babylon's choice of which lights to keep changes with the camera —
  the shifting/popping light pools in the screen recording.
- New approach: the continuous "LED line" look comes from the strip mesh's own
  emissive colour + the existing glow bloom (view-independent, always a line,
  never bulbs). The dynamic light is back to ONE per fixture mesh and is only
  responsible for the soft ambient wash on the room; for elongated strips
  (>1.5 m) it is dropped partway toward the floor, well clear of the mounting
  surface, so the wash is wide and soft instead of a tight hotspot.
- Entity lights no longer emit specular: on the glossy tiled floor each light's
  white specular glint slid across the tiles as the camera moved, easily read
  as the lights themselves flickering. Diffuse-only pools now look identical
  from every viewpoint.
- Per-material simultaneous-light cap raised 6 → 8 (sun + ambient + a 4-piece
  perimeter strip + two more lamps before anything gets dropped).

## 2.4.72

### Fix: line-LED strip fixtures lit unevenly and looked camera-dependent
- SweetHome 3D's linear LED asset (the "Sweet Home Light" plugin's `Led Line.obj`)
  is a single long fused mesh (up to ~3 m). Each light fixture only ever got ONE
  `PointLight`, placed at that mesh's centroid, so the middle of the strip lit
  the room while the ends — beyond the light's range — stayed dark. A single
  point source that close to the ceiling/walls also threw a hard specular
  hotspot that visibly slid across nearby surfaces as the camera moved, which
  read as the light itself flickering or being inconsistent even though the
  emitted light never changed.
- Elongated fixture meshes now get several `PointLight`s sampled along their
  long axis instead of one at the centre, approximating a continuous linear
  emitter — the total intensity is normalised across all of them so overall
  brightness is unchanged. Also zeroed specular/metallic reflectivity on light
  fixture meshes so their housing reads as a matte diffuser instead of a
  mirror.

## 2.4.71

### Removed: Drop Control Marker and All Clear features
- Deleted the floating "drop a control marker at a tapped 3D point" feature
  entirely — HUD button, place-mode picking, marker meshes/visuals, config
  storage and the Config Editor's marker management table are all gone
  (`MarkerManager.ts`, `MarkerDialog.tsx`, `MarkersTable.tsx`,
  `markerUtils.ts` removed).
- Deleted the "All Clear" alert-count badge and the Config Editor's "Alert
  thresholds" section. Per-sensor danger/warning coloring in the sensor
  detail panel is unaffected — that's a separate feature that doesn't need
  the removed admin UI to keep working.

### Changed: Bind 3D Object to Entity moved out of the main screen
- Removed the "tap an object to bind it" button and its interactive picker
  from the main villa view. Binding a 3D object to an entity is now done
  entirely from the Config Editor's "Bound 3D objects" table, which already
  supported picking an entity for any unbound object directly — no 3D tap
  required.

### Changed: HUD layout reshuffled
- The category filter (which device types show their state badge) moved
  from the left column to a horizontal pill centered in the top bar, where
  the old bind/marker buttons used to sit.
- The "highlight clickable objects" and "show device state labels" toggles
  moved from the top bar into a new vertical section on the left, directly
  below the floor switch.
- The Rooms button is now a third button in the floor switch, below 2F.
- The first-person / bird's-eye view toggle moved next to Settings at the
  top right.

## 2.4.70

### Fix: badge icon glyphs rendered off-centre (vertically)
- `glyphDataUrl()` drew each emoji to a canvas using `textBaseline: "middle"`,
  which centres on the FONT's ascent/descent metrics, not the glyph's actual
  visible ink. Colour emoji glyphs routinely sit well off that metric centre
  — measured up to 3.5px off on a 72px canvas for 💡 (the exact icon
  reported), and nearly every other glyph (🔒 🔓 🚪 🪟 💧 📺 🛜) had the
  same upward bias by varying amounts, which is why it was visible on badges
  generally, not just one icon.
- Fix: draw the glyph once, measure the real non-transparent pixel bounding
  box via `getImageData`, then redraw shifted so THAT box — not the font's
  metrics — is centred on the badge. Verified this brings every tested
  glyph to within ±0.5px of dead-centre.

## 2.4.69

### Fix: badge taps — root cause finally found and removed
- The real bug all along: the tap target stored for each badge was the
  projection of the entity's 3D ANCHOR point, but the badge circle you see
  is drawn ~56 px ABOVE that point. Babylon places the linked label
  container's CENTER at `anchorProjection + linkOffsetY(−38px)`, and the
  40 px badge sits at the TOP of the 76 px label stack, another 18 px up.
  So a tap dead-centre on a visible badge always measured ~56 px away from
  the stored centre and missed; the circle that actually accepted taps
  floated invisibly over the device mesh below. That explains every
  confusing symptom: taps "sometimes worked" because the miss fell through
  to the 3D raycast which often picked the same entity's mesh, and the
  hover hand-cursor appeared below the badge, not on it. v2.4.68 fixed the
  coordinate-space inflation but kept measuring from the wrong centre.
- Fix: the parallel screen-position bookkeeping is gone entirely. Badge
  hit-testing now asks the GUI's own transform-accurate
  `Control.contains()` on the exact geometry Babylon rendered (badge circle
  + value pill), with a small slop ring for fat fingers. There is no second
  model of where badges are to drift out of sync ever again.
- Bonus fixes that fall out for free: toggling labels off no longer leaves
  stale invisible tap targets swallowing taps, and where two badges
  overlap the tap now goes to the one drawn on top (what you actually see),
  not the one created first.
- Verified against a real render this time: a headless-browser tap sweep of
  3,619 synthetic taps across the whole viewport produced hits ONLY in
  tight clusters centred on the 39 visible badges (worst centroid error
  19 px on a 40 px badge, most within 12 px), confirmed against Babylon's
  own rendered layout positions.

## 2.4.68

### Fix: the actual bug — badge screen positions were inflated ~1000x, breaking almost every tap
- Found by reading Babylon's own `Vector3.ProjectToRef` source rather than
  guessing again: given a viewport already converted to pixel space via
  `.toGlobal(w, h)` (as this code does), `Vector3.Project` returns `p.x`/
  `p.y` ALREADY in that pixel space — not normalized 0..1. `cullLabels()`
  was multiplying by `w`/`h` a second time, inflating every badge's stored
  screen position by roughly the render width/height. This bug was
  introduced in v2.4.65 (the overlap-nudge attempt) and silently carried
  through v2.4.66's rewrite — explaining why that rewrite made things worse
  instead of better: it depended on this same broken position data for
  every badge, not just the one originally reported.
- Verified the fix with a hand-checked coordinate round-trip (including
  hardware-scaling/HiDPI) before shipping, not just code review this time.
- Also restored the hover-cursor feedback dropped in v2.4.66 (mouse pointer
  changes to a hand over a badge) — now driven through the same corrected
  pipeline instead of Babylon GUI's own per-control handling.
- The on-screen tap diagnostic from v2.4.67 stays in place (`?debug` or
  `localStorage villa:debug=1`) in case anything is still off.

## 2.4.67

### Diagnostic only — no fix in this release
- v2.4.66's rewrite (bypassing Babylon GUI's own click handling for badges
  entirely) did NOT resolve the untappable-badge issue either. Two attempts
  based on code review alone have both missed the actual cause, so this
  release adds a visible, on-screen diagnostic instead of a third guess.
- Enable with `?debug` in the kiosk's URL, or run
  `localStorage.setItem("villa:debug", "1")` in the browser console then
  reload. A small green-on-black box appears bottom-left showing, for every
  tap/long-press: the raw touch coordinates, how many badges are currently
  tracked, the nearest badge and its distance (hit or miss), and — if no
  badge was hit — what the 3D raycast found instead (or "no hit" if nothing
  was struck at all). Tapping the "dead" badge with this on will show
  exactly which stage of the pipeline is failing, or whether the tap is
  reaching the app at all.
- Not gated behind the usual dev-only build flag (unlike existing debug
  logging) since this failure has only ever reproduced on a real kiosk, not
  in development — opt-in via the flag above, invisible otherwise.

## 2.4.66

### Change: state badges no longer use Babylon GUI's own click handling — at all
- v2.4.65's overlap-nudge fix turned out to be treating the wrong cause:
  badges reported untappable with zero visible overlap with any neighbour,
  which ruled out screen-position collision as the explanation. That fix is
  fully reverted.
- Rather than keep chasing an intermittent, hard-to-pin-down failure inside
  Babylon GUI's own per-control pointer observables, badges no longer use
  them at all. A tap/long-press now checks badge hit-testing FIRST (plain
  nearest-centre distance math against each visible badge's last-known
  screen position) using the SAME gesture pipeline already reliably driving
  3D-mesh taps, falling through to the existing 3D raycast only when no
  badge was hit. This also means two overlapping badges now resolve by
  "whichever centre the tap landed closer to" instead of an opaque
  z-order winner.
- Known trade-off: the desktop-only pointer-cursor hover hint and the
  press-scale animation on a badge are dropped for now, in favor of
  reliability over that polish — can be reintroduced against the new
  pipeline later if wanted.

## 2.4.65

### Fix: a state badge could become untappable when crowded next to another one
- State labels are deliberately never auto-hidden when crowded (an earlier
  version tried that and it backfired — see `cullLabels()`'s docstring), but
  nobody had accounted for a side effect: when two badges visually overlap
  on screen, Babylon's GUI layer gives the topmost one exclusive claim to
  taps landing in the overlapping area — the one underneath became a dead
  zone there. Camera-angle-dependent (the two badges' screen positions
  change relative to each other) and explained why hovering near the actual
  3D device sometimes "fixed" it — that's a different screen position than
  the badge's exact center, one that happened to land outside the overlap.
- `cullLabels()` now nudges overlapping badges apart by a few pixels every
  frame, live, whenever two are closer than their combined tap-target size —
  nothing is hidden, both stay independently visible and tappable. Verified
  the separation math standalone: near-overlapping pair separates to just
  past the minimum distance, exactly-coincident badges use a stable fallback
  direction (no divide-by-zero), and distant badges are completely
  untouched.

## 2.4.64

### Fix: "Upload central SH3D" failed with HTTP 413 for any real-sized villa
- Root cause, finally confirmed from the browser console: Home Assistant's
  Supervisor Ingress proxy hard-caps a proxied request body at **16 MB** — a
  platform-level limit (home-assistant/supervisor#2950) this add-on has no
  way to raise, no matter how nginx's or aiohttp's own limits are set (both
  were already generous — verified aiohttp's own default doesn't even apply
  to this handler's streaming upload path). A SweetHome `.sh3d` bundles the
  full 3D preview model (OBJ/MTL/textures) for every catalog furniture piece
  used in the plan, which is what actually balloons it to tens of MB — a
  46.8 MB villa file in testing.
- This app only ever reads `Home.xml` out of a `.sh3d` (room names/shapes +
  a few furniture positions) — never the embedded furniture previews. The
  central-SH3D upload now re-zips down to just that entry before sending:
  confirmed 46.8 MB → 20.7 KB on a real villa file, byte-identical on
  round-trip, all rooms intact. Comfortably clears the 16 MB ceiling for any
  realistic villa plan, with zero functional loss.
- Also fixed: a failed upload's message was shown in green (success)
  styling regardless of outcome — it now shows red for a failure.

## 2.4.63

### Fix: a re-uploaded central GLB/SH3D could silently stay stale for up to an hour
- Root cause, finally isolated: `versionedModelUrl()` (the client-side logic
  that detects a replaced central model file) HEADs the bare, query-less
  `/model/...` URL first to read its current ETag/Last-Modified, then appends
  that as `?v=<tag>` before the real download — that tag change is the ONLY
  signal the app has that the file was replaced. The service worker only
  intercepts `GET` requests, so that HEAD request fell through to the
  browser's own native HTTP cache — and nginx was sending
  `Cache-Control: public, max-age=3600` on EVERY `/model/` response,
  including that probe. Net effect: the browser could keep answering the
  version-check with the OLD file's headers for up to an hour after any
  re-upload, producing the same stale `?v=` tag, which hit the same entry in
  the service worker's own model cache — so a fresh GLB or SH3D upload could
  silently fail to take effect no matter how many times you re-uploaded or
  hard-refreshed, until that hour happened to elapse.
- `nginx.conf`'s `/model/` location now varies `Cache-Control` by whether the
  request carries `?v=`: a versioned URL is a distinct, immutable resource by
  construction (a changed file always gets a new tag) and is now cached
  aggressively forever; the bare/unversioned path (used only for the
  freshness probe) now always revalidates (`no-cache`), so a re-upload is
  detected on the very next load. Verified with `nginx -t` and a live
  request against both URL shapes before shipping.
- This affected the GLB exactly as much as the SH3D — if your kitchen
  geometry also hadn't visually updated yet, this is why.

## 2.4.62

### Change: surface a failed central .sh3d refresh instead of failing silently
- The background central-`.sh3d` refresh (add-on mode, runs after every load
  to pick up room-name changes without blocking first paint) only ever
  logged a failure to the browser console — invisible on a kiosk tablet with
  no devtools. If a re-uploaded `.sh3d` still doesn't update the Rooms menu
  after updating to v2.4.61+, this will now show exactly why: a 404 on the
  central file, a plan with no named rooms, or a parse error with its
  message — as a small dismissible banner instead of nothing at all.

## 2.4.61

### Change: Room field now suggests your actual room names (typo protection)
- The "Room" field (Bound 3D objects table and the Config Editor) is matched
  EXACTLY (case/whitespace aside) against a real room's name by the
  motion-glow and teleport code — a typo, or a name that doesn't match any
  actual room, silently does nothing with no error anywhere. That's the
  likely cause if a sensor's floor glow works for one room but not another
  with no other difference.
- Both Room fields now autocomplete from your real Rooms-menu names (a
  native browser suggestion list), so a mismatch is visible while typing.
  Still plain text underneath — typing a name that doesn't exist yet (e.g.
  ahead of adding that room) still works, it's just no longer a silent trap.

## 2.4.60

### Fix: a re-uploaded central .sh3d's new/renamed rooms never appeared in the Rooms menu
- The add-on's central .sh3d (shared by every device) is fetched and parsed
  in the *background* after the GLB loads, so first paint doesn't wait on
  parsing a large SweetHome project file — this is intentional. The bug:
  once that background parse landed, nothing told the scene to actually
  re-run room calibration with the fresh data, so a new room (e.g.
  "Kitchen") or a rename (e.g. "Bedroom1" → "Bedroom 1") sat in memory
  unused — the Rooms menu kept showing whatever was calibrated from the
  *previous* upload.
- `SceneManager.updateConfig()` now treats a change to the parsed sh3d room/
  entity data as a reason to recalibrate, the same as it already does for an
  entity-map change or a mirror-flip toggle.
- Side effect worth knowing about: since the app can't tell "renamed" apart
  from "deleted old room + added new one", a renamed room will show up
  ALONGSIDE its old, now-orphaned name in the Rooms menu after this fix
  applies (by design — it never silently deletes a room in case it was
  hand-customized). Delete the stale one via its trash icon once.

## 2.4.59

### Fix: a point-room's motion glow floated at one flat height, poking out from under sloped assets like a staircase
- A "room" added via the Rooms menu's "Add room here" (no drawn sh3d polygon
  behind it — e.g. a staircase landing) drew its glow as a flat disc at a
  single Y height. A staircase rises well above that one height, so the
  disc appeared to float below/behind the stairs' geometry instead of lit
  across their surface.
- `RoomHighlight` now probes straight down from the anchor and, if it finds
  real geometry there, projects the glow as a Babylon decal draped onto that
  surface (steps, slopes, whatever it actually is) instead of a rigid flat
  circle. Falls back to the previous flat circle when nothing sensible is
  found to project onto, so ordinary flat-floor rooms are unaffected.

## 2.4.58

### Change: the anchor (default-view) button now goes-to instead of only saving
- Tap now jumps straight to this device's saved default overview framing
  (useful as a "home" button while browsing around, not just something that
  happens automatically on load/reload). If nothing has been saved yet, a
  hint explains how to set one instead of silently doing nothing.
- Long-press / right-click now (re)defines the default as whatever
  angle/tilt/zoom/pan the camera is currently at — same gesture, new role
  (previously tap saved and long-press cleared; there's no separate "clear"
  anymore, since redefining always overwrites the old value).

## 2.4.57

### Fix: re-anchoring a room's bird's-eye view in the Rooms menu didn't restore the angle/tilt/zoom
- v2.4.56 fixed which camera the long-press/right-click gesture captured
  (the overview camera instead of a stale dormant first-person one) but the
  restore side was still broken: `TeleportPoint` only ever stored a flat
  position + look-at target, and clicking a room card while in overview mode
  did nothing but pan the camera to that x/z — the height, rotation and zoom
  you'd carefully framed were silently discarded, so the view you got back
  never matched what you saved.
- Added a proper `overviewPose` (angle/tilt/zoom + pan target) captured from
  the live overview camera on long-press/right-click, and overview-mode
  navigation now restores it exactly instead of just panning. "Add room
  here" gained the same capture.
- Also fixed a durability gap this uncovered: rooms parsed from the villa's
  floor plan get their position fully rebuilt on every model reload or
  mirror-flip recalibration (by design, so the fit stays correct) — which
  would have silently discarded a saved `overviewPose` on the very next
  reload. It's now carried forward across recalibration instead of being
  dropped.

## 2.4.56

### New: fix a per-device default overview view
- New button next to the (i) navigation-tips button (overview mode only,
  bottom-left) that saves the bird's-eye camera's current angle/tilt/zoom/pan
  as THIS device's default framing — reapplied every time the app lands in
  overview from now on (cold load, model reload, or switching back from
  first-person). Solves the auto-fit landing at an awkward rotation/crop on
  a given phone/tablet's aspect ratio, without having to re-adjust it by hand
  on every reload.
- Tap to save, long-press or right-click to clear (same tap-vs-hold
  convention as the Rooms menu's re-anchor gesture). A brief confirmation
  line replaces the tips text either way.
- Stored in its own `localStorage` key, deliberately kept OUT of the
  exportable app config — a wall tablet and a phone need different framing
  for the same villa, so this is never carried across devices by a backup
  restore.

### Fix: re-anchoring a room from the Rooms menu while in overview mode saved the wrong position
- "Long-press / right-click a room card to save the current view as that
  room's anchor" always captured the FIRST-PERSON camera's position, even
  when the Rooms menu was opened while browsing in the bird's-eye overview.
  That camera goes dormant (input detached) while in overview, frozen
  wherever it was last left — often the initial spawn point — so the
  confirmation checkmark fired correctly but silently saved a stale,
  unrelated pose instead of the room actually being viewed. Clicking the
  card again would then pan to the wrong spot, looking like the save had
  simply been ignored.
- The capture is now mode-aware: in overview mode it reads the overview
  camera's current pan target (which live-updates as you pan/zoom) instead
  of the stale first-person position. "Add room here" had the identical bug
  and got the same fix.

## 2.4.55

Internal refactor round — no functional or visual change to any existing
behavior; camera-beam direction math, room calibration, and pulse timing all
verified to reproduce the prior 2.4.54 behavior exactly.

### Structure: extracted two Babylon modules to keep single-responsibility
- `src/babylon/roomCalibration.ts` (new) — the three-strategy plan→world
  calibration solver (affine fit / entity-anchored sign fit / raycast-vote
  fallback) moved out of `SceneManager.calibrateRooms` as pure, engine-free
  functions. The one scene dependency (the fallback's downward floor
  raycast) is now injected as a callback, so the solver has no Babylon
  import and is unit-testable on its own.
- `src/babylon/CameraBeams.ts` (new) — camera motion-detection beam mesh
  lifecycle (build/clip/dispose/pulse) extracted from `EntityVisuals`,
  matching the existing `RoomHighlight` pattern. `EntityVisuals` keeps the
  policy (which cameras qualify, motion-sensor routing) and delegates cone
  geometry.
- The alert-pulse / beam-pulse animation is now driven by real elapsed time
  (`PULSE_RAD_PER_SEC`, clamped for the on-demand render loop's idle gaps)
  instead of a fixed per-frame increment, so it breathes at the same
  perceived rate regardless of display refresh rate.

### Security: harden the two places untrusted bytes enter the app
- `src/config/sanitizeConfig.ts` (new) — importing a backup ZIP (Settings →
  Import) used to cast the parsed JSON straight to `Partial<AppConfig>` with
  no validation, so a corrupted or handcrafted `config.json` could inject a
  wrong-typed field (crashing far from the import site) or an `haToken`.
  Imports are now whitelist-validated key-by-key against the app's own
  default config shape, and `haToken` is always stripped.
- `rootfs/usr/bin/supervisor-proxy.py` — the add-on's `/model-upload`
  endpoint accepted any bytes under a claimed `kind=glb|sh3d` and published
  them into Home Assistant's `www` folder (served by both the add-on and HA
  itself). It now checks the upload's stream-head magic bytes (`glTF` for a
  binary glTF, a ZIP signature for `.sh3d`) before accepting it.

### Accessibility: icon-only controls now have accessible names
- Every icon-only button in `HUD.tsx` (mobile dropdown triggers, display/
  build toggles, Settings, view-mode switch, Rooms, category filter,
  navigation-tips) and `TeleportMenu.tsx` (close, remove-room) gained an
  `aria-label`, plus `aria-pressed` on the two display toggles — `title`
  alone is invisible on touch and unreliable for screen readers. The
  connection-status dot got `role="img"` + a matching label.

## 2.4.54

### Fix: long-press to re-anchor a room blocked ALL scrolling on the Rooms screen on mobile
- 2.4.53 fixed the long-press being cancelled as a scroll gesture by setting
  `touch-action: none` on the Rooms cards. On a phone, the cards fill nearly
  the whole screen, so that left no gap to grab and scroll the list from —
  the Rooms screen became unscrollable on mobile.
- Cards are back to `touch-action: manipulation` (scrolling works normally).
  Instead, a real (non-passive) `touchmove` listener on the grid now only
  swallows movement while a finger stays within ~10px of where it first
  touched down — enough to survive ordinary hold jitter — and releases
  control back to native scrolling the moment it moves further, so a genuine
  scroll swipe still works exactly as before.

### Fix: renaming an entity_id showed no confirmation of the picked entity
- The Entity ID picker (pencil icon → search/select a new entity_id) passed
  a static placeholder ("New entity ID…") into the shared `EntityPicker`
  component. Its display logic was `placeholder ?? selectedName`, so once
  that static placeholder existed it always won — picking an entity from the
  dropdown updated the value correctly (the Confirm button un-disabled) but
  the input kept showing "New entity ID…", looking exactly like nothing had
  happened.
- The selected entity's name (or, for a not-yet-existing custom entity_id,
  the raw id itself) now always takes priority over a caller-supplied static
  placeholder once something is picked.

### Fix: default overview was zoomed in too far on mobile portrait screens
- The overview camera's default "fit the whole villa" framing used a flat
  radius multiplier with no awareness of screen aspect ratio. Babylon's
  default vertical-fixed FOV mode derives the *horizontal* field of view from
  the aspect ratio, so a portrait phone (narrower than tall) sees
  proportionally less width at the same distance than a landscape desktop
  window does — cropping most of a villa that's wider than it is deep.
- The default fit radius (and its zoom-out ceiling) now scales by the
  screen's aspect ratio when it's narrower than square, restoring the same
  visible width a square-ish viewport would give. Desktop (always ≥1 aspect)
  is completely unaffected.

### Fix: binary_sensor "more details" panel always showed leak wording
- Every `binary_sensor` — motion, door/window contact, smoke, occupancy,
  whatever — showed the same hard-coded "LEAK DETECTED" / "No leak" text and
  droplet icon in its details panel, regardless of what it actually
  monitors.
- The panel now reads HA's own `device_class` attribute (motion, moisture,
  door, smoke, occupancy, gas, safety, connectivity, etc.) and shows the
  correct wording and icon for that class. It also fixes the danger styling
  to match: a motion/door/occupancy sensor reporting "on" is informational,
  not a fault, so it's no longer auto-flagged red the way an actual leak or
  smoke alarm is. A per-entity override in Settings → Alert Thresholds still
  always wins over these defaults.

## 2.4.53

### Fix: "Staircase" point-room glow was still invisible after 2.4.52
- 2.4.52 added a synthetic glow patch for Rooms-menu viewpoints with no real
  sh3d polygon (e.g. a staircase landing), but drew every such patch at the
  same flat height used for ground-floor room polygons (y≈0). A staircase
  anchor is captured well above that — the patch ended up buried inside the
  stairs/slab below and never became visible, even though the sensor's Room
  glow was correctly turned on.
- `RoomHighlight.setPointRooms` now draws each patch at ITS OWN local floor
  height, derived the same way `CameraController.groundCamera()` does in
  reverse (floor Y = the anchor's stored camera Y minus eye height).

### Fix: long-press to re-anchor a room did nothing on the kiosk touchscreen
- The Rooms-menu cards used `touch-action: manipulation`, which still lets
  the browser treat finger movement on the card as the start of a scroll (the
  grid scrolls vertically). Ordinary touch jitter during the 480ms hold was
  enough to fire `pointercancel` and kill the long-press timer before it
  could complete — right-click on desktop was unaffected, so this only showed
  up on the touch kiosk. Cards now use `touch-action: none` so a press that
  starts on a card can't be stolen by a scroll gesture.

## 2.4.52

### Room-floor glow now also works for rooms with no drawn sh3d shape
- **Diagnosed why the motion-glow didn't work for a room like "Staircase":**
  the app has two different ideas of "room" — a real drawn shape from the
  sh3d plan (used for room labels + the floor glow), and a named viewpoint
  you add via the Rooms menu's "Add room here" (just a camera position, no
  area). A staircase landing is rarely drawn as an enclosed room, so setting
  a sensor's Room to "Staircase" had nothing to glow.
- RoomHighlight now also builds a small synthetic circular patch for any
  named Rooms-menu viewpoint that doesn't already have a real polygon — a
  real room always wins if both exist under the same name. Takes effect
  immediately when you add/rename a room, no model reload needed.

### Fix: adding a custom room could silently vanish on the next reload
- Found while fixing the above: the app was fully *replacing*
  `config.teleportPoints` with the freshly-recalibrated sh3d-derived rooms
  every time the model loaded or recalibrated (e.g. a mirror-flip toggle) —
  silently discarding any room you'd added yourself (like "Staircase") that
  has no sh3d counterpart to refresh from. Now merges: sh3d-derived rooms
  refresh to the new fit as before, anything else you added is preserved.

### Rooms menu: long-press now actually works, and re-anchoring gives feedback
- The tooltip promised "long-press a room to re-anchor it" but no long-press
  handler existed anywhere in the code — only the desktop right-click path
  was ever implemented, so touch/kiosk use couldn't reach this feature at
  all. Added a proper press-and-hold (480ms, matching the same threshold
  used for in-scene badge gestures).
- Re-anchoring (either right-click or long-press) was also completely
  silent — it saved your new position with zero visual confirmation, so a
  successful re-anchor was indistinguishable from nothing happening. Now
  shows a brief checkmark on the card and a one-line confirmation.

## 2.4.51

### Fix: Motion sensor picker didn't show the selected entity
- Selecting a motion sensor for a camera (Config Editor) silently "didn't
  register" — the value was actually being saved correctly, but the picker's
  built-in "show what's selected" display was accidentally disabled by a
  custom placeholder string I'd set, which always won over it. Removed the
  override; the picker now shows the linked sensor's name once selected,
  same as every other entity picker in the app.

### Removed: the "Confirm" column and its confirmation-dialog gate
- Long-press already opens the full control panel for any device — a
  deliberate, harder-to-trigger action that made the separate "Confirm
  before toggling" flag (and its yes/no dialog) redundant. Removed
  entirely: `EntityMapping.requiresConfirmation`, the Config Editor/Bound
  3D objects "Confirm" checkbox, the tap-time confirmation dialog on
  Dashboard, and the switch panel's own confirm step. A tap on a
  light/switch/fan now always toggles instantly, as it already did for
  most devices; long-press is the deliberate path for everything else.
  (Locks are unaffected — their unlock confirmation was always independent
  of this flag.)

## 2.4.50

### New: simulated motion detection — camera beams + room glow
- **Cameras get a simulated red detection beam.** Rotate a camera prop in
  SweetHome 3D to actually aim it (the `angle` field — previously never read
  by this app), link it to its HA motion/occupancy `binary_sensor` in the
  Config Editor's new "Motion sensor" column, and the beam pulses on for as
  long as that sensor reads "on". It's a translucent, unlit cone (no real
  light/shadows — an alert indicator, not a physical simulation), clipped to
  stop at the nearest wall so it doesn't shine through the villa forever.
- **Physical motion/presence sensors glow their room's floor instead.** A
  camera has a lens direction; a PIR sensor doesn't, so a directional beam
  would fabricate precision that isn't there. Any `binary_sensor` whose
  "Room" field (Config Editor) matches a calibrated room now pulses that
  room's floor translucent red while it's triggered. A sensor already linked
  to a camera drives only the beam — not both.
- Both are driven entirely by entities you already configure — no separate
  "motion sensor" registry, just one new field (`motionEntityId`) on the
  camera's existing entity settings.
- Not visually verified against the real villa (no GLB / live motion sensor
  in this environment) — the SweetHome `angle` → beam-direction convention
  (which way is 0°, clockwise vs counter-clockwise) is a best-effort first
  pass; if a live test shows the beam pointing the wrong way, that's a
  one-line fix (`planAngleToDir` in SceneManager.ts).

## 2.4.49

### New: glow around lit/active devices, and a much darker (but not black) night
- **Lit fixtures read as glowing, not just brighter.** Added a GlowLayer to the
  render pipeline — a soft bloom around anything emissive: lit fixtures,
  active lock/switch tints, triggered sensor pulses. Previously a light turning
  on only changed a flat colour on its (often small) fixture mesh, easy to
  miss from a distance. Toggle + strength slider in Settings → Render quality.
  Note: SweetHome 3D's own furniture "power" field was never read by this
  app — light brightness has always come entirely from the live HA
  `brightness` attribute, so this had to be a rendering change, not a model
  edit.
- **Night is now noticeably darker, so lit rooms stand out.** The interior
  fill light barely dimmed after dark before (70% of daytime), which made
  every room stay almost as bright at night as during the day — a lamp
  turning on barely registered against that wash. Night now dims
  significantly further (fill light, ambient and IBL), while keeping the
  same warm tint that already fixed the old "dead grey walls at night" look
  — so it reads as a dim, cosy night, not pitch black or washed out. New
  "Night dimming" slider in Settings → Render quality controls how strong
  the effect is.

## 2.4.48

### New: category filter for the map's device tags
- **Left HUD column has a new icon row below Overview/Rooms**: six toggles —
  Comfort, Light, Network, Energy, Access Control, Others — each hides or
  shows that category's state tags on the map. Icon + tooltip only, no text,
  matching the rest of the HUD.
- **Config Editor has a new "Category" column** (both the auto-detected
  entities table and each bound object's settings row) so you can move any
  device into whichever category makes sense for your villa.
- **Default category by device type** (light→Light, camera→Network,
  climate/cover/fan→Comfort, sensor→Energy, everything else→Others) lives in
  `config/EntityCategories.ts` — a dedicated, plain-data file: edit the
  type→category table there, or add a specific entity_id under
  `CATEGORY_EXCEPTIONS` to override just that device, no other code changes
  needed. Re-applied on every model/entity refresh; once you set a category
  in the Config Editor for a given device, your choice always wins over the
  default.
- Applies to every device however it's registered — auto-detected by mesh
  name, tap-bound, or dropped as a floating marker — since they all share
  the same underlying entity metadata.

## 2.4.47

### State labels: fix the value pill's font
- **The little "42%" / "21°" pill under each badge was rendering in the GUI
  layer's default font (Arial), not the app's own Inter typeface** — a
  mismatch that made it look uneven and out of place next to every other
  label in the UI. It also used `font-style: bold` to fake a weight Inter
  doesn't actually ship (only 200/400/500/600 are loaded), which browsers
  render as a synthetic, chunkier bold. Now uses Inter at a real weight
  (600) and a slightly smaller, tighter size, matching the rest of the app.

## 2.4.46

### State labels: anchor each tag to its own asset's real height, not a fixed pixel offset
- **With every tag now visible (2.4.45), many floated noticeably above the
  object they belonged to** — worst on tall or elevated assets, where a flat
  56px screen-space offset from the object's centre either barely cleared it
  or, at some camera distances, stacked a whole cluster of tags well above
  the roofline. Each mesh-bound entity now gets an anchor computed from its
  own real geometry (all its meshes merged into one bounding box, so a
  multi-part fixture is treated as a whole), sitting right at that asset's
  actual top edge plus a small clearance margin — so the tag height follows
  the asset's own elevation and size instead of a single constant that
  couldn't fit every object in the villa.

## 2.4.45

### State labels: removed the overlap declutter entirely — every tag now always shows
- **Devices were still missing tags no matter how you zoomed or panned.** The
  screen-space "declutter" pass hid any badge that clashed on screen with a
  higher-priority one (alert/on beats off), and in a villa with several
  devices a few screen-pixels apart, that reliably reduced a room down to
  about one visible tag regardless of camera angle. Removed it: with "Show
  device state labels" on, EVERY registered device now gets a tag, all the
  time — no hiding, no priority contest. The only thing still culled is a
  badge whose device projects directly behind the camera (a genuinely
  invalid screen position, not clutter).
- If a device still shows no tag at all after this, it means that entity
  isn't bound to anything in the 3D scene yet (no mesh named with its
  entity_id, no tap-to-bind, no dropped marker) — check Settings → Bindings /
  Markers for that entity.

## 2.4.44

### State labels: devices placed as control markers had no tag at all
- **Most non-light devices never showed a state label, no matter how much
  space was on screen.** The tag overlay only ever built badges for entities
  tied to a real mesh in the 3D model; devices placed as floating control
  markers (the normal path for switches, sensors, thermostats, locks — anything
  without its own modelled geometry) got their small glowing orb but no tag.
  Markers now feed the same badge pipeline as mesh-bound entities, so they get
  a proper icon + state-coloured tag too.
- **Tags were appearing/disappearing while panning the bird's-eye view.** The
  default whole-villa overview rendered every badge at full configured size —
  the single most crowded view — so the overlap-avoiding declutter had to hide
  most of them down to about one per room. Badges now start smaller on the
  default overview and grow as you zoom into a room; the base icon size was
  also turned down a notch (Settings → Icon size still overrides it).

## 2.4.43

### State labels: fix missing badges and remaining overlaps
- **Some devices showed no state label at all, and badges could still overlap
  at certain camera angles.** The declutter test compared badges using a
  circular radius derived from screen height, which didn't match the actual
  (taller-than-wide) badge + value-chip shape — it over-hid some widely
  spaced badges while under-hiding others. Replaced with a proper
  axis-aligned bounding-box test sized from the real rendered geometry, so
  more devices show a label and overlapping badges are reliably prevented.

### Left-side controls: icons only
- The Overview/Rooms block under the 1F/2F switch no longer shows text
  labels on desktop — icon-only, matching the rest of the HUD.

### Light theme: fix the black overview backdrop and villa-name legibility
- Switching to Light theme left the bird's-eye backdrop pitch black — it was
  hardcoded, not theme-aware. It now matches the active theme (and updates
  live if you flip the theme while already in overview).
- The villa name is now its own legible chip (like every other HUD control)
  instead of relying on a fading gradient, so it reads clearly on any
  backdrop; the clock moved inside it.

### Settings: cleaner utility layout + brightness control
- Config Editor / Inspector / Export / Import are now a tidy 2×2 tile grid
  under "Advanced" instead of two ragged button rows.
- Added a **Brightness** slider (Settings → Render quality & look) and
  raised the default exposure across all quality presets — the scene was
  reading a bit dark.

## 2.4.42

### Modern bright theme + Light / Dark / Auto selector
- **Reworked the whole look away from the brown/gold palette to a clean,
  modern sky-blue theme.** Every surface, hairline, scrim and accent is now a
  semantic CSS variable, so the entire UI restyles by swapping one block.
- **New theme selector in Settings → Appearance:** Light, Dark or Auto. Auto
  follows the device's system light/dark preference (`prefers-color-scheme`).
  The choice applies instantly and persists.

### Robust, modern state-label badges
- **Rebuilt the in-scene state labels.** Emoji glyphs are now pre-rendered to a
  pixel-centered canvas bitmap (`textBaseline="middle"`) and shown via a GUI
  `Image`, so icons sit dead-centre in their badge on every platform —
  replacing the fragile per-font baseline nudge.
- **Cleaner badge design:** a subtle dark disc with a state-coloured ring and
  glow (sky = on, slate = off, rose = alert, faded = unavailable) plus an
  adaptive value chip below.
- **Professional overlap handling:** labels now declutter in screen space —
  when the camera angle stacks badges, the highest-priority one
  (alert > on > off > unavailable) stays and the clashing lower-priority ones
  hide, revealing again as you zoom in. Nothing is permanently lost.

### Long-press a state label to open the full control panel
- Badges now distinguish a tap (quick toggle / open) from a long-press
  (480 ms → full detail panel from the bottom), matching the 3D-object gesture.

### HUD layout restructure
- **Time** now sits directly right of the villa name + connection dot.
- **Settings** moved to the far right of the top bar, right of the All Clear
  badge; the top-bar **Config Editor** button was removed and now lives inside
  **Settings**.
- **Overview** and **Rooms** are now a single vertically-stacked block on the
  left, directly under the 1F / 2F floor switch.
- Tablet/desktop spacing polished; the phone layout keeps icon-only controls.

### Settings: model details as an (i) tooltip
- Replaced the large green "Central model active" text block with a compact
  status line plus an **(i)** button that reveals the full model details
  (path, size, mesh count, SHA-256, source, SH3D) on hover/focus.

### Fixes
- After uploading a new GLB from the Settings UI, the app again lands in the
  bird's-eye **overview** — matching a fresh add-on launch — instead of the
  first-person view.

## 2.4.41

### Fix "Failed to load the 3D model — HTTP 403" after uploading from the UI
- **Root cause: uploaded model files were written 0600 (root-only), so nginx
  could not read them.** The Settings upload streamed the GLB/SH3D into a
  `tempfile.mkstemp()` temp file — created mode `0600` and owned by the proxy
  (root) — then atomically `os.replace()`'d it over the destination. The live
  model file inherited `0600`; nginx's unprivileged worker got permission-denied
  opening it and returned **HTTP 403 Forbidden**. Files copied in manually over
  Samba/SSH land as `0644`, which is why only UI uploads were affected.
- **Fix:** the upload handler now `chmod`s the temp file to `0644` (world-readable)
  before the atomic replace, so an uploaded model is served exactly like a
  hand-copied one.

## 2.4.40

### Center the emoji glyphs inside the state-label badges
- **Icons sat high in their circular badge.** Emoji render high on the font
  baseline, so the glyph's visual mass was above the badge centre. The glyph
  `TextBlock` now forces horizontal + vertical centre alignment, disables
  `resizeToFit` so its box fills the badge, and applies a small `+2px`
  optical-centre nudge. The nudge lives inside the scaled container, so it stays
  correct as the icon-size slider and bird's-eye zoom scale the badges.

## 2.4.39

### Upload central models from the app; sizable, zoom-reactive icon badges
- **Upload the GLB / SH3D directly from Settings.** New "Upload central GLB" and
  "Upload central SH3D" buttons stream the file straight into the HA `www` folder
  (atomic overwrite — each upload cleanly replaces the previous file), removing
  the need to copy models in over SSH or Samba. The config mount was switched to
  read-write to allow this.
- **One control for icon size + zoom-reactive scaling.** A single "Icon size"
  slider in Settings scales all state-label badges, and the badges now grow and
  shrink as you zoom the bird's-eye view.

## 2.4.38

### Dark overview backdrop, toggle flicker fix, visible clock, state-label icons
- **Dark integrated backdrop for the bird's-eye overview.** The bright/white
  background was harsh at night; the overview now uses a dark, integrated backdrop
  while first-person keeps the real sky.
- **No more full-scene refresh when flipping label/highlight toggles.** Toggling
  "Show device state labels" or "Highlight clickable objects" re-applied render
  effects and re-indexed meshes on every change, causing a visible flicker/reload.
  Config changes are now reference-equality gated so only the affected subsystem
  updates.
- **Clearer top-right clock** restyled as a legible pill.
- **State-aware icon badges.** Device state labels are now contextual, per-category
  icons (bulb for lights, fan, lock, etc.) with distinct looks for
  unreachable / on / off and state-aware values for non-binary entities.

## 2.4.37

### Default to overview, tap-to-toggle, simpler render, polished night look
- **Opens in the bird's-eye overview by default.**
- **Tap toggles on/off entities directly; long-press opens the full panel.** Fixes
  the per-entity "Confirm" flag being ignored (pick callbacks were captured once at
  mount and went stale); pick callbacks now route through live refs.
- **Simplified render pipeline and polished night lighting.**

## 2.4.36

### Fix: light fixtures whose entity_id contains "ceiling" were invisible
- **Root cause: the dollhouse ceiling-hider matched HA entity meshes by name.**
  `applyStructure` hides architectural ceiling/roof meshes via
  `/ceiling|plafond|toiture|toit/i` on the mesh name. The villa's light fixtures
  are named with their HA entity_id, and several legitimately contain the word
  "ceiling" — `light.bedroom_1_…_ceiling_b1`,
  `light.living_room_ceiling_led_…_dining_table_led`/`…_sofa_led`,
  `light.living_room_main_ceiling_…`. Those meshes were set `isVisible = false`,
  while a sibling like `light.…_wallswicth_center` (no "ceiling" in its id) stayed
  visible — which is why one cluster of 12 ceiling spots showed and the others,
  defined identically in SweetHome, did not. It was never an emissive, binding, or
  geometry problem; the meshes were simply hidden.
- **Fix: the structural pass now skips any mesh named by the HA convention.** Any
  mesh whose name resolves to a known entity domain (`inferTypeFromEntityId`) is
  an entity fixture owned by `EntityVisuals` and is excluded from structural
  hide/collision/opacity — so a fixture can carry an architectural word in its
  entity_id without being mistaken for the building. Non-hardcoded; honors the
  "only act on objects named by the HA convention" rule.
- **Also raised the unwired-marker baseline glow** (`EntityVisuals`
  `LIGHT_BASELINE_GLOW = 0.5`, applied to every light mesh) and the
  `blender_pipeline` v1.7.1 baked emission (`0.55`) / marker size (≥5 cm), so the
  now-visible placeholder fixtures read clearly before they're wired to HA.

## 2.4.35

### Turning off "Live weather effects" now clears them immediately
- **Unchecking the Settings toggle removes active rain at once.** Weather was only
  (re)evaluated when an HA `weather.*` entity changed state, so flipping the
  `weatherEffects` setting off fired no event and the particles kept running.
  `WeatherEffects` now has an explicit master switch (`setEnabled`) driven by a
  config-keyed effect: off clears particles instantly; on re-applies the last
  known weather. Also removes a stale-closure read of `config.weatherEffects` in
  the live-state handler (weather states are now forwarded unconditionally and
  gated inside `WeatherEffects`).

## 2.4.34

### Fix "403: Forbidden" when launching the installed PWA
- **`start_url` now targets `./index.html` instead of the bare directory `./`.**
  The installed PWA launched at `start_url`, which resolved to the directory
  `…/local/villa-kiosk/`; Home Assistant's static file server returns plain
  `403: Forbidden` for a directory request (it does not auto-serve index.html),
  so the app window opened to a 403. Browser tabs were unaffected because they
  always loaded `…/index.html` explicitly.
- **Service worker shell no longer precaches `./`.** The same directory entry in
  `cache.addAll(SHELL)` hit the 403 and could reject the install; the shell now
  precaches `./index.html` + `./manifest.json` only. Cache bumped `v4 → v5` to
  force a clean re-precache on next load.

## 2.4.33

### Restore PWA manifest screenshots (richer install dialog)
- **Re-added the `screenshots` block to the manifest.** 2.4.32 dropped it on the
  belief that `public/screenshots/` was empty, but the branded `wide.png`
  (1280×720) and `narrow.png` (720×1280) promo images are present and correctly
  sized. With them referenced, Chrome shows the *richer* install UI on desktop and
  mobile and the "add at least one screenshot" warnings clear. Screenshots are not
  required for installability — the actual blocker fixed alongside this was the
  `icons/` folder being absent from the deployed `/config/www/villa-kiosk/`.

## 2.4.32

### PWA install link restored behind an authenticated reverse proxy
- **"Install app" now appears when served behind an HTTP Basic Auth gate.** When
  the standalone app is published through an NGINX Proxy Manager Access List, the
  browser fetched the web manifest (and its icons) *without* credentials, got a
  `401`, and silently treated the app as non-installable — so no install link
  showed. The manifest `<link>` now carries `crossorigin="use-credentials"`, which
  sends the cached Basic Auth so the manifest loads and the PWA becomes installable.
- **Removed broken manifest screenshot references.** The manifest pointed at
  `screenshots/wide.png` / `narrow.png`, which never shipped (the directory is
  empty); the dangling references are dropped. Screenshots only enrich the desktop
  install dialog and are not required for installability.

## 2.4.31

### Tap-to-act confirmation, curtain & cover fixes, light-bleed isolation
- **"Confirm" now gates the action, not just one panel.** Tapping a simple on/off
  entity (on/off-only light, switch, input_boolean) toggles it instantly in-world
  with no panel; with the entity's *Confirm* flag set (Config Editor), a small
  yes/no dialog gates that toggle first. Entities with richer controls (dimmable
  lights, AC, covers, fans, media, cameras, sensors) still open their panel. Fixes
  the flag being read by the Switch panel only.
- **Curtains no longer fly into the sky when open.** The retract re-pin mixed the
  mesh's *local* geometry height with its *parent-space* position, so panels whose
  cm→m scale lived on an ancestor node were launched ~200 m up at high open-%. The
  top edge is now re-pinned entirely in **world space**, immune to where the scale
  lives or where the local origin sits.
- **Cover position slider no longer drops the second adjustment.** A live HA state
  event arriving mid-drag re-synced the slider and sent the stale value; the live
  sync is now suspended while dragging and resumes on release.
- **Lights no longer highlight furniture in other rooms.** Each bound entity mesh
  gets its own material clone, so the shared (de-duplicated) wood material of a
  wall-switch fixture and the living-room chairs can't be recoloured together.

## 2.4.30

### Manual deployment, cleaner dev tooling
- **Deployment is now a documented manual copy.** Dropped the SSH/scp deploy
  automation entirely (HA has no SSH server by default, and the script added
  little over a plain file copy). `README.md` now documents copying the **contents
  of `dist/`** into `config/www/villa-kiosk/` via Samba / File editor / Studio Code
  Server, served by HA at `/local/villa-kiosk/`. Removed the `VITE_DEPLOY_*` env
  vars and their type declarations.
- **Always-clean dev/prod.** `dev`, `build` and `preview` now auto-run
  `npm run clean` first (removes `dist/`, `node_modules/.vite`, `tsconfig.tsbuildinfo`),
  so every run starts from a clean slate with no stale artifacts.
- **Dev HTTPS cert mode is logged.** `npm run dev` prints whether it's using a
  trusted cert from `./certs/` (PWA install works) or the self-signed `basic-ssl`
  fallback (Chrome blocks the service worker / install button) — making a missing
  install button easy to diagnose.

## 2.4.29

### Cleaner sky horizon, quieter console, tighter grass
- **Sky.** The horizon read as an ugly grey haze band — that was the procedural
  `SkyMaterial` running at high turbidity (thick, milky atmosphere). Dropped
  turbidity 8 → 2 (plus gentler Rayleigh/Mie) for a crisp blue zenith that fades to
  a soft light-blue horizon. Night now drops luminance harder (0.35 → 0.18) with a
  touch more haze so it reads as a deep night sky instead of a glowing dome.
- **Console.** Startup diagnostics (glass-material list, pane candidates, grass
  painting, calibration) are now silent by default — even in `npm run dev`. Opt in
  per session with `?debug` in the URL or `localStorage.setItem("villa:debug","1")`.
  The bind-mode tap-to-identify log still prints on demand (it's the feature).
- **Grass.** The detector also painted a window's silver reflector pane (a large
  flat grey slab). It now keeps only the largest-area grey slab — the terrain that
  underlies the whole model — and drops smaller grey panes.

## 2.4.28

### Fix CI build + grass only the exterior terrain
- **CI build fixed.** `@vitejs/plugin-basic-ssl` was pinned to `^2.3.0`, which
  peer-requires Vite 6/7/8; this project is on Vite 5, so the Docker `npm install`
  hard-failed (`Conflicting peer dependency: vite@8 … peer vite@^6||^7||^8`).
  Downgraded to `^1.2.0` (supports Vite 3–6) — installs cleanly again.
- **Grass no longer overreaches.** The terrain auto-detection painted the indoor
  floors and furniture too (it matched any large flat slab, and the fused-by-
  material export means repainting one material repaints everything sharing it).
  It now repaints **only a slab whose material is actually grey** (low-saturation,
  mid/dark — so cream indoor tile and coloured furniture are rejected) and which
  spans nearly the whole model footprint. Indoor floors and furniture are untouched.
- New optional config knobs: `grassGround` (set `false` to disable entirely) and
  `grassGroundHints` — explicit material/mesh substrings to grass when auto-detect
  can't isolate the terrain (tap the grey ground to read its material name).
- Dev HTTPS now prefers a **trusted cert** in `./certs/` (`key.pem` + `cert.pem`,
  e.g. from mkcert) and only falls back to the self-signed `basic-ssl`. Chrome
  refuses to register a service worker over a self-signed cert, so a trusted cert
  is required for the install button / PWA testing in dev.

## 2.4.27

### Tap a surface to read its material
- In bind mode (Settings → tap an object to bind), tapping any surface now also
  logs its **material name** to the console. For a stubborn grey window pane that
  auto-detection missed, this is the exact name to drop into `extraGlassHints`
  (2.4.25) — no guessing from the size list.

## 2.4.26

### Draco decoder bundled (enables compressed models)
- The app now **bundles Babylon's Draco decoder** (from `@babylonjs/core`, no new
  dependency, ~192 KB wasm) and points Babylon at it instead of the default CDN —
  so a Draco-**compressed** GLB loads fully offline under HA Ingress. The decoder
  is fetched lazily, only when a model actually uses Draco, so an uncompressed GLB
  pays nothing.
- Pair this with the pipeline (`blender_pipeline.py` v1.6.0, in `sources/`), which
  now exports with Draco enabled at visually-lossless quantization. Result: the GLB
  geometry shrinks ~5–10×, cutting both download and parse time, with **no visible
  change** to the model. Rebuild the GLB to benefit.

## 2.4.25

### Grass instead of a grey plinth
- The villa sat on a flat **grey slab** outside the grass. That slab is SweetHome
  3D's bare terrain (the ground outside the grass room) — not something Blender
  adds. The big flat base is now detected and painted with a procedurally drawn
  **grass texture** (canvas-generated, no asset, offline-safe), so the garden
  reaches the edge of the model. Conservative detection (flat + at the base +
  spanning most of the model + not already green) leaves indoor floors and the
  existing grass untouched. Logs `[GroundGrass] painted grass on …`.

### Glass — name a stubborn pane yourself
- Added **`extraGlassHints`** to the config: a list of substrings merged into the
  glass-detection keywords. A custom imported window (like `window_3x1`) whose
  glass material has no obvious keyword can now be made see-through by adding its
  material name here — no code change. Find the exact name in the
  `[ModelLoader] pane-like meshes …` console log (match by size), add it, reload.

## 2.4.24

### Faster load
- **Off lights no longer slow the load.** A fixture-dense villa builds dozens of
  point lights (each LED strip is modelled as many co-located lights). They were
  all left enabled at load even though nearly every light starts OFF — an enabled
  light, even at zero intensity, stays in every nearby material's shader and
  inflates the first-frame shader compilation. Off lights are now fully disabled
  (dropped from shaders) and only re-enabled when the entity turns on. Big win in
  BOTH add-on and standalone mode, since it's a scene-build cost, not a download.
- **No more shader-recompile storm.** Creating those lights one-by-one re-flagged
  every material's shader as dirty on each add. The build is now batched so shaders
  compile once at the end instead of O(lights × materials) times.
- **Gzip the central GLB (add-on).** nginx now compresses the GLB transfer
  (geometry buffers compress well), cutting download time on the remote/DuckDNS
  path. Embedded textures don't shrink, so a modest compression level keeps the HA
  host's CPU cost low.

### Glass
- **Pin down stubborn custom panes.** A pane-like geometry finder now logs any
  large, thin, flat slab that wasn't detected as glass (walls/floors excluded),
  with its exact material name — so a custom window like `window_3x1` whose material
  has no glass keyword can be identified precisely and added to the hint list,
  instead of guessing.

## 2.4.23

### Glass tuning
- **More glass-like opacity.** Detected panes were nearly invisible (felt like an
  empty hole). Opacity raised (alpha 0.22 → 0.38) and the pane is now smooth +
  non-metallic so it catches highlights and reads as real glass, while still
  clearly see-through.
- **Catch more custom windows.** Glass detection only saw stock SweetHome pieces
  (whose internal material is literally named like glass). Custom imported windows
  (e.g. `window_3x1`) use the model author's own material names, which rarely say
  "glass". Added more synonyms (`glazing`, `glaze`, `transparent`, `cristal`,
  `crystal`, `vetro`, `scheibe`, `fenster`, …), kept specific to avoid false hits.
  If a custom pane still isn't caught, its glass material name is in the
  `[ModelLoader] glass-transparency … | all materials:` console log — add that name
  to the hint list.

## 2.4.22

### See-through window/door glass
- Window and sliding-door glass exported from SweetHome 3D as an **opaque grey
  material**, so the panes read as flat grey panels and the new sky/outside never
  showed through them. Glass is now detected by material/mesh name (English **and**
  French naming — `glass`, `vitre`, `vitrage`, `fenetre`, `baie`, `verre`,
  `miroir`, …) and made properly transparent at load. Frames and handles use
  separate materials, so they stay solid. The full material list + which were
  treated as glass is logged to the browser console, so the heuristic can be tuned
  if a specific pane isn't caught.

### Confirm which GLB is actually loaded (no need to toggle a light)
- Settings → 3D model now shows a **fingerprint of the GLB currently in the scene**:
  size in MB, mesh count, full **SHA-256**, and the resolved fetch URL (including
  the `?v=` cache-busting tag). Compare it against the file on disk with
  `shasum -a 256 <file>.glb` / `ls -l` to prove the right model loaded — useful
  when replacing a same-named GLB where HTTP caching could otherwise mislead.

### Sun-driven sky through the windows
- The outside view is no longer a flat colour (grey-blue by day, near-black at
  night). A procedural atmospheric sky (`SkyDome` + Babylon `SkyMaterial`) is now
  driven by the *same* sun direction that lights the scene — so it tracks the
  villa's latitude/longitude and the time of day: real blue daytime sky, warm dusk,
  deep blue at night. Pinned to the camera (`infiniteDistance`) and never clipped
  by the far plane, so it shows correctly through every window. No texture assets
  needed (SweetHome's sky setting never exports to the GLB).

### Fix — lamp light still bled into the next room
- **Wall occlusion is now always on**, not hidden behind the Shadows quality
  toggle (which also drives the heavy sun shadows and was off by default). Each lit
  `light` entity casts **one** small (256px) cube shadow map so walls block it out
  of the box.
- **One shadow map per entity, not per marker.** Because a LED strip is modelled as
  ~12 co-located markers, shadowing every one would mean 12 cube maps for a single
  strip. We attach the shadow to the entity's representative fixture instead, so a
  whole strip costs a single shadow map.
- **Tighter light range (4 m → 2.8 m).** The un-shadowed sibling markers of a strip
  now stay inside their own room by range alone, so the room no longer leaks light
  through the wall into the bathroom/adjacent space.

> Note: showing **two** distinct bedside-lamp lights (and any other multi-instance
> fixture) requires the GLB to be rebuilt with `blender_pipeline.py` **v1.5.0** —
> the per-instance mesh split happens at model-build time. A single light at the
> midpoint of two lamps means the loaded GLB predates that fix.

## 2.4.21

### Fix — lamp light bled through walls + merged multi-lamp fixtures
- **Light no longer floods the next room.** Each `light` fixture's `PointLight`
  had an 8 m range and no occlusion, so it lit straight through walls. Range is
  now room-scale (4 m) with quadratic falloff (near-zero cost), and — when the
  **Shadows** quality toggle is on — each active lamp casts a cube shadow map
  against the villa shell so walls actually block the light. The shadow map is
  created lazily only while a light is on and freed when it turns off, so an off
  light costs nothing.
- **One light per lamp.** Light sources are now created per fixture *mesh* instead
  of per entity, so an entity whose fixture is several distinct meshes (e.g. the
  two bedside lamps, or multiple stair downlights, that share one HA entity) gets
  a real light at *each* lamp instead of one merged light at their midpoint. Takes
  full effect once the model is regenerated with separate meshes (see the Blender
  pipeline change); harmless with the current merged model.
- **LED-strip lights no longer blow out.** A single HA light is often modelled in
  SweetHome 3D as many co-located virtual markers (e.g. a LED strip drawn as 8–12
  point lights for a soft, diffuse spread). Since each marker is now its own
  `PointLight` and point lights are additive, an entity's per-fixture intensity is
  divided by the number of fixture meshes it owns, so the whole group reads as one
  fixture's worth of light instead of a solid white smear — regardless of how many
  markers model it. Single-mesh lights are unaffected.
- **Smoother lighting near dense strips.** GLB material light caps are raised from
  Babylon's default of 4 to 6 simultaneous lights, so a wall/floor within range of
  a multi-marker strip no longer "pops" between light sets as the camera moves.

## 2.4.20

### Fix — kiosk view freezes ("can see the villa but can't move/navigate")
- A long-running wall tablet / WebView can lose its WebGL context (GPU reset,
  memory pressure, or the app being backgrounded). Babylon restores the context,
  but the render loop is on-demand, so after a restore nothing asked it to repaint
  — the last frame stayed frozen on screen and every touch looked ignored, in
  BOTH first-person and overview modes. Now we force a repaint when the context is
  restored and whenever the page becomes visible again, so the view always thaws
  and input responds. (Verified no navigation/input code changed between 2.4.16,
  which navigated fine, and here — only lighting — so this frozen-context path was
  the remaining explanation for a dead-input kiosk.)

## 2.4.19

### Fix — residual cool tint at night
- Following the 2.4.18 warm night key, the always-on hemisphere fill still used a
  slightly blue ground bounce (`0.55, 0.55, 0.6`), which tinted undersides cyan
  now that the rest of the night light is warm. Neutralised it (`0.55, 0.54,
  0.52`) so white reads white at night. (Note: the optional "Environment lighting
  / IBL" toggle in Settings → Render quality is off by default; if you enabled it,
  its procedural sky is blue and will add a cool cast — turn it off or lower its
  intensity there.)

## 2.4.18

### Fix — interiors went blue at night ("blue kitchen")
- Night lighting used a cold blue key light (`0.25, 0.3, 0.5`) and blue ambient,
  which cast a strong cyan tint on white/light surfaces (kitchen cabinets, dining
  tables, benches) when indoor lights were off. Confirmed via an A/B against the
  2.4.15 code: identical at night, so it was the lighting, not a regression — the
  same blue surfaces read white during the day under the warm sun. Night now uses
  the warm, near-neutral indoor glow the code always intended: a low warm key
  (`0.85, 0.78, 0.66`) lifted slightly for legibility plus warm-neutral ambient,
  so white reads white at night. The sky stays dark, so it still reads as night.

### Re-applied 2.4.16 (rolled forward from the 2.4.15 A/B test)
- Central-GLB service-worker caching + download-progress %, square-checkbox CSS,
  and the Config Editor "Confirm" label alignment — temporarily backed out in
  2.4.17 for the night-lighting comparison — are restored.

## 2.4.17

### Roll back to 2.4.15 behaviour (forward-versioned re-revert of 2.4.16)
- HA Supervisor only updates forward, so a true downgrade to 2.4.15 can't be
  offered to an instance already on 2.4.16. This release carries the **exact
  2.4.15 codebase** under a higher version number so production can move onto it
  via the normal Update button — to A/B confirm the night-time blue-ish kitchen
  tint (which is the existing `SunController` night lighting, not a 2.4.16
  regression).
- Temporarily backs out the 2.4.16 changes (central-GLB service-worker caching +
  download-progress %, square-checkbox CSS, Config Editor "Confirm" label
  alignment). These will be re-applied once the comparison is done.

## 2.4.15

### Fix — Bird's-eye pan didn't track the finger (felt "disconnected" sideways)
- The overview pan converted finger movement to world movement with a single
  flat per-pixel constant on both axes. Because the overview camera is tilted,
  the screen-to-ground scale differs horizontally vs vertically, so the ground
  slid less than the finger on one axis (most noticeably you had to drag wider
  horizontally than the view moved). Panning now unprojects the finger onto the
  ground plane and keeps the grabbed point pinned under the finger — true 1:1
  tracking on both axes at any tilt/zoom. The Natural Scrolling toggle simply
  flips the direction and applies live on Save.

### Faster camera takeover + a fullscreen control
- The MJPEG stream watchdog now falls back to the snapshot poll after 1s (was a
  few seconds), so the feed appears almost immediately for cameras that don't
  serve MJPEG.
- Added a fullscreen button to the camera view. Note: the feed is a live image
  (MJPEG/snapshot), not a `<video>`, so there's no native play/pause/scrub bar —
  those aren't meaningful for a live camera; fullscreen is the useful control.

## 2.4.14

### Fix — Camera feed showed nothing on open
- The camera takeover started with HA's MJPEG stream (`camera_proxy_stream`) and
  only fell back to the still-image poll on the `<img>`'s `onError`. But cameras
  that don't actually serve MJPEG (most RTSP/ONVIF/HLS) leave that request open
  without ever sending a frame, so the image fired *neither* load nor error — the
  view sat blank forever and never reached the working snapshot fallback. Added a
  watchdog: if the stream paints no frame within a few seconds it now drops to
  snapshot polling (which works for any camera that works in HA), so a frame
  always appears. Snapshot refresh is also a bit quicker (800 ms) for liveness.

## 2.4.13

### Fix — Slow first paint on mobile
- The "Loading the villa…" overlay stayed up far too long on phones because the
  optional SH3D refresh (the full SweetHome project, tens of MB — downloaded,
  unzipped and XML-parsed only for room metadata) ran *inline* before the scene
  was marked ready. The villa is now interactive the moment the GLB loads; the
  SH3D room-name/calibration refresh happens in the background and updates the
  labels when it arrives, so first paint no longer waits on it.

### Fix — Mobile dropdown menu layout
- Opening the Display / Build / Config dropdowns on a phone produced two glitches:
  the floating 1F/2F floor selector painted *over* the open menu, and the
  left-most menus extended off the left screen edge, clipping their labels. The
  top bar now sits above the floor selector's stacking context so menus paint
  over it, and on mobile each dropdown is pinned to a fixed on-screen spot under
  the bar (width-constrained to the viewport) so nothing is clipped or overlapped.

## 2.4.12

### Fix — "No 3D model loaded" despite a configured `model_path` (add-on)
- Behind Ingress the app is served under `/api/hassio_ingress/<token>/`, but the
  frontend fetched `/addon-config` and `/model/<path>` as **absolute** paths.
  Those resolved to the Home Assistant origin root instead of the add-on, so
  (especially via an external DuckDNS / Nabu Casa URL) they never reached the
  add-on's nginx — the central model + room names silently failed to load and
  the kiosk showed "No 3D model loaded yet" even with the files present in
  `/config/www/`. These requests are now resolved relative to the Ingress base.

### Fix — "Camera stream unavailable" for cameras that work in HA
- The camera takeover only tried HA's MJPEG endpoint (`camera_proxy_stream`),
  which many cameras (RTSP/ONVIF/HLS) don't implement even though they play fine
  in Home Assistant — so the view errored out permanently. It now falls back to
  polling the still-image endpoint (`camera_proxy`), which works for essentially
  any camera, and only reports "unavailable" if both fail.

## 2.4.11

### New — Render quality & look (Settings → *Render quality*)
- A configurable, live-tunable render stack to fix the washed-out / flat,
  low-contrast render. Every effect is independent, applies live, and persists
  with your config: **tone mapping** (Khronos PBR Neutral default / ACES /
  Standard / None) with exposure & contrast, **fill/key/ambient light balance**,
  **ambient occlusion** (SSAO), **sun shadows**, and **environment lighting**
  (procedural sky/ground IBL — no shipped asset). The same knobs are exposed as
  Blender pipeline flags so the look can be baked into the GLB.

### Fix — disabling Ambient occlusion made the model vanish for good
- Unchecking ambient occlusion disposed the SSAO pipeline but left it registered
  in the post-process manager, which then dereferenced null post-processes every
  frame — throwing inside the render loop and killing it, so the model
  disappeared and re-enabling couldn't recover. AO now toggles by detaching the
  cameras (the pipeline stays alive), and teardown stops the render loop first.

### Settings UX
- AO defaults tuned to minimum strength / maximum radius (subtle by default).
- Removed the global **Reset** button; **Cancel** (and tapping outside the modal)
  now reverts every live-applied change — render preview, eye height, walk speed
  and the immediate toggles — back to how it was when you opened Settings.

### New — installable PWA (standalone / non-Ingress)
- Maskable Android icons + iOS apple-touch icon, a rewritten web manifest
  (`standalone` display, proper icon purposes, app screenshots) and the matching
  `index.html` meta, so the app installs to the home screen on Desktop, Android
  and iOS. (Requires serving over a secure origin / HTTPS to get the prompt.)

### Fix — onboarding & no-model startup
- In the add-on, onboarding no longer blocks on a per-browser upload when a
  central `model_path` is configured — it confirms the central model instead.
- A missing model now shows a clear overlay (add-on instructions, or a one-tap
  uploader in standalone) instead of a blank blue page that silently opened
  Settings. Stale model metadata is reconciled so the app can't claim a model
  that no longer exists.
- Plain modals (onboarding, bind, marker) get proper desktop padding.

## 2.4.10

### Fix — stale UI on the PWA / standalone deployment
- The service worker cached the HTML shell *cache-first*, so a non-Ingress
  install (the `/local/` or installable-PWA path) could keep booting an old
  shell — and therefore old asset hashes — after an update, the same failure
  the nginx `no-cache` header fixes for the add-on. The shell is now fetched
  *network-first* (cache only as an offline fallback); hashed assets stay
  cache-first. (The add-on itself disables the SW, so it was already safe.)

### Hardening
- nginx now sends `X-Content-Type-Options: nosniff`, `Referrer-Policy` and
  `X-Frame-Options` (defense-in-depth behind HA Ingress).
- WebSocket frame parsing and backup-ZIP config parsing are now guarded, so a
  malformed message or corrupt backup yields a clean error instead of crashing
  the handler.

### Internal — audit pass 2 (no behaviour change)
- Extracted the on/off button duplicated across the light, fan, switch and
  media panels into one `PowerToggle` component.
- Documented the supervisor-proxy's request-smuggling posture (aiohttp
  CVE-2025-53643 applies only to the pure-Python parser, which is not in use).

## 2.4.9

### Fix — tapping entities did nothing on phones
- On touch screens, tapping an entity (its label, its 3D mesh, or a control
  marker) opened the control panel and then *immediately* closed it, so it
  looked like nothing happened (worked fine with a mouse on desktop).
- Cause: a tap opens the panel via an async React update, so its full-screen
  backdrop mounts a beat later — right in time for the browser's synthesized
  "ghost" `click` (which touch emits after a tap, but a mouse does not) to land
  on that backdrop and dismiss the panel. We now swallow that one ghost click.

### Fix — stale UI after add-on update
- The kiosk shell (`index.html`) was served with no `Cache-Control`, so
  browsers and the Nabu Casa / DuckDNS edge applied heuristic caching and kept
  serving an OLD shell after an update. The shell pointed at old (immutable-
  cached) `/assets/index-*.js|css`, so the page loaded the previous build even
  though the new files were already on disk — the symptom was a device (e.g. a
  HA Yellow) still showing the old UI while reporting the new version.
- nginx now sends `Cache-Control: no-cache` on the shell so it is revalidated
  on every load; the content-hashed assets it references stay immutable-cached.

### Internal — codebase audit (no behaviour change)
- Single source of truth for default entity metadata: tap-to-bind, marker drop,
  the Config Editor and the mesh resolver now all funnel through one
  `createDefaultMapping()` factory (was duplicated in four places).
- Extracted the tap-vs-drag gesture detection shared by both camera controllers
  into one `TapRecognizer` (was a copy-pasted state machine in each).
- Verbose 3D diagnostic logs are compiled out of production via a `devLog`
  helper; render-error stack traces are now dev-only.
- Removed dead code (unused camera-snapshot, GLB-string and cache-clear
  helpers) and a stale Docker version label; bumped dependency floors to their
  patched releases.

## 2.4.8

### Top / bottom bar layout overhaul (desktop + mobile)
- Top bar is now a clean three-zone layout: brand (left) · action icons
  (centred) · alerts + clock (right)
- Connection status is a single coloured dot (green / red) right beside the
  villa name — the redundant wifi icon is gone
- Floor switch moved out of the bar: it's now a **vertical** 1F / 2F toggle
  floating just below the brand icon (same on desktop and mobile)
- Clock pinned to the far right; the **All Clear** badge sits just to its left
  (its alert list now drops down from the top bar). On phones All Clear becomes
  an icon-only badge and the clock is hidden (the phone shows the time)
- **Rooms** (grid) moved up from the bottom-right into the centred icon row,
  restyled to match the other buttons (paired with the view toggle)
- Bottom-right cluster removed — the bottom bar now only holds the joystick
  (first-person) or the navigation-tips control (overview)

### Bird's-eye navigation tips no longer clutter the view
- The tips card is hidden by default; an **(i)** button at the bottom-left
  reveals / dismisses it (desktop + mobile)

## 2.4.7

### Top bar reorganised into clear icon-only sections
- Action buttons are now grouped into labelled-by-context pills: View ·
  Display · Build · Config — so each category reads at a glance, no text needed
- `Highlight clickable objects` and `Show device state labels` are now direct
  toggles in the top bar (lit gold when on) instead of buried in Settings — and
  removed from the Settings modal
- On phones the Display / Build / Config sections collapse into three single
  dropdown buttons to save width:
  - Display → highlight clickable · show device state labels
  - Build → bind 3D object · drop control marker
  - Config → Config Editor · Settings
  (dropdowns close on outside tap / Escape; toggle items keep the menu open)

### Fix
- Config Editor Confirm checkbox now lines up exactly with the input fields
  above it on mobile cards (the default checkbox margin was nudging it right)

## 2.4.6

### UI / mobile fixes
- Settings checkboxes render as proper squares (box-sizing + aspect-ratio,
  so a flex parent can no longer distort them)
- Room name badge (shown when entering a room) is now centred, width-capped,
  and uses smaller display type on phones so longer names stay on one line
- Config Editor full-page header no longer wraps on mobile — Back button +
  title sit on one tidy line
- Config Editor entity cards reworked on mobile:
  - edit (pencil) + delete (trash) icons grouped and right-aligned in the
    Entity ID row, identical on every card
  - removed the stray bottom delete row and its large vertical gap

## 2.4.5

### Bug fixes
- Plain drag in overview mode now PANS instead of rotating. Root cause: panning
  via camera.setTarget() made Babylon recompute alpha/beta/radius from the stale
  position, spinning the view. The orbit target is now mutated in place (true pan).
  Same fix applied to room-grid teleport (panTo).

### Changes
- Trackpad gestures now work without clicking (like a touchscreen):
  - two-finger slide → pan · pinch → zoom (both via wheel events, no click)
  - mouse wheel still zooms (distinguished from trackpad slide by delta shape)
- Ctrl OR ⌘ (Command) + drag zooms, for macOS parity
- Overview HUD hint updated

## 2.4.4

### Changes
- Overview gestures simplified to an explicit, modifier-gated model:
  - Desktop: plain drag = pan · Shift+drag = rotate + tilt · Ctrl+drag = zoom
  - Mouse wheel / trackpad pinch still zooms (universal map idiom, kept)
  - Touch: 1-finger = pan · 2-finger pinch = zoom · twist = rotate · vertical = tilt
  - Modifier is read per move event, so it can be pressed/released mid-drag
- Overview HUD hint updated to describe the new controls

## 2.4.3

### Changes
- Settings model section now gates on Ingress (add-on) mode, not on whether a path
  happens to be set:
  - In add-on mode the upload / replace / clear buttons are gone entirely — the
    panel shows which files are in use (GLB + SH3D paths read from the add-on config)
  - If model_path is not set in add-on mode, a warning explains how to configure it
  - Standalone / dev deployments keep the full upload UI (unchanged)

## 2.4.2

### Changes
- Overview camera gestures rewritten — Google Earth style (trackpad + touchscreen):
  - Trackpad 2-finger slide → pan (was incorrectly zooming before)
  - Trackpad pinch (ctrlKey) → zoom
  - Shift + scroll → tilt (Y) + rotate heading (X)
  - Touch 1-finger → pan; 2-finger pinch → zoom; 2-finger twist → rotate; 2-finger vertical → tilt
- Add-on model is now exclusive: when model_path is set in the add-on config, the app
  ONLY loads from there (no IndexedDB fallback). Avoids confusion with stale per-browser uploads.
- Clear error message when the add-on model path is unreachable (instead of silent fallback)

## 2.4.1

### Changes
- Central model hosting: set model_path / sh3d_path in the add-on configuration
  page; all clients load the same GLB+SH3D automatically (no per-browser upload)
- nginx serves /model/ from HA www folder; supervisor-proxy exposes /addon-config
- Settings modal shows central model status with a green confirmation banner
- Per-client IndexedDB upload still works as fallback for dev / non-add-on use

## 2.4.0

### Changes
- Bird's-eye overview camera mode: toggle between first-person walk and top-down plan view
- Overview: pan (1 finger/drag), zoom (pinch/wheel), tilt & rotate (2-finger), tap entities to control
- Room grid teleport works in overview mode (pans the bird's-eye camera to the room)
- Entity ID remap in Config Editor: redirect a 3D mesh to a new HA entity without rebuilding the GLB
- Natural scrolling toggle in Settings (overview pan/zoom direction)

## 2.3.4

### Changes
- v4.0: Introducing God mode

---


## 2.3.3

### Changes
- mobile: responsive config table + reliable tap-to-open panel on touch + safe-area insets

---


## 2.3.2

### Changes
- fix floating labels + curtain retraction direction

---


## 2.3.1

### Bug fixes
- **Spawn position** — on first GLB import, the player could spawn near the outer window wall instead of inside the living room. The room calibration now re-runs after auto-detection enriches the entity map, and the player is re-teleported to the correct position.
- **Fan entity label** — the floating state label for fan entities was orbiting across the screen because it was linked to the spinning mesh. Labels are now anchored to a fixed world-space pin and stay stationary regardless of mesh animation.
- **Blue sphere artefact** — placeholder sphere meshes created for light fixtures were included in the interactive highlight layer, appearing as a visible blue glowing ball in the scene. Light entities are now excluded from the outline highlight (they use PointLight + emissive colour instead).
- **Mobile HUD overflow** — all four toolbar buttons are now visible on narrow phone screens (clock and wifi icon hidden on ≤640 px viewports).

---

## 2.3.0

### New features
- **Light entities** — ceiling LED panels and wall switches defined in SweetHome 3D now appear in the navigation space as clickable controls. Tapping a light opens the control panel; active lights glow via a PointLight source.
- **Clickable state labels** — the floating entity labels (camera, fan, sensor…) can now be tapped to open the control panel directly, same as tapping the 3D object.
- **`input_boolean` support** — manually bound input_boolean entities now show a proper on/off toggle panel instead of a blank sensor panel.
- **HUD toolbar** — Bind 3D object, Drop control marker, and Config Editor buttons are now always visible in the top bar, without opening Settings first.

### Config Editor
- Each entity appears exactly once: auto-detected entities in the top table, tap-bound 3D objects in the Bound section — no duplication.
- Inline metadata editing (type, label, room, confirm) directly in the bindings table.
- Entity search dropdown closes on outside click and Escape key.
- Config Editor header stays visible while scrolling (sticky).
- Auto-detected entity settings section moved to the top for clarity.
- Entities whose 3D mesh names match a HA entity ID are now auto-populated in the Config Editor on model load (no manual pre-configuration needed).

### Blender pipeline (v1.3.0)
- Detects SweetHome 3D `<light>` fixture elements (previously only `<pieceOfFurniture>` was scanned).
- Creates placeholder sphere meshes for light fixtures that have no visible 3D geometry in the OBJ export, placed at the centroid of all instances of each entity.
- Fixed sphere coordinate axis mapping so placeholders land at ceiling height rather than floating above the building.

### Bug fixes
- Entities stored with a legacy `sensor` type fallback are automatically upgraded to their correct type (light, switch, input_boolean, etc.) without requiring a config reset.
- Manually bound entities no longer show "Unmapped" as the room label.

---

## 2.2.0

### New features
- **Clear model button** — Settings → 3D model → Clear stored model removes the GLB from browser storage without touching add-on data.

### Changes
- HA URL, token, and Test Connection fields are hidden in Ingress (add-on) mode — only shown in standalone mode.
- Documentation consolidated into a single README.

---

## 2.1.0

### New features
- **Tokenless auth in add-on mode** — the kiosk connects to Home Assistant through the Supervisor proxy without requiring a long-lived access token. Token is only needed in standalone / direct mode.
- **Auto-connect on load** — in Ingress mode the connection starts automatically; the Connect step is skipped in the onboarding wizard.

---

## 2.0.0

- Initial public release as a Home Assistant add-on.
- First-person 3D navigation of a SweetHome 3D villa model.
- Entity tap → control panel for lights, climate, locks, cameras, covers, fans, sensors.
- Room teleport grid, day/night sun cycle, live weather effects.
- Blender pipeline for converting SweetHome 3D OBJ exports to a click-ready GLB.
