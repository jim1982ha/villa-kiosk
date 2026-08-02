# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # https://localhost:5173 (self-signed cert unless ./certs/ has a mkcert one — see vite.config.ts)
npm run build         # tsc -b (typecheck) + vite build → dist/ — ALWAYS run before considering a change done
npm run typecheck     # tsc -b --noEmit only, faster than a full build for a quick check
npm run preview        # serve the production build
python3 tests/security_test.py   # regression suite for supervisor-proxy.py's auth/RBAC boundary — run after touching it
```

There is no lint script and no JS/TS test runner configured — `tsc -b`'s strict settings (`noUnusedLocals`, `noUnusedParameters`, `strict`) are the only automated gate beyond the Python security suite. `npm run dev`/`build`/`preview` all auto-run `npm run clean` first (removes `dist/`, `node_modules/.vite`, `tsconfig.tsbuildinfo`).

Path alias: `@/*` → `src/*`.

## Release procedure

Every release bumps the version in **both** `package.json` and `villa-kiosk/config.yaml` (they must match) and prepends an entry to `villa-kiosk/CHANGELOG.md` in the existing style: dense paragraphs explaining *why* a change was made (the reported symptom, the root cause) rather than terse bullets — read the last few entries before writing a new one. Run `npm run build` clean before committing. Stage files explicitly by name, never `git add -A`/`.` (this working tree periodically picks up stray `.fuse_hidden*` files from a FUSE-mounted filesystem).

## The hard rule: nothing villa-specific ships

This is a redistributable Home Assistant add-on, not a bespoke dashboard for one villa. **No entity_id, room name, device count, villa dimension, per-site tuning constant, or business/contract-specific value (currency amounts, legal clause references) may be hardcoded.** Such a value works perfectly on the machine it was written against while silently breaking every other install.

In practice: derive from live HA/scene/floor-plan data rather than assuming; match rooms/entities through generic config lookups, case/whitespace-insensitively; prefer an **empty** default over a "helpful" seeded one for any user-editable config slice — a seed spread underneath stored config (see `AppConfig`'s merge-on-load) resurrects deleted entries on reload, which was the root cause of a real "stale entities I can't delete" bug. `EntityMap.ts`, `TeleportPoints.ts`, `Sh3dCalibration.ts`, `ThresholdConfig.ts`, and `fm/fmTypes.ts` all ship with deliberately empty seed tables/constants for exactly this reason — don't reintroduce literal data into them. MCP/HA access during development is a diagnostic instrument, not a data source: reading real entities to debug is fine, but that data must never become a literal in shipped code.

## Architecture

**React never touches the 3D scene directly.** `src/babylon/` is plain TypeScript with zero React imports — `SceneManager` owns the Babylon `Engine`/`Scene` and every subsystem (camera, lighting, floors, picking, entity visuals). `src/ha/HAStateStore.tsx` pushes HA state changes **imperatively** into Babylon via `subscribeAll`/`subscribe` callbacks (registered once, called on every `state_changed` event) instead of re-rendering the canvas — this is why the 3D view never stutters on unrelated HA traffic. React only re-renders for the DOM-layer HUD/panels/modals.

**Mesh↔entity resolution** (`config/EntityMap.ts`'s `resolveMeshToMapping`) tries several strategies in order: (1) an explicit user-made binding (`meshBindings`), (2) the mesh literally named after its entity_id (the pipeline's primary convention — see README's "Configuring interactive assets" section), (3) a `[type]_[room]` alias table (currently empty, see the hard rule above), (4) a sanitised dot-vs-underscore retry, (5) infer a minimal mapping from the entity_id's domain alone so an unrecognised device is still tappable. A mesh can also carry a `__<word>` suffix (`cover.x__open`, `lock.y__locked`) marking it as one of several **pose variants** for the same entity, shown/hidden by live state (`EntityVisuals`'s variant grouping) — an unsuffixed mesh is never a pose, it's always-visible base geometry.

**Config has two tiers**, defined by `config/deviceConfig.ts`'s `SHARED_CONFIG_KEYS`:
- **Shared/site-wide** (`entityMap`, `meshBindings`, `deviceGroups`, `teleportPoints`) — synced through the add-on's own `/data` store so every client agrees, reconciled by `config/DeviceConfigSync.tsx`. That file's header comment documents three ordering rules (pull-before-push, push-only-real-changes, pull-never-clobbers-an-unconfirmed-edit) that exist because a violation of any one of them previously caused a real, hard-to-reproduce bug: an edit silently reverting seconds after being made. **Read that file's docstring before changing anything about the config sync flow** — the baseline (`serverJsonRef`) must only ever advance on a *confirmed* server write, never optimistically before one.
- **Per-device** (render quality, theme, `eyeHeight`/`walkSpeed`, `badgeStyle`, `hiddenCategories`, `currentFloor`, …) — plain `localStorage`, deliberately never synced (a phone shouldn't inherit a desktop's render settings).

**Room/entity room data** comes from a `.rooms.json` payload that a pipeline ≥2.14.0 embeds directly in the GLB's glTF `extras` (read by `utils/glbRoomDataExtractor.ts` before the model ever loads into a scene), falling back to a separately-uploaded `.rooms.json` sidecar for older exports. `config.sh3dEntities`/`sh3dRooms` hold the parsed plan-space (cm) data; `babylon/roomCalibration.ts` solves the plan→world transform from it (affine fit from ≥3 entity meshes, degrading gracefully to fewer signals).

**Badge grouping** (`EntityVisuals.ts`) is a frequently-reworked subsystem — six earlier attempts failed because grouping was computed in **screen space**, making it a function of the whole camera pose ("badges dance when I pan"). The current design groups by **world-space ground distance** against a radius derived from **zoom alone**, quantised into discrete steps (the same model map engines use for marker clustering), with **zero hysteresis**. If a grouping bug is reported: do not add hysteresis back, and do not test overlap in screen space — verify the world-space/zoom purity first.

**RBAC is enforced server-side, not client-side.** `auth/permissions.ts` (categories a profile sees, capabilities like `editConfig`/`manageFacility`) is a rendering convenience only — a browser can send whatever it wants, so every rule that matters is duplicated in `rootfs/usr/bin/supervisor-proxy.py` (HA REST/websocket allowlists, owner-only writes on every shared store, the PIN→session-cookie flow). Changes to either side should be checked against the other; `tests/security_test.py` is the regression suite for the proxy side.

**Scenes are read live from Home Assistant, never authored in the kiosk.** `config/haScenes.ts` derives every `scene.*` entity's touched rooms from its own `attributes.entity_id` list cross-referenced against `config.entityMap`, with zero local storage — there used to be a parallel kiosk-side capture/replay scene system; it was removed as a duplicate of HA's own Scene Editor. Don't reintroduce local scene storage.

**Villa telemetry/config stores** in `/data` (device-config, telemetry, Facility Manager data + evidence photos) are all served by `rootfs/usr/bin/supervisor-proxy.py` through one shared `_json_store_handlers` factory (GET open to any authorized session, PUT owner-only) — a new shared store almost certainly belongs on that same factory rather than a bespoke handler pair.

## Known gotchas

- **Babylon GUI `TextBlock` does not inherit CSS.** It defaults to Arial regardless of `--font-ui` — every `TextBlock` must set `fontFamily` explicitly, or you get a "the font didn't change" report for text that was never going to pick it up.
- **Don't reuse `CATEGORY_COLORS` hues** (`config/EntityCategories.ts`) for non-category UI — a room chip rendered in the same accent blue as the "Energy" category read as a mis-tagged badge.
- **Measure, don't assume, for layout/CSS bugs.** Several real field bugs were the same mistake in different clothes: `contentRect` silently excludes padding/safe-area (use the border box); a rotated element must be sized from its container's actual on-screen dimension via the CSS property that *means* that dimension, not a same-named one that doesn't apply post-rotation; an element's own `overflow: hidden` cannot clip its own `transform` — clipping needs a non-transformed ancestor; a shorthand like `padding: 0 X` in a phone media query silently zeroes `padding-top`, wiping out `env(safe-area-inset-top)` (watch shorthand cascades in overrides).
- **An author `display` rule silently defeats the `hidden` attribute.** `[hidden] { display: none }` is a UA rule at the lowest precedence, so `.foo { display: flex }` on the same element wins and the element stays visible — the markup says `hidden` and is correct, so review finds nothing. This bit twice (a collapsed chip row that kept showing its chips; a file input inside a styled form field reappearing as a stray "Choose files" control) before `[hidden] { display: none !important; }` was added as a global guard in `styles.css`. Related: **scope form-control rules to direct children** (`.fm-field > input`, not `.fm-field input`) — a descendant selector reaches into every nested component that happens to sit in a field and restyles controls it doesn't own.
- **Unanchored substring regexes over entity_ids are a recurring false-positive source** — `door` matches inside `outdoor`, `\b` doesn't help since `_` is a word character; use `(?:^|[._])…(?:[._]|$)`. There is no false-positive-free automatic rule for detecting a relay-controlled lock modelled as `switch.*` — this was tried, misfired, and was reverted at the user's request. If raised again, prefer an explicit per-entity opt-in flag over a naming heuristic.
