# Villa Kiosk — Project Overview for Claude

## What this is
A browser-based first-person 3D villa walkthrough kiosk, wired live to Home Assistant over WebSocket. Built for TheLysHouse, Bali (lat -8.3405, lng 115.092), to be run on a touch tablet.

**Tech stack:** React 18 + TypeScript strict, Babylon.js 7.x, Vite 5.

## Dev server
```
cd /media/jm/samsung_ssd/claude/ha_navigate/villa-kiosk
npm run dev          # starts at http://localhost:5173/
npm run build        # production build to dist/
npm run deploy       # scp dist/ to HA (needs .env with VITE_DEPLOY_HOST etc.)
```

## Architecture

### Key files
- `src/babylon/SceneManager.ts` — GLB load, scale normalisation, room calibration, wall opacity, collision, Inspector
- `src/babylon/CameraController.ts` — movement (joystick/WASD/arrows/wheel/dbl-click), floor-following (stairs), Q/E look keys, Shift+swipe look, point-in-polygon room detection
- `src/babylon/EntityVisuals.ts` — HA entity state → 3D mesh changes (lights, covers, fans, locks, sensors)
- `src/ha/HAWebSocket.ts` — WebSocket to HA, auto-reconnect, 10s timeout, dedup
- `src/config/AppConfig.ts` — all runtime config (localStorage-persisted)
- `src/config/Sh3dCalibration.ts` — hardcoded TheLysHouse room polygons + entity positions (fallback when no .sh3d uploaded)
- `src/utils/sh3dParser.ts` — parses .sh3d (ZIP+Home.xml) in browser → room polygons + entity positions
- `src/utils/affineFit.ts` — least-squares affine fit for plan→world transform
- `src/utils/geometry.ts` — pointInPolygon (ray-casting)
- `src/components/settings/SettingsModal.tsx` — all settings UI
- `vite.config.ts` — `allowedHosts: true` (reverse proxy), `optimizeDeps: { exclude: ["@babylonjs/inspector"] }`

### Data flow
1. User uploads GLB → IndexedDB. User optionally uploads .sh3d → config.sh3dRooms + config.sh3dEntities (localStorage).
2. On load: GLB parsed → normalizeScale (exact from entity meshes, or bbox heuristic) → recenterModel → calibrateRooms (affine from entity pairs, or centroid fallback from sh3d room bbox).
3. HA WebSocket → `HAStateStore.subscribeAll` → imperative push to `EntityVisuals` + `MarkerManager` (NO React re-render of canvas).
4. On-demand rendering: render loop only runs when `requestRender()` called (input, state change, etc.).

## Known design decisions
- `applyGravity = false` on camera (gravity sank eye to floor). Floor height set by downward raycast (`groundCamera()` + `followFloor()` while walking).
- Walls forced opaque by **material alpha > 0.5** rule (not mesh names — mesh names are unreliable from SweetHome export). Glass/windows have alpha ≤ 0.5 by default, so they stay transparent.
- Wall collision: enabled on all meshes except `noCollide` regex (floor/ground/stair/ceiling/outdoor/helpers).
- Room detection: point-in-polygon using sh3d room polygons transformed to world space. Falls back to nearest-anchor if no polygons.
- Inspector: exposes `window.BABYLON` before loading the UMD bundle (required by the bundle, not set by Vite ES modules).
- React Router: HashRouter (needed for HA /local/ static mount). `v7_startTransition` + `v7_relativeSplatPath` future flags set.
- Weather effects off by default (can trigger rain particles in Bali which looked like snow).

## Binding system
Three ways to wire entities to 3D objects:
1. **Entity-named meshes** — mesh named `camera.kitchen_cam` auto-matches (only works if GLB has these names, which SweetHome OBJ export does if furniture is named with entity_ids)
2. **Tap-to-bind** — Settings → Bind 3D objects → tap → pick entity
3. **Marker mode** — Settings → Drop control markers → tap floor/wall → link to entity_id (for fused/unnamed meshes or future entities)

## Room calibration
**Best:** entity-named meshes → full affine fit (handles any rotation/mirror)
**Fallback:** sh3d room polygon bounding box → centroid+scale transform (works even when GLB has no entity meshes, e.g. direct SweetHome export)
**No .sh3d:** uses hardcoded TheLysHouse data in `Sh3dCalibration.ts`

## SweetHome 3D → GLB pipeline
See `MODEL_PIPELINE.md`. Key point: do NOT join objects in Blender (destroys mesh names). Do NOT use SweetHome's direct GLB export (names meshes with internal IDs not furniture names). Export to OBJ, import to Blender, keep objects separate, export to GLB.

## Controls
| Action | Control |
|---|---|
| Walk | Joystick / WASD / arrow keys / two-finger swipe |
| Look | Mouse/touch drag / Q·E turn / Shift+arrows / Shift+two-finger-swipe |
| Go to spot | Double-click (collision-aware, ignores outside) |
| Cancel auto-walk | Any joystick/key input |

## Settings UI
- Scrollable body, sticky footer (Reset / Cancel / Save)
- No X close button (clicking backdrop closes)
- Gold custom checkboxes (`.toggle` class)
- .sh3d upload for auto room names (any future villa)
- Eye height slider, walk speed slider, wall collision toggle, weather effects toggle

## Deployment
```ini
# .env
VITE_DEPLOY_HOST=192.168.18.xxx   # HA IP
VITE_DEPLOY_USER=root
VITE_DEPLOY_PATH=/config/www/villa-kiosk
```
After `npm run deploy` → access at `http://<HA_IP>:8123/local/villa-kiosk/`
