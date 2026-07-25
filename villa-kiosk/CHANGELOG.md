# Changelog

## 2.35.33

### Changes
- enforce the bottom-bar rule uniformly: the Scene tile no longer applies a single scene directly on tap — it always opens its menu, and a scene is applied only when selected from it (device tiles already open a modal, never a direct state change)

---


## 2.35.32

### Changes
- bottom-bar tiles now open a comprehensive SummaryGroupPanel modal listing every entity they control (inline on/off + drill-down to each entity's full panel, reusing BasePanel/PanelRouter — DRY); restore the card badge's category-coloured background (keeping the new gradient squircle icon)

---


## 2.35.31

### Changes
- gradient icon squares everywhere (DRY): one categoryGradient() helper drives the top bar, legend and bottom-bar tile icons; badgeImageDataUrl unified with an inset param (deletes near-duplicate iconChipDataUrl) so the card badge now shows the same gradient squircle on a neutral card

---


## 2.35.30

### Changes
- SummaryBar: fix the real width bug — a centred overflow:auto container only shrink-to-fit into half the viewport, so max-width:99vw never applied; add width:max-content so the bar uses the FULL viewport width before scrolling. Reverts the tile-shrinking/label workarounds — full-size tiles + full lock label now fit without scroll

---


## 2.35.29

### Changes
- SummaryBar: fit all tiles without scroll on desktop — keep the icon at 46px but tighten inter-tile gap/padding, cap tile width at 200, single-line (ellipsised) labels, and shorten the lock tile label to Entrance (was the widest tile)

---


## 2.35.28

### Changes
- status/enum sensor badges: hide the value while nominal (Connected/OK/Normal…) since the badge is already category-coloured; a non-nominal state stays shown and a known-bad one (Disconnected/Error/Offline…) rings the badge red so a real change never goes unseen

---


## 2.35.27

### Changes
- SummaryBar: revert tiles to the larger size (icon 46, 18/12 fonts) and instead widen the bar (cap min(99vw,1900px), tighter trailing padding) so the full-size tiles fit without horizontal scroll

---


## 2.35.26

### Changes
- SummaryBar: more compact tiles (smaller icon 42/22, fonts 16/11, trimmed padding+gaps) and cap raised to min(98vw,1800px) so all tiles fit without horizontal scroll on a normal wide screen

---


## 2.35.25

### Changes
- SummaryBar: widen the max-width cap (min(96vw,1600px)) so the bar fits all its tiles without horizontal scroll when the screen has room; scroll only kicks in when it truly can't fit

---


## 2.35.24

### Changes
- SummaryBar: collapse scenes into ONE Scene tile — a single scene applies on tap, multiple open a pop-up picker (portaled above the tile); reduce the bar's vertical padding so it's less tall

---


## 2.35.23

### Changes
- SummaryBar: move Scene tiles to the far right; icon chips now always carry their device category's colour (AC=comfort, Pool/Energy=energy, Lights=light, Lock=access) instead of greying out when off — on/off shows via value text + border

---


## 2.35.22

### Changes
- shared Scenes across devices: store scenes in the add-on's /data volume via a new supervisor-proxy /scenes endpoint (GET any session, PUT owner-only, atomic) + nginx route; client ScenesProvider makes the server authoritative (pull on mount/focus, write-through on edit, first-run migration of local scenes)

---


## 2.35.21

### Changes
- make the bottom SummaryBar larger — bigger tiles, icons (46px chip, 24px glyph) and value text (18px), roomier padding + a proportional phone breakpoint

---


## 2.35.20

### Changes
- add kiosk Scenes: capture the villa's current controllable state (lights/switches/fans/AC/covers/locks) as a named scene in Settings, then re-apply it one-tap from the bottom SummaryBar; scenes are stored in config + included in backup export/import

---


## 2.35.19

### Changes
- card badges: bake the icon-chip inset into the image for deterministic even padding on all sides (fixes chip touching edges); grouped device badges (e.g. temp+humidity combo) now show BOTH members' readings on the one badge (24°C · 58%)

---


## 2.35.18

### Changes
- card badges: symmetric left/right padding (icon-only cards now centre their chip; no phantom gap from a hidden value) + include badgeStyle/showSummaryBar in the config export/import backup bundle

---


## 2.35.17

### Changes
- badge style toggle (classic squircle+pill / card) + summary bar visibility toggle in Settings; card badges are a category-coloured horizontal icon+value card (opt-in, classic stays default)

---


## 2.35.16

### Changes
- add bottom SummaryBar: auto-derived scene/quick-action/summary tiles (entrance lock, pool, lights-all, AC, scenes, energy) from live entities, RBAC-aware, matching the dashboard mockup

---


## 2.35.15

### Changes
- extend the cover/lock pose-swap mechanism to binary_sensor door/window contact sensors (device_class-gated open/closed poses); update README + MODEL_PIPELINE docs to reflect current lock/binary_sensor defaults and the unsuffixed-mesh-is-never-a-pose rule

---


## 2.35.14

### Changes
- unsuffixed base mesh (e.g. physical lock device) is no longer swept into a pose bucket — it stays always-visible and state-tinted instead of vanishing when the opposite pose is active

---


## 2.35.13

### Changes
- lock pose meshes (__locked/__unlocked) skip the red/green state tint; flip lock rest/default pose to locked so the open-door shadow no longer bakes in

---


## 2.35.12

### Changes
- Docs: added a **"Configuring interactive assets in SweetHome 3D"** section to `README.md` (entity-id naming for auto-mapping, curtain/lock position feedback via `__open`/`__half`/`__closed` and `__unlocked`/`__locked` pose copies, placing curtains over windows, and bake resolution), and expanded `MODEL_PIPELINE.md`'s pose-feedback section with the windows-stay-transparent + no-ghost-shadow behaviour and the `--bake-size 2048` recommendation for detailed curtain geometry. No app code change — documents the cover/lock visual-variant feature and the pipeline improvements (v2.9.4–v2.9.7) delivered this development cycle.

## 2.35.11

### Changes
- Fixed a camera detection-beam load-order bug surfaced by the ?debug log. Beams are (re)built by `setCameraDirections`, which runs AFTER the first batch of Home Assistant states has already been applied — so a camera whose motion sensor was already `on` at kiosk load/reload fired its beam-activation against a beam mesh that didn't exist yet (a no-op), and the beam then stayed dark until that sensor's NEXT state change. `buildCameraBeams` now replays the current motion state from `lastState` onto the freshly-built beams, so a beam whose sensor is already on lights up immediately instead of one toggle late. Benign when a sensor is off at load (the common case), which is why it hid until now; real whenever motion is active at load.

## 2.35.10

### Changes
- Closed a gap in the pose-swap diagnostics: v2.35.9's log proved which pose gets *chosen* on every state change, but not whether the non-chosen poses' meshes actually ended up hidden on screen — a real bug in that last mile (e.g. a duplicate mesh reference, or a floor-visibility conflict independent of the pose toggle) wouldn't have shown up. `applyMeshVariant` now reads `isVisible`/`isEnabled()` straight back off every mesh right after toggling and logs it (a mesh only renders with BOTH true), so "is `__open` actually hidden right now" is answered directly from the copyable log instead of by eyeballing the 3D view.
- Investigation update on `cover.bedroom4_curtain`: confirmed from the .sh3d source that `__closed`/`__half` use real, distinct, intentionally high-detail catalog curtain models (`curtain_2_full.obj`/`curtain_2_half.obj`, ~124k vertices each, `half` is an exact half-width scale of `full`) — not a pipeline mis-assignment; the earlier triangle-count anomaly was fully explained by this. Runtime state→pose selection was already independently proven correct via the ?debug log. This release's post-toggle visibility readback is the next concrete step to rule the last possible failure point in or out.

## 2.35.9

### Changes
- Added a "Copy all" button to the `?debug` on-screen log box. It was capturing everything correctly, but the visible window only ever showed the last 40 lines and scrolled past too fast to read (or select by hand) during a busy model load — there was no way to get the full transcript off a device without real devtools. The box now keeps the full history for the page load (up to 5000 lines) in the background; the button copies all of it to the clipboard in one tap (with an execCommand fallback for browsers without the async Clipboard API), while the visible window still only shows the last 40 for at-a-glance reading.
- Added targeted runtime diagnostics for the pose-swap feature (cover/lock), since the on-screen box previously only logged the ONE-TIME grouping summary at model-load time, not what happens on every subsequent live state change: `apply()` now logs when a `cover.*`/`lock.*` entity's state arrives but no mesh/mapping resolves for it at all (nothing could ever be shown), and when one resolves but with an unexpected `type` (e.g. the Advanced Settings Type field got changed away from cover/lock, silently disabling the pose swap for that entity); `applyMeshVariant` now logs every call's requested vs. chosen pose. This turns "which stage of the chain broke" from a guess into something visible directly in the copyable log.

## 2.35.8

### Changes
- Fixed the "one curtain pose (usually fully-open) stays visible no matter the position, while the others toggle correctly" bug. It wasn't a visibility-flag conflict (that was v2.35.7) — that pose's meshes were escaping the entity grouping entirely, so nothing ever hid them. Two independent causes, both addressed: (1) mesh-name normalisation stripped export artifacts in a single fixed-order pass, so a mesh whose tail combined several ("__open_primitive0.001" order, vs the "__open.001_primitive0" the single pass handled) kept its "__open" and resolved to its own separate entity instead of the shared base — now loops until the tail is fully clean, verified against every artifact ordering plus a bare "(2)"/numeric duplicate, while leaving legitimate entity_ids with digits/underscores untouched. (2) Stale per-browser config: before the pose convention existed (v2.35.0), the app auto-detected each pose as its OWN entity and saved it to localStorage; those stale "cover.x__open" entries shadowed the correct base and are now migrated away on load (any entity_id containing "__" — which a real HA entity_id never does, the app reserves it as the pose delimiter). Also strengthened the ?debug diagnostic to list every variant group INCLUDING single-mesh ones and to flag any entity whose id still carries an un-collapsed "__" suffix, so a grouping problem is immediately visible.

## 2.35.7

### Changes
- Root-caused and robustly fixed the intermittent "the fully-open curtain pose won't disappear" bug (the v2.35.6 floor-check was only patching one symptom). The real cause: pose exclusivity used `setEnabled()`, the SAME flat per-mesh flag FloorManager uses for whole-storey visibility — AND that room calibration (estimateFloorY / buildRoomConform) SAVES every floor mesh's setEnabled state, force-enables them all for a floor-height raycast, then RESTORES the snapshot. Three systems writing one flag: whether a calibration's save-snapshot happened to capture "all poses enabled" or "only the chosen one" depended purely on timing versus when the pose toggle ran — exactly why it was random and un-patternable. Fixed by moving pose exclusivity onto `isVisible` instead: a mesh renders only when isEnabled() AND isVisible are both true, so FloorManager's setEnabled (WHICH FLOOR) and the pose toggle's isVisible (WHICH POSE) are now fully orthogonal and can never clobber each other — no floor check, no post-switch resync, no calibration interference. Nothing else in the app sets isVisible on an entity mesh, so a hidden pose stays hidden through every floor switch and recalibration, deterministically.
- This fix lives in the single shared applyMeshVariant, so it applies automatically to EVERY pose-swap asset type — both the curtains (cover) and the door lock (lock, its __locked/__unlocked meshes) — and any future one, with no per-type work. The ceiling fan and all other dynamic assets are unaffected by this class of bug because they never toggle mesh VISIBILITY for state: fan spins (rotation), light changes glow/illumination (the fixture mesh stays visible; only its light + baked pool change), switch/media/climate/binary_sensor change emissive tint/outline. The only mechanism that shows/hides entity meshes by state is the pose swap, and it now composes cleanly with floor visibility for every type that uses it.

## 2.35.6

### Changes
- Fixed a real bug: a 2F curtain's mesh-variant toggle could show up while viewing 1F (and vice versa). FloorManager stamps every mesh's floor on `metadata.floorIndex` and manages visibility with a flat, non-hierarchical `setEnabled()` flag — the mesh-variant toggle (applyMeshVariant) was calling `setEnabled()` on the chosen pose with no awareness of which floor is active, directly clobbering FloorManager's own decision for that same mesh. It now folds in `metadata.floorIndex <= the active floor` on every enable/disable, in both directions: the initial choice, AND a floor switch (which re-enables every mesh on the newly active floor via FloorManager's own logic, including a curtain's other, not-chosen poses — now re-asserted right after, the same pattern lights already use for their floor pools).
- Fixed the remaining "all poses visible until moved once" case: `coverVisualBucket`'s fallback for a genuinely uncertain live state (unavailable, unknown) returned "half" — inconsistent with the "default to open" behavior everywhere else in this feature (the unsuffixed-mesh convention, and the index-time safety net in v2.35.5). It now defaults to "open" for anything uncertain too, reserving "half" specifically for the states that DO mean something is actively happening (opening/closing).

## 2.35.5

### Changes
- Fixed a real gap in the curtain/lock mesh-variant feature (v2.35.0/2.35.1): the toggle that hides all-but-the-active pose (applyMeshVariant) only ever ran from a live Home Assistant state event — an entity authored with 2-3 poses that hasn't reported a state yet (not wired to a real integration, or simply hasn't checked in before the model finished indexing) showed EVERY pose overlapping simultaneously, with nothing left to ever correct it, since nothing else ever calls that toggle. Now defaults every multi-variant entity to its type's default pose immediately at index time — before any live state is needed — so the worst case is "shows the default pose" instead of "shows all of them forever". Also added a `?debug`-gated diagnostic line reporting exactly which entities got 2+ poses grouped and how many meshes landed in each, so a naming/grouping problem is verifiable on a real kiosk without console access.

## 2.35.4

### Changes
- A camera's motion-detection beam requires the camera's SweetHome3D placement to have a real facing rotation authored (buildCameraBeams deliberately never guesses a direction from no data) — a camera left at its default/unrotated placement gets no beam mesh at all, so turning its linked motion sensor on used to do nothing visible, with the only diagnostic being a console/on-screen line gated behind `?debug`. Added a fallback: when a linked camera has no beam mesh, its motion sensor now glows that camera's own room instead (sourced from the camera's own Room field, since the motion sensor itself — typically just the camera's built-in detector, referenced only by entity_id — usually has no room mapping of its own to fall back to). Never a guess about aiming direction, just real feedback instead of silence for the single most common reason this looked broken.

## 2.35.3

### Changes
- Fixed two mobile UX issues. (1) In Advanced Settings → grouped devices, a group whose primary entity has no friendly_name showed the raw entity_id as its heading — one long unbreakable underscore-joined token that overflowed the row and pushed the delete (trash) button off the right edge of the screen. The heading (and the suggestion rows and member chips, same risk) now wrap long tokens inside the row and the delete button stays put. (2) The first-run "Quick tips" card and the "Map colours" legend rendered as top-anchored full-screen sheets on a phone — with a big empty area below — instead of centered cards like every other popup, because they used the base modal classes (meant for long Settings forms) rather than the centered-card treatment. Same fix as the badge-colour picker got in v2.34.1: they now appear as a centered rounded card on mobile.

## 2.35.2

### Changes
- Fixed the intermittent "Failed to load the 3D model — Failed to fetch" screen some users saw on a cold open over the public (Cloudflare) hostname. Root cause: fetching the multi-MB central GLB over the public hop occasionally hits a transient network-layer failure (a connection reset mid-transfer, a brief cloudflared tunnel reconnect, a TLS renegotiation drop) — all of which surface as "TypeError: Failed to fetch". These are near-absent on the HA sidebar's local Ingress path (no public hop), which is why it was origin-specific and never happened right after a GLB upload (that reuses bytes already in hand, no big re-download). The previous retry window (3 attempts / ~2.7s) simply didn't always outlast the blip, so it dead-ended on a terminal screen needing a manual reload. Now the model fetch rides through a network failure with capped exponential backoff for a generous ~2-minute budget — comfortably longer than any realistic Cloudflare/tunnel/add-on-restart hiccup — so the kiosk SELF-HEALS the moment the hop is back, showing an honest "Connection unstable — reconnecting…" message instead of a frozen spinner or a dead end. A real HTTP error (404/500 — a genuinely missing/broken model) still surfaces immediately with the actionable re-upload message, unretried, exactly as before.
- Hardened the same class of transient failure on the /addon-config gateway call that runs first: a network blip there used to silently misroute the whole load to the "no model — upload one" screen even when a model exists. It now retries a network failure a few times, while still returning immediately on an HTTP status (a 401 there is the expected "not authorized yet" signal the pre-login model prefetch relies on, so that common path keeps its zero added latency).

## 2.35.1

### Changes
- Extended v2.35.0's opt-in mesh-variant mechanism to locks: a door lock can now be authored as two alternate poses ("lock.foo__unlocked"/"__locked", unsuffixed = unlocked) to show its real bolt/lever position, on top of the existing always-on green/red tint. Reused the exact same generic machinery (VARIANT_VOCAB/meshVariants/applyMeshVariant) built for covers — a 3-line vocabulary entry plus one small state-bucketing helper, not a parallel implementation. Live state is interpreted defensively: anything uncertain (jammed, mid-transition, offline) shows the LOCKED pose rather than risk implying a door is open when its real state genuinely isn't known. A lock with just one plain mesh — every villa today — is completely unaffected.

## 2.35.0

### Changes
- Curtains/blinds can now show real open/half/closed position in the 3D view — opt-in, per curtain, zero effect on a villa that doesn't use it. A curtain authored as up to 3 alternate SweetHome3D pieces named "cover.foo__closed"/"__half"/"__open" (unsuffixed = open, by convention) shows whichever pose matches the entity's live current_position (or bare open/closed state when a device doesn't report position), and hides the other poses; a plain, unsuffixed single mesh — today's default for every existing villa — is completely unaffected and stays always visible, exactly as before. Verified end-to-end against the actual sources/blender_pipeline.py: SweetHome3D's declared piece name (suffix included) is preserved verbatim into the final GLB mesh name, so this works with the real toolchain, not just in theory. Also found and fixed a real latent bug this surfaced: the map-badge label anchor inherits its enabled-state from whichever mesh happens to be first in an entity's mesh list — fine for a single mesh, but for a multi-pose curtain that mesh is hidden 2 times out of 3, which would have made the badge itself flicker in and out with the wrong pose. Re-anchors to whichever pose mesh is actually visible whenever it changes.
- The underlying mechanism (EntityVisuals' VARIANT_VOCAB / meshVariants / applyMeshVariant, EntityMap's extractVariantSuffix) is fully generic, not cover-specific — extending it to another domain (e.g. a lock's bolt position) is a ~10-line addition (one vocabulary entry + one bucketing function + one call in apply()), not a parallel implementation.
- Documentation: MODEL_PIPELINE.md's cover row and light-naming section described a position-feedback behavior that the actual code never implemented ("mesh retracts & fades", continuous 0-100%) — corrected to describe what's now actually built, with a new authoring walkthrough alongside the existing light-naming one.

## 2.34.1

### Changes
- Icon-colour picker (tap a device panel's badge) rendered inconsistently on mobile — top-anchored, edge-to-edge, square corners — because it was missing the `panel-modal-backdrop`/`panel-modal` classes that give short dialogs (the device panel itself, which it opens from) their small centered rounded-card treatment; without them it fell through to the base full-screen-sheet rules meant for long forms like Settings. Now uses the same classes as the panel underneath it.
- Root-caused (not re-debounced) the remaining Advanced Settings typing lag: every field's "not-yet-committed" draft state lived in a flat Record keyed by entity ID at the TABLE level (ConfigEditor/BindingsTable), so a keystroke in any ONE row's Label field re-rendered the entire table — recomputing every OTHER row's Type/Category selects, room dropdown, motion-sensor picker, on every character typed. Both tables also read live HA `entities` at that same top level, so the identical full-table re-render fired on every state_changed event for ANY device in the house, typing or not. Split each row into its own component (EntityMapRow, BindingRow), React.memo'd, with its own localized draft state and a narrowly-scoped `entity` prop (only that row's own entity, not the whole house's state) — a keystroke, a drag, or someone else's sensor updating now only re-renders the one row it actually affects. The existing debounce and SceneManager's frame-yielding (from v2.33.0) are still needed for the eventual heavy commit itself; this fixes the separate, purely-React cost that was still there in between commits.

## 2.34.0

### Changes
- Tap-to-toggle now gives instant feedback. Tapping a light/switch/fan/media entity — in the 3D map directly, or via a panel's big On/Off button — used to change nothing on screen until Home Assistant's real state_changed round-trip landed, which on a slow link read as "did that even register?". An earlier attempt at PREDICTING the outcome (optimistic toggle) was tried project-wide and reverted after it mispredicted rapid ON→OFF taps — this doesn't repeat that mistake: it never predicts the result, it only acknowledges the tap itself. The in-scene quick-toggle gesture now spawns a brief expanding ring at the exact tap point (TapRipple, pure DOM, zero Babylon/material involvement so it can't desync from the real state); PowerToggle now shows a soft pulse while waiting, cleared the instant the real state actually changes (or after a 4s safety timeout if HA never confirms).
- Gesture discoverability: buttons whose long-press does something beyond their tap (the Rooms/Compass button, the overview "save default view" Anchor button) previously relied entirely on hover tooltips to explain that — which do nothing on a touchscreen kiosk. They now carry a small persistent dot indicator, plus both are keyboard-operable for the first time: the Rooms button had ONLY pointer handlers before (native button keyboard activation dispatches a click, not pointer events, so Tab+Enter/Space silently did nothing), and now supports a held Enter/Space as the long-press equivalent; the Anchor button gained the same via held Space specifically (Enter's click fires on keydown rather than keyup for buttons, so only Space can time a real hold without also mis-firing the tap action).
- New one-time "Quick tips" card on a kiosk's first-ever login (per-device, never shown again after — see utils/storage's hasSeenFirstRunTips), explaining the category filter icons, the long-press affordance above, and the new map-colours legend below.
- New map-colours legend (the ? button next to Settings, or "Map colours" in the mobile overflow menu): the category filter icons already double as a colour legend for badge backgrounds, but nothing explained the on/off/unavailable/alert status-pill colours in one place before — now it does, using the app's real theme tokens so it's always correct in light or dark.
- Device-panel history charts (StateTimeline/Sparkline, used by every panel's "Last 24 hours" view) now distinguish "still loading" from "Home Assistant genuinely has no history for this entity" — both used to render as the identical empty message, so a slow network looked exactly like a sensor that's never reported. useStateHistory now reports a `loading` flag threaded through to a subtle shimmer placeholder instead.
- Replaced the native `alert()` for "this floor isn't modelled yet" with a themed toast (AppNotice) matching the rest of the kiosk's chrome instead of breaking out into an unstyled browser dialog.
- The crash-recovery / model-load-failure screen (ErrorReport, used by the render error boundary, model-load failures, and the iOS crash-loop guard) now leads with the actual recovery action (Reload / Upload model / etc.) and collapses the raw technical report behind a "Show technical details" toggle — it's reachable by anyone using the kiosk at the moment something fails, not just the owner, and "copy the details below and send them over" read as a dead end to someone who doesn't know what a stack trace is.
- The PIN pad now offers a way forward after 2 wrong attempts ("Ask whoever manages this villa's kiosk") instead of only "Incorrect code — try again" with the small "Profiles" link as the only way out.

## 2.33.0

### Changes
- Security hardening on the direct/Cloudflare-exposed port: permissions.ts's role matrix was UI-only — any authenticated session, including guest, could reach the raw /core/websocket or /core/api/* bridge and call ANY Home Assistant service in ANY domain from devtools (automations, scripts, alarm_control_panel, arbitrary Jinja template rendering, homeassistant.restart/stop), not just what the kiosk's own panels expose. supervisor-proxy.py now enforces a role-based allowlist at the point a service call actually leaves the browser, on both the WebSocket (call_service) and REST (/services/<domain>/<service>) paths: non-owner sessions are confined to the exact domains the kiosk's UI ever calls (light/climate/lock/cover/fan/switch/media_player, plus homeassistant.toggle). Also fixed: an owner/ops profile left with no PIN configured (config.yaml's shipped default) used to silently grant a full-access session to anyone who asked for it on the direct path — refused now unless a PIN is actually set (only the guest profile may stay intentionally PIN-less). Model upload is now owner-only (was any authenticated role) and /core/api/template + guest camera_proxy access are blocked server-side, not just hidden client-side. See supervisor-proxy.py's module docstring for the full threat model and the one known residual gap (entity-category read visibility, which needs entityMap moved server-side to close — not attempted here).
- Advanced Settings / Bindings editing lag, root-caused rather than further debounced: every field commit still ran SceneManager.updateConfig's structural rebuild (indexMeshes + applyStructure) as one uninterrupted multi-second block on the main thread, so the debounce already in place only reduced how OFTEN that block happened, not how long any single one froze input. updateConfig now yields the main thread between its heavy steps — the same technique loadModel already used for the initial model load — turning one long freeze into shorter ones with real paint/input opportunities in between. Also consolidated three separately hand-rolled "instant local draft, debounced commit" implementations (ConfigEditor, BindingsTable, SettingsModal) into one shared hook (useDraftCommit), which incidentally fixes a couple of needless-rebuild edge cases (e.g. blurring an untouched field used to commit anyway).
- Cleanup: removed two npm dependencies with zero remaining imports (jszip, @babylonjs/serializers), extracted six panels' identical history-fetch effect into a shared hook (useStateHistory) and their identical "Last 24 hours" render block into a shared component (LastDayTimeline), merged duplicated CSS chrome (the same background+blur pair repeated across 8 rules; the hud-group/hud-stack icon-btn reset rules), and cleared stale build artifacts (dist/, dist.zip, tsconfig.tsbuildinfo, macOS/Python junk) from the working tree.

---


## 2.32.27

### Changes
- Fix a room's presence/motion floor-glow landing at ceiling height instead of the floor: estimateFloorY's downward probe took the FIRST (topmost) raycast hit within its storey's mesh group, reasoning a room's centroid never hits overhead structure — true for most rooms, but the guest bathroom's centroid lined up with a beam/overhead structure, so its glow rendered up at that height instead of the tile floor. Switched to multiPickWithRay + the LOWEST hit, which is always the actual floor slab regardless of what else is overhead — removes the fragile per-room assumption instead of special-casing it. Same fix applied to buildRoomConform's stepped-room (staircase) probe for consistency.

---


## 2.32.26

### Changes
- Two fixes: (1) chart axis/grid/tooltip-border text was using --text-muted/--border, which were never defined in either theme — fell back to SVG's default black fill, nearly invisible in dark mode. Now uses the app's real --text-secondary/--hairline tokens, themed correctly both ways. (2) Entity 'unavailable'/'unknown' state was silently read as a definite off/unlocked/closed/etc. in every device panel and in the lock/binary_sensor mesh colouring — worst case, a lock HA had lost contact with rendered as a confirmed red UNLOCKED on the map and in its panel. Added a shared isUnavailable() check + a distinct amber 'UNAVAILABLE' treatment (status pill, mesh tint, disabled controls) across every panel (Light/Fan/Switch/Media/Lock/Cover/AC/Sensor/DeviceGroup) and the lock/binary_sensor 3D mesh colouring, so the kiosk never asserts a state HA never actually confirmed. The map badge ring/value chip already handled this correctly and needed no change.

---


## 2.32.25

### Changes
- Model download now retries on a transient network failure (fetch() throwing, or the stream dropping mid-read — both surface as 'TypeError: Failed to fetch'), up to 2 extra attempts with a short backoff, before giving up and showing the error screen. Common on the standalone hostname's public Cloudflare hop, rare on the HA sidebar's local Ingress path — a real HTTP error status (404/500) is still surfaced immediately, unretried, since that's a genuine failure, not a blip.

---


## 2.32.24

### Changes
- Remove the 'Exit to Home Assistant' button and all related code (redundant now): the login/profile-select screen's top-right exit button, the HUD's overflow-menu and inline exit buttons, ha/ingress.ts's isIngress()/exitToHomeAssistant() helpers, and the now-unused .auth-exit-btn CSS.

---


## 2.32.23

### Changes
- LED strip cove lighting: dark corners fixed. A rectangular LED cove is 4 separate strip segments, each previously lighting only its own centre — corners (where two segments' ends meet) fell outside every pool's radius and stayed dim. Each strip now gets 3 floor-glow pools: full intensity at its centre (unchanged) plus half intensity at each of its own two ends, so two adjoining strips' end-pools land on the same corner and sum back to roughly the centre's brightness, lighting the corner without doubling it into a hotspot. Compact (non-strip) fixtures are unaffected — still exactly one pool. This is the corner-lighting half of the earlier-reverted v2.32.8 strip work, reapplied on its own — no wall-clip, no idle queue, no optimistic toggle, so it carries none of the responsiveness risk from that reverted saga.

---


## 2.32.22

### Changes
- Fix error/loading/no-model/crash-loop screens rendering underneath the HUD: .center-overlay now paints above the topbar and floor-switch column (z-index 30 vs 21/22) with a solid background and top padding that clears the topbar's real height (safe-area aware, so notched phones are correct too) — previously the topbar's higher z-index let its own text/icons visually overlap and clip the error report's title/buttons.

---


## 2.32.21

### Changes
- Reverted the light-pool responsiveness work (v2.32.7 through v2.32.20) back to its v2.32.6 baseline: repeated attempts to fix ON/OFF latency in that subsystem (wall-clip, LED strip pools, iOS z-fix, optimistic tap toggling, on-demand pool building) did not resolve the reported lag, so the whole line of changes was rolled back rather than layering further fixes on unproven ground. Baked-mode lights are back to the pre-v2.32.7 behavior: a simple round floor-glow pool with no wall clipping, no optimistic tap prediction, and no background idle-queue pool building. The unrelated v2.32.10 Settings-modal (single "Close" button) and mobile-menu (connection status icon) changes were kept — they were not part of the reverted work.

---


## 2.32.20

### Changes
- Fix the actual root cause of ON/OFF feeling slow: a baked light's floor-pool glow was only built by a slow background idle queue, unaware of WHICH light the user just tapped — so tapping a fixture near the end of the queue got no visual response for however long the queue took to reach it, on either ON or OFF. Fixed by building a fixture's pool on demand the instant it's actually needed (ensurePoolsBuilt), for any live tap or real HA state change. Kept the villa's initial bulk repaint (every entity, right after load) on the deferred idle path via a new bulk-vs-live distinction all the way from HAStateStore (subscribeAllBulk/notifyBulk) through SceneManager to EntityVisuals — so a fresh load still doesn't build every fixture's pool synchronously at once, but any light a user actually interacts with responds immediately regardless of queue position.

---


## 2.32.19

### Changes
- Fix the real cause of 'villa just loaded, first light tap freezes UI': the wall-clip's ray sweep tested every ray against EVERY baked-shell submesh (a baked Structure commonly splits into 100+ per-material Structure_primitive<N> meshes), with no yield inside that loop — a batch of a few pools could mean ~10k unaccelerated ray-mesh tests executed synchronously inside one idle callback. Fixed with a cheap AABB-distance pre-filter (per pool, not per ray) so only submeshes actually near that pool get the expensive test; halved ray count and idle batch size as extra margin. Given this exact subsystem caused two separate freeze regressions, defaulted clipLightPools to OFF (opt-in via Advanced Settings) even though it's now properly bounded — the 'always responsive' requirement wins the default, not the polish.

---


## 2.32.18

### Changes
- Root-cause fix for laggy OFF-after-ON: entitiesRef was written INSIDE a React state updater (not guaranteed synchronous), so two rapid taps could race and the second one read stale state, silently guessing the wrong toggle direction. Rewrote HAStateStore's commit path so the ref is always written synchronously before React is even told. Extended optimistic toggling to every panel's PowerToggle (light/fan/switch), not just the map tap, via a shared utils/optimisticToggle + hooks/useOptimisticToggle (DRY) — media player intentionally excluded (toggle isn't a clean on/off flip). Also fixed package.json's version never being bumped by push.sh (Advanced Settings footer was stuck on v2.32.0 while the HA add-on reported the real version) — push.sh now bumps and verifies both files together, using the correct outer-repo path for package.json.

---


## 2.32.15

### Changes
- Fix laggy OFF right after ON: optimistic toggle now reads the LIVE state snapshot instead of a stale React closure, so a rapid ON→OFF flips the correct direction and turns off instantly (was mispredicting 'on' and waiting on HA). Also cancel a light's pending background wall-clip when it turns off.

---


## 2.32.14

### Changes
- Instant tap feedback: a map tap on a light/switch now flips its state OPTIMISTICALLY (badge + 3D glow update the moment you touch it) instead of waiting for HA's websocket echo — that round-trip was the remaining perceived latency. HA's real state_changed reconciles a beat later; a failed command reverts.

---


## 2.32.13

### Changes
- Progressive load (#1): baked-mode floor-pool creation now runs in the background too (idle time), not just the wall-clip. The scene appears immediately and each room's light glow floor-finds + fills in a moment later, so per-fixture load raycasts never block first paint. On lights get their glow the instant their pool is built.

---


## 2.32.12

### Changes
- Light-pool wall-clip is back — now fully BACKGROUND, on by default: a light turns on instantly as a round pool, then its wall-bounded shape is computed in browser idle time (requestIdleCallback, chunked, yields on low idle) and swapped in, so interaction never blocks. Advanced Settings toggle (default on) to opt out on weak devices. Persists + exports with config.

---


## 2.32.11

### Changes
- Restore instant light turn-on: revert the two effects that ran expensive work on the click path in baked mode — the per-fixture furniture PointLight (first setEnabled triggered a multi-second shader recompile; now redundant since the night bake lifts furniture) and the on-turn-on wall-clip raycasts. Baked mode is pools-only again (distributed strip pools + iOS z-fix kept, both load-time/free). Responsiveness on device interaction is the hard requirement.

---


## 2.32.10

### Changes
- Settings modal now matches Advanced Settings: every setting (including theme) applies + persists live via a debounced commit, so Cancel/Save become a single Close button. Mobile overflow menu: connection status is now a bare icon on the 'Signed in as' line instead of a separate 'Connection: xxx' text row

---


## 2.32.9

### Changes
- Fix iOS-only rainbow speckle on light pools: additive pool material now disables depth-write and applies a polygon zOffset, so the coplanar/overlapping pools no longer z-fight the floor on iPad's lower-precision depth buffer (Android was already fine)

---


## 2.32.8

### Changes
- LED strip light now runs ALONG the whole strip: an elongated fixture gets several dimmed, overlapping floor pools distributed down its axis (blended into one even line + wall-clipped) instead of a single bright blob at its midpoint. Compact fixtures unchanged.

---


## 2.32.7

### Changes
- Light pools no longer spill outside walls: each baked-mode floor pool is clipped to a wall-bounded visibility polygon (rays from the fixture stop at the villa shell), so glow stays inside the house and only crosses walls through door/window openings. Built lazily on first turn-on.

---


## 2.32.6

### Changes
- Document that per-badge colour (entityMap.badgeColor) is covered by Export/Import Configuration — it already round-trips via whole-entityMap serialization; guard the contract against future field-copy rewrites

---


## 2.32.5

### Changes
- Fix badge colour not repainting on the map: route colour-only change through rebuildLabels (fresh GUI Image) instead of an in-place source swap that Babylon didn't re-render

---


## 2.32.4

### Changes
- Fixes: badge colour picker now updates header live + no re-index lag (cheap repaint); stronger badge shrink on far zoom-out; hover/touch tooltip on discrete state-timeline charts

---


## 2.32.3

### Changes
- Batch: fan 5-speed buttons; overview camera during load; per-badge colour customisation; cap badge size on far zoom-out; light furniture under ON lights in baked mode; pinch/wheel zoom on camera feed; axes+tooltip on trend charts

---


## 2.32.2

### Changes
- Advanced Settings opened via a device's Edit shortcut now auto-scrolls to that entity's card instead of the modal top

---


## 2.32.1

### Changes
- Consistent active-device red: badge ring uses shared ALERT_RED for all active devices; camera/assist_satellite active states now ring; locked locks quiet

---


## 2.32.0

Full-codebase audit: redundancy, memory-leak, and security passes, with
every finding fixed in this release.

- **Security — dependencies (CVE/GHSA):** `npm audit` reported 2
  vulnerabilities: Vite ≤6.4.2 path traversal in optimized-deps `.map`
  handling (GHSA-4w7w-66w2-5vf9, HIGH) and esbuild ≤0.24.2 dev-server
  request exposure (GHSA-67mh-4wv8-2f99, moderate) — both dev-server-scoped
  (production is a static nginx build), fixed anyway by upgrading Vite 5 →
  8 (+ @vitejs/plugin-react 5, @vitejs/plugin-basic-ssl 2). Audit is now
  clean (0 vulnerabilities). Vite 8's rolldown bundler required the
  function form of `manualChunks`; the service-worker asset manifest,
  production build (10× faster: ~3s), and dev server were all re-verified.
- **Security — hardening:** nginx `server_tokens off` (stop advertising
  the server version on the public port, CWE-200) and a `Permissions-Policy`
  header denying camera/microphone/geolocation/payment/usb outright (the
  kiosk uses none of them — HA camera streams are plain HTTP, not
  getUserMedia). A full CSP was evaluated and deliberately deferred with an
  in-file rationale (blob: Draco workers + WASM + React style attributes +
  Google Fonts make a blind CSP too likely to brick the fielded kiosk).
- **Security — reviewed clean:** no XSS sinks (no dangerouslySetInnerHTML/
  innerHTML/eval anywhere in src), no shell/exec in the Python proxy,
  upload path traversal guarded (realpath + prefix check), strict chunk-ID
  validation + magic-byte checks on uploads, uploads NOT exposed by
  `public_model_access`, constant-time PIN/session comparisons,
  crypto-random session secret, httpOnly/Secure/SameSite cookie, per-role
  rate limiting, hop-by-hop header stripping.
- **Memory-leak audit:** every addEventListener/setInterval/setTimeout
  pairing verified (the only unpaired listeners are deliberate
  page-lifetime globals: SW registration, global error capture); Babylon
  disposal chain re-verified end-to-end incl. the pagehide safety net; the
  suspected Babylon GUI linked-controls leak was disproved against the
  installed library source (removeControl does unlink). One real fix:
  `modelPrefetch` kept a stale multi-MB GLB ArrayBuffer pinned for the
  whole session when the model was replaced between prefetch and login —
  the entry is now dropped on claim mismatch so it garbage-collects.
- **Redundancy:** no unreferenced modules and no dead exports found (an
  import-graph scan of all of src/); deduplicated the iOS detection in
  SceneManager onto utils/diagnostics' isIOS(); removed a stray local
  `__pycache__`; corrected a stale comment claiming "Light effect
  strength" was baked-only (it drives dynamic lights too since 2.31.0).

## 2.31.0

- **iPhone render quality restored to the same tier as Android/desktop** —
  MSAA on, up-to-2×-CSS supersampled rendering. iPhone's old
  maximum-aggression tier (no antialiasing, rendering BELOW CSS resolution)
  existed to dodge its per-tab WebGL memory ceiling, and its single-sample
  minification of high-frequency tile textures was also the source of the
  reported rainbow speckle noise around lit floors (clean on Android,
  speckled on iPhone, same GLB). The pipeline's v2.9.0 micro-UV collapse
  halved the decoded model (~321MB → ~170MB measured), which is what paid
  for this: field-confirmed the fixed GLB now loads on the previously
  crash-looping iPhone. iOS keeps the "default" power preference and the
  SSAO/IBL trim as insurance, and the crash-loop guard remains.
- **"Light effect strength" (Settings) now works on non-baked villas too**:
  it scales the real dynamic PointLight a lit fixture casts, not only the
  baked-mode floor pools — it was a silent no-op on a non-baked GLB before.
  Live slider drag previews on dynamic lights as well (new
  `resyncDynamicLightIntensities`). The per-light Intensity slider
  (Advanced Settings) already reached dynamic lights and is unchanged.
- **New "Invert day/night" toggle** in Settings, on the Brightness row
  (right side), shown only when the loaded villa uses baked lighting:
  forces the opposite of the automatic sun-driven look (preview the night
  render at noon, or lift the villa back to daylight after dark). Honoured
  in both sun-position and HA `sun.sun` driven modes; quality presets don't
  reset it; persists with Save like the other render settings.
- **Advanced Settings no longer scrolls horizontally on phones**: the (i)
  model-details tooltip's anchored popover could overflow the modal's right
  edge on narrow screens, dragging a horizontal scrollbar in with it. The
  settings body now clamps horizontal overflow, and on phones the popover
  is pinned to the viewport (full width minus margins, vertically centred)
  so tapping the (i) always shows the whole card on screen.
- **(Model pipeline, not in this repo — v2.9.1)** Fixed a v2.9.0 refactor
  bug that silently disabled the upper-storey vegetation veto (a NameError
  in `_parse_all_furniture` was swallowed as "level veto skipped"), which
  let 2F roof-planter hedges chain through palm bounding-boxes into the
  always-visible `Structure_Exterior` group — the "bushes on the 1F view"
  report on the freshly-baked GLB. Re-run the pipeline (now prints v2.9.1)
  and re-upload to fix; the 1024 bake's vertex/memory wins are confirmed
  (47.1MB → 17.94MB, 5.61M → 2.67M verts).

## 2.30.3

- **iPad no longer renders blurry/pixelated.** iPad was lumped into the same
  maximum-aggression memory tier as iPhone (no MSAA antialiasing, rendering
  at or below CSS resolution — on a DPR-2 iPad that's HALF native), built to
  dodge iPhone's per-tab WebGL memory ceiling. Side-by-side screenshots of
  the same GLB on iPad vs MacBook made the gap obvious. iPad is now its own
  middle tier: MSAA on, true native-resolution rendering (no supersampling
  above native, which is where desktop's extra memory goes), while keeping
  the SSAO/IBL trim and default power preference as cheap insurance. iPhone
  is unchanged. Detection: modern iPadOS reports a Mac UA, so the
  maxTouchPoints check catches it; iPhone/iPod match by UA directly.
- **(Model pipeline, not in this repo)** Root-caused the iPhone
  crash-loop on baked GLBs by per-mesh byte accounting of the real villa
  exports: the bake DOUBLED the exported vertex count vs the identical
  no-bake geometry (5.61M vs 2.64M verts for the same 2.20M triangles —
  `Structure_L1` alone at 2.85 verts/tri, near the 3.0 worst case), because
  every micro-island face carried its own per-face UV spread inside its
  material's patch cell, forcing the exporter to split every shared vertex.
  ~250MB of decoded vertex buffers (plus textures and Draco's transient
  decode) is what breaches iPhone's per-tab ceiling — file size was never
  the issue. Fixed in `blender_pipeline.py`: after both atlases are baked,
  micro-face UVs snap to their patch cell's centre texel (visually
  imperceptible — the cell is a flat colour by design), so vertices weld
  again at export. Also unified the non-baked export onto the same
  level-splitter as the baked one, fixing 2F roof-planter hedges showing on
  the 1F view in no-bake GLBs (the legacy splitter never peeled
  `Structure_Exterior` and chained roof hedges to the ground floor through
  bbox contact with adjacent tall vegetation). Both fixes require re-running
  the pipeline and re-uploading the GLB.

## 2.30.2

- **Restores early scene preload (v2.29.0's approach, reverted in v2.30.1)
  as an explicit, informed trade-off** — the villa again starts loading
  (and decoding) as soon as the profile-select screen appears, on every
  platform except iOS (still excluded there for the separate, unrelated
  memory-ceiling crash risk — see the iPhone crash-loop investigation).
  This is a deliberate compromise, not a full fix: genuinely eliminating
  ALL main-thread blocking during that decode would require moving the
  entire Babylon rendering layer into a Web Worker via `OffscreenCanvas` —
  checked Babylon's actual support for this (Draco decode already runs in
  a Worker by default; the rest — glTF parse, GPU upload, Scene graph
  construction — does not, and this app's `src/babylon/` layer directly
  and synchronously manipulates the Scene from dozens of files) — a large,
  separate rewrite, not attempted here.
  - **What actually shrinks the freeze**: `SceneManager.loadModel` now
    yields the main thread (`await` a `requestAnimationFrame`) between its
    major top-level steps — after mesh cleanup/indexing, before
    `indexMeshes`, and again before `applyStructure` — instead of running
    the whole sequence as one unbroken block. Each individual step
    (especially `indexMeshes`, the single heaviest one) is still a solid
    synchronous stretch — this narrows the LONGEST uninterrupted freeze,
    it does not remove blocking entirely. Expect the profile-select/PIN
    screen to still stutter or briefly pause during a preload — for less
    total time and less continuously than v2.29.0, but not zero.
  - Added a disposal guard (`this.disposed` check after each yield) so a
    very fast unmount mid-preload can't operate on already-torn-down
    meshes.
  - `ProfileGate.tsx`: `modelPreloadable`/`showChildrenEarly` restored;
    `modelPrefetch.ts`: `onPrefetchAvailable` restored.

## 2.30.1

- **Reverted v2.29.0's early scene preload — it was freezing clicks on the
  profile-select/PIN screen**, the exact thing it was explicitly required
  not to do. Root cause: starting the model DOWNLOAD early (v2.28.0) is
  genuinely free — a plain background `fetch()` costs nothing while in
  flight. But v2.29.0 went further and started the actual Babylon scene
  DECODE early too (Draco decompression, GPU upload, this app's own
  mesh-indexing pass — the same 4.5-6.4 SECONDS measured in the v2.28.0/
  v2.29.0 investigation). That decode is synchronous, main-thread-blocking
  JavaScript — moving it earlier didn't make it non-blocking, it just moved
  *when* the freeze happened, from the (non-interactive) "Loading the
  villa" spinner to the (interactive) profile-select/PIN screen, freezing
  every click there for the full duration.
  - `src/components/auth/ProfileGate.tsx`: `children` (the real Babylon
    scene) once again only mounts after a real session exists (login, or an
    in-progress profile switch) — never before, on any platform. The
    byte-level prefetch (`src/utils/modelPrefetch.ts`, v2.28.0) is
    unchanged and still starts at the profile-select screen — it has no
    blocking cost, unlike scene/decode work.
  - `src/pages/Dashboard.tsx`: comment corrected back to reflect that
    `role` is genuinely always set when this page mounts again.
  - The `public_model_access` add-on option (v2.29.0) and its byte-level
    early-fetch benefit under the gated deployment are UNCHANGED and still
    work — only their bigger justification (early full-scene decode) no
    longer applies, so the option is now a much smaller optimization than
    originally advertised (saves a fetch that was already only 58-183ms).
    Left enabled as-is since it's still opt-in, still narrow, and still a
    real (if modest) win — worth reconsidering only if you'd rather not
    carry that trade-off for the smaller remaining benefit.

## 2.30.0

- **Fixed "can't get back to Home Assistant" on iPhone**, reported alongside
  black letterboxing (bars above/below the app) and a visibly stretched
  villa render — three symptoms of the same underlying cause on the HA
  Companion App's iOS Ingress webview:
  - **Added a guaranteed way out**: a new "Exit to Home Assistant" control
    (`src/ha/ingress.ts`'s `exitToHomeAssistant()`) navigates `window.top`
    back to HA's own UI — reachable from the profile-select screen, the PIN
    pad, AND the in-app HUD menu (mobile overflow + desktop), shown only
    under Ingress (there's nothing to "exit" to on the direct hostname/PWA).
    Doesn't depend on any native swipe gesture working at all.
  - **Likely root cause of why no gesture worked**: the kiosk's 3D view
    needs `touch-action: none` edge-to-edge for its own pan/orbit/pinch
    controls, which can also swallow whatever back-navigation gesture the
    embedding environment would otherwise offer — this is why an explicit
    in-app button, not a CSS tweak, is the reliable fix.
  - **Letterboxing**: `html`/`body`/`#root`'s `height: 100%` can resolve
    against a stale/wrong containing-block size on iOS Safari/WKWebView (a
    well-documented quirk, historically tied to address-bar-hide animations
    — and this app's `overflow: hidden` layout never gets the scroll event
    that normally lets the OS correct it). Added `100dvh`/`100dvw` (dynamic
    viewport units) as a second declaration alongside the `100%` fallback.
  - **Stretched render**: if the WebView's own container resizes without
    firing a `window` "resize" event (plausible in an embedded/native
    context), Babylon's render buffer can go stale relative to the canvas's
    actual CSS box, stretching the frame to fit. `SceneManager` now also
    watches the canvas element directly via `ResizeObserver`, which reacts
    to the element's own box changing regardless of whether `window` ever
    fires anything — a strictly more reliable signal than the existing
    `window resize` listener for this class of embedding-container resize.

## 2.29.1

- **Fixed a real regression v2.29.0 introduced on iOS.** A field report: a
  friend's iPhone hit the crash-loop guard (`SCENE_LOAD_CRASH_LOOP`,
  `Last load phase reached: import-mesh`) before ever reaching the PIN
  screen. This villa's GLB is known to exceed iOS Safari/WebView's per-tab
  memory ceiling during Draco decode + GPU upload (a pre-existing device
  limitation — see the earlier iPhone crash-loop investigation; the durable
  fix is a lighter GLB export, not something fixable in app code). Before
  2.29.0, that crash only happened after a deliberate login; 2.29.0's early
  scene preload (`modelPreloadable`) started attempting the SAME decode
  automatically the instant the profile-select screen appeared — so on a
  crash-prone villa, iOS now hit the failure immediately and repeatedly on
  every reload, with no user action at all, instead of only when someone
  chose to log in.
  - `src/components/auth/ProfileGate.tsx`: early scene preload now excludes
    iOS entirely (`isIOS()`, newly exported from `utils/diagnostics.ts`) —
    iOS keeps the pre-2.29.0 behaviour, loading only after login. Every
    other platform (desktop, Android, and iOS's own Safari-based
    `MacIntel`-with-touch detection aside) keeps the early-preload speedup.
  - v2.28.0's byte-level prefetch (`startModelPrefetch`) is UNCHANGED and
    still runs on iOS too — only the actual scene mount + decode is deferred
    there. Fetching bytes early is harmless (no memory pressure); decoding
    them is what risks the OOM.

## 2.29.0

- **v2.28.0's prefetch alone wasn't enough — field data explained why.** A
  user's real "Load time" breakdown (Advanced Settings → central model info)
  showed `fetch 58-183ms · parse 4.5-6.4s` — the network transfer was NEVER
  the bottleneck, even cold. The actual cost is Babylon decoding the GLB
  (Draco geometry + textures + GPU upload) plus this app's own mesh-indexing
  pass, and that only runs inside a live Babylon Scene — which didn't exist
  until after login, so prefetching bytes earlier had nothing to speed up.
  Waiting 30s+ on the profile-select/PIN screen made no visible difference,
  exactly as reported.
- **The villa can now start decoding — not just downloading — before login,
  while the user is still on the profile-select/PIN screen.** `ProfileGate`
  can now mount the real Babylon scene early (`modelPreloadable`, fed by
  `modelPrefetch.ts`'s `onPrefetchAvailable`) the instant it's confirmed
  `/model/` is actually reachable, instead of waiting for `role` to be set.
  `sceneConfig` is unfiltered while `role` is still null and reactively
  re-filters the moment login sets it (existing behaviour, unchanged) — and
  the opaque `.auth-screen` overlay means none of this is visible before
  login regardless, same protection the profile-SWITCH overlay already relied
  on. For an Owner login specifically (no role-based restrictions), the
  post-login re-filter is a no-op — the entire spinner can be absorbed before
  the PIN is even entered.
  - Under HA Ingress, `/model/` was already auto-trusted, so this "just
    works" immediately with no new exposure.
  - **On the direct/Cloudflare-gated deployment, this requires a real
    security trade-off**, so it ships OFF by default as a new opt-in add-on
    option: **`public_model_access`**. Enabling it makes `/model/` (the
    villa's floor plan) and `/addon-config` (its filename) reachable with NO
    session cookie at all — anyone who reaches the add-on's public hostname
    could download the raw GLB without ever entering a PIN. `/core/` (Home
    Assistant control) and the PINs themselves are NEVER affected — only
    those two routes. Intended for installs that already put something like
    Cloudflare Access in front of the whole hostname, so an unauthenticated
    visitor can't reach the add-on at all in the first place. See DOCS.md.
  - Backend: `supervisor-proxy.py` gains `_public_model_access()` /
    `_model_authorized()`, used only by `addon_config_handler` and
    `auth_check_handler` (which gates nginx's `/model/` location) — every
    other route (`/core/*`, `/model-upload`) is untouched and still requires
    a real session or Ingress regardless of this option.
  - Fixed a genuine latent bug surfaced while building this: `Dashboard.tsx`
    had role-capability checks that were already null-safe (`role != null &&
    …`), but a stale comment claimed "ProfileGate guarantees a signed-in role
    before this page mounts" — no longer true, updated to say so.

## 2.28.0

- **The central GLB now starts downloading in the background as soon as the
  profile-select screen ("Who's using the kiosk?") appears**, instead of only
  after the PIN is entered — cutting into the "Villa Loading" spinner's wait
  by however much of the download finishes during profile pick + PIN entry.
  Purely a background `fetch()` (`src/utils/modelPrefetch.ts`); no scene/DOM
  work happens until after login, so the gate screen itself stays exactly as
  responsive as before.
  - Under HA Ingress, `/model/` is auto-trusted (no session needed), so this
    starts at the very first frame, before any profile is even picked.
  - On the direct/Cloudflare-gated deployment, `/model/` requires a session
    cookie that doesn't exist yet at that point — the early attempt fails
    harmlessly and automatically retries at the earliest moment it's legally
    possible: right when a profile is confirmed (an un-PIN'd profile's tap,
    or a correct PIN), in parallel with — not sequentially after — the
    Dashboard/BabylonCanvas mount that would otherwise fetch it.
  - BabylonCanvas's real load path (`claimPrefetch`) reuses the in-flight or
    completed background download when the URL matches, and transparently
    falls back to a normal fetch whenever it doesn't (nothing prefetched yet,
    prefetch failed, or the model was replaced in between) — behaviour is
    identical to before whenever the prefetch can't help.
  - Fixed a latent caching bug surfaced while building this:
    `fetchAddonConfig()` used to cache ANY failure (including a 401 from
    calling it before login) as "no model exists," which would have
    permanently broken the real post-login call for the rest of the session.
    Now only a genuine 200 response is cached.

## 2.27.1

- **The "active/alert" red still looked visually different between the badge
  ring and the climate/room-glow overlays**, even after 2.27.0 unified the
  underlying colour constant. Root cause: the badge ring is a flat, fully-
  opaque 2D stroke, while the climate outline and room-presence glow are
  translucent 3D overlays blended with the surface beneath — same RGB value,
  very different rendered result (a pale wash instead of a clear red).
  RoomHighlight also had a second, compounding issue: its glow colour was
  scaled down to the same fraction used for its alpha blend (double
  dilution), on top of that translucency. Fixed by keeping the emissive
  colour at full intensity (translucency now comes only from
  `material.alpha`) and raising both the climate overlay's alpha (0.3 → 0.55)
  and the room glow's alpha range (0.28–0.5 → 0.5–0.75), so both now clearly
  read as red instead of pink.
- **Service worker now precaches the app's heavy content-hashed chunks**
  (Babylon engine, Draco decoder, HLS, app JS/CSS — ~7MB) at install time,
  in the background, instead of only reactively on first fetch. A new Vite
  plugin (`assetManifestPlugin` in `vite.config.ts`) emits
  `dist/asset-manifest.json` listing every `/assets/` file; `public/sw.js`'s
  install handler fetches it and warms the cache before the new service
  worker takes over. Previously, whichever kiosk open happened to be first
  after a deploy that changed one of those chunks paid its full download
  cost live, in the loading spinner — now that cost is absorbed in the
  background while the OLD version is still serving. (Investigated after a
  report that v2.27.0 felt slower to load; confirmed that release's actual
  code changes couldn't explain it — the Babylon/Draco chunk was
  byte-identical before and after — but this was a real, separate
  inefficiency worth fixing regardless.)
- **Reminder for the Guest Bathroom elevation fix (2.27.0):** that fix lives
  in the model pipeline script, not the app — it only takes effect after
  re-running the pipeline export and re-uploading the regenerated
  `rooms.json` (Advanced Settings → 3D model source → Upload room data).

## 2.27.0

- **Unified the "active/alert" red.** A room's presence-glow, a running
  climate device's mesh outline, and the badge's alert ring were each carrying
  their own independently hand-picked red — close but visibly different. All
  three now share one constant (`src/babylon/colors.ts`).
- **Fixed a room-presence highlight snapping to the wrong storey** for one
  specific room (reported: Guest Bathroom, while other 1F rooms were
  correct). Traced to the model pipeline's room-sidecar writer
  (`sources/blender_pipeline.py`, `_write_room_sidecar`): it computed each
  SweetHome level's 1-based floor number from **un-rounded** elevation
  floats, while every other floor-assignment path in the same pipeline
  (furniture, structural meshes) rounds first before comparing. A room drawn
  on a sub-level whose elevation differed from the primary level by a
  fraction of a centimetre — still the same physical storey everywhere else
  — could get written to the sidecar on a phantom extra floor, so its glow
  mesh got raycast against the WRONG storey's geometry
  (`SceneManager.estimateFloorY`) while its own furniture/entities (parsed
  through the already-correct rounded path) placed fine. Fixed by factoring
  level→floor resolution into one shared helper (`_level_floor_map`) used by
  both the sidecar writer and the furniture parser, so they can't drift
  apart again. **Requires re-running the model pipeline and re-uploading the
  regenerated `.rooms.json`** (Advanced Settings → 3D model source → Upload
  room data) for already-exported villas to pick up the fix — the GLB itself
  doesn't need to change.
- **Advanced Settings device editing felt laggy** — every click on a
  device's "Shown" checkbox, or a Type/Category/Room dropdown, patched
  config synchronously, which triggers BabylonCanvas's structural scene
  re-index (`SceneManager.updateConfig` → `indexMeshes` + `applyStructure`,
  a pass over every mesh in the loaded GLB to rebuild lights, fan rigs,
  cloned materials and shadow casters). On a villa-sized model this can
  block the main thread for a few seconds, during which the NEXT click
  (e.g. editing a second field right after the first) doesn't register
  until the rebuild finishes. `ConfigEditor.tsx`'s Label field and light-
  intensity slider already used a draft-locally/commit-after-a-pause
  pattern to avoid this per-keystroke; extended the same pattern to the
  Shown checkbox and every Type/Category/Room/motion-sensor field in both
  `ConfigEditor.tsx` and `BindingsTable.tsx` (the latter's Label/Room text
  inputs previously had no debounce at all). Controls now flip instantly via
  local draft state, and a quick run of edits on one device coalesces into a
  single rebuild instead of freezing once per click.

## 2.26.4

- **Daily auto-reload safety net** (`src/utils/autoReload.ts`) against a slow
  background memory drift measured on a real kiosk: ~700-800MB baseline
  (expected — a heavy 3D scene) plus a genuine but modest ~37MB/hour drift on
  top of normal GC sawtooth, confirmed via a lightweight `performance.memory`
  poll over ~2 idle hours (a full DevTools heap snapshot at that size crashed
  the tab outright, so this used the cheaper diagnostic instead). Rather than
  keep chasing the exact allocation site on a fielded device, the kiosk now
  reloads itself once a day, around 04:00 local device time, but only when
  idle — no panel/settings open, no interaction in the last 5 minutes;
  otherwise it retries each minute within that hour and simply skips the day
  if it never finds a safe moment. No re-login needed afterward (the profile
  role lives in sessionStorage, which survives a same-tab reload).

## 2.26.3

- **Fixed the real cause of a badge (and its icon) showing stale/default
  state after a fresh load.** BabylonCanvas's "paint the villa with whatever
  HA state is already known" step ran once, right after the model finished
  loading — but it read `entities` from a React effect with an empty (or
  otherwise narrow) dependency array, so it was permanently closed over
  whatever `entities` WAS at that effect's creation — almost always still
  `{}`, since HA's initial hydrate is an async round-trip that hasn't
  resolved yet at that point. Every badge/mesh therefore only ever got its
  first correct paint whenever HA happened to send THAT specific entity's
  next live `state_changed` event: instant for a frequently-updating entity,
  but left a slow-to-report one (e.g. a sensor that only updates every
  10–20 minutes) showing default/wrong visuals — including a generic icon
  instead of its real one — for a long time after the villa loaded. Root-
  caused with the user's own Home Assistant entity data (both compared
  sensors reported identical `device_class`/`unit_of_measurement`, ruling
  out an earlier device_class-based theory). Fixed by giving `useHA()` an
  imperative `getEntitiesSnapshot()` that's always current (backed by a ref
  kept in sync alongside the reactive `entities` state), and using it at
  both of BabylonCanvas's replay-all-known-entities call sites instead of
  the closed-over value. Scanned every other `entities` consumer in the app;
  this pattern was isolated to these two Babylon/React imperative-boundary
  call sites, nowhere else.
- **Sensor icon fallback for entities with no `device_class`** (a separate,
  smaller hardening — NOT the cause of the bug above, whose two sensors both
  had `device_class` set correctly): a plain `sensor` entity that omits
  `device_class` (some template/BLE/MQTT-bridged integrations do) now infers
  one from `unit_of_measurement` where that's unambiguous (°C/°F →
  temperature, W/kW → power, etc.) instead of always falling back to a
  generic gauge icon. The device panel's header icon for a plain sensor now
  resolves the same way (previously hardcoded to a generic icon regardless
  of type), so the badge and the panel it opens always agree.

## 2.26.2

- **Real-sun fallback effect no longer re-runs on every entity in the house.**
  It depended on the whole `entities` map, which gets a new object reference
  on every single `state_changed` event anywhere in HA (see HAStateStore's
  setEntities) — so an effect meant to check `sun.sun` once and otherwise
  refresh hourly was actually tearing down and recreating its interval on
  every unrelated sensor update. Now depends on `entities["sun.sun"]`
  specifically. Found while investigating a reported >1GB, still-growing tab
  memory footprint — a real inefficiency, not confirmed as the full
  explanation; investigation continues.

## 2.26.1

- **`.dockerignore`: exclude `sources/`** — the model-pipeline working
  directory (source GLBs/SweetHome exports/Blender intermediates, 1.6GB+
  locally). It's gitignored and never read by the Dockerfile, but wasn't
  excluded from the Docker build context, so a local `docker build` was
  sending the whole thing to the daemon and copying it into the build stage
  via `COPY . .` on every build. CI is unaffected (the checkout never has
  `sources/`); this only speeds up the "Local build fallback" path in
  ADDON.md. Also excluded the small `dist.zip` for the same reason.

## 2.26.0

- **Device panel redesign.** The header/footer and every panel's "Last 24
  hours" section were reworked together:
  - The footer **Close** button is gone; every panel now has a plain **X** in
    the top-right of the header instead (Escape and backdrop-tap still close
    it too). The footer, when a profile can edit config, is just **Edit**,
    right-aligned.
  - A long device name no longer wraps onto a second line — it truncates with
    an ellipsis, same as the entity id already did below it.
  - Removed the small "N entities grouped as one device…" / "Updated …" /
    "Running for …" footnotes — the freed space goes to a taller, more
    readable graph (all "Last 24 hours" graphs are ~30% taller).
  - **Every panel now shows a "Last 24 hours" history graph**, not just
    numeric sensors: Light, Fan, Switch, Lock and Cover previously had none at
    all — they now get a coloured **state timeline** (a new `StateTimeline`
    component) showing exactly when the device was on/off, locked/unlocked,
    open/closed, etc. The generic fallback panel (used for entity types with
    no dedicated panel) gets one too, colour-coded per distinct state with a
    legend. (Out of scope for now: Climate and Media Player, which already
    show several live attributes and would need a genuinely different kind of
    graph — current vs. target temperature, mode changes, playback state —
    to be useful rather than just tall.)
  - **Fixed a real bug this surfaced**: a plain `sensor` whose state is text,
    not a number (e.g. a network device reporting "connected"/"disconnected"),
    always showed "Not enough history yet" — `fetchHistory` silently drops
    every point that doesn't parse as a number, even though Home Assistant
    held real history for it. Such a sensor now takes the same raw
    state-history path as the new StateTimeline (see `fetchStateHistory`),
    which keeps text states instead of numeric-parsing them, and renders a
    timeline colour-coded per distinct state instead of an always-empty line
    graph.

## 2.25.1

- **No more "rendered but frozen" gap after loading a model.** The central
  room-data (`.rooms.json`) sync used to run AFTER the villa was revealed, and
  applying it triggers one heavy structural rebuild (re-index + re-calibrate
  over every mesh) — so the map looked ready but was unclickable for a few
  seconds. It now runs BEHIND the loading overlay (before reveal), so the villa
  only appears once it's actually interactive. And because `parseRoomData`
  returns fresh arrays each open, the old reference-compare forced that rebuild
  on *every* load even when nothing changed; it's now a content-compare, so an
  unchanged plan (the common re-open case) skips the rebuild entirely — no
  delay at all. A missing/slow sidecar never blocks the reveal (5s timeout).
- **Model info (i) shows the real uploaded filename.** The "GLB" row displayed
  the managed on-disk name (`villa.glb`) — which always looked the same
  whatever you uploaded — instead of the file you picked. It now shows the
  original uploaded name (e.g. `villa_2F_4096_no-bake.glb`) in full, with its
  upload time; it's still stored/served as `villa.glb` (shown in the "From" URL
  and explained in the footer).

## 2.25.0

- **Never get stuck in a silent reload loop; copyable error reports.** A too-heavy
  GLB can exceed iOS Safari / WKWebView's per-tab memory ceiling and get the
  page killed by the OS mid-load — which iOS then silently reloads, crashing
  again in an invisible loop (reported: an iPhone looping right after the PIN,
  while the same model is fine on Android and macOS Safari). That OS-level kill
  is not catchable in JS, so instead the app now **detects the reload-loop
  pattern** (load attempts tracked in localStorage, which survives the crash)
  and, after a few rapid failures that never reached "ready", stops and shows a
  diagnostics screen instead of loading again. Every *catchable* failure too
  (WebGL unavailable, model fetch 4xx/5xx, Draco/parse errors, lost WebGL
  context, render exceptions) now lands on the same screen with a **"Copy error
  details"** button that copies a full report — app version, error code +
  message + stack, the furthest load phase reached, model path/size, device +
  display, JS heap (where exposed), and WebGL renderer/limits — so a kiosk user
  with no devtools can paste it back for troubleshooting.
  - Note on the trigger: a baked (`--bake`) GLB is NOT incompatible with iPhone,
    and the light-atlas/bake size is irrelevant here — it's total geometry +
    texture memory. A 2-storey baked export can be ~7× the vertices of a
    single-floor one (millions of verts, Draco decode spike, a 2nd lightmap UV
    set); that peak is what iOS kills. Fix is a lighter GLB (more decimation /
    fewer-smaller textures), which the diagnostics screen now guides toward.
- **Overview: two-finger trackpad slide no longer inverts up/down.** A wheel
  reports *scroll* deltas, whose vertical sign is opposite a pointer *drag*'s, so
  a no-click slide panned the map up/down backwards vs. click-drag. Vertical is
  now negated to match the drag; left/right (already correct) is untouched, and
  it stays consistent whether the Natural Scrolling toggle is on or off.

## 2.24.0

- **One app, two front doors — with real auth on both.** The kiosk is now a
  single build served entirely by the add-on, reachable in the HA sidebar
  (Ingress) **and** directly on the add-on's own host port 8099 (e.g. via a
  Cloudflare Tunnel) as a full-screen installable PWA. The separate "standalone"
  deployment (copying `dist/` into HA's `www/` and opening it via `/local/`) is
  gone, along with all the two-mode branching (`isIngress()`), the
  Home-Assistant-URL/long-lived-token onboarding screen, and the env-baked
  `VITE_*_PIN` courtesy gate.
- **Security: the Supervisor proxy now authenticates every sensitive request.**
  Previously the proxy handed out `SUPERVISOR_TOKEN`-level Home Assistant access
  to anything that reached `/core/`, safe only because nginx refused everything
  but the Ingress gateway. Exposing the port directly made the client-side-only
  profile PIN insufficient, so a correct passcode (verified server-side) now
  mints a **signed, httpOnly session cookie**, and `/core`, `/model`,
  `/model-upload` and `/addon-config` refuse any direct request without it.
  Requests arriving through Ingress stay exempt (HA already authenticated them),
  identified by a source-IP-derived `X-VK-Ingress` header nginx sets and the
  client cannot forge. Static model files are gated via an nginx `auth_request`.
- **The 3D model moved into the add-on's own `/data` volume.** It's no longer
  written to HA's `www/` folder and is never exposed on HA's unauthenticated
  `/local/` static route. The `model_path` option is removed (nothing to
  configure — upload once from **Advanced Settings** on the Owner profile), and
  the add-on **no longer requests write access to your HA config directory**
  (`homeassistant_config:rw` map dropped).
- **PWA installs at `/`** on the direct hostname (cleaner service-worker scope
  than the old nested `/local/villa-kiosk/dist/` path); the sidebar path still
  skips the service worker as before.

### After updating

Set at least one profile passcode in the add-on options before mapping port
8099, add a Cloudflare Tunnel host pointing at `http://<HA-host-ip>:8099` (drop
the old Worker redirect to `/local/...`), and re-upload your GLB + `.rooms.json`
once from Advanced Settings so they land in the new `/data` store.

## 2.23.42

- **Onboarding collapsed from 4 steps to 1.** The "3D model" and "Location"
  steps were pure information/confirmation with nothing to actually enter —
  the model has auto-detected the add-on's central GLB/room-data with no
  upload needed since 2.23.28 (confirmed unchanged; BabylonCanvas already
  handles this independently of onboarding, including its own inline
  uploader for the rare case nothing central is found), and the location
  silently adopts the connected HA instance's own lat/lng a moment after
  connecting, with no confirmation screen needed. Onboarding is now just:
  Home Assistant URL + long-lived token, one screen, one button. Add-on
  (Ingress) mode shows no fields at all, same as before — it still connects
  automatically.
- **The HA URL field now prefills a real guess** instead of starting blank:
  it derives `ha-<this page's own hostname>` from the page's own address —
  matching the split-subdomain Cloudflare Tunnel convention this app's own
  docs/runbook uses (kiosk at the bare domain, HA at the same domain with an
  `ha-` prefix) — e.g. opening the kiosk at
  `.../local/villa-kiosk/dist/index.html` on `villa.example.com` prefills
  `https://ha-villa.example.com`. Skipped for a bare LAN IP or `localhost`
  (no `ha-` sibling to guess there), left blank as before.

## 2.23.41

- **Security: removed the env-configurable HA URL/token default entirely.**
  A build-time `VITE_HA_URL`/`VITE_HA_TOKEN` default gets baked as plain
  text into the compiled JS bundle — for a standalone deploy that's a
  public static file, so a real long-lived token ending up there is a live
  credential leak to anyone who can fetch it (confirmed in the field: a
  Cloudflare-tunneled instance with no auth in front of `/local/` had its
  token sitting in plain text in the deployed bundle). `haUrl`/`haToken`/
  `haPort` are now always empty defaults, entered once per physical device
  via the Onboarding wizard only — never baked into a build again. Deleted
  the local `.env` that had these set, and stripped the mechanism from
  `AppConfig.ts`/`vite-env.d.ts`/`.env.example`. Villa GPS
  (`VITE_LAT`/`VITE_LNG`) and standalone profile-PIN env vars are unrelated
  (non-secret / already documented as a courtesy gate) and unchanged.

## 2.23.40

- **Mobile top bar: the overflow (⋮) menu button now lives inside the same
  pill as the label-size −/+ buttons**, instead of standing alone in its own
  section — reads as one continuous button group. That combined group (not
  the category filter row next to it) now sits flush against the right edge
  of the screen, matching where the standalone ⋮ button used to be.

## 2.23.39

- **Fixed: a device badge next to another closely-mounted fixture (e.g. a
  ceiling fan and its own temperature sensor) looked like it shrank when it
  lost its value pill (fan turned off).** Root cause, confirmed from two
  same-camera-position screenshots: the anti-overlap "declutter" pass only
  reserved pill-sized collision clearance around a badge while it *currently*
  had a pill showing — the moment the fan's pill disappeared (turned off),
  its collision box shrank, so it got pushed apart from its neighbour less
  than before and ended up nearly overlapping it, reading as "got smaller."
  Clearance is now reserved for any entity type that can *ever* show a pill
  (light/fan/cover/climate/sensor), regardless of whether it has one at this
  exact moment — so two such fixtures keep the same spacing no matter which
  one currently has a reading to display.

## 2.23.38

- **Onboarding (standalone): the HA URL/token fields were pre-filled from
  the local `.env` used to build the app** — including, on this machine, a
  real long-lived token, which meant every standalone build shipped it
  baked into the client JS. Cleared `VITE_HA_TOKEN` (token is meant to be
  entered per-device, never baked in) and pointed `VITE_HA_URL` at the
  villa's actual domain.
- **Settings (standalone): "Test connection" now sits on the same line as
  the token field**, instead of as its own full-width button below.
- **Settings: removed two redundant description paragraphs** ("Pick a
  quality preset…" under Render quality, "How the walk-through camera
  feels…" under First-person view) — both restated what the controls right
  below them already make obvious.
- **Advanced Settings reshuffle:**
  - The model (i) icon now sits inline with the "3D model source" title
    instead of on its own row underneath.
  - "Bound 3D objects" moved below "Grouped devices".
  - The villa-location description moved below the latitude/longitude
    fields instead of above them.
  - The device-group "+ Create" button restyled to match the other ghost
    buttons (was solid accent) — same size/position.
- **Fixed: the HUD's mobile overflow ("⋮") button rendered at 48px instead
  of the intended 32px**, taller than every other top-bar button next to
  it. `.hud-right .icon-btn { width: 32px; height: 32px; }` and
  `.hud-group .icon-btn { width: 38px; ... }` are equal-specificity (2
  classes each) and source order between them isn't something to keep
  relying on across edits — added an unambiguous, higher-specificity
  `.hud-right .hud-overflow .icon-btn` rule so it can't regress again.

## 2.23.37

- **Memory-leak / GPU-context audit + fixes — the real cause of the growing
  reload time when switching HA sidebar panels back and forth.** When Home
  Assistant re-navigates the Ingress iframe, the old document is discarded
  WITHOUT React unmounting, so `SceneManager.dispose()` never ran and each
  visit's WebGL context (tens of MB of decoded textures + geometry on the
  GPU) lingered until GC. Chrome caps live WebGL contexts (~16) and thrashes
  as they accumulate — which is what ballooned model texture-upload
  ("import") time on repeat opens (5s → 22s → 25s). Fixes:
  - Dispose the Babylon engine on `pagehide` (fires when a document is
    discarded, unlike React unmount) — and explicitly force
    `WEBGL_lose_context` so the driver frees GPU memory immediately rather
    than waiting for GC. Guarded against bfcache restores (`persisted`).
  - Made `SceneManager.dispose()` idempotent (pagehide + React unmount can
    both fire) and exhaustive: it now also disposes `EntityVisuals` (which
    owns a fullscreen GUI texture + per-entity lights/shadow maps and
    previously had NO dispose() and was never torn down) and clears the
    module-level `LightPools` gradient-texture cache.
  - Fixed `HAWebSocket` leaking its `visibilitychange`/`online` document/
    window listeners (anonymous, never removed); `disconnect()` now removes
    them and rejects pending calls, and `HAStateProvider` disconnects the
    socket on unmount (previously the socket, its reconnect/heartbeat timers
    and those listeners were never cleaned up).

## 2.23.36

- **Standalone no longer shows "Upload central GLB"/"Upload room data" at
  all.** They were disabled-with-explanation there (no backend to accept an
  upload from a static page), but a permanently non-functional button reads
  as broken rather than as an intentionally-explained state — confirmed via
  fresh-tab load-time testing that the earlier ~25s numbers were a Home
  Assistant Ingress-panel-navigation artifact, not a real bug, so this is
  purely a UI streamlining pass. Import/Export Configuration stay, since
  those work identically everywhere.

## 2.23.35

- Widened the model (i) tooltip 50% (340px → 510px cap) — confirmed
  rendering correctly (right direction, right position) after 2.23.34's fix;
  the extra width is just breathing room for its long `From`/SHA-256 rows.

## 2.23.34

- **Fixed: the model (i) tooltip's real bug — it opened the wrong direction,
  not just the wrong size.** `max-height` alone can't rescue a popover
  anchored `bottom: calc(100% + 8px)` above a button that sits near the TOP
  of the panel with little room above it — part of the box still renders
  above the browser viewport's own top edge, which no CSS overflow rule can
  reveal (it isn't the modal clipping it; it's off the physical screen).
  Flipped to open downward (`top: calc(100% + 8px)`), into the rest of the
  scrollable modal body where there's actually room.
- **Split "Load time" into import vs. post-processing**, to find out what
  the ~29s parse time (reported identically in both add-on and standalone —
  confirming it's not a caching issue) is actually spent on: Babylon's own
  `SceneLoader.ImportMeshAsync` (glTF parse, Draco decode, every texture
  decoded + uploaded to the GPU) vs. this app's own post-import mesh
  indexing/structure setup. Expect nearly all of it to be `import` — a
  lightmap-mode GLB keeps every original tiled texture instead of one atlas,
  so texture decode/upload is the likely dominant cost, not app JS.

## 2.23.33

- **Fixed: the model (i) tooltip still overflowed, now off the TOP of the
  screen.** 2.23.32 fixed the left/right overflow, but the tooltip has grown
  to 7+ rows plus a paragraph — tall enough that opening upward from a
  button positioned low in the panel pushed its earliest rows (including
  the new "Load time" one) above the top of the viewport, with nowhere to
  go and no way to reach them. It's now capped at `min(60vh, 420px)` and
  scrolls internally, so every row is always reachable.
- **Fixed: the disabled "Upload central GLB"/"Upload room data" buttons in
  standalone had no visible explanation.** Their `title` tooltip never
  actually showed — `.btn:disabled` sets `pointer-events: none`, which also
  blocks the hover needed to trigger it. Wrapped in a plain (non-disabled)
  span instead, so hovering the greyed-out button now shows why it's
  disabled there.

## 2.23.32

- **Fixed: the model (i) tooltip overflowed off the left edge of the
  screen.** After 2.23.28 moved the (i) button to sit alone at the left of
  its row (dropping the green status line it used to pair with), the
  popover's `right: 0` anchor — a leftover from when the button sat at the
  right end of a spread row — pushed the whole 340px popover off-screen to
  the left. Now anchored `left: 0` (opens rightward, toward the available
  space) instead.
- **Standalone's 3D-model UI now shares the SAME row of actions as the
  add-on's, in every case, not just when a central model is already
  found.** Previously standalone had its own, differently-labelled
  "Configuration backup" section instead of the add-on's combined
  Upload/Import/Export row; now it's the exact same `ModelActionsRow` in
  all three states (central model found, ingress-with-none-yet, and
  standalone-with-nothing-central), with only "Upload central GLB"/"Upload
  room data" disabled (with an explanatory tooltip) where there's no
  backend to accept them. One shared component instead of parallel,
  drifting copies.
- **Added the running app version to the Advanced Settings footer**
  (bottom-left), baked in at build time from `package.json` — the same
  mechanism briefly used for camera-bug diagnostics in 2.23.26 and removed
  afterward, reinstated here as a permanent, always-visible feature instead
  of temporary scaffolding.

## 2.23.31

- **Fixed: standalone (dist copied into HA's own `www/` folder) didn't
  auto-detect a central model with a custom `model_path`.** 2.23.28's
  auto-detection only ever probed the conventional default path
  (`villa-kiosk/villa.glb`), so an add-on configured with a custom-named GLB
  (the common case — the Blender pipeline names files after the bake, e.g.
  `villa_2F_4096_bake-....glb`) was invisible to it, silently falling back to
  the old per-browser upload UI. The add-on now mirrors its real effective
  config into a small static JSON file inside the same `www/` folder it
  already serves (`villa-kiosk/addon-config.json`, refreshed on startup and
  after every upload) — standalone reads that directly over plain HTTP
  instead of guessing a path, so it picks up the actual configured model
  (whatever it's named) exactly like the add-on's own `/addon-config` route
  does.

## 2.23.30

- **Added a fetch-vs-parse load-time breakdown to the model (i) tooltip**
  (Advanced Settings → 3D model source), to tell apart "still re-downloading
  the GLB" from "Babylon is just slow to parse/build the scene" — the still
  reproducing "I see the spinner every time I reopen" report needs this to
  diagnose further, since `devLog` (used for earlier debugging arcs) is
  compiled out of production builds and useless on a real deployed add-on.

## 2.23.29

- **Fixed: camera panel's close/fullscreen buttons weren't clickable while an
  HLS feed was showing.** 2.23.27's instant-snapshot-preview overlay
  (`.camera-hls-wrap`) spans the whole panel (`inset: 0`) and, unlike the
  loading spinner it sits next to, was never given `pointer-events: none` —
  so it silently ate clicks over the buttons in the top-right corner even
  though nothing was painted there.
- **Model reload speed: closed two real gaps in the GLB/room-data caching.**
  The bytes are meant to be cache-first (service worker, see `sw.js`) so a
  repeat app open shouldn't re-download a many-MB GLB at all — but 2.23.28's
  standalone `/local/` path was never added to the service worker's
  model-cache matcher (it only recognized Ingress's `/model/` prefix), so a
  standalone build silently fell back to a much weaker cache strategy.
  Separately, `versionedModelUrl`'s freshness check (a HEAD request every
  open, to detect a replaced file) previously fell back to a bare,
  never-cached URL on ANY hiccup (slow tunnel, dropped request) — forcing a
  full re-download for what's often a single flaky request. It now
  remembers the last tag that worked and reuses it when the live probe
  fails, so a transient hiccup no longer defeats the cache. Note: this only
  addresses the network transfer — Babylon still has to parse the GLB and
  build the scene/GPU resources on every fresh page load, which is CPU-bound
  and unrelated to caching.

## 2.23.28

- **Standalone (dist copied into HA's own `www/` folder) now auto-loads the
  SAME central GLB the add-on manages, instead of needing its own per-browser
  upload.** The add-on's `/model/` route is just an nginx alias onto the same
  `www/` folder HA itself serves at `/local/` — so a standalone build probes
  `/local/villa-kiosk/villa.glb` directly and, if found, loads and manages it
  exactly like the add-on does (same info tooltip, same background room-data
  sync), with per-browser upload only offered as a fallback when no central
  model is found. The onboarding wizard's "3D model" step picks this up
  automatically (it already keyed off the same central-model check) and skips
  straight past the upload step, matching the add-on's onboarding UX.
- **Advanced Settings: model/configuration actions consolidated onto one
  row.** Import/Export Configuration moved out of the header and next to
  Upload central GLB/room data, both now labelled instead of icon-only.
  Removed the redundant "✓ Central model active — all clients share the same
  view" line (the (i) tooltip already says as much). The (i) tooltip now
  leads with the latest SH3D plan's name and upload date/time.
  (`.rooms.json` generation itself was deliberately kept, not folded into
  Import/Export Configuration — it's live room-polygon/entity-calibration
  data that auto-syncs to every kiosk in the background, unlike the
  per-device preference backup those buttons carry.)

## 2.23.27

- **Instant snapshot preview while HLS sets up, so the first open of a camera
  doesn't sit on a bare loading spinner.** HA has to spin up its own FFmpeg
  stream worker on a camera's first HLS request each session, which can take
  several seconds — long enough to read as "slow" even though it's working
  as intended (subsequent opens of the same camera reuse the worker and are
  fast). The `hls` tier now overlays the near-instant snapshot image (already
  polled every 800ms) on top of the `<video>` element until it paints its own
  first frame, then the overlay disappears with no visible transition since
  the video is already decoding underneath by that point. Scoped to the HLS
  tier only; MJPEG/snapshot fallback behavior is unchanged.

## 2.23.26

- **Camera HLS streaming confirmed working — removed the temporary
  diagnostics and finalized.** Field-confirmed smooth on Chrome and desktop
  Safari via hls.js after 2.23.25's fix. Stripped the on-screen stream-tier
  diagnostic overlay, the transition-log state, and the build-version stamp
  (`__APP_VERSION__` in vite config) that were added to hunt the root cause.
  The three-tier fallback (HLS → MJPEG → snapshot), the loading spinner, and
  the hls.js-driven fallback all stay; failure reasons now go to `devLog`
  (visible only with the `?debug` flag) instead of an on-screen overlay.

## 2.23.25

- **ROOT CAUSE of the camera lag found and fixed — the stream was never
  using hls.js at all.** The 2.23.24 diagnostics were conclusive:
  `HLS capability: native=true hlsJs=true`, then on Chrome
  `mediaError=4/DEMUXER_ERROR_COULD_NOT_PARSE`. Chrome's
  `video.canPlayType("application/vnd.apple.mpegurl")` returns a truthy
  "maybe" but Chrome **cannot** actually play HLS natively — and the old
  code preferred that false-positive native path, so it set `video.src`
  directly and hls.js never ran. That's why none of the previous
  hls.js-side fixes changed anything: they were fixing code that was never
  executing on these browsers. Desktop Safari hit the same thing (native
  path, silent timeout) — native HLS is unreliable through the
  Ingress→Supervisor→tunnel proxy chain (almost certainly a `Content-Type`
  the native player rejects), which is exactly why pasting the raw URL into
  a tab worked while in-app playback didn't. Flipped to the canonical
  hls.js selection order: **use hls.js whenever `Hls.isSupported()`**, and
  fall back to native HLS only when it can't run (real iOS Safari, no MSE).
  hls.js fetches the playlist/segments over XHR and feeds MediaSource
  itself, ignoring Content-Type — the same approach Home Assistant's own
  frontend uses, which is why it works there. This should finally make the
  camera feed smooth on Chrome and desktop Safari.

## 2.23.24

- **Camera diagnostic: confirmed 2.23.23 IS the running build, and the
  failure is still identical — so this round adds no behaviour change,
  only more precise instrumentation.** By the current code, `usingHlsJsRef`
  must already be `true` by the time playback starts, and nothing resets
  it afterward, so the guard should already prevent this. Since it
  evidently doesn't, guessing a sixth fix isn't the right move — the log
  now shows, unconditionally, which capability branch was actually taken
  (`HLS capability: native=... hlsJs=...`) and the exact decision state at
  the moment of any video error (`usingHlsJs=...`, plus the native
  MediaError code/message, which nothing so far has captured). The next
  report should make the actual mechanism unambiguous.

## 2.23.23

- **Camera diagnostic now shows exactly which app build is running.** After
  four fix attempts in a row produced byte-identical failure logs — despite
  2.23.22 changing the actual guard logic in a way that should make the
  reported failure structurally impossible once playback starts — the most
  likely explanation is that the fix isn't reaching the browser at all,
  possibly tied to the same Supervisor-sync issue behind the `sh3d_path`
  warning (2.23.21) where the Update button doesn't reliably register. The
  diagnostic's first line now reads "App X.Y.Z · Now: ...", baked in at
  build time from package.json, so the next report will show at a glance
  whether the running build is current — before spending more time
  theorizing about app logic that may not even be deployed yet.

## 2.23.22

- **Fixed the actual HLS teardown race this time (hopefully) — the field
  log finally showed the real order.** The diagnostic showed the native
  video error firing BEFORE the effect's own teardown log, proving the
  2.23.20 theory had cause and effect backwards: the error wasn't caused by
  a stray reconnect tearing anything down, it was a genuine native error
  slipping through the `usingHlsJsRef` guard from 2.23.19. Found why: that
  ref was being reset to `false` at the START of every attempt, then only
  set back to `true` after TWO awaited async calls (a dynamic import, then
  a websocket round-trip) — a real window where a native error could land
  ungated. Since which HLS path a browser uses never changes within a
  session, there was never a reason to reset it in the first place — once
  set true, it now stays true for the component's whole lifetime.
- **Fixed add-on shutdowns getting SIGKILLed (exit 137) instead of exiting
  cleanly on stop/restart/update.** `aiohttp.web.run_app()`'s own
  `shutdown_timeout` defaults to 60 seconds — on SIGTERM it waits that long
  for in-flight connections (including the kiosk's long-lived proxied
  websocket to HA Core, which never closes on its own during a stop) to
  finish naturally before exiting, far past Supervisor's and s6-overlay's
  own much shorter grace periods before they escalate to SIGKILL. Set it to
  3 seconds — comfortably under both — so the add-on can actually exit
  promptly on its own instead of needing to be force-killed every time.

## 2.23.21

- **Self-heal a stale `sh3d_path` add-on option left over from before
  central-model hosting.** That field was dropped from `config.yaml`'s
  schema (replaced by `model_path`), but Supervisor persists an add-on's
  raw configured options independently of the current schema — any install
  that had ever set `sh3d_path` kept it forever, and Supervisor
  re-validates against the current schema on basically every poll/reload
  cycle, logging `Option 'sh3d_path' does not exist in the schema`
  continuously. That kind of persistent validation error is a known way
  for Supervisor/Core to lose sync on the add-on's state (e.g. the Update
  button not registering as clickable until a full HA restart). The add-on
  now checks its own stored options against the current schema on every
  startup and writes back only the known-good keys if it finds anything
  stale — self-heals on the next add-on restart/update, no manual options
  edit needed.

## 2.23.20

- **Found the actual root cause of the recurring "HLS playing" → "HLS
  failed: Video element error" bug.** The HLS setup effect was keyed on the
  HA websocket's live `connected` state; any brief reconnect blip (harmless
  to everything else) tore down and rebuilt the whole effect — including
  resetting the "is hls.js this attempt's player" guard added in 2.23.19
  back to its default BEFORE the new attempt had picked a path again. A
  stale, asynchronous error from the previous hls.js instance's own
  teardown could then land in that narrow window and get misread as a
  fatal native-video error, killing a stream that was actually still
  healthy. Removed `connected` as a dependency: the websocket is only
  needed for the one-time stream-URL request, which already fails
  gracefully and falls back on its own if it isn't connected at that
  moment — there was no reason to also tear down an already-playing stream
  over a later blip. Also added a diagnostic line that fires if a
  teardown-while-healthy ever happens again, so the next report is
  conclusive either way.

## 2.23.19

- **Fixed: 2.23.18's fix for the same bug still misfired.** Confirmed in
  the field — the exact same `HLS playing` → `HLS failed: Video element
  error` sequence recurred. The guard added in 2.23.18 checked
  `hlsInstanceRef.current`, but that ref gets nulled out *during* cleanup
  while the native `<video>` error it triggers (both hls.js's own
  `destroy()` and the old manual `video.load()` cause one) only fires
  *afterward*, asynchronously — by the time it arrives the ref was already
  gone, so the guard never actually protected anything. Replaced it with a
  dedicated ref that records "is hls.js this attempt's player" once, for
  that attempt's entire lifetime, untouched by cleanup/teardown timing —
  so it can't lose the race the way a ref that teardown itself clears can.

## 2.23.18

- **Fixed: HLS camera streams that connected successfully were getting
  killed moments later by the app's own code.** Confirmed in the field —
  the diagnostic log showed `HLS playing` immediately followed by `HLS
  failed: Video element error`. The cleanup effect was unconditionally
  calling `video.load()` even when hls.js was managing the element; hls.js's
  `destroy()` already detaches its MediaSource cleanly, and the extra manual
  `load()` on top of that fires a native `<video>` error purely from that
  teardown, which was then misread as a real playback failure and
  permanently dropped to MJPEG/snapshot. Also stopped treating a native
  `<video>` error as fatal at all while hls.js is in control — it reports
  its own errors through a separate, more reliable channel, and a native
  error surfacing during hls.js-driven playback can just be its own internal
  recovery churn. Native HLS (Safari/iOS) is unaffected — it still clears
  its own `src` on cleanup, since there's no hls.js instance managing it.

## 2.23.17

- **Camera watchdogs made much more generous (HLS 4s → 15s, MJPEG 1s →
  6s).** Diagnostic screenshots across three different cameras all showed
  the identical pattern: a correctly-formed, unique HLS URL each time, then
  complete silence — not even a fast error — for the whole old 4-second
  window. That reads as "still starting up" (HA has to spin up an FFmpeg
  stream worker on the first request for a camera, and this setup routes
  through an external tunnel on top of the usual Ingress → Supervisor →
  Core hops) rather than "broken". Safe either way — the same MJPEG/
  snapshot fallback chain still applies if it's still not enough.

## 2.23.16

- **Camera diagnostic: added the exact HLS URL + first hls.js warning to
  the trace.** Testing showed both HLS and MJPEG hanging completely
  silently (no error, just nothing arriving before their timeouts) — only
  snapshot polling ever got data. The log now shows the exact URL asked for
  (`HLS url: ...`, the single most useful line for spotting a wrong path)
  and, if hls.js is stuck retrying the same recoverable error for the whole
  watchdog window, its first warning with the failing URL and HTTP status.
- **Fixed a real secondary bug**: `video.play()` was being called
  immediately after attaching the HLS stream, before hls.js had parsed
  anything — moved to fire after the manifest is actually parsed (the
  correct hls.js pattern), since calling it too early can silently swallow
  playback instead of resuming once data arrives.

## 2.23.15

- **Camera diagnostic now shows the full transition trace, not just the
  latest overwritten line.** The tiers can fall through fast enough (HLS →
  MJPEG → snapshot in under a couple seconds) that a single status line
  never got read before the next fallback replaced it — confirmed by
  testing, where the actual HLS failure reason flashed by unseen. It's now
  an accumulating log for the life of the panel, plus a line each time a
  tier actually starts painting real frames.

## 2.23.14

- **Camera panel: fixed the "broken feed" look during stream setup.** An
  empty `<video>` element with no source yet (the first couple seconds
  while HLS connects) rendered as a blank/broken frame — now covered by a
  loading spinner until a real frame actually arrives, on any tier.
- **Added a temporary on-screen diagnostic** at the bottom of the camera
  view showing which tier ended up active (HLS / MJPEG / snapshot) and, if
  it fell back, why — readable straight off the kiosk screen, no devtools
  needed. Meant to pin down why camera feeds still felt laggy after 2.23.13;
  will be removed once that's confirmed fixed.

## 2.23.13

- **Per-light intensity override.** Light entity cards in Advanced Settings
  (both "Auto-detected entity settings" and "Bound 3D objects") now have a
  -100%..+100% slider that multiplies on top of that light's live Home
  Assistant brightness and the global "Light effect strength" setting — lets
  one fixture be tuned brighter or dimmer than its dimmer level alone would
  produce, without touching every other light. Dragging is debounced the
  same way the Label field is, so it doesn't trigger a full re-index per
  pixel of drag.
- **Camera streams now try HLS first, before falling back to MJPEG then
  still-image polling.** This app only ever used MJPEG (`camera_proxy_stream`)
  — HA's own frontend prefers HLS for any camera that supports the stream
  pipeline (most modern RTSP/ONVIF cameras do), since MJPEG makes HA
  continuously re-decode and re-encode every frame as a JPEG server-side.
  That mismatch is the likely cause of camera feeds looking laggier here
  than in the HA UI for the same camera. Added via `hls.js`, lazy-loaded
  only when a camera panel actually opens so it doesn't affect the app's
  normal startup bundle; falls straight through to the existing MJPEG/
  snapshot chain on any failure, so this can't regress cameras that don't
  support HLS.

## 2.23.12

- **Fixed: a light left on upstairs stayed visibly lit (floating,
  unoccluded) even while viewing the floor below.** In baked-lighting
  villas, a lit fixture's floor "pool" glow (`LightPools.ts`) is a
  freestanding decal mesh created at runtime — unlike the fixture itself,
  `FloorManager` never indexed or toggled it per floor. Each pool's on/off
  state is now derived from its fixture mesh's live enabled state (which
  FloorManager keeps floor-correct), re-synced on every floor switch, HA
  state change, and "Light effect strength" slider move.

## 2.23.11

- **Fixed: 2F ceiling fan's badge showing on 1F too.** A side effect of
  2.23.7's fan-label fix: `cullLabels()` decided a badge's floor visibility
  by reading `floorIndex`/enabled-state off the badge anchor's OWN parent —
  correct for every normal entity (its anchor is parented straight to its
  mesh), but the fan's anchor is deliberately detached onto its spin pivot's
  non-rotating parent (a shared container FloorManager never touches, so it
  reads as "always enabled, no floor"). Floor culling now reads straight off
  the entity's bound mesh instead, which FloorManager always keeps correct.
- **Top bar: the ⋮ overflow button on mobile now matches the other squircle
  buttons.** It was falling back to the larger standalone button's corner
  radius at a smaller size, reading as a near-circle next to the flatter
  zoom/category buttons. Also fixed the mobile top bar's left/right padding,
  which weren't actually symmetric despite equal CSS padding values — the
  hidden brand chip was still reserving its own empty grid column on the
  left with nothing mirroring it on the right; removed that column.
- **Removed the (i) navigation-tips button** (bottom-left, both mobile and
  desktop) — redundant.
- **Bottom-left now always shows the first-person/bird's-eye toggle**, with
  the "jump to default view" button directly below it while in overview
  (previously the toggle lived in a separate column higher up the screen).
- **The first-person movement joystick moved to the bottom-right** of the
  screen, freeing up the bottom-left for the view controls above.

## 2.23.10

- **Removed "Live weather effects" (rain).** Deleted `WeatherEffects.ts` and
  every call site — the feature and its Settings toggle are gone.
- **Removed "Glow around lit/active devices."** It was genuinely wired to a
  real `GlowLayer`, but this villa's baked structure is entirely excluded
  from it (to avoid a scene-wide bloom halo), so it only ever affected small
  fixture meshes at a faint 0.8 intensity — invisible in practice. Removed
  `GlowLayer` and all `render.glow`/`glowIntensity` plumbing.
- **Quality preset accuracy.** The Performance/Balanced/High presets do
  apply correctly, but for a baked-lighting villa SSAO — the preset system's
  biggest advertised difference — is unconditionally forced off, so Balanced
  and High look nearly identical here. The dropdown now shows an accurate
  note instead of falsely promising "adds contact shadows (AO)."
- **Settings reorganised**: "Highlight clickable objects" moved to the top
  of Render quality & look and renamed "Show blue glow around clickable
  devices"; Render quality & look now sits before First-person view; in
  Advanced Settings, 3D model source now sits before Auto-detected entity
  settings. Villa latitude/longitude fields are full width instead of a
  narrow centred pair. Settings modal section titles now match Advanced
  Settings' style.
- **Fixed the real cause of Advanced Settings feeling laggy on every
  edit**: `ConfigContext` was JSON.stringify-ing and synchronously writing
  the *entire* config (including the full entity map) to localStorage
  **inside** the React state updater, blocking commit/paint before a
  checkbox could even visually flip. Persistence now happens in an effect,
  after paint — checkboxes should toggle instantly now.
- **Auto-detected entity cards are collapsed by default** (entity ID + Show
  toggle + chevron on one line) instead of a full 6-field card per device —
  there can be a lot of them. The "redirect to a different entity" Apply/
  Cancel controls now sit on the same line as the field on desktop and wrap
  naturally on narrow screens.
- **Search icons moved inside their text fields** ("New entity ID…",
  "Search entities…", "Add another entity to this device…", "Search or
  type entity id…") to match the existing entity-filter box style — all
  four route through the one `EntityPicker` component, so a single fix
  covered all of them.
- **CSS cleanup**: removed three confirmed-dead style blocks no longer
  referenced anywhere (checked against dynamic `className` construction,
  not just literal text) — `.config-topbar` (leftover from the old
  full-page Config Editor), `.floor-switch-v` (superseded by
  `.hud-floor-btn`), `.glow-dot`.

## 2.23.9

- **Fixed: ceiling fan asset permanently disappearing (and its badge jumping
  to the edge of the screen) after using Advanced Settings.** Once a fan had
  been spun at least once, disposing its old rotation pivot on the next
  structural re-index (any Advanced Settings edit that touches the device
  list) silently destroyed the fan mesh too — Babylon's `TransformNode.
  dispose()` recurses into the whole descendant hierarchy by default, and the
  fan mesh was a child of that pivot (reparented there so it could spin in
  place). The badge then re-anchored itself to that now-dead mesh reference,
  which is why it appeared to fly off to the side. The mesh is now moved back
  onto the pivot's original parent before the pivot is disposed, so only the
  (now childless) pivot goes away.

## 2.23.8

- **File tree cleanup.** Deep-scanned the repo (outside `sources/`, which is
  intentionally never touched) for unused/redundant files: removed macOS
  `.DS_Store` junk, a stale `.claude/session-handoff.md` scratch file (session
  notes from v2.20.0, long superseded by this changelog + git history), and a
  stray `rootfs/usr/bin/__pycache__/*.pyc` — the latter wasn't excluded by
  `.dockerignore`, so it was at risk of actually getting baked into the Docker
  image via `COPY rootfs /`. Added `__pycache__/`/`*.pyc` to `.dockerignore`
  to stop that from recurring, and dropped two stale `.dockerignore` entries
  (`model-source`, `DEPLOYMENT.md`) for paths that no longer exist.
- **`dist.zip` actually gitignored now.** It turns out `.gitignore`'s `dist`
  rule only matched the build **directory**, not a `dist.zip` file — gitignore
  doesn't do prefix matching. Added `dist.zip` explicitly.

## 2.23.7

- **Ceiling fan's badge label no longer spins with the blades.** The 2.23.1
  fix (reparenting the fan mesh under a rotating pivot node) had a side
  effect: the badge anchor was parented directly to that same mesh, so it
  got dragged into the rotating subtree as a grandchild and spun along with
  it. The anchor is now detached onto the pivot's own (non-rotating) parent
  right after the fan rig is built, before it ever starts spinning.
- **Faster response when editing devices in Advanced Settings.** Two
  redundant-work sources made every config edit feel sluggish: (1) any
  config change — including dragging a render slider — replayed every known
  Home Assistant entity's full visual state, even though only a structural
  edit (enabling/disabling or rebinding a device) actually needs that; now
  gated on whether the scene really did a structural rebuild. (2) typing in
  a device's Label field fired a full structural re-index on every
  keystroke; it's now debounced so the re-index runs once after a pause (or
  on blur) instead of once per character.
- **Removed unused code found during an app-wide scan**: an unwired
  "wall display" floating-label feature, two unused hooks
  (`useHAEntities`, `useSceneReady`), and half a dozen dead exports
  (`getMappingByEntityId`, `DEFAULT_SPAWN`, `pctToBrightness`, `isDaylight`,
  `sh3dToBabylon`, `SceneReadyInfo`) that had no remaining callers anywhere
  in the codebase.

## 2.23.6

- **"Glow strength" replaced with "Light effect strength".** The old slider
  controlled GlowLayer bloom (fixed at a sensible default now, no longer
  user-facing); the new one controls the power of the 2.23.5 floor light-pool
  effect instead — the thing actually worth tuning when a light doesn't seem
  to brighten its room enough. Live-previews while dragging, same as the
  other render sliders.
- **3D model upload moved into Advanced Settings.** "Upload central GLB" /
  "Upload room data" (and the standalone-mode model uploader) were sitting on
  the everyday Settings screen; they're an administration action, so they
  now live in Advanced Settings alongside the rest of the Owner-only tools.

## 2.23.5

- **Camera badge icon changed again — CCTV camera, not a webcam.** The
  webcam glyph from 2.23.2 wasn't quite right either; swapped for lucide's
  `cctv` icon (an angular wall-mounted security camera), which matches a
  fixed monitoring camera much better.
- **Rooms actually get brighter when a light turns on, in baked-lighting
  villas.** `LIGHT_RANGE`/`MAX_LIGHT_INTENSITY` (which 2.23.3/2.23.4 tried
  tuning) turned out to control a real dynamic `PointLight` that this villa
  never creates in the first place — its walls/floor/ceiling are exported
  **unlit** (baked lightmap materials), so they ignore every dynamic light
  by design; those two constants were dead code here regardless of value.
  Added a different mechanism for baked villas: a soft, warm, additive
  "light pool" on the floor under each fixture — sized from the light's
  range, coloured/dimmed from its live brightness and colour, visible only
  while on. It brightens the floor around it rather than trying to light
  geometry that's architecturally immune to it.

## 2.23.4

### Changes
- LIGHT_RANGE from 4 to 8

---


## 2.23.3

### Changes
- MAX_LIGHT_INTENSITY from 1.3 to 2

---


## 2.23.2

- **Category filter buttons now double as a colour legend.** Each button in
  the top-bar category row lights up in its own category's colour when
  active (matching the map badges) instead of a uniform blue, so it's clear
  at a glance which colour means which category.
- **Camera badge icon changed to a webcam glyph** — more fitting than the
  traditional camera-body icon for a fixed security/monitoring camera.

## 2.23.1

- **Fix: ceiling fan (and its badge) disappearing when turned on, and never
  coming back when turned off.** 2.22.6's `setPivotPoint`-based spin fixed
  the orbiting mathematically, but the badge's on-screen position tracking
  (Babylon GUI's `linkWithMesh`) projects the mesh's own *local*
  bounding-sphere centre through its world matrix every frame — an
  interaction with the pivot matrix that isn't verifiable without a browser,
  and in practice broke both the mesh and its badge. Replaced with an
  invisible pivot node the fan mesh is reparented under (`setParent`, a
  mechanism already used throughout this app) — animateFans now only ever
  rotates that pivot; the mesh's own transform, pivot matrix and bounding
  info are never touched, so nothing reading the mesh directly (the badge
  included) can be affected. Spin correctness (no orbit, no drift) verified
  numerically before shipping.

## 2.23.0

- **Redesigned device badges — hardcoded, no more per-user icon editing.**
  Replaced the emoji-based, user-customisable badge icons with a fixed
  design: a squircle background coloured by CATEGORY (one of 6 distinct
  colours — comfort, light, network, energy, access control, others) with a
  thick white line-art glyph for the device type / device_class (~35 icons,
  vendored from lucide's own SVG data for pixel accuracy). The background no
  longer recolours with live state — instead, an outline ring appears around
  the badge while a device is on (amber) or in alert (red), the same colour
  language as the red mesh outline a running climate device gets, just
  applied to the 2D badge instead of the 3D asset.
- Removed the "Device state icons" section from Settings (entityIcons /
  binarySensorIcons / sensorIcons) — nothing left to edit; the whole system
  is deleted from config, export/import, and the UI.

## 2.22.6

- **Fix: ceiling fan pole/label still orbiting (2.22.5's fix wasn't enough).**
  The real bug: `rotateAround` re-derives its pivot offset from the mesh's
  CURRENT position on every call, and these fan meshes import with position
  at the local origin while their real placement lives entirely in vertex
  data — so ANY vertex-derived pivot orbits the whole mesh (pole AND, since
  the label anchors to that same mesh, the label too) around it every frame,
  no matter which point gets passed in. Rebuilt on Babylon's own pivot-point
  mechanism instead (`setPivotPoint` + an absolute `rotationQuaternion`
  assigned fresh every frame, never accumulated) — this cannot drift or
  orbit, by construction, regardless of where the mesh's own position sits.
- **Fan panel: speed is now 3(+) buttons, not a slider.** Matches Home
  Assistant's own fan more-info card (Low/Medium/High, derived from
  `percentage_step`) instead of a free-drag percentage slider, laid out as a
  horizontal row rather than HA's vertical stack.

## 2.22.5

- **Fix: ceiling fan mount/pole visibly orbiting while spinning.** Each
  ceiling fan is exported as one fused mesh (mount + motor + blades, no
  separate "blade" object to isolate), so the whole thing has to rotate
  together — but the spin's pivot was the plain bounding-box midpoint, which
  isn't quite on the true axle when the blade assembly isn't perfectly
  symmetric. The pivot now comes from averaging the ceiling mount/canopy's
  own vertices (the top slice of the fixture — reliably round and centred on
  the real axle), so the mount/pole reads as motionless while the blades spin.
- **Removed the fan's on/off glow.** `fan` entities no longer get an emissive
  tint when on — the spin itself is the "on" cue now.
- **Fan panel: added a Speed slider.** Fans that report a continuous speed
  (`percentage`, separate from any named presets) now show a slider for it,
  same pattern as the cover position slider — previously only preset-mode
  buttons were exposed even though the service call already existed.

## 2.22.4

- **Removed the fake grass repaint.** SweetHome 3D exports the terrain outside
  any defined room as a bare grey slab; the app was repainting it green to
  look like grass. That's gone — the slab now shows its real (grey) colour
  instead of a synthetic one. `GroundGrass.ts` and the unused
  `grassGround`/`grassGroundHints` config fields are removed.

## 2.22.3

- **Lit rooms actually look lit now, especially at night.** A light's real
  room-fill contribution was quite weak — turning it on mostly just bloomed
  the fixture's own glow rather than brightening the room around it. Bumped
  `MAX_LIGHT_INTENSITY` 0.85 → 1.3 and each fixture's `LIGHT_RANGE` 2.8m →
  4m. If a light starts visibly bleeding into a neighbouring room (most
  likely with multi-marker LED strips), that range is the first thing to
  dial back.

## 2.22.2

- **Fix: connection status still ate top-bar space on phones.** The previous
  fix collapsed it into its own small button, but that's still a button —
  it's now folded entirely into the existing right-side "⋮" menu instead, so
  the top bar spends nothing on it and the category filter row gets that
  width back too (not just half of it, from the old symmetric left/right
  column split).
- **Fix: device panel header cramped on phones.** Edit/Close moved out of the
  header into a footer row (text-labelled buttons, same look as Settings'
  Cancel/Save), so a long device name always gets the full header width to
  wrap into instead of squeezing against the buttons.

## 2.22.1

- **Fix: device panel modal on phones.** It was inheriting the full-screen,
  top-anchored sheet treatment meant for Settings, so it rendered off-center
  with its Edit/Close buttons pushed out of view on a long device name. It's
  now a small centered card on phones too, and the header buttons no longer
  shrink or get clipped regardless of title length.
- **Fix: sensor/device-group history graphs missing on Ingress.** The history
  fetch required `haUrl`/`haToken` to be set, but those are legitimately
  blank when the kiosk is opened through Home Assistant's Ingress (the
  add-on's Supervisor proxy injects credentials server-side) — so the graph
  silently never loaded on any Ingress-connected device (typically phones/
  the HA app) even though it worked fine wherever a URL+token were configured.
- **Reclaimed top-bar width on phones.** The villa name/connection-dot/clock
  chip now collapses into a single dropdown button (mirroring the existing
  right-side overflow menu) instead of staying visible as a chip, so the
  category filter row is no longer cropped on narrow screens.

## 2.22.0

- **Running climate devices get a red outline** on the map, same forward-pass
  outline+overlay technique as the blue "clickable" highlight — always on
  while the thermostat is running, independent of the "highlight clickable
  objects" preference.
- **Export/import moved to the Advanced Settings header** — icon-only,
  top-right, same treatment as the theme selector in Settings (Owner only).
- **Advanced Settings' "Done" button renamed to "Close".**
- **Device grouping.** Fold several HA entities that are really one physical
  device (e.g. a combo sensor exposing separate temperature + humidity
  entities) into a single map badge — new "Grouped devices" section in
  Advanced Settings, with one-click suggestions for temperature/humidity
  pairs detected from entity_id naming. Only the group's primary entity keeps
  a badge on the map; tapping it opens a combined detail view with every
  member's current value and a 24h history graph (dual-axis when there are
  exactly two numeric series).

## 2.21.0

- **Label size stepper.** New +/- buttons next to the category filters in the
  top bar step the in-scene badge size by 0.25 per click, down to 0 (hidden).
  Replaces the old "Icon size" slider in Settings.
- **First-person / bird's-eye toggle moved** below the floor + Rooms stack on
  the left, out of the top-right bar (and its mobile overflow-menu duplicate).
- **Bottom-left nav buttons restacked** — the (i) navigation-tips button now
  sits above the view-default (anchor) button instead of beside it.
- **Device info panel is now a centered modal**, not a bottom sheet — matches
  the look of Settings/Advanced Settings, with a cleaner header and its own
  internal scroll for taller panels (climate, camera).
- **Owner: export/import your configuration.** Advanced Settings has a new
  "Backup & restore" section (Owner profile only) to export device↔room
  bindings, room definitions (incl. saved viewports), device icons,
  enabled/disabled devices and the First-person/Overview + Render quality +
  Device-icon settings to a JSON file — and import it on another install to
  reproduce the setup automatically.

## 2.20.0

- **Left bar reworked.** Re-added the **1F / 2F floor toggle** and moved the
  **Rooms** button into that same vertical stack.
- **Device state labels are always shown** — the "Show device state labels"
  button is gone (labels are on by default, no toggle needed).
- **"Highlight clickable objects" moved to Settings** (a toggle in the render/
  look section) and removed from the left bar.

## 2.19.2

- **Fix: only ceiling fans spin, and they spin IN PLACE.** Two bugs in the fan
  animation: (1) it spun every `fan.*` entity, including bathroom VMC/exhaust
  vents — now only devices named like `ceiling_fan` spin. (2) It orbited the fan
  in a huge arc across the map: Babylon's `rotateAround` takes its pivot in the
  mesh's parent-local space, but we passed a world-space centre, and the fan
  meshes are parented to the recentred root — so the offset flung them around a
  far point. The centre + axis are now converted to the parent frame, so a fan
  spins about its own centre (and its badge, which sits on that axis, stays put).

## 2.19.1

- **Badge size is now truly fixed.** Badges no longer grow/shrink with the
  bird's-eye zoom level — they stay at exactly the "Icon size" you set in
  Settings, in both views, at any zoom.

## 2.19.0

- **Device panels now show the HA entity id** (e.g. `climate.gym_room`) under the
  title, so it's clear exactly which Home Assistant entity a control drives.
- **Quick-edit shortcut.** Owners get a pencil button in the panel header that
  jumps straight to that device's row in Advanced Settings (the entity table,
  pre-filtered to it) for fast edits — then Back returns to the villa. Guests /
  facility profiles don't see the button (they can't edit config).

## 2.18.0

- **Faster load — the villa appears before the heavy passes run.** The raycast-
  heavy work (per-room floor probing + the stair-glow conform) and the cosmetic
  passes (grass, blue highlights, room anchors) now run AFTER the first rendered
  frame instead of blocking it. On a wall tablet that's several seconds sooner to
  an interactive villa; rooms/teleport/glow pop in a moment later. Nothing is
  lost — the Rooms grid adopts via the existing calibration hook when it lands.

## 2.17.1

- **Fix: villa stuck on "Loading…".** 2.17.0's stair-conforming glow ran its
  grid-probe (which raycasts the whole structure) on every room; the big outdoor
  / terrain / pool polygons vary in height, so they false-positived as "stepped"
  and each fired thousands of raycasts, hanging the load. The probe is now scoped
  to staircase rooms only (matched by name), wrapped so it can never block load.

## 2.17.0

- **Motion-glow drapes over the stairs.** A motion/occupancy sensor whose room is
  a staircase now lights the actual steps: stepped rooms get a surface-hugging
  glow mesh (sampled over the real geometry) instead of a flat patch that floated
  at mid-step height. Flat rooms are unchanged (and pay nothing — the app only
  does the extra sampling for rooms it detects as stepped).
- **Ceiling fans spin when on.** A `fan.*` device whose 3D object is bound (e.g.
  `fan.ceiling_fan_*`) now rotates while it's on, at a speed scaled by its fan
  percentage. It spins about its own centre so the badge stays put, and only
  turns while its floor is in view (to respect the on-demand render budget).
  Hidden/disabled devices don't spin — so this lights up once your ceiling fans
  are integrated in Home Assistant and switched on.

## 2.16.0

- **Per-device show/hide.** Advanced Settings → the entity table now has a
  **Shown** checkbox per device. Turn it off and that device drops out of the 3D
  view entirely — no badge/label, no blue highlight, not tappable — while its
  model stays as plain geometry. Ideal for devices modelled ahead of their Home
  Assistant integration (e.g. ceiling fans not yet controllable). The device
  stays listed in Advanced Settings so you can switch it back on. Applies live.

## 2.15.0

- **Device categories now follow device TYPE + device_class, not per-entity.**
  Categories are derived from a device's kind (and, where it matters, its Home
  Assistant `device_class`) at read time instead of being pinned onto each
  entity, so re-organising the rules re-buckets every device automatically. New
  grouping:
  - Temperature + humidity **sensors** → **Comfort**
  - Motion/presence **binary_sensors**, **cameras** and **locks** → **Access
    Control**
  - Enum (text-state) **sensors** → **Network**
  A category you explicitly set in Advanced Settings is still respected.
- **Consistent button shape.** The standalone controls (Settings, view toggle,
  compass/rooms, default-view anchor, (i)) were circles while the top-bar groups
  and left stack were squircles. They're all squircles now.
- **Cleaner profile chip.** The Guest/Owner/Facility-Manager chip had an
  oversized round logout button that made it look bulky; it's now a tidy squircle
  chip matching the icon buttons' height, with a smaller nested logout button.
- **Renamed "Config Editor" to "Advanced Settings"** (the footer button and the
  modal title) — a clearer name for the villa coordinates / bindings / entity
  metadata screen.
- **Villa location fields are centred** in Advanced Settings, with their labels
  and values centred too, so the Latitude/Longitude pair sits tidily.
- Dropped the stale "shadows" mention from the villa-location description (sun
  shadows were removed in 2.14.0).

## 2.14.3

- **Consistent badge blue.** Live devices used two slightly different, partly
  transparent blues (sensors were a deeper shade, and the translucency let the
  background behind each badge tint it) — so the same "active" colour looked
  different badge to badge. All live devices now share one fully-opaque blue, so
  it reads identically over any surface; the glyph still distinguishes a sensor
  from a light.
- **Value pills have breathing room.** The chip's side padding was smaller than
  its rounded-end radius, so the text crowded the edges. Padding now clears the
  radius for a small, even margin on both sides.

## 2.14.2

- **Value pills no longer tuck under a neighbouring badge.** The declutter used
  to treat each label as a circle at the badge, ignoring the value pill that
  hangs below it — so a nearby badge could land on another label's pill. Each
  label is now modelled as its full screen box (badge + pill, with the pill's
  width estimated from its text) and overlaps are resolved with the minimum
  axis-aligned nudge, keeping every badge clear of every pill. Still applied
  directly (no easing / self-render), so labels stay rock-steady.

## 2.14.1

- **Tidier value pills.** The chip under a device badge was dumping raw state,
  so readings crowded it ("6570.989W", "25.05°C"). Values are now formatted
  exhaustively: numbers are rounded to a sensible precision with large
  power/energy scaled to k-units ("6.6 kW", "25.1°C", "64%"); enum/text states
  are tidied to Sentence case with underscores as spaces ("not_home" → "Not
  home", "connected" → "Connected"); and anything still long is ellipsised so a
  pill can never blow out.

## 2.14.0

- **Uploading a model keeps Settings open.** A new GLB / room-data upload now
  refreshes the scene in the background without closing the Settings modal.
- **Settings tidy-up.** The room-data upload buttons drop the `(.rooms.json)`
  suffix and their descriptions now explain what the file is; the leftover
  `.sh3d` references are gone.
- **Removed the "Cast sun shadows" option.** It did nothing: the villa uses
  baked lighting (shadows are already in the texture), so the sun shadow pass was
  force-disabled and the toggle was a no-op. Removed the toggle and the whole
  dead shadow subsystem (config fields, presets, ShadowGenerator).
- **Grouped the camera settings.** "Eye height" + "Walk speed" now sit under a
  **First-person view** heading, and "Natural scrolling" under an **Overview
  (bird's-eye) view** heading, next to each other since they're the same domain.

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
