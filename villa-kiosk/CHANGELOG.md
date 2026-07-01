# Changelog

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
