## 2.127.0

### Fixed — the entity registry was being refetched dozens of times over

The first freeze capture from a real device brought an unrelated finding with it: between 04:10 and 04:43 the Mac performed roughly **25 full entity-registry fetches**, 1,582 rows each, repeatedly two within the same *second*.

Home Assistant emits registry-change events in bursts — one device edit touches the entity, device and area registries within milliseconds, and an integration reloading emits a long run of them — and the handler subscribed to all four event types refetched the whole registry on every single one, with no coalescing. Each refetch parses 1,582 rows and rebuilds the derived area/floor/device maps, so this is real main-thread work and real garbage, repeated for an answer that has not changed between the first event of a burst and the last.

Those events are now debounced by 750ms: long enough to swallow an integration reload, short enough that renaming a room in Home Assistant still reaches the map effectively immediately. The timer lives in a ref rather than the connect closure, since `connect` runs again on every reconnect and a per-call timer would leave the previous one pending — reintroducing the burst it exists to collapse.

Not claimed as the cause of the freeze; it is a defect found while looking for it, and worth removing on its own terms.

### Fixed — the first freeze report was the load, misattributed

`PerformanceObserver` reports a long task when it **ends**, not when it starts, so the load's own final block — the GLB parse and first paint — arrives at the observer just *after* the load record is built. The boolean gate added in 2.125.0 counted that as a post-load freeze, and the very first capture duly reported a 5,469ms "freeze" whose duration matched that same load's `paintMs` of 5,509 almost exactly.

The gate is now a timestamp compared against the task's own `startTime`, so a block that began before the load record was built is attributed to the load however long afterwards it is reported. The second capture in that session — 1,049ms, two and a half minutes in — was and remains genuine.

### Fixed — the disconnection notice covered a third of the villa on a phone

Reported with a screenshot. "Disconnected from Home Assistant — reconnecting… Controls won't respond until this clears." is a reasonable sentence on a desktop pill and five wrapped lines on a 402px phone, producing a slab sitting over the villa next to the floor buttons — heavier than the condition it was reporting, which is usually over in seconds.

Below 640px it now reads "Reconnecting to Home Assistant…", on one line, in a tighter box: the same `-full`/`-short` swap the settings labels already use. `white-space: nowrap` is what actually holds the height, since a merely narrower pill can still wrap, and the width cap keeps that line clear of the floor stack on one side and the overflow button on the other.

## 2.126.0

### Fixed — freeze reporting was blind on exactly the device it most needs to watch

2.125.0's freeze detection is built on the Long Tasks API, which is Chromium-only: Safari does not implement it, so `observe()` throws and the observer quietly does nothing. That is a fine failure mode for a nice-to-have metric and a bad one here, because an iPad is one of the two devices this app is mounted on a wall to run continuously — and historically the one that breaks first. The instrument meant to diagnose a freeze on a 24/7 tablet was silent on half the tablets.

A timer watchdog now covers that case, measuring the same thing from the other end: an interval that should fire every 500ms can only be late if the main thread was busy, so the lateness *is* the block. It cannot attribute the time to one task the way a long-task entry does, so the event records which detector saw it (`src`) and the panel labels the fallback's figure as timer lag — for a multi-second freeze the distinction does not change the conclusion.

It installs **only** where the real API is missing, so a Chromium device never reports one freeze twice from two detectors. Intervals that touch a hidden state are discarded rather than reported: a backgrounded page has its timers throttled to seconds or minutes, and that is the browser behaving correctly, not a freeze — including the interval spanning the moment of return, which would otherwise report every single wake as a false positive.

The `--ktx2` question is unaffected by any of this and remains declined; see 2.124.0.

## 2.125.0

### Added — the freeze is finally being reported, by an observer that was already watching it

The reported symptom is that returning to the kiosk after being away leaves the villa **on screen but unresponsive** for several seconds, sometimes long enough for the browser to offer to kill the page. Two explanations were carried for that, and this release's evidence kills both.

It is not the page being discarded and reloaded: the villa is still there, so the document survived. And it is not a WebGL context being lost and rebuilt: a lost context that comes back fires `context-restored`, and across four versions of telemetry there is **not one** such event — every `context-lost` is co-timed with `pagehide`, which is the signature of a context dying because the page is being torn down (`handlePageHide` disposes deliberately), not one being recovered. So the freeze is an ordinary main-thread block on a live page, and both prior theories were wrong.

That block should have been visible all along. `installStallObserver` has watched `longtask` entries continuously since startup — but its counters were only ever read into the **load** record and then reset, so every multi-second block occurring *after* the villa was up was measured and thrown away. Every single time this was reported, the number describing it had already been collected and discarded.

Long tasks past a second (well beyond jank, into "not responding") are now reported as their own `freeze` event once the load record is out, carrying the one thing that makes them diagnosable: **how long after returning to the page it happened, and how long the page had been away**. A block 200ms after coming back from six minutes hidden and a block forty minutes into an untouched session have nothing to do with each other and would be fixed in completely different places, and until now the data could not tell them apart. Rate-limited to one per thirty seconds and twenty per session, since a wedged main thread emits several in a row and only the first is informative; reported from a deferred task so the measurement never adds to the stall it is measuring.

No fix here — this release is only the measurement. Guessing again without it would repeat what the last two attempts did.

### Note — the GPU-memory reading of the earlier data was wrong

`mem` is roughly 350–380MB from the moment the villa finishes loading, not after hours of use: parsing a 17.7MB GLB into 704 meshes, 392 textures and 2.4M vertices legitimately costs that, and the figure is flat afterwards. Earlier notes describing an accumulation that eventually crosses a threshold were reading a load cost as a drift.

## 2.124.0

### Fixed — the villa rendered continuously, forever, whenever anything was animating

Reported as: leaving the kiosk, coming back, and finding the UI frozen — sometimes with the browser offering to kill the unresponsive page. Reported during a deliberate soak test with every ceiling fan left on for hours, with the (correct) suspicion that the two were connected.

The render loop is on-demand: `requestRender()` keeps it awake for a short window, and when nothing asks, the GPU idles. Three things asked *every single frame*. `animateFans` re-arms it while any fan spins, `animatePulse` while any alert is triggered or a camera beam is live, and `RoomHighlight.animate` while any room glows — each of which runs **from** a rendered frame, so re-arming per frame is the only way it can keep itself going at all. The consequence is that one fan left on, one leak sensor triggered, or one room flagged for overdue maintenance pins a villa at its display's full refresh rate for as long as that state lasts, which for a fan in a hot climate is indefinitely. `EntityVisuals`'s own header had already identified this in 2.113.0 and defended the expensive half of it — the badge layout no longer recomputes on those frames — but the frames themselves were never capped.

Continuous animation now draws from a separate, rate-capped budget (`requestAnimationRender`), while interaction, transitions and real state changes keep using `requestRender` and are never throttled. The cap is 33ms, about 30fps: a ceiling fan is a rotationally symmetric blur at the distance a wall-mounted tablet is read from and is indistinguishable at 30 from 60, so the frames removed were bought and paid for and then thrown away. Nothing animates more slowly as a result — every one of these advances by real elapsed time, not by a frame count, so a fan turns at the same speed however often it is drawn.

The loop also now returns immediately when `document.hidden`. `requestAnimationFrame` is *usually* throttled for a hidden document, which is what this quietly relied on, but that is a browser behaviour rather than a guarantee — and a PWA window sitting behind another window is not hidden at all, so it was previously rendering at full rate with nobody looking at it.

**This is a real and large reduction in sustained GPU work, and it is not yet proven to be the cause of the freeze.** The telemetry that prompted this shows the WebGL context being lost four times, always at 350–410MB heap and always as the window went away, and losing a context means Babylon must re-upload every texture and buffer on the main thread when it comes back — which would look exactly like the reported freeze. That remains a hypothesis: the previous instrumentation recorded only that a loss had happened, never what the recovery cost. See below.

### Fixed — a room glow that pulsed at whatever rate the monitor happened to run at

Found while capping the above. `RoomHighlight` advanced its glow by a fixed `0.05` per **frame**, so the pulse ran at double speed on a 120Hz panel and at half speed on anything drawing at 30 — including, as of this release, every rate-capped frame. It is now expressed in radians per second like the fan spin and the alert pulse beside it, tuned to reproduce exactly what the old per-frame step looked like at 60fps.

### Added — the cost of a context loss is now measured rather than inferred

`context-restored` previously carried no data at all, so a lost GPU context was a bare occurrence with nothing to say whether recovering from it took 20ms or 8 seconds. It now reports how long the view was actually dead, how many meshes and textures had to be re-uploaded, and — from the first frame that genuinely reaches the screen afterwards — how long that rebuild blocked for. If the freeze is the context restore, the next occurrence will say so with a number instead of requiring the argument to be made from plausibility.

### Added — whether the loaded villa is actually using GPU-compressed textures

A new `glTexCompressed` load stat counts how many of the model's distinct images reached the GPU still compressed. An uncompressed texture costs roughly four bytes per texel plus another third for mipmaps; a KTX2/ETC1S one transcodes to about half a byte. For a villa reporting 17.1 megapixels of distinct image that is the difference between roughly 90MB and roughly 11MB of GPU texture memory — in precisely the resource whose exhaustion takes the WebGL context away. The pipeline has had a `--ktx2` flag and the app has shipped its own offline decoder since 2.80.0, but nothing until now reported which of the two a given uploaded GLB actually was.

**This stat is not an argument for turning `--ktx2` on.** KTX2 was evaluated and declined (see 2.94.0 and 2.75.0), for the good reason that textures are not where load time goes — and a subsequent trial bake measured the GLB growing roughly fivefold for no visible gain. That growth was not the textures: `gltf-transform etc1s` decompresses geometry and does not re-apply Draco unless explicitly told to, and at 2.4M vertices the geometry returning uncompressed accounts for essentially all of it. The one axis that evaluation never covered is GPU *memory*, which depends on decoded pixels rather than on file size — so this stat exists to answer that question if, and only if, a context restore is ever actually measured to be what freezes the kiosk. Until then the correct setting is the current one: off.

## 2.123.0

### Added — "Log out all devices", which the add-on options had been promising all along

The `session_days` option's own description ends with *"use 'Log out all devices' in the app to apply it to existing ones immediately"* — and there was no such button anywhere in the UI. The server side had been complete for some time (`POST /auth/logout-all`, owner-only, bumping a signing epoch that every outstanding cookie is verified against), so the capability existed and was reachable by anyone willing to issue the request by hand; what was missing was the control the documentation told you to look for. That is worse than an undocumented feature, because the person reading it concludes the app is broken, or that they are looking in the wrong place.

It now lives in **Advanced Settings → Session**, Owner-only, behind the same two-tap confirm the Facility tabs use for their destructive actions. The confirm is not decoration: bumping the epoch invalidates *every* session including the one belonging to the person pressing the button, so it always signs you out too, and the copy says so. If the request fails the local session is deliberately left untouched and an error is shown, because a UI that claims every device has been signed out when the server never heard about it is the one outcome worse than the button not existing.

### Fixed — one villa's real GPS coordinates were compiled into every install

`AppConfig`'s `DEFAULT_CONFIG` carried a hardcoded latitude/longitude fallback, and `.env.example` shipped the same pair again under a comment naming the specific property they belong to. Sun position, day/night lighting and the whole baked-lighting preview key off those numbers, so any install that had not yet adopted its Home Assistant instance's own coordinates was being lit for somebody else's location — silently, and correctly enough to look intentional. The fallback is now `0`/`0`, which is the honest "not configured yet" value; the real coordinates arrive on connect from HA as they always did. The same audit removed the property's name from the pipeline documentation's worked examples, from a proxy docstring and from a comment in `modelInfo.ts`, replacing them with generic placeholders.

This is the same class of defect the project's hardcoding rule exists to prevent, and it had been sitting in the one file whose defaults are spread underneath *every* stored config on load.

### Removed — a config field nothing had read for a long time

`modelTransform` (scale, plan-centre X/Z, flip flags) was declared on `AppConfig`, given a default whose centre coordinates were measured against one specific floor plan, persisted, merged on every load, and read by absolutely nothing — the runtime plan→world solve in `roomCalibration.ts` replaced it and the field was simply never deleted. Its `ModelTransform` type went with it. Removing it also removes another set of villa-specific constants from shipped code.

### Changed — shared rules that had been re-implemented instead of shared

A pass over the source found four cases of the same rule written more than once, each the shape that drifts silently. `clamp()` existed three times (twice byte-identical in the two camera controllers, once more with renamed parameters in `useMediaZoom`) and now comes from `utils/geometry`. The `?debug` / `villa:debug` opt-in check was implemented independently in `devLog.ts` and `tapDebug.ts`; it is now one exported `debugFlagEnabled()`, with `devLog`'s additional dev-build-only gate applied at its own call site so the deliberate difference between the two stays visible rather than duplicated. Both Facility report builders opened by pushing the same four Markdown header lines, including the verbatim financial-reporting disclaimer, which is precisely the sentence you do not want drifting between two documents handed to the same owner — they now share one `reportHeader()`. And `useEntityLabel()`, a hook that exists specifically to stop the config-label/friendly-name double lookup being rewritten per screen, was still being hand-rolled in four components and wrapped in a local helper in a fifth.

Eight further symbols were exported but used only inside their own file, and one function (`warnFeedback`) had no call sites at all. Nothing user-visible changed here; the point is that the next person to touch any of these rules should not have to find every copy.

### Changed — documentation rewritten against what the app actually does

The README's feature table still described per-effect render-quality controls that were consolidated long ago, an MJPEG-only camera panel that now negotiates HLS first, and a tech stack listing two dependencies the project does not have. `MODEL_PIPELINE.md` still warned that Draco decoding needs an internet round trip — the exact opposite of the offline guarantee the decoder was bundled to provide, and advice that would push someone toward shipping a needlessly large GLB. `DOCS.md` described a "Load the schedule" button seeding a regional maintenance schedule; that seed was removed in 2.47.0 and the button no longer exists, but a stale comment in `ScheduleEditor.tsx` still referred to "the seeded ones" and had kept the claim alive in the docs.

All four documents now describe the shipping build: the HUD and its long-press gestures, Cockpit, the bottom dock, every entity panel, HA-sourced scenes, device groups, the rooms dial, both settings tiers and the three-profile access model.

### Changed — licence

The repository shipped under AGPL-3.0, which grants exactly the reuse, modification and redistribution rights this project does not intend to give. It is now proprietary, all rights reserved, with `package.json` marked `UNLICENSED` and the README's licence section rewritten to match.

## 2.122.0

### Changed — badges stay individually tappable at far larger icon sizes

Reported with two screenshots: at the largest icon size that still showed individual badges, some of them overlapped; one step bigger and the whole room collapsed into its `Master Bedroom 7` chip. Both halves of that are a problem for the app's actual deployment — a tablet on a wall, read and operated from across the room. Icons have to be large to be legible and finger-sized at that distance, but the room chip is not a smaller badge: it is an extra tap between the user and the light they wanted to switch. So the usable icon size was being capped by the layout rather than by the screen.

The cause was that a fanned huddle was laid out as a **single horizontal row**. A row's width grows *linearly* with the number of badges, so seven badges needed seven badge-widths of clear room inside their own room's floor plan; past a fairly small icon size that never fits, `pileFitsItsRoom` refuses, and the room summarises. The huddle is now laid out as a compact **grid** instead, whose width grows as the square root of the count — those same seven badges need about three widths, not seven. That is where the extra headroom in icon size and zoom-out comes from; nothing about the grouping decision itself changed, and it remains a pure function of world-space position and zoom.

Cells are uniform and sized from the widest member, so no two badges in a huddle can overlap by construction — there is no solver and nothing iterative here, and the same input always produces the same layout. That is deliberate: every previous overlap fix in this subsystem was a force-relaxation solver, and each one eventually failed the same way, by never settling and leaving badges visibly dancing. Member order is by entity id for the same reason. The layout now also offsets badges vertically, which the row never did.

`FAN_MAX_TRAVEL_WIDTHS` — the cap on how far one badge may sit from the device it labels — is raised from 1.5 to 3 of its own widths, and is now measured as a true 2-D distance since the grid moves badges on both axes. 1.5 was chosen in 2.121.0 purely to stop badges being laid out on the lawn and gave no thought to the other side of the trade: set too tight, ordinary huddles fail to fan and collapse into a chip. Three widths still reads unmistakably as "next to that device" while leaving enough room to actually resolve a crowd. The budget is still expressed in badge widths and still deliberately not multiplied by the icon-size factor, so it cannot grow just because the icons were made bigger.

Badges belonging to *different* piles are still only kept apart by the grouping radius, not by this layout — piles are separated in world space, and the grid only guarantees no overlap within one huddle.

### Fixed — the "disconnected from Home Assistant" bar covered the header

It was a full-width strip pinned to the top of the screen, so it sat across the villa name, the category rail and the corner controls — hiding the UI at exactly the moment someone is trying to work out what still responds. It is now a centred pill sitting below the top bar, clear of the corners, with nothing but empty canvas behind it.

## 2.121.0

### Fixed — badges laid out on the lawn, far from the devices they point at

After 2.120.0 stopped room *chips* from travelling, a screenshot showed the problem still present one level down, in the individual badges: a light, a fan and a water badge sitting in a row off the villa's left wall, over grass, with nothing under them.

Those badges were in a *fanned huddle*. When several devices project close enough together to overlap, the badges are laid out side by side in a short row rather than clustered away — a deliberate concession ("it's ok to artificially move the icon a bit to make them not overlap"). The guard on that concession was `pileFitsItsRoom`, which checks the row's total width against the room's own width from the drawn floor plan. It had the same shape of flaw the chip nudge did.

First, when a room has no drawn polygon the guard fell back to the spread of that room's own devices. For an ordinary room that is a reasonable stand-in. For a sprawling outdoor or plot-wide bucket it is not: the devices span the whole property, so the reported "room width" was the entire site, the guard waved through a row as wide as the villa, and the badges at its ends were laid out over open ground. A room with no polygon has no measurable space to lay anything out in, so that fallback is gone — such piles now cluster instead, which is the same "merge rather than travel" answer chips were given in 2.120.0.

Second, and independent of the polygon: bounding the row's **total width** says nothing about how far any **one** badge moves. The row is centred on the huddle's mean projected position, so a member sitting away from that mean is displaced by the mean-offset plus its own slot offset, and a wide room licenses a wide row whose outermost members travel furthest. A badge points at exactly one device, so unlike a chip it is actively misleading the moment it stops being next to that device. Each member's displacement is now bounded to `FAN_MAX_TRAVEL_WIDTHS` (1.5) of its own width, and a pile that cannot be fanned inside that budget is not fanned at all — it clusters. The budget is expressed in badge widths and deliberately **not** multiplied by the icon-size or zoom factor, since a budget that grows with icon size is precisely the defect that put a chip on the lawn.

The predicate now measures the exact offsets `fanBadges` will apply, via a shared `fanLayout()` that both call — a guard that judges a different layout than the one actually drawn is how a badge ends up somewhere the guard believed it could not reach.

## 2.120.0

### Fixed — a room chip could end up outside the villa entirely

A screenshot showed the **Master Bedroom** chip sitting on the lawn, well clear of the building, with no device anywhere near it. The same report noted two related symptoms: chips drifting a long way from the rooms they name whenever the icon size was turned up or the view was zoomed out, and — separately — the general complaint that badges should never be seen overlapping at all.

The cause was the mechanism used to keep chips from stacking on top of each other. Since chips carry text they are far wider than a badge, so two rooms whose centroids project close together used to overlap into an unreadable pile; `relaxBoxes` pushed them apart, with a travel budget of `CLUSTER_MAX_NUDGE_HEIGHTS * CLUSTER_HEIGHT_PX * scale`. That budget was wrong in two independent ways. It multiplied by `scale`, so raising the icon size granted a chip *more* licence to travel away from the room it labels — exactly backwards from what the size control implies. And it was a budget in screen **pixels** applied against a **world-space** anchor: zoom out and the villa covers fewer pixels while the chips keep their pixel size, so they overlap more, the solver pushes harder, and a displacement that merely looked untidy at full zoom put a chip completely off the building. The solver itself was never at fault — it only ever knew "these boxes must not overlap", had no notion of where the villa was, and would happily satisfy that constraint by putting a chip anywhere on screen.

The invariant that was missing, and is now written down in the code: **a chip must never leave the room it names.** That cannot be reconciled with "chips must never overlap" by capping the travel distance, because at low zoom there is genuinely no non-overlapping arrangement to find — capping the nudge just trades a chip on the lawn for chips that still touch.

So overlapping chips are no longer displaced at all; they **merge**. Every chip now renders exactly on its own anchor with zero horizontal offset, and the only way an overlap gets resolved is by two chips becoming one — the same answer map engines use for marker clustering, and the same principle the badge grouping already follows one level down. The merge runs worst-overlap-first and repeats until nothing overlaps, so the result does not depend on the order rooms happen to be iterated in. The surviving chip keeps the busier room's name plus a `+N` suffix (so its count pill is never mistaken for a single room's device count), takes the device-count-weighted centroid of the rooms it absorbed as its anchor — leaving it among the devices it stands for — and owns the union of their entity ids, so tapping it still selects everything it represents. Both properties now hold literally, at every zoom level and every icon size: nothing overlaps, and nothing travels.

`relaxBoxes` and its `Nudgeable` type have been deleted from `labelLayout.ts` along with the `CLUSTER_MAX_NUDGE_HEIGHTS` constant — the chip layout was their last caller, and the badge layout has not used force relaxation since the world-space grouping rewrite.

# Changelog

## 2.119.0

### Fixed — badges sat overlapping for several seconds, then rearranged themselves untouched
- **Reported exactly that way, and it was a regression introduced by 2.113.0's own frame-skip optimisation.** `setResolvedRooms()` writes the entity→room map that `roomOf()` reads — and `roomOf()` is what *every* grouping and room-clustering decision keys on. But it did not call `markLayoutDirty()`.
- **Why that only became a bug in 2.113.0**: room resolution deliberately lands **after** the reveal. `calibrateRooms` runs in `loadModel`'s deferred post-first-frame block precisely because its raycasts are far too heavy to sit on the load path, so the first painted frame is always drawn before any entity has a room. Until 2.113.0 `cullLabels` ran on *every* frame and simply picked the map up on the next one, so nobody ever noticed. After 2.113.0 it runs only when something marks the layout dirty — and since this setter didn't, **the badges kept a layout computed while every entity still resolved to `NO_ROOM_LABEL`**: nothing grouped, nothing clustered, everything overlapping. They stayed that way until some unrelated event (a state change, a camera move) happened to dirty the layout, at which point they snapped into place on their own. That is the reported symptom precisely, and it explains why it always looked like a delay rather than a failure.
- One line, in the one place that had the missing invalidation. The frame-skip itself is unaffected — this only restores the "room data changed, so the layout must be recomputed" edge that 2.113.0's dirty-tracking should have had from the start.

### Known, NOT fixed — cluster chips can be pushed outside the villa
- Raised alongside the above with a screenshot: the **Master Bedroom** chip sitting on the lawn, well outside the building, and chips drifting far from the rooms they name when the icon size is large or the view is zoomed out. Recorded here rather than fixed, because the correct fix is a design decision that has not been taken yet.
- **Root cause, for whoever picks this up**: `updateClusters` passes `CLUSTER_MAX_NUDGE_HEIGHTS * CLUSTER_HEIGHT_PX * scale` as `relaxBoxes`' `maxOff` — the furthest a chip may be pushed from its anchor. Two things are wrong with that expression. It multiplies by `scale` (= `iconUserScale × iconZoomScale`), so **turning the icon size up grants a chip more licence to travel away from the room it describes**, which is backwards. And the budget is expressed in **screen pixels while the anchor's meaning is a world position**: zoom out and the villa covers fewer pixels while chips keep their pixel size, so they overlap more, relaxation pushes harder, and a displacement that was "just outside the room" at full zoom puts a chip off the building entirely. `relaxBoxes` knows only that chips must not overlap; it has no notion of where the villa is, and will satisfy that constraint by putting a chip anywhere.
- **The missing invariant is "a chip must never leave the room it names", and it is expressed nowhere in the code.** Note the two requirements are in tension: capping the nudge harder keeps chips home but leaves them touching at low zoom, because there genuinely is not room to separate them. Resolving it properly means chips that cannot be placed within their room should **merge or collapse into a neighbour** rather than be flung — the approach map engines take — which is a real change to the subsystem whose header already records six failed rewrites. Not something to attempt as a side effect of a bug fix.

## 2.118.0

### Corrected — 2.117.0's pin did not fix the slow paint, it EXPOSED it
- **The 2.117.0 records overturn the conclusion 2.117.0 shipped with, and that has to be said before anything else.** Two PWA loads: `rdrMs 11628` with **`stallMs 11931, stallMaxMs 11656, stallMaxAt 2058`**, and `rdrMs 12735` with **`stallMaxMs 12760`**. `tReady` on the first was 2038ms — so the worst stall *starts at the moment of reveal* and its duration *matches `rdrMs` almost exactly*. That is **one single blocking main-thread task of ~11.6 seconds**, and it is `scene.render()` drawing the first frame.
- **So the render loop was never the cause.** The pin worked exactly as designed — it made the first frame render immediately instead of waiting for an accidental wake-up — and in doing so it moved the cost into view. Before the pin, the loop slept, the driver had many seconds to finish work in the background, and by the time something woke it the render was cheap; that is why 2.116.0 measured `stallMs 182` and I concluded "the main thread was idle". **That reading was correct for that record and wrong as an explanation.** The work was always there; the old code was just measuring the wait for it rather than the work itself.
- **What the data now says plainly: the first frame costs ~11.6s of MAIN-THREAD time in the PWA.** That is not a GPU queue (`cmpMs` 56–202ms), not a hidden page (`hidMs 0`), and not the model — those two PWA loads used the **light** albedo GLB (74 materials, 12MP).

### Found — the PWA and Ingress paths are not performing the same work
- **The operator has said twice that the add-on (Ingress) feels better. The 2.117.0 data supports it, and the comparison is stark because it runs the other way from the models:**
  - **PWA** (`standalone: true`), **albedo** GLB, 74 materials, 12MP → **`rdrMs` 11,628 and 12,735**
  - **Ingress** (`standalone: false`), **lightmap** GLB, **334** materials, 17.1MP → **`rdrMs` 4,039**
  - The Ingress path draws a model with **4.5× the materials** in **a third of the time**. Whatever the difference is, it is not the asset.
- **Leading hypothesis, and the field added here tests it directly: the PWA window is falling back to SOFTWARE rendering (SwiftShader).** A CPU rasteriser does its first-frame shader compilation and rasterisation on the main thread, which produces exactly one enormous blocking task — the shape observed — while a GPU draw does not. It would also explain the PWA's `context-lost` counter reaching **36**: repeated GPU-process loss for that origin is precisely what makes Chrome blocklist acceleration and fall back.
- **`gpu` is now in every load record** — the WebGL `RENDERER` string, read off the **live** engine (`getGlInfo`) rather than a throwaway canvas, since creating a second context purely to ask this question would add to the very context pressure under investigation. `webglInfo()` has collected this since long before, but only for the **error screen**, so no successful load ever carried it. That omission is why five releases of analysis could not separate "slow GPU" from "no GPU".
- **Next record settles it**: if PWA reports something like `SwiftShader`/`llvmpipe`/`Software` while Ingress reports the real Apple/AMD GPU, the cause is confirmed and the fix is about GPU-process stability for that origin, not about the model, the loop, or the loader. If both report the same hardware renderer, this is eliminated and the difference lies elsewhere in the two paths (service worker — registered for the PWA, absent under Ingress — being the next candidate).

## 2.117.0

### Fixed — the render loop could fall asleep before it had ever drawn the villa
- **2.116.0's split found it on its first real load, and it is not what any earlier guess said.** The record: **`paintMs: 19331`, of which `rdrMs: 18971`, `cmpMs: 360`, `hidMs: 0` — with `stallMs: 182` and the worst stall at 460ms, before ready.** Read together those eliminate every previous theory at once. The compositor and GPU queue took **360ms**, so it was never a GPU or texture problem. The page was **never hidden**, so the background-throttling explanation (mine, given confidently, twice) is dead. And **the main thread was IDLE for those 19 seconds** — 182ms of work total — so it was never shader compilation, buffer upload, or model weight either. Nothing was computing. **The villa simply was not being drawn.**
- **Root cause: the on-demand render loop's window can expire before the first frame exists.** `runRenderLoop` only calls `scene.render()` while `keepRenderingUntil` is still in the future. `markReady()` requests 1000ms and the reveal path adds 350ms — and if the first frame has not landed inside that window, **the loop stops having never rendered anything**. `onAfterRenderObservable` then cannot fire until some unrelated event — a pointer move, an incoming HA state change, a fan animation tick — happens to request a frame. `rdrMs` was measuring the wait for that accident, which is exactly why the figure ranged from 2s to 52s across otherwise similar loads with no work to account for the difference.
- **The reveal now pins continuous rendering** (`pinContinuous`, which already existed for the camera-stream case) from "ready" until the first frame is confirmed on screen, then releases it. The race is removed rather than made less likely: the loop cannot idle before it has drawn once. On-demand rendering — which is what keeps an idle wall tablet from burning power — is otherwise untouched, because the pin is released the instant the frame lands or the 15s guard gives up.
- **Why it was worse on the lighter model**: fewer materials and no lightmap mean fewer incidental redraws, so nothing happened to wake the sleeping loop. The same mechanism explains the operator's observation that the **Ingress (HA add-on) path feels more responsive than the standalone PWA** — the sidebar page sits under constant HA-driven activity that kept waking it by chance.
- **Stated as a hypothesis that fits every field, not as proven.** It is the first explanation consistent with all four measurements simultaneously, but confirmation is a load coming back with `rdrMs` in the tens of milliseconds. If it does not collapse, this is cleanly eliminated and the remaining suspect is rAF starvation at the window/OS level.
- **Context for the numbers above**: they were taken against a `--bake` (albedo) GLB used purely as a diagnostic instrument — 74 materials, 12MP, 11.6MB. **The shipping model is and will remain `--bake-lightmap`** (334 materials, 26.6MP), so the GPU-memory headroom question that produced the earlier crash-loop is unaffected by this fix and still stands on its own.

## 2.116.0

### Fixed — `paintMs` was one number covering three unrelated waits, so it could not be diagnosed
- **The operator's objection was correct and is the reason for this release: "I feel you keep misunderstanding the telemetry — either it's badly implemented or you are missing something."** It was badly implemented. `paintMs` measured `setStatus("ready")` → Babylon's `onAfterRenderObservable` → one `requestAnimationFrame` → timestamp, and reported the whole span as a single figure. Those are three different things with three different causes, and no combination of the other fields could separate them. Every large value was therefore explained by *guess* — first as GPU shader compilation, later as background-tab throttling — with the data unable to confirm or refute either. Two of those explanations were given confidently and at least one was wrong.
- **Split into its actual components**, all reported alongside the unchanged `paintMs` so historical records stay comparable:
  - **`rdrMs`** — ready → `onAfterRender`. Our own render call: shader compilation and buffer upload land here. This is MAIN-THREAD time, so it must also appear in `stallMs`; if `rdrMs` is large while `stallMs` is small, the two disagree and one of them is lying.
  - **`cmpMs`** — `onAfterRender` → the next rAF. The compositor actually putting the frame on screen. GPU-queue time lands here and is **invisible to the long-task observer**, which is precisely why it could never be distinguished from the above.
  - **`hidMs`** — how much of that span the page spent **not being drawn at all**. A hidden page cannot paint and its rAF does not fire, so any load spanning a hidden stretch was reporting that as though it were work.
- **`hidMs` is measured, not inferred.** A new visibility tracker (`installVisibilityTracker`, wired in `main.tsx` beside the stall observer) accumulates hidden time from the first millisecond — deliberately installed before anything begins loading, so a load that *starts* on a backgrounded tab is accounted from the beginning rather than from its first `visibilitychange`. Callers sample the cumulative total at two points and subtract, so the module needs to know nothing about load phases.
- **What this makes answerable.** A record showing `rdrMs` large is real work on our side. `cmpMs` large is the GPU/compositor, where the long-task observer is blind. `hidMs` large means the number was never about performance at all. And since every record already carries `standalone`, the operator's observation that **the Ingress (HA add-on) path feels more responsive than the standalone PWA** becomes a testable claim rather than a hunch — the split can now show whether the two differ, and in which half.
- No behaviour changed: this release only measures. The unexplained 10.9s paint on the albedo GLB is deliberately left unexplained rather than given a third speculative cause; the next load record should attribute it.

## 2.115.0

### Fixed — a stalled model download had no timeout at any layer, so the load just hung
- **Reported as "a few failed attempts" when loading a newly generated GLB.** The telemetry shows the shape of it exactly: a load carrying **`fetchMs: 87385`** — the user watched a spinner for **87 seconds** — with `visibleMs: 98008`. Nothing errored, nothing retried; the transfer simply crawled and the app waited.
- **Root cause: `fetchModelWithRetry` bounded the wrong thing.** It has a generous 120s *retry budget*, but that budget is only ever consulted **inside the `catch`**. Retries fire when something THROWS — `fetch()` rejecting, or the body stream dropping mid-read. A connection that stays open and simply stops delivering bytes never throws, so the retry path is never entered and the budget never checked. There was no per-attempt timeout, no header timeout, and no stall detection: a transfer that stopped moving would wait forever. Every layer assumed some other layer had a timeout, and none did.
- **Fixed with a STALL watchdog rather than a duration timeout**, which is the distinction that matters: a large model on a slow link is legitimately slow and must never be killed for it. The new bound measures only the **gap between chunks** — 20s with no bytes at all means the transfer is stuck, not slow — and rejects, which drops the caller into the retry path it already had (and which, from the second attempt, also escalates past the service worker). The request itself gets a separate, shorter 30s bound via `AbortController`, since response headers should arrive promptly even when the body then takes a while.
- **Also fixed in `modelPrefetch`, which is where the reported failure actually happened.** The 87-second record carried **`prefetched: true`**, so the stall was in the background prefetch — and `BabylonCanvas` *awaits* whatever that promise does (`claimPrefetch`) instead of running its own retrying fetch. A stalled prefetch is therefore worse than no prefetch: it converts a recoverable situation into an unbounded wait. Bounding only the foreground path would have left the real one untouched.

### Analysed — the crash loop, and why the guard behaved correctly
- The same session shows `WEBGL_CONTEXT_LOST` followed by `SCENE_LOAD_CRASH_LOOP` ("failed to load 3 times in a row over 67s"). **This is the safety net working, not a new bug**: it stopped a fourth attempt and surfaced an explanation instead of looping. The load succeeded on the next try and has been fine since.
- **The trigger was a genuinely heavier model arriving into an already-loaded tab.** The new GLB is up across every axis that costs GPU memory: **334 materials (was 252, +33%), 392 textures (was 285, +38%), 703 meshes (was 619), 26.6MP of texture (was 23MP)**, 18.35MB (was 16.82MB). That landed in a browser tab that had been running for hours. Worth stating plainly because it cuts against the previous release's direction: the 2.22.0 pipeline work brought materials *down* to 252, and this newly baked model gives most of that back — if load time and memory headroom matter, that regression is in the bake, not the app.

## 2.114.0

### Fixed — badge grouping ignored mounting height, so a ceiling fan grouped with the lamp beneath it
- **Reported from UAT: "I don't understand why the fan badges are considered apart from the grouping algorithm — it seems weird and inconsistent."** The observation was right; the explanation turned out to be the opposite of the wording. **Fans are not treated apart** — there is no type-specific branch anywhere in the grouping path, and `fan` sits in `PILL_CAPABLE_TYPES` alongside `light`/`cover`/`climate`/`sensor`. What made them *look* singled out is that they are the extreme case of a flaw that applied to everything.
- **Root cause: the decision and the drawing disagreed about how many dimensions exist.** A badge's anchor is placed just above its own geometry (`buildLabelAnchors` uses `max.y`), so mounting height varies by metres across one room — a ceiling fan's anchor is ~2.7m up, a table lamp's barely off the floor. Grouping ran on **ground distance (X/Z) only**, which makes a ceiling fan and the lamp directly beneath it *the same point*; but the badges are **drawn from the full 3D projection**, which puts them far apart on screen once the overview camera is tilted (its default). So the pair was fanned apart, or collapsed into a room chip together, on the basis of an overlap that was not happening.
- **Grouping now runs on 3D world distance (X/Y/Z).** `ShownLabel` carries `wy`, and the union-find proximity test adds the height term. **What deliberately did NOT change is the property this subsystem exists to protect**: the inputs are still anchor world positions and zoom alone — both independent of where the camera is looking from — so the result is still invariant under pan, orbit and tilt, still quantised to discrete zoom steps, still has zero hysteresis. This is the same test in 3D rather than 2D, **not** a return to the screen-space overlap testing that six earlier attempts died on. That distinction is the whole reason this was safe to change.
- `minPxPerWorldToDeclutterRoom` — the "how far must I zoom for this room to declutter" hint — moved to 3D in the same commit. Its entire contract is that it reuses `groupBadges`' reach/gap formula so the two can never disagree, and leaving it on ground distance would have quietly broken exactly that.
- **Known trade-off, stated rather than discovered later:** looking *straight down*, a ceiling fan and the lamp under it genuinely do overlap on screen, and they will no longer group in that view. Ground distance is the better model for a pure top-down camera; 3D distance is the better model for the tilted one this app actually opens in. The tilted case is the default and the one the report came from.

### Verified by UAT — 2.113.0's render-loop rework holds
- The operator ran the full regression list against the shipped build: **fan blades still spin** (the in-place quaternion write via `RotationAxisToRef` keeps Babylon's dirty flag set, as the code review predicted), **badges reposition correctly under pan/orbit/zoom**, **a value change updates its badge immediately** (no missed `layoutDirty` trigger), **floor switching and category toggles respond at once**, and **badge size/style changes re-solve the layout**. No stale-layout symptom in any of them, which is the failure mode the frame-skip optimisation could plausibly have introduced.
- **The memory fix itself remains UNCONFIRMED, and the telemetry explains why rather than showing a result.** Heap across a 31-minute 2.113.0 window went 358MB → 331MB (flat-to-declining) — but 2.111.0 over 86 minutes went 336MB → 321MB, i.e. **the machine used for testing was not exhibiting the drift in either version**, so the data cannot distinguish them. That is consistent with the diagnosis rather than against it: the leak only exists while something is *animating*, because the render loop sleeps otherwise. Confirming it needs a device left running for hours **with a ceiling fan on** — the condition that pins the loop awake.

## 2.113.0

### Fixed — the idle memory drift, at its source rather than behind a reload
- **The operator's objection was the right one: a wall-mounted tablet is the app's PRIMARY target, so "it leaks ~37MB/hour but reloads itself at 04:00" is not an acceptable resting state.** `autoReload.ts` had documented that drift since it was written, never root-caused — a DevTools heap snapshot had crashed the tab at ~800MB, so live diagnosis was judged too risky and the daily reload was shipped as a deliberate blunt mitigation instead. This release goes after the cause.
- **Root cause, and it is two things compounding.** `cullLabels()` — the badge layout pass — runs from `registerBeforeRender`, i.e. on **every rendered frame**, and rebuilds its entire working set each time: a `shown` array holding one object per visible badge (each with a nested `off` object), a `boxes` array of one object per badge from a `.map()`, nested `piles`/`fannable` arrays, and a `Vector3` per badge from `Vector3.Project`. At ~100 badges that is several hundred allocations per frame. On its own that would only cost while someone was actually moving the camera — except **the render loop does not idle when anything is animating**: `animateFans()` and `animatePulse()` each call `requestRender()` on every frame they run, which re-arms the loop indefinitely. **A single ceiling fan left on — entirely normal in a villa — therefore renders continuously for weeks, recomputing and reallocating the whole badge layout at full frame rate the entire time**, for a view that is not changing. That is the sustained garbage stream behind the "under normal GC churn" reading.
- **The layout pass now SKIPS entirely when nothing that can move a badge has changed.** The view-projection matrix is the honest test for the camera half — pan, orbit, zoom and fov all land in it — so 16 float comparisons replace a full relayout; the viewport dimensions catch a resize. Everything the matrix cannot see (a label's value text or category, the label set, badge scale, `hiddenCategories`, `badgeStyle`, the active floor) sets an explicit `layoutDirty` flag, wired into `apply`, `updateLabel`, `rebuildLabels`, `indexMeshes`, `updateConfig`, `setActiveFloor` and `applyIconScale`. The flag is deliberately generous: a false positive costs one recomputed frame, a false negative leaves a badge visibly stale, so every input that could plausibly matter marks it. A fan's blades spinning does **not** mark it — the fan's badge anchor deliberately sits on the blade rig's non-rotating parent (see `detachFanLabelAnchor`), so the spin genuinely cannot move it, and a pulse only changes emissive colour.
- **When the pass does run, it no longer allocates.** `shown` and `boxes` are filled from grow-only pools kept separate from the truncated per-frame arrays (so truncation cannot drop the objects and force reallocation next frame), `off` is explicitly reset per slot because a reused slot would otherwise inherit the previous frame's nudge, and `Vector3.Project` becomes `ProjectToRef` into one scratch vector. Only a badge count above the high-water mark allocates at all. **The grouping ALGORITHM is untouched** — same inputs, same world-space/zoom-only decision with no hysteresis, same outputs; only allocation and scheduling changed, which is the one kind of edit this subsystem's history permits.
- **The two never-sleeping animation callbacks stopped allocating too**, since they are by definition the ones that run forever: `animatePulse` reuses one scratch `Color3` instead of constructing one per frame, and `animateFans` writes through the existing quaternion via `Quaternion.RotationAxisToRef` rather than replacing it per blade rig per frame. Verified against Babylon's own change detection — `TransformNode._isSynchronized` reads `_rotationQuaternion._isDirty`, and `RotationAxisToRef` sets that flag explicitly, so writing in place still recomputes the world matrix and the fan keeps spinning.
- **Also fixed: `labelBoxes` shared its buffers between the render loop and `minPxPerWorldToDeclutterRoom`**, a public method driven by the UI. The two do not currently interleave, so nothing was broken — but a mutable buffer shared across a public method and the frame path is exactly the coupling that stops being true after a later edit, so the non-loop caller now passes its own arrays.
- **Honest scope**: this removes a large, mechanically-confirmed allocation stream from the path that runs 24/7, but it has **not** been measured against a real device — the drift's true magnitude after this change is unknown until field telemetry comes back. If heap growth persists, the remaining suspects are elsewhere and this narrows rather than closes the search.

### Added — a memory safety valve that does not wait for the clock
- The daily 04:00 reload had a hole for exactly the target device: at the documented drift a tab could still reach **~900MB before the next 04:00 came round**, and a mobile browser kills a tab well before that — experienced as the kiosk going white, not as a tidy overnight refresh. A heap-pressure trigger now reloads at the next safe moment (nothing open, no interaction for 5 minutes) once usage crosses **70% of the browser's own heap limit**. Expressed as a fraction rather than an absolute figure because that limit differs by an order of magnitude across the phones, tablets and desktops this runs on. Guarded against becoming a reload loop two ways: a one-hour minimum uptime, so a genuinely heavy start cannot cycle, and a six-hour cooldown that the daily reload also stamps, so the two triggers cannot fire back-to-back for the same accumulated memory.
- **This does not cover iOS/iPadOS** — `performance.memory` is Chrome-only and Safari exposes no heap API, so an iPad still relies on the daily reload plus its own context-loss recovery. Stated plainly rather than left to be discovered: for an iPad the fix above is the protection, not this valve.

### Fixed — `visibleMs` reported ~98 seconds for a load that took under 8
- A `loadSeq: 2` record carried **`visibleMs: 98,239`** beside **`reloadMs: 7,864`**. `visibleMs` is measured from the original page navigation, so on an in-page reload it reports "time since the tab was first opened", not the load. This is the identical stale-anchor mistake `bootMs`/`totalMs`/`waitMs` made before 2.105.0 — `paintMs`/`visibleMs` simply did not exist yet when that fix landed (they arrived in 2.109.0), so they never inherited its guard. `visibleMs` is now omitted on a reload exactly as the other navigation-relative figures already are; `reloadMs` already carries the correct span through paint.

### Audited — what is NOT leaking
- Recorded so the next investigation starts narrower. **Server `/data` is bounded everywhere**: telemetry is a 500-event ring, evidence photos have a retention sweep plus orphan collection, auth-failure tracking caps at 2048 tracked pairs, elevation tokens at 32, uploads at 200MB — there is no server-side saturation path. **Client teardown is disciplined**: every Babylon `addEventListener` has a matching remove inside an idempotent `dispose()` that also disconnects the `ResizeObserver` and force-releases the raw WebGL context. **The per-event path retains nothing unbounded**: `lastState` is keyed by entity_id, `badgeImageDataUrl` is cached by a finite key with Babylon short-circuiting identical `source` assignments, `syncEntityShadow` disposes on off and guards on existing, `ensureCluster` memoizes per room, telemetry has no client buffer, history is panel-scoped, and `HAWebSocket` deletes from both `pending` and `subscriptions`.
- One correction to the record: **`contextLosses` is a cumulative lifetime counter in `localStorage`, not a count of live contexts.** A reading of 32 means 32 losses ever recorded on that browser profile, surviving every reload — it does not indicate 32 leaked contexts pinned in one tab, and should not be read as memory pressure.

## 2.112.0

### Removed — a load-time cost that bought nothing, ever
- **The operator asked directly: is `paintMs` really mandatory every load, given the GLB is cached, or is there something to streamline?** Chasing that question through the reveal sequence turned up `ensureFirstPersonSpawn` — a pass that teleported the (inactive) first-person walker camera to its default spawn pose right after the overview reveal, via 16+ `pickWithRay` probes against the un-octree'd structure (700-790ms typical on the target iPad, up to 5.9s in the worst field sample recorded when this cost was first identified and moved off the reveal path).
- **It was pure waste, on every single load, for every user, whether or not first-person is ever touched.** `setViewMode("first-person")` — the code path that runs on an actual switch — already computes its own spawn fresh every time (from the room the user last picked in overview, or the default staircase pose) and never read or reused whatever `ensureFirstPersonSpawn` had precomputed. The eager pass paid a real, repeated raycast cost for a result nothing downstream ever consumed.
- **Worse: it likely inflated `paintMs` itself.** The raycasts ran from a callback registered on `scene.onAfterRenderObservable`, and the load-telemetry timestamp (`tPaint`) is captured in a *second* callback registered on the same observable, after it. Babylon fires same-event listeners synchronously in registration order, so on the very first post-load render notification the raycast pass very likely completed before the timestamp was taken — meaning some of what every prior release attributed to "GPU shader compile" in `paintMs` (2.109.0 onward) may actually have been this unrelated CPU-side work. This was not separately instrumented before, so the exact split is unknown, and no number is being claimed here beyond what the next round of field telemetry shows.
- `ensureFirstPersonSpawn` and the now-write-only `spawnApplied` flag are deleted outright rather than gated behind a check, since there was no real use left to preserve. `firstPersonSpawn`/`staircaseSpawn`/`bestFacing` are untouched — they still run, on demand, from the two places that actually need a computed spawn: a real view-mode switch, and the bulk-entity-recalibration re-teleport. First-person as a feature (the toggle, walking, `eyeHeight`/`walkSpeed`, room→first-person navigation) is unaffected; only the eager, discarded-before-use precompute is gone.

## 2.111.0

### Reverted — 2.110.0's shader pre-compilation was a net loss, measured
- **It made the load four seconds slower and did not even remove the freeze it was written for.** On the same villa, same device: **Android `visibleMs` 5,048 → 9,096**, and `stallMaxMs` stayed at **2,301ms**. The freeze moved out of `paintMs` (2,256 → 21ms) exactly as designed, and then cost more elsewhere than it had ever saved.
- **Three mistakes, all visible in the record it produced:**
  - **`compiledMats: 898` against a GLB with `glMaterials: 371`.** Iterating every scene mesh reaches hidden pose variants, the atlas carrier planes and the floor the view culls — none of which the first frame ever compiles. It was doing roughly 2.4× the necessary work.
  - **One `requestAnimationFrame` per 4 materials is ~224 yields at ~16ms ≈ 3.6s of pure waiting**, added straight to the wall clock. The yield strategy was chosen by count instead of by elapsed time, which is the wrong unit entirely.
  - **`forceCompilationAsync` still blocks in large chunks**, so the freeze survived regardless.
- **Babylon's own first frame is smarter than the replacement**: it compiles exactly the shaders the visible set needs, and nothing else. The pre-compilation is gone and the comment in its place records why, so it is not attempted again the same way.
- `paintMs`/`visibleMs` stay — they are what made this measurable, and what caught the regression within one release rather than after weeks of it feeling vaguely worse.

### Where this leaves the load
- Honest position after the revert: a healthy phone load is back to **~5.0s**, of which **PARSE ~2.2s** and **PAINT ~2.3s** are ~90%. Both are driven by the same property of the GLB — **371 materials**, which produce both the 765 primitives Babylon must import and the shader permutations the driver must compile. **No further app-side change moves this meaningfully; the lever is material count, and it is in the pipeline.** Everything the app can reach — the redundant remounts (2.108.0), the passcode re-entry (2.98.0), the JS bundle (2.96.0) — has already been taken.

## 2.110.0

### Measured — the whole load now accounts for itself, to within 2ms
- With `visibleMs` in place the arithmetic finally closes. A healthy phone load is **5,048ms**: boot 414 + engine 128 + config 3 + fetch 44 + **parse 2,193** + reveal 8 + **paint 2,256**. A loaded desktop is **13,371–15,049ms** on the same GLB. Summing the parts lands within **2ms** of the measured total in all three records, so nothing is hiding any more.
- **Two phases carry ~90% of it, near-equally: PARSE ≈ 45% and PAINT ≈ 45%.** Everything else — network, bundle, React, engine init, config, reveal — is together under 11%. Those are the only two worth attacking, and both trace back to the same property of the GLB.

### Fixed — the freeze at the end of the load
- The long-task observer found a **single 1,359ms blocking task inside `paintMs`**: all **371 materials** having their shaders compiled by the GPU driver in the first frame after the overlay lifted. It lands with no spinner on screen, because the code has already declared itself ready — which is exactly the freeze reported from the field.
- Compilation now happens **before the reveal**, one material at a time with a yield every fourth, so the longest single block is milliseconds instead of over a second, and the work sits behind the loading overlay where there is feedback. **This removes the freeze, not the cost** — the GPU does the same work either way, and saying otherwise would be dishonest. New `compileMs` and `compiledMats` report it, so a regression that pushes shader work back into the first frame is immediately visible.

### Where the remaining time actually is
- **`glMaterials: 371` is the root of both dominant phases.** glTF emits one primitive per (mesh × material) — that is the 765 primitives behind PARSE — and every material is a shader permutation the driver must compile, which is PAINT. Reducing material count attacks ~90% of the load at once, and it is a pipeline change, not a code one (see the pipeline's own `[report]` primitive budget).
- Two app-side observations logged rather than acted on: `maxSimultaneousLights` is set to **8** on every material, and the lightmap-mode structure materials keep their original names so the `unlit` fast path (which only matches `BAKED_` prefixes) never applies to them. Both plausibly inflate shader complexity. Neither is changed here — four hypotheses about this load have already been argued from plausibility and disproved by measurement, and `compileMs` is precisely the number that will show whether either is worth touching.

## 2.109.0

### Fixed — every "total" this app has ever reported stopped before the villa was on screen
- **The operator said the traces were wrong because they do not match the ~10s per load actually experienced, and that is correct.** `totalMs` — and every number derived from it — ended at `setStatus("ready")`, which is a **React state update, not a picture**. Still to happen after that line, all of it unmeasured: React committing the change, the loading overlay clearing, the browser painting, and the expensive one — **Babylon's first rendered frame**, where the GPU driver compiles shaders for all **371 materials** and binds **2.28M vertices** for the first time. First-frame shader compilation routinely costs seconds on a scene this size, and none of it was in any figure ever shown.
- This is the same mistake `revealMs` was created to fix in 2.94.0, one stage further down the pipe: a phase boundary chosen because it was convenient in the code rather than because it matched what a person waits for. Being wrong the same way twice is the part worth recording.
- The load record now waits for the villa to be **genuinely drawn** before it is sent, adding **`visibleMs`** (navigation start → first frame actually on screen — the number to compare against a stopwatch) and **`paintMs`** (`ready` → that frame, which is where shader compilation lands). The record was already fire-and-forget and already past the reveal, so holding it costs the user nothing. A 15s timeout still sends the record with `paintTimedOut` if no frame ever arrives, because the render loop is on-demand and "the villa never painted" is precisely the case worth hearing about. The Telemetry panel now leads with `visibleMs`.

## 2.108.0

### Fixed — the villa was torn down and rebuilt every time the profile switcher opened, and again when it was cancelled
- **Reported by the operator, who was right on both counts: "when I click on the profile selection view (while the villa is already loaded) and click on Cancel, the villa reload is happening again... there is no need to reload the villa map at all when the profile is changed."** The telemetry agrees — a record with `loadSeq: 2`, `gated: true`, **`pinned: false`**: a gate appeared, no passcode was ever typed, and the villa reloaded regardless.
- **Root cause was React reconciliation, not anything about auth.** `ProfileGate` returned four different tree shapes: `<>{children}</>` when signed in, `null` while resolving, and `<>{early && children}<div/></>` for each gate screen. React reconciles a fragment's children **by position**, and `children` here is itself an array — the whole provider tree down to `BabylonCanvas`. Moving it between "the fragment's only child" and "index 0 of an array" changes its implicit keys, so React could not match the old subtree to the new one: it unmounted the entire authenticated tree and built a fresh one. That happened when the overlay opened **and again when it closed**, so backing out of the switcher without changing anything cost a full ~2.5s GLB re-parse and a brand-new WebGL context.
- There is now **one return with one structure**: always two slots in the same order, slot 0 being `children` whenever a session exists — including while the switch overlay is up. A profile change re-filters the scene through the existing `sceneConfig` effect, which is the correct behaviour: the geometry is identical between roles, only what may be shown differs. A first-ever visit still renders the gate alone, so the pre-login decode stays disabled exactly as 2.79.0 left it.
- This also explains two things previously logged as separate mysteries: the **WebGL context-loss counter climbing into the teens** (17 by this session) and the **heap growing across a session** — each redundant remount abandoned a scene and took a new GL context.

### Ruled out — the freeze is not main-thread blocking
- 2.107.0's long-task observer answers the question it was built for, and the answer is negative: **`stallPreCount: 0` and `stallPreMs: 0` on every record**, with total blocking of only 249–380ms across 3–4 tasks (worst 191ms). Whatever the pre-login screens are doing, they are not blocking the main thread — which eliminates the entire class of cause that four earlier hypotheses lived in. A decisive negative is worth as much as a positive here, and it is why the search moved to reconciliation instead.

### Noted, not yet fixed
- **`hydrate` runs twice on every connect** — `connect()` calls it directly and the reconnect effect fires again on the same transition — so 995 entity states are fetched twice per load. Visible as paired `ha-connect` records milliseconds apart. Left alone deliberately: the reconnect path guards against stale state after a dropped websocket, and a careless fix there trades a duplicate fetch for a silently stale villa.
- One `registry` pull took **5,276ms**. It is network time, not main-thread time (its `applyMs` sibling is 1–4ms), so it cannot freeze the UI, but it does delay live room/floor data on a slow link.

## 2.107.0

### Wrong again — the Home Assistant hypothesis is dead, and the measurement killed it cleanly
- **2.106.0 guessed that the pre-login freeze was HA's connect running above `ProfileGate`. It is not.** `hydrate` reports **995 states with an `applyMs` of 1–4ms**, the entity registry **1,581 rows in 73–141ms**, and — decisively — **`preLogin: false` on every single record**, so none of it even lands on the screen in question. That is the fourth hypothesis about this freeze (the JS bundle, the Draco worker pool, texture decode, now HA connect) to be argued from plausibility and disproved by data. The pattern is the lesson: none of them should have been argued at all.

### Fixed — a second stale-anchor bug in the same instrumentation
- `mountMs` fell back to the `react` mark when no sign-in had happened, and `react` is **page-level and never cleared**. On a reload that measured from the page's React mount rather than this load, producing **`mountMs: 21001` on a load whose own span was 2,186ms** — the identical failure `bootMs` had, in a field 2.105.0 left behind. It is now emitted only when its anchor genuinely belongs to the current load. The 8,961ms sibling reading is discarded for the same reason: it exceeds the entire sign-in cycle it claims to sit inside, so it cannot be real either.

### Added — ask the browser where the main thread is blocked, instead of guessing
- A freeze **is** main-thread blocking, and the browser reports every task over 50ms as a `longtask` entry. After four wrong hypotheses, the honest move is to stop reasoning about which code might be slow and read that directly. A `PerformanceObserver` now runs from the first line of `main.tsx` — before React, before anything the app itself times, because the freeze being chased happens on screens that exist before any of it.
- Reported as **`stallMs`/`stallCount`/`stallMaxMs`/`stallMaxAt`**, plus **`stallPreMs`/`stallPreCount`** — the subset that landed **before the villa began loading**, which is precisely the blocking a user meets with no spinner on screen to explain it. Counters reset with the per-load marks, so the window covers the whole cycle a person actually experiences: the previous scene tearing down, the gate, the passcode, and the villa rebuilding. The Telemetry panel prints it as `BLOCKED 1.2s/8 tasks (worst 340ms, 900ms pre-villa)`. If the next log shows large `stallPreMs`, the freeze is finally located rather than theorised about; if it shows none, the freeze is not main-thread blocking at all and that rules out an entire class of cause.

## 2.106.0

### Changed — measure what the profile/passcode screens are actually doing
- **The freeze on the pre-login screens is NOT fixed by this release, and 2.105.0 did not fix it either** — that one corrected the *measurement* that had invented a 35-second load regression, which is a different problem that happened to be reported at the same time. Saying so plainly matters, because the two got conflated.
- **The reason this has stayed invisible: a session that stalls at the gate emits no telemetry at all.** A `load` record is only written once the villa finishes, so every gated attempt is simply absent — the field dump behind this release contains five loads, all `gated: false`, and zero gated ones. There has never been data behind the reported freeze.
- **The prime suspect, from the reporter's own clue ("it freezes when I don't wait long enough on the profile selection screen"):** `HAStateProvider` is mounted ABOVE `ProfileGate` (`App.tsx`), so before anyone has logged in the app already opens the Home Assistant websocket, runs `hydrate()` — `get_states` for **every entity in the instance**, then a map build and a `notify()` per entity — and pulls the **entity registry**, one row per entity, plus devices, areas and floors. That is JSON parsing and React commits on the main thread, for a screen whose only job is to answer a tap, and whose content needs nothing from Home Assistant. Waiting lets it finish; tapping early puts the tap behind it. It fits, but it is a hypothesis, and three hypotheses in this same investigation (the JS bundle, the Draco worker pool, then the texture decode) were all measured and disproved. So it is measured before it is acted on.
- New `ha-connect` telemetry, reported from the two calls that would carry the cost: `hydrate` (state count, fetch vs apply split) and `registry` (row count, duration). Both carry **`preLogin`** — whether the villa had started loading yet — because that single flag is what turns "HA connect takes N ms" into "N ms landed on the profile screen". The Telemetry panel leads with it. If the numbers come back small, the hypothesis is wrong and the search moves on with the blind spot closed either way.

## 2.105.0

### Fixed — the load telemetry reported a 35-second regression that never happened
- **Reported as "we've regressed, loads are back to ~10s", and the numbers did say that: `totalMs` 10,887 / 15,863 / 24,934 / 29,309 / 31,035 / 35,348 across one 90-second session.** They were wrong. Every one of those same records shows the actual work at **2.1–4.3s** (`engineMs + configMs + fetchMs + parseMs + revealMs`), unchanged from the good loads either side of them. The giveaway was three consecutive records reporting **`waitMs: 4815` to the millisecond** — a human cannot type a passcode in exactly the same time three times running.
- **Root cause, and it is mine, introduced with the boot timeline in 2.97.0:** the marks were a module-level map with first-write-wins semantics and no reset. That is correct for one villa load per page, and the app loads it again whenever the canvas remounts — signing out and back in does exactly that, which is what a session of profile-switching produces. From the second load onward `markBoot("scene")` silently did nothing while the caller's own `performance.now()` kept advancing, so **`bootMs` reported time since the page opened** rather than time for this load, `waitMs` reported the *first* sign-in forever, and `activeMs` (= totalMs − waitMs) inherited both errors.
- Per-load marks (`gate`/`pin`/`auth`/`scene`) are now cleared, and the page-level ones (`js`/`react`) deliberately kept. **The clearing happens on TEARDOWN, not at the start of a load** — a distinction the fix's own test caught: the sign-in is what *causes* the canvas to mount, so `gate` and `auth` are marked *before* the scene effect runs, and clearing there would have wiped the marks describing that very load and lost `waitMs` entirely. New fields **`loadSeq`** and **`reloadMs`** (this load's own span) replace the navigation-relative `bootMs`/`totalMs`/`activeMs`, which are now emitted **only for a page's first load**, because for any later one they describe nothing. The Telemetry panel's summary says which of the two it is showing rather than printing a "total" that isn't one. Verified against a 16-check harness that replays the exact failure in the order the app produces it — three loads with different sign-in times, one with no gate at all.

### Known, not yet fixed — memory growth across repeated villa loads
- The same session shows the JS heap going from **11 MB on a fresh page to 650 MB after eight model loads in ninety seconds**, with the WebGL context-loss counter climbing 7 → 10. That is consistent with the second half of the report — lag and freezing on the profile-select and passcode screens — because garbage collection at that heap size stalls the main thread regardless of what the UI is doing. It is a real problem and it is *not* addressed here; this release only makes the measurement trustworthy enough to investigate it. The question to answer next is whether `SceneManager.dispose()` genuinely releases the previous scene's geometry, textures and WebGL context, or whether each sign-in cycle leaves one behind.

## 2.104.0

### Fixed — `glTexMp` was counting the same image once per material that used it
- **Reported as 1,260 megapixels, which was dismissed as "impossible" and should not have been.** A number that large has a mechanism, and finding it took one read of the loader: `glTFLoader` builds each texture's URL from the **image** (`data:<root>#image{index}`), and `Texture` resolves its pixels through `_getFromCache(this.url, …)`. So Babylon creates one texture **object per material slot** but shares a single **InternalTexture per underlying image** — and `getSize()` reports the shared image's dimensions. Summing it per object multiplied every baked atlas by however many of the villa's 371 materials referenced it. The figure was never impossible; it was **reference-weighted**, not a memory total.
- Now de-duplicated on the internal texture's identity, so **`glTexMp` is the real megapixel total of DISTINCT decoded images**, with **`glTexImgs`** reporting how many there actually are. Read against `glTextures` (475 objects), the gap between the two shows how heavily the atlases are reused. This matters beyond tidiness: texture memory is what drives the GPU `context-lost` events this same telemetry records, and the wall-mounted iPad's memory ceiling — a wrong number there is worse than no number.

### Removed — the diagnostic scaffolding, now that it has done its job
- **The Draco instrumentation is gone.** It monkey-patched a **private** Babylon method (`_decodeMeshToGeometryForGltfAsync`) on the villa's critical load path, and it earned its keep: it proved Draco owns the import's tail, then proved the cost is calling-thread work per primitive rather than anything the worker pool can reach. With that settled, a patched private API in production is a liability with no remaining payoff — the next Babylon upgrade could change its shape, and the load path is the worst place in this app to carry a surprise. Nothing diagnostic is lost: **`glMeshes` counts the same primitives from a public observable**, and primitive count is the one number that matters for the remaining lever. If the pipeline ever merges meshes, `glMeshes` falling and `importMs` falling with it is the whole confirmation needed.
- **`glMesh`/`glTex`/`glMat` collapsed into a single `glGraph`.** All three always reported the *same instant* — they fire on object creation, not on data readiness — so three fields for one event was pure noise in every record.
- `numWorkers` is no longer set at all: Babylon's default is correct, and the comment there records that raising it was measured and disproved, so it is not retried.

### Where this leaves the build
- With the scaffolding out, the load work of 2.96.0–2.103.0 is complete and production-clean: **13,398ms → ~2,150ms desktop / ~2,550ms phone**, no patched private APIs, no misleading metrics, no debug logging. What remains in the telemetry is a deliberate product feature — the Settings → Telemetry panel that made every one of these findings possible from devices nobody here can hold.

## 2.103.0

### Reverted — doubling the Draco worker pool changed nothing, and the experiment says why
- **2.102.0's hypothesis is refuted by its own pre-registered test.** Android went from 4 workers to 8 and `glDracoMs` moved **1431 → 1430 / 1431**. Desktop went from 2 to 4 and moved **1436 / 1296 → 1325 / 1259**, which is inside the run-to-run noise already visible across earlier samples. Twice the workers bought nothing on either machine, so the ~1,430ms Draco phase is **not worker-bound**, and the pool size is back to Babylon's own default — a bigger pool costs one WASM instance per worker on a device that is a wall-mounted iPad, and buys zero.
- **What that leaves is the answer, by the elimination this whole sequence was built to perform.** The cost is on the **calling thread**: roughly **1.9ms per primitive, 765 times over** — slicing each buffer view, marshalling it to a worker and back, then building vertex buffers and uploading each primitive's attributes to the GPU (765 primitives at several attributes each is thousands of small driver calls). No amount of worker parallelism touches any of that, which is exactly why the phase was identical on a phone and a desktop from the very first measurement.
- The comment at that constant now records the refutation explicitly, so nobody re-raises `numWorkers` expecting a win that has already been measured and disproved. `glDracoWorkers` stays in the telemetry — the comparison that killed the theory was only possible because the pool size was in the log.

### Where the villa's load actually stands
- **The application-side load path is essentially done.** Across this sequence the villa went from **13,398ms** to **~2,150ms desktop / ~2,550ms phone**, with the passcode prompt (2.4–3.1s of pure re-entry) removed, the JS bundle cut 56%, and every remaining phase measured rather than guessed at: `bootMs` ~260–450, `engineMs` ~60–180, `parseMs` ~1,700–2,150, `revealMs` 5–8ms. Nothing left in the app's own code is worth more than a few tens of milliseconds.
- **The one remaining lever is the GLB itself, and it is a pipeline change rather than a code change: 765 Draco primitives.** The per-primitive main-thread cost is fixed, so the phase scales with the COUNT, not the vertex total (2.28M vertices is incidental — the same geometry in far fewer primitives would cost far less to load). Merging the static structure/decor meshes in the Blender pipeline is what converts that ~1,430ms into a fraction of it; entity meshes must stay individually named and separate, since the app resolves them by name for binding, picking and pose variants. As a rough scale: 765 → ~150 primitives would put the phone's total near 1.4s.

## 2.102.0

### Found — the villa's load tail is Draco per-call overhead, not decode work
- **`glDracoEnd` lands within 1–3ms of `importMs` on every sample** (1541 vs 1544 on the phone, 1500 vs 1502 and 1360 vs 1361 on desktop), and **`glDracoN` is 765** — every mesh in the GLB is separately Draco-compressed. Draco is the import's tail, conclusively, which is what the previous two releases were built to establish.
- **The parallelism figure is what actually cracked it.** `glDracoSum ÷ glDracoMs` came out at **353–400×**, which is impossible as real concurrency and therefore means something else: all 765 decode calls are queued up front, so each promise sits pending for most of the import and `glDracoSum` is measuring **queue wait**, not work. The useful number is throughput: **765 decodes drain in ~1,430ms**, which against Babylon's default pool of 4 workers is **~7.5ms of worker time per primitive** — and that per-primitive figure is **identical on a desktop Mac and an Android phone** (1,431ms vs 1,436ms for the same 765 tasks). Decoding a ~3,000-vertex primitive is well under a millisecond of real work, so a cost that does not move with CPU speed is **per-call overhead** — message passing, structured clone, per-invocation WASM setup — not compute. That finally explains the device-independence first noticed two releases ago, and it means the earlier instinct to blame the codec was wrong: swapping Draco for meshopt would have re-paid the same 765 per-call costs.
- The implied worker count of 4 matches Babylon's `min(cores/2, 4)` default exactly, which both confirms the model and points at a fix that needs no pipeline change.

### Changed — doubled the Draco decode worker pool
- **`numWorkers` is now `min(hardwareConcurrency, 8)` (floor 2) instead of Babylon's conservative `min(cores/2, 4)`** — consistently **twice** the workers on any device, so this reads as a controlled experiment rather than a tweak. Overhead that lives *in* the worker scales with the pool, so if the diagnosis holds the phase should fall roughly in proportion. Capped at 8 because each worker holds its own WASM instance and the target is a wall-mounted iPad, not a workstation; `hardwareConcurrency` is absent on some browsers, hence the fallback.
- **`glDracoWorkers` is reported alongside**, so the next field log is self-interpreting. Throughput is `glDracoN ÷ glDracoMs`: if it scales with the pool, the phase is worker-bound overhead as diagnosed and the remedy is settled. **If it does not move, the cost is on the calling thread** — serialising 765 messages — and the answer is *fewer primitives from the pipeline*, which is a completely different fix. Either result is informative, which is the point.

## 2.101.0

### Ruled out — textures are not the load bottleneck, which settles an open question
- **`glTexDone: 475` of `glTextures: 475` — full coverage, so this is not a partial answer — and every texture is decoded and uploaded by 25–38% of the import.** On the phone `glTexReady` is 526/580ms against an `importMs` of 1609/1537; on desktop 328/351ms against 1305/1343. **Roughly 1,000ms, about 65–75% of the import, happens after the last texture is ready.** Textures are simply not where the time goes — which retroactively confirms that declining KTX2 was the right call, since it would have bought very little here.
- **`glTexMp` is not trustworthy and is being reported as such rather than quietly used.** It came back as 1,260 megapixels, which would be roughly 5GB of texture memory — the phone would not survive that. Either one image is being counted once per texture object referencing it, or `getSize()` does not mean what was assumed. No conclusion in this changelog rests on it. `glKVerts: 2278` (2.28M vertices across 766 primitives) is real, and is a lot of geometry for one building.

### Changed — measuring Draco directly, because the obvious conclusion is contradicted by the data
- With textures excluded, geometry owns that second, and the natural next move would be "replace Draco with meshopt". **The timings argue against it.** That ~1,000ms is nearly identical on a MacBook and an Android phone — 977/992ms versus 1083/957ms. CPU-bound decode of 2.28M vertices would be several times slower on the phone; work that does not scale with CPU speed is usually **per-call overhead, not compute**. Acting on the obvious answer would have committed the villa to a vendored decoder plus a full pipeline re-export on a hypothesis its own evidence contradicts — and two earlier guesses in this same investigation (the JS bundle, then the object-creation milestones) were already wrong.
- So the one function that settles it is now measured. Reading Babylon's loader source first showed that `ImportMeshAsync` **resolves at the READY state**, with `onCompleteObservable` firing afterwards inside a `SetImmediate` — so completion hooks sit outside `importMs` entirely and would have measured nothing, and `compileMaterials` defaults to false, which rules out shader compilation as the hidden cost. That leaves the per-primitive geometry promises, and the glTF Draco extension routes every one of them through a single method. Wrapping it yields **`glDracoN`** (how many primitives are Draco-compressed at all — `0` would mean the villa is not using Draco and the whole theory is void), **`glDracoEnd`** (when the last decode finished, measured from the import's start — if it lands at `importMs`, Draco owns the tail; if it does not, something after geometry does), **`glDracoMs`** (first decode start to last decode end) and **`glDracoSum`** (summed per-call time). **`glDracoSum ÷ glDracoMs` is the effective parallelism**, which is what separates "the four decode workers aren't actually being used" from "each call is cheap but there are 766 of them" — two problems with completely different fixes.
- This is the first change to monkey-patch a Babylon prototype method on the critical load path, where getting it wrong means the villa never loads at all, so it is written to be transparent and was proven so rather than eyeballed: the wrapper always delegates, returns the original promise untouched, and only observes it. Verified against a harness covering value pass-through, `this` binding, rejection still reaching the caller, no unhandled rejection being introduced, a non-promise return, and the parallelism metric reading a true 4.0× for four concurrent calls. If Babylon ever renames the private method, the patch is skipped silently instead of breaking the load. Counters reset per load, since this app re-imports on every Android PWA relaunch.

## 2.100.0

### Fixed — 2.99.0's import milestones measured the wrong thing, and said so loudly
- **The first field reading was unambiguous and not what was expected: `glJson: 47`, then `glMesh`, `glTex` and `glMat` all landing at exactly `110` — while `importMs` was `1609`.** Three independent milestones reporting the same instant is not a coincidence, it is a signal that they all measure the same event. Babylon's own documentation confirms it: `onMeshLoaded` and friends fire "as soon as the mesh object is created, meaning some data may not have been setup yet for this mesh (vertex data, morph targets, material, ...)". So 2.99.0 measured **object-graph construction**, not decode.
- That is still a real finding — building the entire graph (766 meshes, 475 textures, 371 materials) takes ~110ms, about **7%** of the import — but it means the other **~93% is the asynchronous data phase those callbacks never bracketed**, and the question of what fills it was still open. The milestones are kept (with a comment stating plainly what they do and do not mean, so nobody reads them as decode timings again) and a measurement that actually closes the question is added.
- **`glTexReady` is the decisive new field: when the LAST texture finished decoding and uploading**, hooked through each texture's own readiness rather than its creation. If it lands near `importMs`, textures own the tail; if it doesn't, geometry does, by elimination — so one number settles it either way. **`glTexDone`** reports how many textures actually answered, so partial coverage can never be mistaken for an early finish, and a texture already decoded when first seen is counted immediately rather than waiting for a load event that will never fire again.
- **`glTexMp` and `glKVerts`** give the two workloads' sizes — total megapixels of image actually decoded, and total thousands of vertices. Whichever phase owns the tail, the remedy depends on whether this villa is heavy in images or heavy in triangles, and those pull in opposite directions. The 475-texture count is already the strongest lead: that is a lot of separate images for one building, and each one costs a CPU decode plus a GPU upload.
- A bug in the megapixel accumulator was caught before shipping: it rounded to whole megapixels on **every** texture, so a 512×512 image (0.26MP) rounded to zero and the running total stayed zero forever. It now accumulates raw pixels and converts once at the end.

## 2.99.0

### Confirmed in the field — 2.98.0's session fix more than halved the wait
- Three consecutive Android loads all report `gated: false` with no `waitMs` at all: **`totalMs` 5051/5519/5642 → 2654/2558/2596**. `totalMs` now equals `activeMs`, i.e. there is no human time left inside the measurement. Against the 13,398ms this line of work started from, the villa now appears roughly **5× faster**; desktop steady state is 2,085ms. (The one 4,052ms desktop sample is not steady state — `probeRays: 42` and `rvRooms: 385` mark it as the cold re-probe after a config push. The `context-lost` events are also benign: each shares its second with a `pagehide` during rapid reloads, i.e. the browser reclaiming the GPU context on teardown.)

### Changed — Babylon's own import is no longer a single unattributable number
- **What is left of the load is now almost entirely the GLB parse** — `parseMs` ~2,100ms of ~2,600ms, of which `importMs` (~1,530ms) is Babylon's own work and `postMs` (~500ms) is ours. `importMs` has been one opaque figure since it was first measured, which is precisely the condition that let a 5,655ms phase hide inside `revealMs` until 2.94.0 broke that one apart. It matters more than usual here because the plausible causes point at **opposite** fixes: if geometry dominates, the answer is decimation or a different mesh compression; if textures dominate, the answer is a texture format — and one of those, KTX2, has already been evaluated and declined, so guessing wrong is expensive.
- The glTF loader already publishes the milestones needed, so the load telemetry now carries them: **`glJson`** (the container readable — everything after it is real decode work), **`glMesh`/`glTex`/`glMat`** (when that kind of work last finished, all measured from the import's start), and the **`glMeshes`/`glTextures`/`glMaterials`** counts behind them. Whichever of `glMesh`/`glTex` sits closest to `importMs` owns the tail. They arrive as loose keys alongside the existing post-phase timings, so one flat set of fields explains the whole parse — Babylon's half and ours — instead of splitting the story across two places.
- Cost is one timestamp per loader callback (~765 mesh plus a few dozen texture/material calls; sub-millisecond in total), and the plugin observer is removed in a `finally` so a failed import cannot leave a stale observer attached to double-count the next load — which matters in an app that re-loads this constantly.

### Verified while investigating, so it is not re-proposed later
- **Draco geometry decode already runs in Web Workers** — Babylon defaults `numWorkers` to `min(cores/2, 4)` and the app's `DracoCompression.Configuration` never overrode it. "Move Draco off the main thread" is therefore already done, not an available win.
- **`EXT_meshopt_compression` is NOT exempt from the offline rule.** Babylon ships the `MeshoptCompression` wrapper but **no decoder**, and fetches one from its CDN by default — exactly the KTX2 trap. It could be made offline-safe by vendoring the decoder from the `meshoptimizer` npm package (small, ~30kB, unlike KTX2's ~500kB WASM), but that plus a pipeline re-export is the real price, and it should not be described as a free swap.

## 2.98.0

### Fixed — the passcode pad reappeared on almost every launch, and it cost more than the whole villa load
- **Measured, not estimated: 2,424ms / 2,894ms / 3,055ms across three consecutive field loads, against a total machine time of ~2,600ms.** Re-entering a passcode the server had *already accepted* was the single largest component of the wait — larger than downloading, decoding and rendering the entire 17MB villa. 2.97.0's `waitMs` is what made it visible; before that it was buried inside `bootMs` and looked like the app being slow.
- **Root cause: the active profile lived only in the browser's `sessionStorage`.** That dies when the document is torn down, and on Android the OS evicts a backgrounded PWA and relaunches it fresh constantly — so the kiosk forgot who was signed in on essentially every launch. Meanwhile the signed `vk_session` cookie was still valid and still authorizing every `/core`, `/model`, `/fm-data` and config-store request the app made. The UI was contradicting the server's own session policy: the passcode pad was asking for credentials the backend had already accepted and would keep accepting for the full `session_days` (default 30).
- **The profile is now restored from the server's session cookie** via a new `GET /auth/session`, asked once on boot when this tab has no remembered profile. **`session_days` remains the only control over how long a sign-in lasts** — no second, competing setting was added; an operator who wants a shorter leash shortens it there, and it now governs the UI as well as the API.
- **The endpoint deliberately reads the signed cookie only (`_session_role`), never `_role_for()`.** `_role_for` treats any Ingress request as owner-equivalent, so reusing it here would have silently handed every HA-sidebar visitor an owner session and removed the profile picker — nobody could browse as a guest again. Eight new `security_test.py` assertions cover the endpoint end-to-end (no cookie, valid cookie, role swapped inside a valid cookie, forged signature, expired, revoked by logout-all) plus a source check that the Ingress shortcut stays out of it — asserted against the code body, since the docstring names `_role_for` to explain the trap and matching prose would make the test unfailable. 182/182 passing.
- Restoring a session deliberately does **not** mark the boot timeline's `auth` milestone: that exists to measure how long a *human* spent at the gate, and nobody was asked anything, so counting it would report phantom wait time on exactly the loads this fixes. The gate also renders nothing at all for the one round trip it takes to answer, rather than flashing the profile picker before jumping into the villa. Any failure — offline, an older add-on without the route, a malformed reply — resolves to "not signed in" and shows the picker, so this degrades to the previous behaviour instead of breaking.

### Fixed — a telemetry row rendered as a vertical column of single letters on a phone
- **Reported from an Android screenshot: each log entry's summary came out one character per line, a column hundreds of pixels tall.** The row is a flex line of four parts — event kind, device/role/build, summary, timestamp — and three of them were `flex: 0 0 auto`, so on a 360px screen they consumed the entire width and left the summary, the only flexible item, squeezed to roughly one character wide. Its `word-break: break-word` then did precisely what it was told. The layout moved out of inline style props and into `styles.css` (`.telemetry-row`) specifically so the phone tier can re-flow it — **a media query cannot override an inline `style` prop**, a trap already documented in this repo. On a narrow screen the summary now takes a full line of its own (via `order`, leaving DOM order as the natural wide-screen reading order) with the timestamp pushed to the end of the first line. `overflow-wrap: anywhere` replaces `word-break`, so it still prefers real word boundaries whenever the line has room.
- Checked the rest of the codebase for the same shape, as asked: this was the only instance. The two other rows mixing a flexible text child with a `flex: 0 0 auto` sibling can't collapse the same way — `BindingsTable`'s unmapped-entity row has a single short optional sibling, and `BindingRow`'s label sits beside an input with a `min-width: 80` floor.

## 2.97.0

### Fixed — every telemetry event now says which build produced it
- **A load record timestamped two minutes after the 2.96.0 release was read as evidence that the release hadn't helped.** It could not have been: the add-on's frontend ships *inside* the GHCR image (`Dockerfile` builds `dist` and copies it to `/var/www`; `config.yaml` sets `image: ghcr.io/…`), so a device only picks up a release after CI publishes the image **and** the add-on is manually updated — neither of which had happened. The device was still running the previous build, and nothing in the payload could say so. Every event now carries `v` (the baked-in `__APP_VERSION__`, already used by the Settings footer), and the Telemetry panel shows it beside the device/role. Older events predate the field and simply show nothing.

### Fixed — `bootMs` silently included however long a person spent typing their passcode
- **The single biggest flaw in the load measurement, and it made every previous number partly untrustworthy.** `bootMs` was "navigation start → the scene effect", and the scene effect only runs *after* the profile gate lets its children render — so a load where someone browsed the profile list and fumbled a 4-digit PIN for six seconds produced the same `bootMs` as one where the JS bundle took six seconds to compile. Only one of those is a bug, and the number could not tell them apart. Every optimisation so far has been judged against a figure that mixes human hesitation with machine work.
- **New `src/utils/bootTimeline.ts` records first-write-wins milestones along the one path that matters** — bundle executed (`main.tsx`) → React reached `<App>` → a sign-in screen appeared → the passcode pad appeared → `login()` established a session (the single choke point every sign-in path funnels through, in `ProfileContext`) → the Babylon scene effect started. Marks are idempotent, so StrictMode's double-invoke and ordinary re-renders can't move them. From those it derives what the old telemetry could not express: **`waitMs`** (the stretch spent waiting on a *person* at the gate) and **`activeMs` = `totalMs` − `waitMs`**, which is now the figure to optimise against. `gated`/`pinned` record whether a gate appeared at all, since a returning device with a restored session skips it entirely and has no human time to subtract.
- **The phases between the tap and the villa are now separately attributable** rather than summed into one opaque figure: `ttfbMs`/`htmlMs` (the document), **`bundleMs`** (HTML delivered → our first line of code ran: the JS download + parse + compile, the exact phase 2.96.0's deep-import work targets), `reactMs`, and — newly measured, never covered by anything — **`mountMs`**: passcode accepted → the scene effect starting, i.e. React committing the whole authenticated tree (config/FM/HA providers, Dashboard, BabylonCanvas) before one line of villa-loading code runs. That is the stretch a user experiences as "I entered my PIN and nothing happened yet". `swMs` and `navType` come from Navigation Timing, so a service-worker-served navigation on the PWA (the villa iPad's actual configuration) is no longer lumped in with "the server was slow".
- **`jsKb` reports the DECODED weight of the JavaScript the device actually executed** (with `jsNetKb` for what crossed the network). Decoded size is reported even on a cache/service-worker hit, where `transferSize` is 0 — precisely the case where a stale build would otherwise stay invisible. A future "did the bundle actually shrink?" question is now answerable from the log itself rather than by inference.
- The Telemetry panel's one-line `load` summary was still **leading with `parseMs`**, which since 2.95.0 is a minority of the load — reading it as the headline understated every slow load by seconds. It now leads with the end-to-end wall clock, calls out sign-in wait separately from active time, and shows the bundle/mount/parse/reveal split.
- The derivation arithmetic was verified against the real module across five load shapes (restored session, cold start with a slow PIN, repeated marks, service-worker navigation, and missing resource timing) — including that a missing measurement is *omitted* rather than reported as a misleading `0`.

## 2.96.0

### Performance — the eager JS bundle was shipping the entire Babylon library regardless of what the villa actually uses
- **`bootMs` had become the largest single phase of the load (52-64% in the field, 3.2-5.9s on Android) once 2.95.0 moved everything else off the reveal path.** Root cause, confirmed rather than theorised: 18 files under `src/babylon/` plus `TeleportMenu.tsx` imported from the `@babylonjs/core` **barrel** (`from "@babylonjs/core"`), and one (`EntityVisuals.ts`) from the `@babylonjs/gui` barrel. Both packages ship `"sideEffects": true` in their own `package.json` — the standard signal that tells a bundler "don't assume any module here is free to drop" — so importing even a single named symbol through the barrel's `index.ts` forced the bundler to keep everything that file transitively touches, which is most of the library. `babylon-*.js` was **6,059 kB**, most of it code the villa never calls (physics, particles, XR, audio, sprites, …).
- **Fix: every barrel import converted to a deep per-module import** (`import { Vector3 } from "@babylonjs/core"` → `import { Vector3 } from "@babylonjs/core/Maths/math.vector"`, and so on for all 40-odd symbols across the 19 files), matching the pattern the codebase already used for the Draco/glTF-loader assets. `babylon-*.js` dropped to **2,664 kB (−56%)**, and Vite's module graph shrank from 3,994 to 2,666 transformed modules — confirming the barrel, not any individual class, was pulling in the extra ~3.4MB.
- **The one real trap in this refactor, and the reason it wasn't a five-minute find-and-replace:** a handful of Babylon APIs aren't implemented on their own class at all — they're patched onto `Scene.prototype` at import time by a *second, sibling* file, and TypeScript's types don't distinguish the two, so a wrong deep-import path type-checks fine and only breaks at runtime. `Scene.pickWithRay`/`multiPickWithRay`/`createPickingRay` are patched on by `Culling/ray.js`, NOT by `Culling/ray.core.js` (which only holds the `Ray` class itself); `Scene.beginDirectAnimation`/`beginAnimation` are patched on by `Animations/animatable.js`, not by `Animations/animation.js` (which only holds the `Animation` class). Every file that imports `Ray` now imports it from `Culling/ray` specifically (five call sites: `CameraBeams`, `CameraController`, `EntityVisuals`, `SceneManager`, `RoomHighlight` — this also silently covers `OverviewController.ts`'s `scene.createPickingRay()` call, which imports no `Ray` symbol of its own), and `CameraController.ts` — the one caller of `beginDirectAnimation` — carries an explicit bare `import "@babylonjs/core/Animations/animatable";` for the same reason. Verified by grepping every `Scene`/`Mesh`/`AbstractMesh`/`Camera`/`Material` prototype-extension file Babylon ships against every method this codebase actually calls, not by assumption.
- **Cannot be verified in this environment** — the 3D layer has no automated test coverage and browser testing was declined for this project; needs on-device confirmation that the villa still renders correctly and that `bootMs`/`totalMs` actually improved in the field telemetry before this counts as done.

## 2.95.0

### Performance — the biggest phase of the load was bookkeeping behind the spinner
- **2.94.0's new instrumentation immediately found where the wait actually was, and it was not where anyone had been looking.** A field record: `totalMs 13398` (matching a counted ~12s), split `bootMs 2931` (22%, the JS bundle) + `parseMs 4693` (35%, Babylon's import and our post-processing) + **`revealMs 5655` (42%)** — the stretch between the villa being fully built and interactive, and the loading overlay actually lifting. It was the single largest phase of the entire load, larger than Babylon's own glTF import, and it had never been measured because the old telemetry stopped its clock before it began.
- **What was in it: work that changes nothing on screen.** A **SHA-256 over the entire 17MB GLB — `await`ed before the reveal** — which exists only as a fingerprint for one row in Settings ("which file is loaded"); a synchronous `JSON.stringify` of ~765 mesh names into localStorage for the binding UI; and the auto-detect pass whose `update()`, on any load that finds a new entity, changes `entityMap`'s key set and so triggers a full multi-second `indexMeshes` re-run (classed STRUCTURAL by `entityMapDiff`). All three now run *after* the villa is visible, in one `finishAfterReveal` step. What remains ahead of the reveal is only what would make the villa **wrong** on screen without it: the per-entity state paint, and the rooms-sync settle (which has its own documented reason — applying it late would leave a rendered-but-frozen map, and in the common re-open case it is skipped entirely anyway).
- **`revealMs` now reports its own split** (`rvMeshNames` / `rvStates` / `rvRooms`), so whatever is left is attributable rather than hidden behind one number — the exact mistake that let 5.6s go unnoticed until now.
- Also confirmed by the same record: 2.94.0's two fixes landed as intended — `spawn` fell from 240–350ms to **8ms**, `yield` from 350–750ms to **88ms**. (The `probeMs: 1375` in that record is a one-off: the GLB had just been re-uploaded, so the floor-probe cache correctly missed on its versioned key and re-probed once.)

## 2.94.0

### Fixed — the load telemetry was measuring about a third of the actual wait
- **Reported as "I wait much longer than these numbers say", and correct.** The `load` record started its clock at the model fetch and stopped it when parsing finished, so `parseMs` (~2.1s on desktop) described only the middle of the load. Cross-checking each device's own `pageshow` record against its `load` record puts the real wall-clock at **5–7s on desktop, 5–10s on Android** — meaning roughly two thirds of the wait had never appeared in any measurement, and every optimisation aimed at those numbers was aimed at the smaller half of the problem. Five new fields close the gap: `bootMs` (navigation start → the scene effect: HTML, the ~6.6MB JS bundle's download/parse/compile, React mount, session resolve — all of it previously invisible), `engineMs` (WebGL/Babylon engine construction), `configMs` (the `/addon-config` round trip), `revealMs` (parse finished → overlay actually lifted: the GLB-wide sha256, the mesh-catalog write, auto-detect, the per-entity state paint, the rooms-sync await and its double-rAF settle), and `totalMs` (navigation start → villa visible — the number to actually judge a load by). The telemetry POST also moved off the reveal path: it used to be built and fired *before* the villa appeared, and now goes out immediately after.

### Performance — two costs removed from the reveal path
- **The default first-person spawn pose no longer blocks the reveal.** `firstPersonSpawn()` fires 16+ `pickWithRay` probes against un-octree'd structure geometry (`bestFacing`) plus a floor estimate — the same un-accelerated-raycast pathology already fixed for the per-room floor probes, just never applied here. It measured 150–170ms on desktop, **700–790ms on the target iPad, and 5,888ms in the worst field sample**, all to place a camera that **is not rendering at that moment**: the reveal deliberately runs through the overview camera. Moved into the deferred block that already exists for exactly this class of work, one frame after the reveal. Nothing regresses on a real mode switch — `setViewMode("first-person")` already computed and applied its own spawn independently, and now marks the deferred pass as done so the raycasts never run twice.
- **Dropped the `yieldFrame()` in front of `applyStructure`.** That step measures 2–19ms in the field, and the yield ahead of it was parking ~110ms (desktop) to ~375ms (Android) — an order of magnitude more than the work it was yielding for. Its stated purpose was keeping the pre-login profile gate responsive during a decode, but that decode has not run pre-login since 2.79.x set `showChildrenEarly = isSwitch`, so it was protecting a screen that no longer exists at that moment. The yield ahead of `indexMeshes` (genuinely heavy, 250–980ms) is kept.

## 2.93.0

### New — "Confirm before toggling" for a critical device modelled as a plain switch
- **A relay-controlled door/gate is very often modelled in Home Assistant as a plain `switch.*` or `light.*` entity — nothing about its domain says "this is critical," yet a single tap on its map badge fired an instant on/off toggle, no confirmation, the same as a living-room lamp.** Raised from a real device (`switch.outdoor_parking_doorbell_door_1_relay`) whose badge shows a padlock: that badge glyph comes from a name-hint table (`EntityCategories.ts`'s `SWITCH_PURPOSE_HINTS`, matching whole words like `door`/`lock`/`gate` in the entity_id) that only ever chooses the ICON and map colour — it has never affected behaviour, and deliberately doesn't: an earlier attempt at automatically treating a switch AS a lock (changing how it's controlled, not just how it looks) was tried, misfired, and was reverted at the user's request — see CLAUDE.md's own gotcha on this. Reusing that same name-hint table to gate tap behaviour would repeat exactly that mistake: a switch named `garden_gate_light` would get needlessly gated, while a real door relay named without any of those words would stay silently unprotected — the dangerous direction.
- **New per-device setting instead: `EntityMapping.requireConfirm`**, an explicit opt-in in Advanced Settings ("Confirm before toggling" — off by default on every device, no seeded data, shown only for the types that actually have an on/off toggle: light, switch, input_boolean, fan, media player). When set: a tap on the device's map badge opens its panel instead of instantly toggling (`utils/quickAction.ts`'s `isQuickToggle` now checks the flag first), and the panel's own on/off button (`PowerToggle`, shared by all four panel types) asks "Turn on/off?" before acting — the exact same Cancel/Confirm pattern the bottom-bar group modals' "Turn all on/off" already uses, not a new one. A `type: "lock"` entity doesn't need this option at all: it already never quick-toggles and already has its own two-step confirm on Unlock (`LockPanel`), so the checkbox isn't offered there. Registered as a cosmetic `EntityMapping` field (`babylon/entityMapDiff.ts`'s `COSMETIC_MAPPING_FIELDS`) since nothing in the Babylon structural pass reads it — toggling it in Advanced Settings stays instant rather than triggering a full model re-index.

### Fixed — the home icon and 1F/2F floor buttons didn't line up
- **The villa-name chip's home icon sat visibly to the right of the 1F/2F floor buttons directly below it**, reported from a phone screenshot. Root cause: `.hud-brand`'s own left padding (10px) never matched `.hud-stack`'s (4px) — a 6px gap that was invisible when the home icon was a small 22px glyph (2.87.1 and earlier), but became obvious the moment that release made it a full 40px box the same size as the floor buttons, turning a minor inset mismatch into two same-sized squares visibly not lining up. `.hud-brand`'s left padding now matches `.hud-stack`'s 4px at every breakpoint.

## 2.92.0

### Fixed — the Cockpit button's count disagreed with the modal it opens
- **The top-bar alert icon's badge, and the phone overflow menu's "Cockpit (N)" row, could show a smaller number than "Needs attention" actually listed once the modal was open** — reported from a screenshot: badge said 4, modal said "5 things need attention." Root cause: that badge/menu count was still `unavailableIds.length` alone (unavailable devices only), a leftover from before Cockpit's Needs Attention section was unified in 2.86.0 to also include open faults, overdue schedules, and active alarm-state binary_sensors — CockpitModal's own list moved on to the fuller definition, but nothing told the button that opens it. Fixed at the root: extracted the shared computation into a new hook, `useVillaAttention` (`src/components/cockpit/useVillaAttention.ts`), and both `HUD.tsx` (the icon badge and the overflow-menu text) and `CockpitModal.tsx` now call the SAME hook instead of each computing their own version — the two can no longer independently drift, because there is only one computation left to drift from. The button's tooltip text also now matches the modal's own headline wording ("N things need attention.") instead of a separately-worded "N devices unavailable" string.

## 2.91.0

### Fixed — the floor pivot ignored Home Assistant's own Floors feature entirely
- **A device correctly resolved to its right ROOM (Corridor) but still landed in the floor pivot's "Other" bucket, even though that room's Area is assigned to "2F" in Home Assistant.** Root cause: unlike room resolution (which the 2.85.0 rework made HA's own Area assignment the authoritative source, geometry only the fallback), the floor-pivot's storey lookup had never been given the same treatment — it only ever read the floor-plan's own static per-room `floor` value (`config.sh3dRooms`, matched by room NAME against whatever the floor-plan file happened to call that space), with no live HA signal at all. Confirmed directly against a live instance before fixing: Home Assistant's own Floor registry has "Corridor" correctly assigned to floor "2F" — the data was right, the app simply never asked for it. Home Assistant's own **Floors** feature (an Area's optional parent grouping, distinct from and newer than the per-room floor-plan data) is now read the same way Areas already are — a new `entity_id -> floor number` map (`HAStateStore.tsx`'s `entityFloorNumbers`, live via a new `config/floor_registry/list` read + `floor_registry_updated` subscription) wins whenever any device in a room has one, with the floor-plan's own geometry staying the fallback for whatever HA hasn't organised into a Floor yet — the identical "HA wins, geometry is the fallback" precedence room resolution already uses. HA's own `level` field on a Floor is optional and wasn't trustworthy on its own in a live test (one floor had it set, the sibling floor didn't) — a leading digit parsed from the Floor's own name ("1F"/"2F", the same convention this app's UI already displays floors with) is checked first, `level` only as a secondary fallback. New read-only websocket command allowlisted for every role (`config/floor_registry/list`, same category as the existing entity/device/area registry reads), covered by a new `security_test.py` assertion (174/174 passing).

## 2.90.0

### Fixed — a camera's Linked entity/Motion sensor always resolved to "Other"
- **Every camera's arm/disarm switch (its `linkedEntityId`) and detection sensor (its `motionEntityId`) fell into Cockpit's "Other" bucket, regardless of what Area they actually have in Home Assistant.** Root cause: the 2.85.0 room-resolution rework computes a live resolved room only for entities that are literal keys of `config.entityMap` — but a linked entity/motion sensor is never a key itself, it only ever exists as a VALUE on the camera's own mapping (the same reason `Dashboard.tsx`'s `effectiveMappedEntityIds` has to separately fold it into the "on the map" set). The resolution loop simply never visited these ids, so they had no resolved room at all and fell straight to "Other" in every room/floor grouping. Confirmed against a live instance before fixing, not assumed: a reported camera's underlying device DOES have its Area set correctly in Home Assistant — the data was always right, the app just never read it for these specific entity_ids. Fixed by resolving every `linkedEntityId`/`motionEntityId` the same way every other entity already is (HA's own Area first, the geometric fallback — always empty for these, since they have no mesh of their own — second). This also restores `EntityVisuals.applyMotionRouting`'s documented fallback, which glows a camera's own room when it has no beam mesh yet, reading the same resolved-rooms map.

## 2.89.0

### Fixed — Cockpit's Close button was on the wrong side
- **Cockpit's footer put "Close" on the LEFT, while every other modal in the app puts its primary button on the right.** `.settings-footer` is `justify-content: space-between`, which every other single-button footer (Settings, the Legend modal, the first-run tips card) satisfies with an empty `<span />` as the first child so the lone button still gets pushed to the right; Cockpit's footer was missing that spacer, so with only one child, `space-between` had nothing to push it away from and left it sitting at the start of the row instead. Same fix as those three, not a new pattern.

### Changed — Category folded into the Room/Floor selector
- **"By category" is no longer its own always-visible block sitting above the room/floor pivot — it's now a third tab on the same Room/Floor toggle**, so the modal only ever shows one "how are the devices grouped" view at a time instead of two overlapping ones, and the section title always names whichever grouping is on screen. The room/floor bar list and the category grid share the exact same header row and selector; picking a tab swaps which one renders below it. The 3-button segmented control this produces is wider than the 2-button one it replaces, so the header row now wraps onto its own line on a narrow phone instead of risking an overflow/clip that hadn't been screenshot-verified yet.

## 2.88.0

### New — Cockpit's room/floor pivot drills into the same device list every other room view uses
- **Tapping a room or floor row in Cockpit's "By room"/"By floor" pivot now opens that room/floor's actual device list**, with the same trailing chevron and inline controls (toggle a light, unlock a door) every other "all the devices in X" view in the app already offers — the pivot used to be a read-only bar chart with no way to see WHICH devices made up a room's count. Reuses `SummaryGroupPanel`, the same modal room clusters on the 3D map and the bottom Summary bar's tiles already open, rather than a bespoke list. Works for the "Other" bucket on both pivots too. `cockpitData.ts`'s `buildRoomGroups`/`buildFloorGroups` now carry each bucket's actual `entityIds` alongside its count, not just the count.

### Fixed — Settings' badge-style row stopped partway across the modal
- **The "Floating badge style" row (Default/Card + the bottom-bar Dock toggle) visibly stopped short of the modal's right edge, leaving dead space**, reported from a screenshot. 2.87.0 had fixed a truncation bug in this same row by making both button groups size to their own content (shrink-to-fit) rather than grow — which fixed the truncation but meant the row no longer filled the line at all once the fix was in. Both groups now grow to fill the row edge-to-edge, weighted 2:1 (Default+Card is genuinely wider content than a single Dock button, so an even 50/50 split would starve the pair) — the previous truncation bug doesn't return, because that bug specifically required a shrink-to-fit PARENT, which growing groups no longer are. Renamed "Floating badge style" → "Badge & bottom bar style" in the same pass: the old name only ever described the first of the two controls (the on-map entity badge look), not the second (whether the bottom bar shows at all).

## 2.87.1

### Fixed — top-bar brand chip out of step with its own sizing rules
- **The villa-name chip (home icon + name + connection dot) rendered visibly shorter than the category/alert pill groups beside it, and its home icon looked noticeably smaller than the 1F/2F floor buttons directly below it.** Both were the same root cause: the brand chip's height came from vertical padding around its content rather than an explicit size, and its tallest content (the villa-name text) has a shorter line height than a 38px icon button — so the chip's painted height (~37px) never matched `.hud-group`'s (48px, driven by its 38px icon-btn + padding + border), even though both sit in the same row and read as siblings. The home button itself had never been sized at all; it shrink-wrapped its bare 22px icon glyph while the floor toggle right underneath it is a full 40×38px button. Fixed by giving both `.hud-brand` and `.hud-group` an explicit height off one shared token (`--hud-pill-h`, re-declared to 42px at the ≤640px compact-bar tier where the category row's own icons shrink to 32px) instead of letting them drift apart by content, and sizing `.hud-home-btn` to match `.hud-stack .icon-btn`'s footprint (40×38px, 40×40px at the same compact tier) rather than its icon's raw size.

## 2.87.0

### Fixed — a real bug in every modal, not just Cockpit
- **Every modal in the app was silently re-running its focus-trap setup on every unrelated re-render of whatever opened it — scrolling snapped back to the top, a room/floor toggle looked like the whole page reloaded, and typing into ANY text field (Advanced Settings' entity search, a device Label) could lose focus after the very first keystroke, with no way to type a second one.** `useModalA11y`'s mount effect depended on the caller's `onClose` function; a caller that passes an inline arrow function (`onClose={() => setOpen(false)}` — the common case, including HUD.tsx opening Cockpit and Advanced Settings' own back handler) hands it a NEW function reference on every one of ITS OWN re-renders, and several of these callers re-render on every single Home Assistant `state_changed` event — any light or sensor in the whole villa, completely unrelated to what the user is doing on screen. Each of those re-runs called `first.focus()` again, which both scrolls that element into view AND yanks keyboard focus away from whatever the user had actually clicked into. Fixed at the root, in the one shared hook every dialog in the app goes through (confirmed by search — nothing else in the codebase manages focus this way): the mount effect now runs exactly once per actual mount (Escape still always calls the current `onClose`, via a ref).
- **The Floating badge style row's buttons could truncate to an ellipsis ("Def…") even with most of the row empty.** A nested-flexbox sizing quirk: the buttons inside still inherited the shared `.segmented button` rule's zero flex-basis, which in a shrink-to-fit parent means the browser can undercount the group's own real content width when computing how much space it needs — so the group measured itself narrower than it actually renders and clipped text that had plenty of room. Buttons now size to their own content instead.
- **Cockpit's "Show all unavailable devices" button and its drill-down modal are gone.** Needs Attention already lists every unavailable device individually — always did, nothing was capped — so the button only ever opened a second view showing the exact same rows already on screen. Pure ceremony with no information the user didn't already have.
- **The room/floor pivot's empty bucket is now labelled "Other", not "Unplaced".** Reported as a term that appears nowhere else in the app — correct: "Other" is the one word every room/category grouping already uses for "doesn't resolve to a real one" (the room pivot's own empty bucket already said it), and "Unplaced" was a second, unreviewed word invented for the identical idea. Now the same word everywhere.
- **Recent activity was failing outright ("Couldn't reach Home Assistant's activity log") and would have shown almost nothing even once fixed.** Two separate problems, found by testing directly against a live instance rather than guessing: the classic REST `/api/logbook/<timestamp>` endpoint this was built against didn't return usable data at all — switched to the websocket `logbook/get_events` command instead (verified working, and it's what HA's own frontend logbook actually uses). Separately, that data revealed only automation/script-triggered entries carry a ready-made `message` from HA — a plain state change (a motion sensor, a lock) arrives as just a raw `state`, because HA builds that sentence on ITS OWN frontend, not via the API. The original filter silently dropped every entry without a `message`, which would have been almost everything. Now: HA's own `message` is used verbatim where it exists (an automation's real trigger cause — not something this app should ever try to reconstruct itself), and a plain state change is described using the kiosk's OWN existing state vocabulary (the same `BinarySensorClasses` wording SensorPanel and badges already show) rather than a raw "on"/"off".
- Backend housekeeping to match: the proxy's REST allowlist no longer carries an unused `logbook/` entry (nothing calls it any more); `logbook/get_events` was added to the websocket allowlist instead, covered by an updated `security_test.py` assertion.

## 2.86.0

### New — Cockpit
- **A new "Cockpit" page: a graceful, non-technical, at-a-glance report of the whole villa's device state**, reachable from the same top-bar alert icon that used to open a bare Unavailable-devices list directly — repointed, not a new button, and that list isn't gone: it's the "Show all unavailable devices" drill-down at the bottom of Cockpit's own Needs Attention section, reusing `SummaryGroupPanel` unmodified. Facility's own Readiness-tab quick-link opens the same page.
- **Needs Attention unifies four sources that were previously split across two separate badges** (the HUD's unavailable-devices icon and Facility's own attention count): unavailable devices, open faults, overdue/never-recorded maintenance, and — new — any binary_sensor currently reporting its own device_class's "problem" state (a leak, a tamper trip, low battery, a disconnected sensor). That last one already existed per-class (`BinarySensorClasses.ts`'s `alarmState`) but had never been aggregated across the whole villa before. A one-line health headline (green/amber/red) summarises the count; unavailable devices and active alarms count as the more severe tier, open faults and overdue schedules as the lighter one.
- **A category grid and a room/floor pivot**, both reusing the app's existing 6-category taxonomy and the live-resolved room data from the 2.85.0 room-architecture change — deliberately non-judgmental (a light being on isn't a problem), kept visually separate from Needs Attention so the page doesn't read as "everything is red."
- **Recent activity reads Home Assistant's own Logbook**, not a re-implementation of "what happened and why" — HA already turns a raw state change into a readable sentence (including an automation's actual trigger cause), which this app has no way to reproduce and shouldn't try to. Filtered to the villa's own selectable devices client-side: HA's raw logbook is unfiltered and genuinely noisy — a bare date/time helper alone produced roughly one entry every six seconds in a real pull against the reference villa.
- **"Energy today," but only when it can be trusted.** Reads Home Assistant's own Energy Dashboard configuration and long-term statistics (`recorder/statistics_during_period`'s pre-computed `change` field — the same number HA's own Energy graphs are built from, no client-side sum-of-cumulative-readings math needed) rather than re-deriving consumption from raw sensor wattage. The tile is hidden entirely — not shown as zero — when an install has no Energy Dashboard configured, or when its configured grid source doesn't resolve to any actually-recorded statistic: confirmed via the reference villa that this second case is real, not theoretical (a `stat_energy_from` pointing at a statistic ID silently orphaned by an unrelated entity rename, still configured, no longer producing data).
- **An Owner-only updates-available count** — Home Assistant's own `update` domain already tracks per-device and per-add-on firmware/software update availability (including this add-on's own update entity), so this costs nothing extra to surface.
- Two backend widenings needed for the above, both read-only and covered by new `security_test.py` assertions: the proxy's REST allowlist now permits `logbook/` for every role (same category as the existing `history/period/`), and its websocket allowlist now permits `energy/get_prefs`, `recorder/list_statistic_ids`, and `recorder/statistics_during_period`.

## 2.85.0

### Architecture
- **A device's room is no longer kiosk config — it's Home Assistant's own Area assignment, live.** The kiosk used to carry its own `room` field per device, seeded once by geometric guesswork (which drawn room polygon the device's own 3D anchor sits inside) and then hand-editable in two separate Advanced Settings tables — a second, independent room assignment that could silently disagree with the Area a device already has in Home Assistant, with no way to reconcile the two. Room is now resolved live: HA's own Area wins whenever a device has one, geometric detection is only the fallback for whatever HA hasn't organised into an Area yet, and nothing in the kiosk can override it by hand any more — the Room column in "Auto-detected entity settings" and the Room field in "Bound 3D objects" are both gone. Editing a device's Area in Home Assistant (or assigning one for the first time) now reaches every open kiosk session within moments, no reload — the app subscribes to HA's `entity_registry_updated`/`device_registry_updated`/`area_registry_updated` events over the same websocket connection it already uses for live device state, the same way a light turning on anywhere in the house already reaches the map instantly.
- **Reading Home Assistant's entity/device/area registries now works for every profile, not just Owner.** The proxy's websocket allowlist was written to stop a guest session from reaching HA's *control* surface (chaining `execute_script` to bypass the service-call allowlist, the incident the allowlist itself exists to prevent) — reads were never the boundary it enforces, and its own docstring says so explicitly. The four registry/config *list* commands this release now depends on (`get_config`, `config/entity_registry/list`, `config/device_registry/list`, `config/area_registry/list`) had simply never been added to that allowlist, because the kiosk's client code that calls them was written well after the allowlist was frozen and nobody had revisited it since — confirmed by checking the git history rather than assuming. Widened for every role; the mutating counterpart (`config/entity_registry/update`) stays denied, and both are now covered by `security_test.py`, which previously asserted the write was blocked but said nothing about the reads.
- **Badge grouping, room-cluster chips, motion-detection room-glow, and every panel/summary view that shows "which room" all read from the same live-resolved source now** (`ConfigContext.resolvedRooms` on the React side, `SceneManager.setResolvedRooms` on the Babylon side) — one computation, pushed to both layers, so they can never drift from each other the way two independently-maintained fields eventually would.

### Interface — settings polish carried over from this session
- **The Day/Auto/Night preview control (2.84.x) reordered to Day/Night/Auto**, with proper tooltips on all three, and its "Day" icon changed once more for clarity; it also now fills the full width of its own line once it wraps onto one on a phone, instead of sitting as a small icon cluster with dead space beside it.
- **"Clickable Glow"/"Natural Scroll" now share one line on a phone**, matching how they've always looked on desktop — the same flex-basis fix already applied to the Classic/Card + Summary bar row, generalised into one shared `.settings-row-half` class instead of two copies.
- **The Floating badge style row renamed "Classic" → "Default"** and shortened "Bottom Bar" → "Dock" on a phone, with a more robust nowrap-and-shrink layout replacing the previous icon-only-under-560px compromise now that the labels themselves are shorter.
- **A stray tooltip no longer pops open by itself when Advanced Settings opens.** The dialog's own focus-on-open behaviour (correct, standard modal accessibility) was landing on the `(i)` model-info button — the first focusable element in that dialog — and its tooltip is shown on `:focus-within` so keyboard users can reach it too, not just mouse hover. Landing focus there on open triggered the tooltip with no hover at all. Initial focus now goes to the dialog's own heading instead.

## 2.84.2

### Interface
- **The Day/Auto/Night control from 2.84.1 still looked wrong, from a second phone screenshot: too tall, a blocky pill next to the sliders rather than matching their scale.** `alignSelf: "stretch"` had matched it to the sliders' FULL height — label text plus track — when what actually needed matching was just the track/thumb part beneath the label, the same visual weight class as the rest of the row. Back to `alignSelf: "flex-end"`, which lines the control's bottom edge up with the bottom of the slider column (where the track sits) and lets it keep its own natural, compact height instead of stretching to fill space nothing else in the row was asking for.
- **Classic/Card still wrapped onto its own row above Bottom Bar on a phone, even after 2.84.1 gave both groups a 50/50 flex-basis split.** The basis split was the right idea but didn't work: a flex item's default minimum width is set by its CONTENT's min-content size, not by its flex-basis, so telling the Classic/Card group to shrink to 50% didn't actually let it shrink past "Classic" and "Card"'s own text width — the row kept wrapping regardless of the split. Rather than fight that floor, Classic/Card now drop to icon-only under 560px (reusing the same `.settings-label-full` show/hide mechanism Bottom Bar already uses for its own label, just with no short-text replacement — the icons alone read fine at that size), which removes the floor instead of trying to shrink past it.

## 2.84.1

### Interface
- **Two follow-ups to 2.84.0's Day/Auto/Night control, reported from a phone screenshot.** The segmented control sat visibly shorter than the Brightness/Night dimming sliders beside it — `alignSelf: "flex-end"` pinned it to their bottom edge instead of matching their full label-plus-track height, so it read as a small pill stapled onto a taller row rather than a same-height sibling. Now `alignSelf: "stretch"`, and the buttons fill that height automatically (`.segmented`'s `align-items` was already the flex default of `stretch`). Separately, the "Day" option used the same `Sun` glyph as the Theme selector's Light option one row up, close enough on the same screen to read as the same control; it's now `Sunrise`, visually distinct while still legible as "day".
- **The Summary bar toggle still wrapped onto its own row below Classic/Card on a phone, even after 2.84.0 shortened its label to "Bottom Bar".** The label swap only changed the TEXT — both groups' `flex-basis` was still a hardcoded inline `200px`, so the browser kept treating Summary bar as needing 200px of its own before it would share the row, regardless of how little text was actually left inside it once shortened. Moved that basis into a CSS class (`.badge-style-row-group`, an inline style can't be beaten by a media query) and, under 560px, split it `calc(50% - 5px)` between the two groups instead — an even half each, which both fit their now-short content comfortably.

## 2.84.0

### Interface
- **The saved default-view "anchor" moved off the floor stack and onto the brand icon in the top bar, at the user's request.** The anchor button (tap to jump to this device's saved overview framing, long-press/right-click to set it) only ever appeared as a 4th row under the 1F/2F floor switch, and only in overview mode — reasonable when it was introduced, but the user found reaching for the villa's own name/logo more natural for "take me home" than a small icon buried in a corner stack. The gesture is unchanged (`useHomeAnchor.ts`, moved out of `ViewControls.tsx`'s `DefaultViewButton`), but it's now on the house icon next to the villa name, which is always visible in both view modes — a tap from first-person switches into overview first (landing on the saved default itself, same as the automatic apply-on-arrival `SceneManager.setViewMode` already did) rather than being a no-op outside overview like the old button was. The icon shows a small dot only while no default has been saved yet, as an invitation to long-press one in; once a default exists the icon deliberately stays plain rather than picking up an `.active` highlight, which would read as a stray toggle sitting on the app's own logo rather than the brand mark it still is the rest of the time.
- **The villa name in the top bar reads noticeably larger than before, since 2.83.0's font-size consolidation.** That release replaced 22 hand-written pixel values with a shared `--text-*` scale, and `.hud-brand`'s old hardcoded `22px` got mapped to `--text-2xl` (28px, the scale's "one-per-screen headline" step — the same size a full-screen profile-gate villa name or a panel heading uses) rather than the closer `--text-xl` (20px). A headline-sized name made sense for a once-per-screen moment; for a chip that's on screen permanently in the corner of every view, it read as oversized. Now uses `--text-xl`.
- **"Invert day/night preview" (baked villas only) is now a proper Day / Auto / Night three-way control, not a single toggle.** The old button mirrored whatever the real sun position (or HA's `sun.sun` state) currently said — which meant its actual effect depended on the time of day you pressed it: sometimes it showed day, sometimes night, never a guaranteed one or the other, despite the button reading as a stable on/off. Replaced `AppConfig`'s `dayNightInvert` boolean with `dayNightPreview: "day" | "auto" | "night"`; `SunController` now clamps the sun's altitude to strictly positive or strictly negative (`Math.abs`/`-Math.abs`, not a sign flip) for the forced states, so "Day" and "Night" pin the look regardless of the real time or `sun.sun` reading, and "Auto" is exactly the old always-live behaviour. Matches the same `.segmented-icons` styling as the Theme selector above it, and moved out of the header down next to the Brightness/Night dimming sliders it's most related to (and shares a row with, on screens wide enough) rather than sitting beside an unrelated Light/Dark/Auto theme picker.
- **The Bottom Summary bar toggle is renamed "Summary bar", shortening further to "Bottom Bar" under 560px** so it fits on the same line as the Classic/Card badge-style pair above it instead of wrapping onto its own row — a plain CSS label swap (`.settings-label-full`/`-short`), matching how every other breakpoint-driven label change in this codebase already works.

## 2.83.0

### Interface
- **Every dialog now opens with motion instead of appearing instantly.** Ten surfaces share one `.modal-backdrop`/`.modal` shell and none of them had any transition, while smaller things around them (the radial room menu, tap ripples, the room label) were already animated — a dialog that pops into existence is the most-noticed "unfinished" tell in an otherwise polished interface. Animating the shared shell fixes all ten together. Deliberately brief (0.18s, transform+opacity only, both GPU-composited): this is chrome the user summoned on purpose, so the motion should acknowledge the open rather than make anyone wait for it.
- **The lock panel finally acknowledges a tap.** A deadbolt is the slowest device class in the villa — a Z-Wave/Zigbee lock routinely takes seconds to report back, and unlike a light there's usually no way to see the result from where you're standing — yet it was the one panel with no in-flight feedback at all, so a tap looked like it did nothing and invited a second tap on a physical lock. The pulse that lights/switches/fans already had lived inline in `PowerToggle`; it's now a shared `usePendingAck` hook both use. It watches the raw state string, so an intermediate "locking"/"unlocking" report clears it as soon as the motor actually moves. Still deliberately an ACKNOWLEDGMENT, never a prediction — it says a request is in flight and stops the moment real state changes, so it cannot show a wrong state.
- **Device rows in the group/room/category list now move the instant you tap them.** These are where most bulk toggling happens, and every one of them waited a full Home Assistant round-trip before the switch moved. They now use the existing `useOptimisticToggle`. This is scoped precisely: a discrete DOM switch with two unambiguous positions, self-correcting when real state arrives, on a timeout if the call fails, and on entity change — explicitly NOT the 3D scene, whose appearance prediction was rightly reverted before and which continues to render from confirmed state only.
- **Touch targets on phones meet the 44px minimum without changing the layout.** The HUD's category and overflow buttons shrink to 32px at phone width — below this codebase's own `--touch-min`, and below Apple HIG / WCAG 2.5.8 — on the most-tapped controls in the app. Growing them would re-break the row overflow that shrinking them fixed, so the visual size stays 32px and an invisible centred overlay expands the TOUCH target to 44, which is what the guidance actually measures.
- **A dropped Home Assistant connection is now visible.** The only indicator was a small dot in the top bar, deliberately hidden below 640px — so on a phone, and on the wall tablet in portrait, a dead socket was completely invisible: every control still looked live, every tap did nothing, and the reasonable conclusion was "this app is broken". A banner now states it in words after a 2.5s grace period (so a brief AP roam doesn't cry wolf) and only for a connection that was previously established, so a normal cold start isn't reported as a fault. Controls stay tappable on purpose — a reconnect is usually seconds, and a queued tap landing as the socket returns beats a control nobody could press.
- **Reduced-motion is honoured app-wide.** This matters more for a kiosk than an ordinary web app: it's often wall-mounted and permanently in view, and several animations are ambient and indefinite rather than one-shot. Durations collapse rather than being removed outright, so animations land on their final state instead of stranding an element mid-sweep.
- **Dialogs are keyboard- and screen-reader-navigable.** Behind every dialog sits the live 3D canvas and the whole HUD, so tabbing out of one didn't land somewhere harmless — it walked into villa controls the user couldn't see behind the scrim. One `useModalA11y` hook now gives all of them focus-into-dialog on open, a focus trap while open, focus restoration on close, and `role="dialog"`/`aria-modal`. The loading overlay announces its progress, so the several seconds between sign-in and the map appearing are no longer silence.
- **Short haptics on touch actions.** The primary interaction here is tapping a badge to move something physical in another room, where the result often isn't visible and the on-screen confirmation lags the device. Three intents only (acknowledge / success / warn), every one inside a user gesture — deliberately never on background state changes, since a kiosk sees constant Home Assistant traffic and a device that buzzes at someone else's light turning on is worse than one that never buzzes.
- **One type scale replaces 22 hand-written sizes.** They had drifted into pairs too close to be deliberate (12 vs 12.5, 13 vs 13.5) plus ten sizes used exactly once, compounded by 53 inline `fontSize` overrides bypassing the tokens entirely. Nobody can name the difference between 12px and 12.5px, but the accumulation of near-misses is what makes an interface read as assembled rather than designed. Steps are named by role, so a new surface picks what it IS rather than eyeballing a number.

### Internal
- **One atomic-write primitive, replacing three copies — one of which was quietly wrong.** The JSON stores and the model upload each had a correct implementation (`mkstemp` in the destination directory, `chmod`, `os.replace`, cleanup on every failure path). The Facility evidence-photo write had a third that looked equivalent and wasn't: a predictable `<dest>.part` name instead of `mkstemp`, so two concurrent posts of the same id raced through one temp file and a pre-existing file or symlink at that path was inherited rather than refused — and no failure cleanup at all, so any exception mid-write orphaned a `.part` in `/data` permanently. Three copies of a security-relevant primitive is three chances to get it subtly wrong, and that is what happened. All three now call `atomic_write`/`atomic_write_async`. The chunked-upload path deliberately keeps its stable named part-file (it must survive between requests to be resumable) and already had correct cleanup.
- **Removed the dead pre-login scene-mount signal.** `onPrefetchAvailable`, its listener type, its Set and the broadcast that fired it survived the strategy they served: pre-login decode was disabled on every platform in 2.79.0, so nothing has consumed the signal since. Dead on every load — and its docstring still described a live consumer, which is the more expensive half, because it told the next reader the pre-login mount was still a thing.
- **Removed `sameRoom()`, which had no callers and would have been a pessimisation if given any.** Every real room comparison normalises one side once and reuses it inside a loop, so a two-argument helper would re-normalise the fixed side per iteration. It was additionally named in `CLAUDE.md` as a rule to follow, which made the documentation describe a convention the code did not have; that entry is corrected.
- **Fifteen module-internal symbols are no longer exported.** Things like `isEntityAllowed`, `PERMISSION_MATRIX` and `CATEGORY_EXCEPTIONS` were used only inside their own file but exposed anyway — public surface that isn't public, inviting exactly the kind of parallel call path that bypasses a composed rule (importing `isEntityAllowed` directly instead of `isMappingAllowed`, say, and losing its RBAC composition).
- **`EntityVisuals.ts` starts shedding its prelude.** At ~4,000 lines it's the largest file in the app, with 700 of those a prelude of module-level helpers above the class. The two most self-contained blocks move out: pose-word resolution (`meshVariants.ts`, depends only on the `HassEntity` type) and label/chip overlap geometry (`labelLayout.ts`, pure 2-D maths). Both moved VERBATIM — every function byte-identical to the original — because the badge-layout rules here have a documented history of regressions and this change is about where code lives, not what it computes. Further extraction is deliberately deferred rather than bundled in.

## 2.82.0

### Fixed
- **A shared configuration edit (e.g. binding a camera's motion sensor) could show up on every device reached through the HA sidebar/Ingress but silently NOT on the same client's own installed PWA/direct-hostname session** — two different configurations for what is supposed to be one shared store, reported and reproduced firsthand by switching how the same client opened the kiosk. Every shared-store GET handler in `supervisor-proxy.py` (`/device-config`, `/fm-data`, `/telemetry`, `/addon-config`) sent its response with no `Cache-Control` header at all. Under Ingress that's harmless — HA's own Supervisor proxies the request straight through, nothing else sits in between. The standalone/direct-hostname path is exactly where a user's own reverse proxy, tunnel or CDN commonly sits in front of the add-on's exposed port, and without an explicit `no-store` any such layer is free to cache a plain GET under its own default policy — serving a stale copy of a store that's supposed to change the instant any device edits it. All four endpoints (plus the 409-conflict response, which hands a rejected write the fresher copy it's meant to rebase onto) now send `Cache-Control: no-store` explicitly. The client-side refresh trigger (`useStoreRefresh`) was checked too and has no origin-dependent code — the gap was entirely server-side. `security_test.py` still passes 165/165 after the change.

### Changed
- **A camera's configured motion sensor is now shown in the camera's own panel.** Setting Advanced Settings' "Motion sensor" field previously had no visible effect anywhere outside that settings screen — the generic "Linked entity" field has always rendered as an on/off switch right in the panel header, but a camera's motion link, a distinct and camera-only field, showed nowhere at all. Added the same placement: a read-only row (no toggle — this reports HA's own state, it isn't something the panel can flip) showing the sensor's label and live "Motion detected" / "Clear" reading, reusing the existing connection-status dot rather than the interactive toggle control so it doesn't read as tappable when it isn't.

## 2.81.2

### Fixed
- **A baked-mode light's floor "glow pool" could paint at furniture height instead of on the floor** — reported and confirmed from screenshots as a warm disc floating in mid-air under a ceiling fixture, over a dining table. The floor-finding probe behind these pools (`EntityVisuals.surfaceBelow`) casts a ray straight down from the fixture and paints the glow at the first solid thing it hits — and its predicate accepted ANY mesh with geometry, furniture included. A table sitting directly under a ceiling light is exactly what that ray was told counts as "the floor". This is the same class of bug `blocksCameraBeam` was already written to avoid for camera motion beams (see `meshRoles.ts`): furniture isn't the villa's structure, and letting it stand in for structure gives the wrong answer even though the raycast itself works perfectly. The probe is now restricted to structure meshes only (walls/floors/ceilings, via `isStructureMesh`) — the same distinction already used there — so it always finds the real floor slab beneath whatever furniture happens to be in the way.
- **Two smaller misses in the same code, worth fixing alongside it rather than separately.** The ray only reached 8m down, generous for an ordinary room but not for every case; it's now 20m. And a genuine miss (nothing at all below — an outdoor fixture with no floor in reach, say) used to paint the pool 1m below the fixture regardless of what was actually there; it now skips the pool for that one spot instead, and logs the exact fixture and world position via `tapDebug` (visible on-device with `?debug`) so a future report can be pinned down immediately instead of guessed at again.

## 2.81.1

### Fixed
- **A camera's live view still showed portrait-style chrome (title bar on top, controls along the bottom) even when the iPad was actually held in landscape** — reported as "still looks portrait" despite the device being rotated. The side-rail rearrangement that already handles this correctly on a landscape phone was gated on `(orientation: landscape) and (max-height: 560px)`: a landscape phone is short enough to match that height cap, but an iPad in landscape never is (800px+), so it silently kept the portrait layout instead. Re-gated on `pointer: coarse` — a signal for "this is a touchscreen", true for any phone or tablet regardless of its actual height, and false for a mouse/trackpad desktop window that happens to be wide-but-short, which is the distinction that actually matters here. The rail's existing `clamp()` sizing on button/gap dimensions already self-limits at the top end, so nothing needed retuning for the taller viewport.
- **The bottom tile bar sat well clear of the screen's true edge on an iPad, in both orientations, reading as dead space next to how it correctly sits flush on desktop.** The bar's `bottom` offset is a flat 20px plus `env(safe-area-inset-bottom)`, meant to keep it clear of an iPhone's home-indicator gesture zone; an iPad without a physical Home button reports the same ~20pt inset for the same reason, so the two stacked into a bigger gap than the tile row actually needs to clear it. Desktop has no such gesture zone at all, which is why only desktop looked "right" next to it. Added a `pointer: coarse` (tablet-width-and-up; the phone rule's own already-tuned 14px is untouched) override trimming the flat term to 8px — the safe-area term alone already clears the gesture zone, so the flat part is just breathing room now, not a second margin stacked on top of it.

## 2.81.0

### Fixed
- **The motion-detection toast fired for any motion/presence/occupancy sensor Home Assistant reported, configured in this kiosk or not.** The `subscribeAll` handler behind it checked an entity's device_class/id against a motion-shaped pattern and stopped there — it never checked whether the sensor was actually wired to anything in this app (real geometry in the model, or another mapping's Linked entity/Motion sensor field). On an install with several unrelated motion sensors exposed to HA, every one of them announced itself on the villa's map the instant it tripped. Now gated on `effectiveMappedEntityIds`, the same set the rest of Dashboard.tsx already uses to mean "on the map" — real geometry, or reached indirectly via `linkedEntityId`/`motionEntityId` — so an unconfigured sensor stays silent.
- **A climate card in the room/category summary list showed "0°" instead of "--" when its `current_temperature` was null.** HA's null-for-unavailable convention landed on `Math.round(value ?? 0)`, which treats a missing reading the same as a genuine zero. The device detail panel and the map badge already guarded this correctly (`!= null` checks); only the summary-group row's inline ternary used `??`, which is equally nullish on `null`. Now reads `--` there too, matching every other surface that shows a climate's current temperature.
- **A device panel's Mode / Fan speed / Preset button row could show a button sliced in half against the panel's own edge on a narrow phone**, with no scrollbar or fade hinting there was more to swipe to — reported as buttons "badly rendered", text reading as if it had escaped its own pill. `.row-buttons.scroll` (ACPanel's Mode and Fan speed rows, FanPanel's Preset row) trades wrapping for horizontal scroll so a short list stays one line on desktop, but a 6-8-option HVAC/fan-mode list routinely doesn't fit a phone-width panel, and the abrupt clip at the panel's padding boundary reads as broken rather than scrollable. On phones, `.row-buttons.scroll` now wraps like the plain `.row-buttons` variant instead — every option is visible without discovering a hidden scroll — fixed once, in the shared rule, rather than patched per component.

### Performance
- **Two independent HEAD probes for the model's version tag could disagree, breaking prefetch reuse and the floor-probe cache for byte-identical geometry.** `versionedModelUrl()` re-checks the central GLB's ETag/Last-Modified live on every call, and it's called from two places on every load — `main.tsx`'s `startModelPrefetch()` (started before React even mounts) and `BabylonCanvas`'s own load effect — each firing its own probe for the same file. Under a flaky connection one probe can time out while the other succeeds, and the timed-out one falls back to whatever tag was last known, occasionally a different one than the call that just succeeded. Two callers disagreeing on the model's `?v=` makes `claimPrefetch` reject on the URL mismatch and silently re-fetch from scratch, and fragments the floor-probe cache (keyed on that same URL) for what is otherwise identical geometry — exactly what field telemetry showed: the same GLB, same byte count, loading in under 150ms most opens and taking 5-9+ seconds (once 61s) on others, `postMs` spiking in lockstep with `probeMs` jumping from 0 to 900-3200ms on the slow ones. `versionedModelUrl()` now memoizes per file path — one real HEAD probe per page life, every caller awaits the same result — so the two callers can no longer disagree. Invalidated explicitly right after a central model upload so a freshly-replaced model is still picked up.
- **The diagnostic SHA-256 hash and the `.rooms.json` sidecar sync were both awaited serially after the GLB's own decode finished, though neither depends on it.** The hash only needs the raw bytes already in hand before decode starts; the sidecar fetch only needs the add-on's model path, known before the GLB is even downloaded. Both now start the moment their real dependency is available and are awaited only where their result is actually used, letting their latency run in the shadow of the multi-second decode instead of stacking after it.
- Field telemetry from a 765-mesh/17MB villa shows the network fetch, not decode, as the dominant and most variable cost — often several seconds, against Babylon's own import and this app's post-processing usually landing under two seconds combined. The fixes above remove the avoidable overhead on that path; the remaining cost is genuinely how long the WiFi/Ingress hop takes to move that many bytes, which geometry/texture complexity bounds directly — the same telemetry's smaller, ~2-3MB villa loads consistently fast by comparison.

## 2.80.0

### Changes
- **KTX2 (GPU-compressed) textures now work with no internet.** This is what unblocks the last big load item: with the floor-probe cache landed, Babylon's own glTF import is ~1.5s of a ~2.1s load, and most of that is texture decode. Ordinary PNG/JPEG textures are decoded by the CPU and uploaded as raw pixels; KTX2 transcodes straight into whatever compressed format the GPU speaks — ASTC on an iPad — and **stays compressed in GPU memory**, which matters twice over on the device that has a per-tab memory ceiling.
- **The decoder is shipped, not fetched.** `@babylonjs/core` bundles Draco but not KTX2, so out of the box Babylon pulls the decoder from its CDN — on a villa iPad with no WAN that is not "slower", it is a villa with no textures. The decoder module now comes from npm and the MSC transcoder (which Babylon does not publish there) is vendored in `src/assets/ktx2/`, both imported so Vite hashes them and resolves the right base under Ingress. They are already in the service worker's precache manifest, so an offline install has them from the start. Adds ~520KB to the bundle, gzipped to ~290KB.
- **Only the ETC1S path is wired; the UASTC entries are deliberately left null.** Pointing them at a CDN would reintroduce the exact dependency this exists to remove, and shipping four more WASM binaries for a format nothing here produces is dead weight. A UASTC GLB will fail to decode rather than silently phone home — the louder failure, and the right one.

### Pipeline (blender_pipeline.py 2.16.0)
- **`--ktx2` re-encodes the exported GLB's textures in place**, so the file uploaded to the kiosk is already the optimised one — a manual CLI pass is a step that gets skipped, and then the villa is slower for a month before anyone notices. Needs node/npx and internet **on the machine running the pipeline**, which is fine: that is a laptop, not the villa. Best-effort — a missing npx or a failed encode leaves the plain GLB untouched rather than producing no output at all.
- **Check the result before shipping it.** ETC1S is aggressive and this villa's baked lighting atlases are gradient-heavy, so look for banding on large flat walls and floors. Re-running without `--ktx2` gives the plain GLB back, and the old file can simply be re-uploaded.

## 2.79.1

### Changes
- **Removed the startup options dump added in 2.79.0.** It existed to settle whether a reverting toggle was being lost before or after the server read it; the answer turned out to be neither — the add-on's Configuration page needs its **Save** button pressed, and a toggle flipped without saving is discarded by Home Assistant, not by this add-on. Diagnostics that have done their job are clutter, so it goes.
- The self-heal change from 2.78.0 stays. It was not the cause of that report, but it fixed a real latent bug: the sweep worked from an allowlist compiled into the image, so any option added to `config.yaml` before a matching image shipped would have been deleted on every start. `public_model_access` was exposed to exactly that for many releases.

## 2.79.0

### Performance — measured, then fixed
- **The villa's floor probes are now reused across reloads, removing ~950ms from every load after the first.** 2.77.0's instrumentation named the culprit precisely: the downward raycasts that find the floor under each light fixture were **72% of `indexMeshes` and 27% of the entire visible load** — 42 rays at ~23ms each, because every one is a linear scan over a 1.4-million-triangle structure mesh with no octree. The in-memory bucket cache was already doing its job (180 requests collapsed to 42 rays); what it could not do is survive a reload — and reloads are the common case here, since Android evicts the PWA whenever it is backgrounded, so a phone paid this on every return to the app. The answers are a pure function of the geometry, so they are now kept and keyed by the **versioned model URL**: upload a different GLB and the key changes, so a stale answer cannot outlive the model it describes.

### Fixed
- **The profile and passcode screens no longer freeze — the villa is decoded only after sign-in.** 2.76.0 tried to keep the pre-login decode while protecting input, by not starting it during passcode entry and waiting for an idle moment. That wasn't enough, for a reason that is simple arithmetic: choosing a profile takes longer than the idle wait, so the decode had already started by the time the pad opened — and a decode in progress cannot be paused, it is synchronous main-thread work. The trade is now settled the other way: a spinner after sign-in beats a passcode pad that drops digits, because a stutter is indistinguishable from a mis-tap and the digit just gets typed again. Every platform now behaves alike, which matters because iOS has always loaded only after login (memory ceiling) and the target device is an iPad. The model's BYTES are still fetched as early as possible — that is a plain download and costs the screen nothing.

### Diagnostics
- **The add-on now logs the options it actually read at startup**, and whether `public_model_access` resolved ON or OFF. A toggle that reverts after a restart could not be settled by argument — every theory about it was either wrong or unfalsifiable from outside — so the server's own view of its configuration is now a fact in the add-on log. Passcodes are reported as set/unset and never echoed.

## 2.78.1

### Changes
- **Rewrote the `public_model_access` help text as a plain ON-versus-OFF comparison.** The previous version explained the reasoning and buried the behaviour; this one states what each setting does in the first two sentences, keeps the warning, and says outright that devices which have signed in before are unaffected either way.

### Note on the reverting toggle
- The fix for that (2.78.0) lives in `supervisor-proxy.py`, which ships **inside the add-on image** — unlike `config.yaml` and these labels, which come from the repository and update as soon as it refreshes. So the option will keep resetting until the add-on is updated to an image built from 2.78.0 or later. The version shown in the app's Advanced Settings footer is the image's version (the Dockerfile bakes the built frontend and this Python into the same image), so it is the reliable way to tell which one is actually running.

## 2.78.0

### Fixed
- **An option toggled on in the add-on's Configuration page could silently revert to off after a restart.** Reported against `public_model_access`, and the mechanism would have hit every future option too. The add-on self-heals its stored options by deleting keys the running code doesn't recognise — an ALLOWLIST, which is backwards for something shipped inside a Docker image. `config.yaml` and the field labels come from the *repository* and refresh as soon as the add-on repo does; the Python that reads them comes from the *image* and only changes when a new image is pulled. In the window between the two, the Configuration page offers an option the running code has never heard of, and the self-heal deletes it on every start. The operator toggles it, restarts, finds it off, and nothing logs a reason. `public_model_access` sat in `config.yaml` for many releases without ever being listed, so it was affected the whole time.
- **The self-heal is now a denylist of options this add-on has actually retired** (`sh3d_path`, `model_path`). It cannot delete a setting that the current Configuration page offers, whatever version of the image is running. Worst case is now a stale key lingering until someone names it — a log warning — rather than a deliberate choice being discarded in silence. A test fails if any currently-offered option ever appears on that list.

### Changes
- **Rewrote the `public_model_access` help text, which oversold it.** It implied you had to switch it on to get a background pre-load. You don't: the villa starts loading as soon as the app opens, and a device that has signed in before already pre-loads without this. The option only affects devices that have never signed in (or whose sign-in expired) on the add-on's own hostname, and it has no effect at all in the Home Assistant sidebar. The text now leads with "leave this OFF unless you know you need it" and states the cost plainly — the floor plan becomes downloadable by anyone who can reach the add-on.

## 2.77.0

### Changes
- **Split the heaviest load step so the next field report says which part of it is slow.** `indexMeshes` — entity binding, light creation, badge building — has been reported as one number, and in the field it ranges from 742ms to 4,070ms. That is enough to know it matters and not enough to fix it. The `load` event now also carries `probeMs` and `probeRays` (the downward floor raycasts, historically THE bottleneck here), `probeHits` (so the bucketing cache's real hit rate is visible — the number that says whether a finer grid would help or is already exhausted), and `labelsMs` (badge construction).
- Deliberately measurement before surgery. This renderer took months to stabilise on iOS and is now targeted at an offline iPad; optimising it on a guess about which pass dominates is how a working villa becomes a broken one. The counters are plain accumulators — nothing runs between loads, and nothing is fetched.

## 2.76.1

### Changes
- **Hardened 2.76.0's idle scheduling for Safari.** `requestIdleCallback` is a recent arrival there, so the code already had a `setTimeout` fallback — but the cleanup decided how to cancel by checking a DIFFERENT global than the one that scheduled, which is exactly the shape that misfires on the browser the fallback exists for. Each branch now owns its own teardown.
- No behaviour change on iPhone either way: the pre-login scene mount is disabled on iOS entirely (it can exceed the per-tab memory ceiling and retrigger a crash loop), so this scheduling never runs there.

## 2.76.0

### Changes
- **The profile and passcode screens no longer freeze while the villa loads behind them.** Mounting the 3D scene before login (2.30.2) buys a head start, but the decode is main-thread work — the release note for it said in as many words to "expect this screen to still stutter/pause during a preload". Two rules now protect the input instead of the decode:
  - **It never starts while a passcode pad is open.** Entering four digits is the most timing-sensitive thing anyone does here, and a pad that drops a digit is worse than a spinner: the user can't tell a stutter from a mis-tap and simply types it again. Entry takes a couple of seconds; the preload can wait for it.
  - **It waits for the browser to go idle first**, so the screen paints and its first taps land before anything heavy begins — with a bounded timeout, for devices that never report idle.
- Once started it is latched, since unmounting a half-built scene throws the work away and helps nobody.

### What this does and doesn't fix
- This narrows the window; it does not close it. The decode still runs on the main thread, so a preload that has begun can still cause a pause. Closing it completely means moving the Babylon layer into a Web Worker via OffscreenCanvas — a large, separate rewrite, still not attempted.
- The most effective change available without that rewrite is not in this app at all: the villa's own GLB. Decoding is 97% of the load (measured, see 2.75.0), and re-encoding textures as KTX2 (`npx @gltf-transform/cli etc1s villa.glb out.glb`) moves a large part of that work from the CPU to the GPU. No code change, no rebuild.

## 2.75.0

### Changes
- **The GLB download now starts before React mounts**, rather than only while the profile screen is showing. The common case is that the screen never shows: a returning device restores its profile and renders straight through to the villa, so every ordinary reload — which on Android happens whenever the app is backgrounded — paid the download again with nothing overlapping it. It is a plain fetch with no DOM, scene or decode work, so it cannot make anything on screen hesitate.
- **Load telemetry now records whether the pre-download was actually used** (`prefetched: true/false`). Without it, "is the pre-load working?" was unanswerable from a device you don't hold: the phase timings alone can't tell a fast network from a prefetch that finished before login.

### Measured, and worth stating plainly
- **Downloading is 3% of the wait. Decoding is 97%.** Across 26 real loads from this installation: fetch median 119ms, parse median 3,738ms. `public_model_access` and every other download optimisation are therefore worth about a tenth of a second on this network — the setting works exactly as documented, it simply has almost nothing left to save here. The remaining time splits roughly evenly between Babylon's own glTF/Draco import (~1.6s) and this app's post-processing (~2.0s), both main-thread work that no amount of pre-downloading can overlap.

## 2.74.0

### Changes
- **A form field's label spacing is now defined once, not three times.** The Settings body, the slider fields and the Facility forms had each grown their own numbers for the same idea — 6px under a 13px label, 8px, and 5px under a 12px one — so a field looked slightly tighter or looser depending on which modal you were in, and the Facility forms read as cramped next to the rest of the app. One pair of tokens (`--field-label-gap`, `--field-label-size`) now feeds all three, set to a slightly roomier 7px.
- **`roomKey()` replaces ~18 hand-written room-name normalisations.** Room names are typed in three unrelated places — Advanced Settings, the SweetHome3D plan, and Home Assistant's own Areas — and every comparison between them has to be case-insensitive and whitespace-tolerant. That rule was spelled out as `name.trim().toLowerCase()` at each site across the Babylon layer, the config layer and the components. All correct; the risk was never the code that existed but the next site that reasonably decides to also strip a hyphen and silently stops matching everything else. Two sites that looked identical but normalise sensor STATES, not rooms, were deliberately left alone.
- **`useEntityLabel()` replaces the same two-table lookup written out at seven call sites.** Resolving a device's display name always meant reaching into both the entity map and the live entity table with exactly the right optional chaining; one site forgetting the config label would silently show Home Assistant's name instead, on one screen only, and read as a data bug.
- **`EvidenceRow`'s `onChange` is optional**, so a read-only photo strip stops having to declare a do-nothing handler — three files each carried their own.

### Deliberately not changed
- **The HUD's two press-and-hold gestures stay as they are.** They look like duplicates of `useLongPress` and are not quite: each is a per-item handler factory built over a `.map()` (where a hook cannot be called), and their hold times differ on purpose — 450ms on a floor button, 480ms on a category icon, against the hook's 600ms, which is tuned for a list row you might be scrolling. Collapsing them would mean extracting two child components and re-timing two field-tested gestures, for no behaviour change. Recorded here rather than done quietly, so the next person doesn't rediscover it as an oversight.

## 2.73.3

### Changes
- **Removed the stray "Choose files / No file chosen" control that appeared under the photo strip.** It was the hidden file input the camera button triggers, made visible by 2.73.1: that release styled form controls with `.fm-field input`, a DESCENDANT selector, and its `display: block` overrode the input's `hidden` attribute. Two separate mistakes, both now fixed properly rather than patched at the symptom.
- **Form-control styling is scoped to direct children.** A field styles its own control, not whatever a nested component renders inside it. The descendant form also reached DeviceSearchPicker's search box — which has its own styling and doesn't want this one — so the device pickers in the fault and spend forms were being restyled too.
- **`hidden` now means hidden, globally.** The attribute is a UA rule at the lowest possible precedence, so any author rule setting `display` silently defeats it, and the markup reads as correct the whole time. This is the second occurrence (the collapsed offline-devices list kept showing its chips in 2.70.0, for exactly the same reason), so it is now guarded once for the whole app instead of being fixed per site. Recorded in the project's gotchas so the next `display` rule doesn't reintroduce it.

## 2.73.2

### Changes
- **Placeholder text now matches across a form's controls.** 2.73.1 styled the textarea's placeholder but left the single-line inputs on the browser default, so the fault editor showed two different placeholder greys in adjacent fields. Applied to both, from one rule.

## 2.73.1

### Changes
- **Multi-line fields in the Facility workspace were rendering unstyled** — a white box with black text, sized by the HTML `cols` attribute rather than the form column, sitting out of line with every field around it. The form-control rule read `.fm-field input, .fm-field select` and had simply never included `textarea`, so the browser's own defaults applied. Nothing had noticed because until recently the only textareas in these forms were in dialogs rarely opened; 2.72.0 put one on the fault and spend editors, where it was immediately obvious. All three control types are now styled together, so the next multi-line field added anywhere in the workspace inherits it instead of needing its own rule.
- Also: dropped the second paragraph from the fault details placeholder (a blank line inside placeholder text renders literally, which read as a layout glitch), and the auto-grow now leaves the height alone when the field is measured inside a hidden tab, where the browser reports zero and the field would otherwise collapse until the next keystroke.

## 2.73.0

### Changes
- **Every add-on option now explains itself on the Configuration page.** Until now that page showed the raw key — `evidence_retention_days`, `public_model_access` — and nothing else. All the explanation existed, but in comments inside `config.yaml`, which is a file the person configuring the add-on never opens. Home Assistant renders help text from `translations/en.yaml` and the add-on didn't ship one, so none of it reached the only screen where the decision is actually made. Each of the nine options now has a proper label and a short description written to answer "what do I put in this box", including what an EMPTY value means — which differs per field and is the easiest thing to get wrong: an empty guest passcode lets anyone in, an empty owner passcode removes the profile entirely, and an empty superadmin code switches record deletion off for everybody.
- **The exposed port is explained too**, since mapping it is the single decision that changes this add-on's exposure most.
- **A test fails if a future option ships without help text**, or if help text is left behind for an option that no longer exists. A setting nobody can interpret is how a villa ends up misconfigured, and passcodes and public model access are exactly the fields where that matters.

## 2.72.0

### Changes
- **A fault can finally be explained, not just named.** "Describe the problem" was a single-line input and the only text field a fault had — so a fault could be given a headline and nothing more. It is now a one-line **Summary** (the card title, the report row, the thing people scan a list for) plus a **Details** field that takes as much as you need: what exactly happens, when it started, what has already been tried. Editing a fault opens both, and the details show on the card underneath the summary.
- **Every free-text field in the Facility workspace is now the same field.** Each form had drifted to its own idea of "notes": the fault form had none at all, logging a completion used a single-line input that scrolled sideways past about eight words, and the two dialogs that did use a textarea disagreed on its height. How much you could say about a piece of work depended on which screen you happened to be on — which is not a decision those screens should be making. One `NotesField` now serves faults, spend, completions, every fault-stage update and the guest report form.
- **It grows with what you type.** A fixed three rows is wrong in both directions — too tall for "replaced the filter", too short for a real account of what went wrong. The box expands as you write and shrinks again when text is deleted, capped so it can never push a form's buttons off the bottom of a phone screen, after which it scrolls.
- **The guest report gained the same split**: a short "what's wrong" that becomes the fault's headline, and an optional details field for when it started, how often it happens and anything already tried. A guest typing three paragraphs into the summary would have produced a fault whose title was truncated in every list that shows it.

## 2.71.0

### Changes
- **Four hardcoded policy values are now add-on options.** How long evidence is kept, how long a session lasts, how much diagnostic history to hold and how hard a wrong passcode bites are all POLICY — no single number is right for every property — so they belong in the Supervisor UI rather than in a Python file an operator would have to patch and then lose on the next update. All are read live (a change applies without restarting the add-on) and clamped server-side, because the schema only guards what the UI writes: `/data/options.json` can be hand-edited, and a retention of `-1` or `10^9` must not become "delete everything" or "never delete".
  - `evidence_retention_days` (550, ~18 months) — `0` switches age-based deletion off entirely, for an operator whose own obligation outlives any default we could pick. Independent of the clean-up of photos nothing references any more, which always runs: those files are pure waste at any age.
  - `session_days` (30) — a wall-mounted kiosk wants a long one; a villa where guests come and go with their own phones wants a short one, so a departing guest's session lapses on its own.
  - `telemetry_max_events` (500) — raise it while chasing an intermittent fault on someone else's device; the ring is fixed-size, so the only cost is a slightly larger file.
  - `pin_lockout_minutes` (5) — the lockout is per source address, so raising it punishes a guesser rather than locking the household out.
- **Fixed the offline-devices section not actually collapsing.** The chevron flipped and the chips stayed. `.fm-chiprow` sets `display: flex`, and an explicit `display` beats the browser's own `[hidden] { display: none }` rule — so the `hidden` attribute did nothing. Rendered conditionally instead, which removes the trap rather than fighting it with more CSS.

## 2.70.0

### Changes
- **A guest can now report a problem.** The guest is the person standing in the room when the air-conditioner starts rattling — and until now the only way that reached the maintenance record was if they happened to mention it to somebody. Every profile holds the new `reportFault` capability, but a guest gets one screen and three fields (what's wrong, which device, an optional photo), not the six-tab Facility workspace they hold no permissions for. Reports are flagged `reportedBy: "guest"` and marked on the fault card, because they should be read as a symptom noticed from inside the villa rather than a diagnosis.
- **That permission is enforced by the SHAPE of the write, not by a role.** Admitting "guest" to the facility store's writer roles would have handed over the whole maintenance record, so the add-on additionally requires a guest's write to leave every other collection byte-identical and to only APPEND to tickets — no removal, no edit of an existing one, not even of their own report once filed, no pre-resolved status, no attached cost, and no rewriting of a field this server version doesn't recognise. Twelve new assertions pin each of those. Guests may upload an evidence photo but still cannot read one back: that read gate was deliberately closed in an earlier hardening pass and reopening it for a nicer thumbnail would be a real regression, so their form confirms the attachment rather than showing it.
- **Work that was done is finally visible.** Completions were write-only — logging one recorded who, when, a note, a cost and photographs, and then no screen ever showed it again; the evidence surfaced only inside a generated monthly report. A "Recent work" list now sits under the Today board, saying for each entry whether it answered a scheduled task or a fault, with its cost and its photographs.
- **Every fault transition now records what happened.** "Mark in progress" and "Mark resolved" were bare status flips: mean-time-to-resolution rested on a timestamp with nothing behind it. Both now open the same dialog — who, what happened, a photo, and (on resolution only) what it cost — and the fault keeps a visible timeline of those steps on its card. One dialog for every transition rather than one per stage, since they ask the same questions and only the cost field differs.
- **A fault and the work that fixed it are one record again.** Resolving files a completion linked back to the ticket, so a report can say "this fault, fixed on this date, at this cost" — previously two unrelated rows with nothing joining them. Reopening a resolved fault now also clears its resolution timestamp, which would otherwise have quietly corrupted every mean-time-to-resolution figure derived from it.
- **Readiness can be frozen as evidence.** It is computed live from device state, which makes "was the villa ready before the last guest arrived?" unanswerable after the fact. *Save snapshot* keeps a point-in-time markdown record in the same saved-documents store the monthly report and spend statement already use.
- **Spend entries take notes, like faults do** — the person reading a one-line label in six months is not the person who typed it.
- **The offline-devices shortlist in the fault form starts collapsed.** It is a useful shortcut when the fault you are raising IS one of those devices, and noise otherwise; expanded, ten chips pushed the description field — the one thing every fault needs — below the fold on a phone.

### Storage
- **Evidence photos are now garbage-collected on every facility write, not only on a delete.** Two ways for JPEGs to accumulate in `/data` were open: editing a record to remove one photo dropped the reference and kept the file, and a photo uploaded into a form that was then cancelled was never referenced by anything at all. Both are now the same rule — a file nothing references is garbage — with a 12-hour grace period so a form still open on someone's phone never has its attachments swept out from under it. A fault's per-stage photos are counted as references too, so recording a repair photo can't cause the original fault photo to be collected. The retention sweep (550 days) now also runs on this path, so a villa that has stopped uploading still ages out its old evidence instead of only pruning when someone adds a new photo.

## 2.69.0

### Changes
- **A recorded fault or spend entry can now be corrected — tap the card to open it.** Both were write-once: a fault raised in thirty seconds from a phone (a device and four words, which is exactly the right way to raise one) could never be given a proper description, a photo, or a corrected device afterwards. The same form does both jobs rather than a second, subtly different editor, so the two cannot drift apart. Editing leaves the record's history alone: a fault keeps its status, opened and resolved timestamps, and a spend entry keeps the date it was recorded against — which is what the monthly total and the cap are computed from. Erasing one still needs the superadmin code; correcting one is ordinary work and does not.
- **Evidence photos are visible where the record is, and open full size.** A saved fault said "3 photo(s)" and gave no way to see them, which makes a photo a claim rather than evidence. Faults and spend entries now show their thumbnails inline (smaller than in the capture form, so a three-photo fault isn't taller than the text describing it), and tapping one opens a full-size viewer with arrow-key and swipe-free chevron navigation, Escape or backdrop to close. The viewer lives in the component that already draws thumbnails, so every present and future surface that records evidence gets it without wiring.
- **Tap-and-hold to erase no longer collides with tap-to-open.** A completed hold is followed by a click, which would have opened the editor underneath the authorisation prompt. The long-press hook now reports that it consumed the click, and controls inside a row (the status button, the device chip) keep acting as themselves rather than opening the card.
- **A device panel can raise a fault about the device it is showing.** An icon button beside *Edit* opens the Facility workspace on the Faults tab with that device already filled in. The gap it closes is the moment of noticing: someone walking the villa taps the badge of a lamp that won't come on, and acting on it previously meant closing the panel, opening Facility, finding Faults and searching for the device they had just been looking at — four steps and a name they may not know. The description is deliberately left blank: the "<device> offline" guess is right when Home Assistant reports the device down, but a fault raised by hand is usually something HA cannot see at all (a dripping tap, a cracked panel), and a pre-written wrong title tends to get saved as written. Hidden for profiles without the Facility capability, so the shortcut can never lead to a screen the profile cannot open.

## 2.68.0

### Changes
- **The Facility device picker offered rows that were not devices.** Raising a fault and searching "Bedroom" suggested "Bedroom 1", "Bedroom 2", "Bedroom 3" — entries Home Assistant has never heard of, each shown exactly like a real device and each impossible to identify or act on. They appeared nowhere else in the app, which is what made it so confusing: Advanced Settings showed nothing unmapped, because that screen hides bound rows, drops dismissed ones and puts stale ones behind an explicit "no longer in Home Assistant" banner. The picker applied none of those filters — it enumerated `entityMap` with only `disabled` checked.
- **"What counts as a device" is now one function, `selectableDeviceIds`.** It applies the rules that were already spelled out for the unavailable-devices list and nowhere else: hidden entities are out; CONFIG DEBRIS (no HA entity *and* no geometry in the model — a leftover key from a renamed entity or an older GLB) is out; dismissed entities are out; and the members of a multi-entity device fold into their primary so one physical thing is one row. `unavailableDeviceIds` is now that same list filtered to the offline ones, rather than a second implementation of the same rules — the two can no longer disagree about the same device, which is exactly the class of bug this was.
- **Both tabs are handed one prebuilt list.** Faults and Spend each built their own candidates; they now share the one FacilityModal computes, the same way the offline shortlist already worked. Two screens deriving "the villa's devices" from different starting points is how they came to disagree in the first place.
- **Every suggestion now names its entity_id.** A friendly label alone frequently identifies nothing — "Bedroom 1" tells an operator nothing they can go and look at, while `sensor.bedroom_1` names it exactly. The id sits under the label alongside the room, always visible rather than on hover (unusable on a phone), and both lines truncate so a long id can't make the list jump while typing. Devices Home Assistant currently reports as offline are flagged in the row, since that is very often why someone is raising the fault. The offline quick-pick chips and the device chips on saved faults/spend entries carry the id as a tooltip for the same reason.
- **"Unmapped" is no longer displayed as if it were a room.** It is the placeholder the model auto-detection writes before a device's real room is worked out — an internal marker that was being rendered in the slot where a room name goes, reading as a place in the villa called "Unmapped". Rows with no room now say "no room set".
- **Audited every other list built from the entity map; the picker was the only one missing these rules.** The category modal already applied dismissals and RBAC, Advanced Settings its own filtering plus the stale banner, and the unavailable-devices modal the full rule set. The remaining enumerations are counts and one-off config migrations, not lists anyone is shown.

## 2.67.0

### Changes
- **The per-light Intensity slider in Advanced Settings did nothing at all.** Not "nothing until the light next changes state" — nothing, ever, until a model reload or an unrelated structural edit happened to rebuild the scene's index. The cause: `EntityVisuals` keeps its own cache of each entity's mapping, and that cache is populated **only** by `indexMeshes()`, the multi-second structural pass. `lightIntensityRatio` is (correctly) classed as a COSMETIC field so that editing it stays instant instead of re-indexing the whole villa — but that classification is a promise that nothing in the structural pass reads the field, and this one was read straight off the cached mapping the structural pass builds. So the slider wrote a value to config that the renderer never looked at again.
- **Fixed by refreshing the cached mappings whenever the entity map changes**, driven off the same COSMETIC_MAPPING_FIELDS list that declares which fields are safe to skip re-indexing for — so the next cosmetic field added is covered automatically rather than repeating this bug. The entries are replaced rather than mutated in place, because the resolver can hand back the config's own object and writing through it would edit the previous config.
- **The affected lights are then re-applied through the normal state path**, not by recomputing the brightness formula at the call site. That formula already appears in three places, and the override feeds both the light a fixture *casts* and the fixture's own emissive *glow* — a resync that moved only one of them would leave a bulb looking unchanged in a room that visibly got darker. Only the entities whose override actually changed are re-applied (usually one, and the slider is debounced), so the global "Light effect strength" slider keeps its lighter resync for dragging across every light at once.
- **Fixed a WebSocket reconnect that silently stopped entities from updating.** `resubscribeAll` sent on `this.ws` while every other reply in that handler deliberately sends on the socket the message arrived on — the distinction exists because a concurrent reconnect can already have replaced `this.ws` with a newer socket that is still CONNECTING, where `send()` throws. This call site was missed when that rule was introduced, and the damage was wider than one failed subscribe: the exception escaped mid-loop, so the remaining subscriptions were never re-registered **and** the rest of the `auth_ok` branch — starting the heartbeat, and resolving the connect promise — never ran either. Reported from a phone as `Failed to execute 'send' on 'WebSocket': Still in CONNECTING state`; the visible symptom is entities going quiet after a reconnect until the app is reloaded. Now sends on the authenticated socket, skips a socket that isn't open, and isolates each send so one failure cannot cost the others their subscription (anything not sent is re-issued on the next `auth_ok` rather than lost).

## 2.66.0

### Changes
- **The Facility Manager store now reports itself in telemetry.** A field report — "marking a fault in progress on the MacBook doesn't show up on the phone" — arrived with a telemetry dump in which every single `sync` event was the *device-config* store. The maintenance store had none at all, so the log could not distinguish a write that never left the desktop from one that landed perfectly and a screen that simply had not asked for it yet. It now emits the same `sync` events (pulls with revision and record counts, pushes with their outcome, and the silent paths: unreachable, skipped, deferred), and every event from either store now carries `store: "config"` or `store: "fm"` so a dump can never be misread again. Adding refresh triggers to that store in 2.64.0 without adding its telemetry was the gap.
- **The dedupe that keeps those events readable is now shared rather than a private detail of one store.** The ring holds only the newest 500 events and a phone fires a pull on every visibilitychange — a few seconds apart — so an undeduped steady state evicts the very history it exists to explain. `useSyncReporter` is now one implementation used by both stores.
- **A failed Facility write no longer freezes that device's refresh for the rest of the session.** The refresh guard compared local state against the last known server state and skipped while they differed, which is right while a write is in flight. But a write that *failed* leaves them different permanently: local is kept deliberately (losing what an operator just typed is worse than showing it unsaved), the baseline never advances, and so that device silently stopped accepting any remote change, with nothing on screen explaining why. The guard now distinguishes the two — in-flight writes are waited out as before, while unsaved work is **re-pushed** on the next refresh tick. That both saves the work and clears the block, and since a successful push returns the merged document, the remote changes arrive in the same step.
- **While the Facility panel is open, the store re-reads every 15 seconds instead of every three minutes.** The background heartbeat is right for a store nobody is looking at, but on a screen someone is actively watching it meant the only way to see another device's change was to minimise and restore the window (which fires a visibility change) or wait out the beat — and there is no way for the operator to tell that apart from a broken sync. The fast cadence applies only while a panel that displays the records is mounted and the document is visible; an unattended wall tablet still costs one small GET every three minutes.
- **Corrected the `superadmin_pin` description in the add-on options.** It claimed the code was needed to delete a saved report or a schedule. It is not — those keep their ordinary delete buttons on purpose, since a schedule is a plan rather than a record of something that happened and a report can be regenerated. The text described an earlier draft of 2.65.0, not what shipped.

## 2.65.0

### Changes
- **A fault or a spend entry can now be erased for good — press and hold it, then enter a 6-digit superadmin code.** Until now nothing in the interface deleted either one, deliberately: they are the evidence a fault existed and that money was spent, and resolving a fault keeps it. But entries do genuinely need to go sometimes — a duplicate raised from two devices, a test row, a figure recorded against the wrong villa — and the only alternative was leaving wrong data in the record permanently. The new capability is deliberately narrow: it destroys the record and its evidence photos from `/data`, and it asks for the code every single time.
- **The code is not a fourth profile, and holding it grants nothing on its own.** There is no superadmin session, nothing to sign out of, and no state the app can be left sitting in. A correct code mints one single-use token with a two-minute ceiling that authorises exactly one write; the server consumes it on use, so it cannot be replayed, cached or saved for the next deletion. It is also purely additive — the store's existing owner/ops write rule still applies, so a guest with the code can still delete nothing.
- **Enforced by the server, not the button.** The FM store takes whole documents, which means a client that simply omits a record IS a delete — gating only the UI would have left the capability wide open to anyone holding a normal session and a JSON editor. `supervisor-proxy.py` now compares the incoming document against the stored one and refuses the write outright if any evidence record disappeared without a valid elevation. Attempts are rate-limited on the same two-tier (per-client-IP plus global) limiter the profile passcodes use, and compared in constant time.
- **Only evidence is protected.** Faults, spend entries and logged completions need the code. Schedules and saved reports deliberately do not, and keep their ordinary delete buttons: a schedule is a plan rather than a record of something that happened (deleting one destroys no history — the completions it produced survive), and a saved report can be regenerated from the records it was built from. Putting a code in front of routine housekeeping would be friction bought with nothing.
- **The hint is one small dot in the corner of an erasable row.** Someone who has been told what it means spots it immediately; someone who has not reads it as decoration. That is the intent — the capability is documented on a need-to-know basis in the add-on options, and a louder affordance would advertise something most profiles cannot use anyway. An earlier experiment with hint dots on the HUD category icons was removed as clutter in 2.59.0, so this one is fainter and appears only on rows that actually offer it.
- **`superadmin_pin` is a new add-on option, empty by default — which means the capability is OFF.** With no code configured no elevation can be minted at all, so records are simply un-erasable from the app rather than erasable by anyone. The option carries its own explanation in the add-on config page.
- **A refused deletion now visibly un-deletes.** Every other failed write keeps the local change and says it is unsaved, because losing what an operator typed is worse than showing it as pending. A rejected delete is the opposite case: the record still exists on the server and every other device still shows it, so leaving this one screen quietly disagreeing would be the wrong kind of optimism. The row comes back with an explicit "nothing was removed".
- **Erasing a spend keeps the work.** A completion that pointed at the deleted cost loses only the link, not the completion — the job still happened, it just no longer has a price attached, which beats rendering as work of unknown cost.
- **Two pieces of shared machinery came out of this rather than a third copy.** `useLongPress` gives press-and-hold one definition (with a movement tolerance, so a hold that turns into a scroll on a phone never fires) — the HUD still hand-rolls its own twice and is the next thing to move onto it. `PinPad` grew a length parameter instead of being forked for six digits, so the profile gate and the elevation prompt share one keypad, one lockout countdown and one keyboard path.

## 2.64.0

### Changes
- **The Facility Manager screen now refreshes itself, so a fault or completion logged on one device stops being invisible on another until the app is restarted.** Found while field-verifying 2.63.0's concurrency fix: raising a fault on the phone and then one on the desktop correctly kept BOTH (the desktop even showed the phone's fault the instant it wrote, because a successful push returns the merged document) — but the phone only saw the desktop's fault after a restart. The records were right; the screen simply never asked again. `FmDataContext` re-read only on mount: no focus trigger, no visibility trigger, no heartbeat. In practice that means the facility manager logging work on site and the owner watching on another device cannot see each other, which is the normal working pattern rather than an edge case.
- **The refresh triggers are now one shared hook (`useStoreRefresh`) used by BOTH server-backed stores**, rather than the device-config sync owning a private copy and the FM store having none. Mount, window focus, `visibilitychange`, and a slow heartbeat that only fires while the document is visible — so a wall-mounted tablet or a desktop window left open on the Facility tab, which fires none of the other triggers, still converges. "How fresh is this screen" now has one answer across the app instead of one per store, which is the same reason the diff/push protocol was unified in 2.63.0.
- **The FM refresh will not clobber an unsent edit.** `mutate` applies locally first and pushes after, so between those two moments local legitimately differs from the server — a refresh landing exactly then would wipe a completion someone just walked across the villa to log. The refresh compares local against the last known server state and skips while a write is pending, the same rule the device-config sync already followed; the push is already in flight, so the next refresh reconciles. Losing a beat of remote changes is fine, losing the operator's entry is not.
- **Audited every other server read for the same gap; the rest are deliberately not live.** `/device-config` already had these triggers. `/telemetry` is a diagnostic snapshot behind an explicit Refresh button — auto-refreshing a ring while someone reads it would make it jump under them. `/auth/roles` is read at the profile gate and only changes with add-on options (which restarts anyway). `/addon-config` reports the central 3D model: swapping the GLB live would tear down and rebuild the Babylon scene mid-navigation, which is worse than being stale, so a new upload is still picked up on next load by design. Only the FM store was actually missing refresh it should have had.

## 2.63.2

### Changes
- **The service worker was serving the add-on's own mutable endpoints from cache on the standalone hostname, so clients were syncing against stale documents.** With 2.63.1's write path finally working, the telemetry showed the desktop's push succeed (`ok:true`, revision `…624218676838`) and then a pull four seconds later report revision `…961413682719` — a document **1.8 hours older than the write that had just been confirmed**. Other pulls returned `rev:"0"` with `entities:129` against a current 101: bodies so old they predate the revision field existing at all. The cause is in `sw.js`'s never-cache rule, which excluded `/api/`, `/auth/` and `camera_proxy`. The add-on's own endpoints only ever matched that by accident — behind Ingress they sit under `/api/hassio_ingress/<token>/…`. On the **standalone hostname, which is exactly what an installed PWA uses**, the same endpoints are bare paths like `/device-config`, matched nothing, and fell through to the cache-first branch. So every shared-store read on a home-screen install was served from cache, origin-dependently — which is why it hit the phone and iPhone hardest and left Ingress tabs looking fine.
- **This was not a cosmetic staleness.** A client reading a pre-write copy of the shared config diffs against it and pushes conclusions drawn from data hours out of date, which is a correctness bug in the sync protocol rather than a rendering delay. It also cached the telemetry GET, so the diagnostics panel could serve a stale ring — meaning the tool used to investigate all of this was itself capable of showing an out-of-date picture. Earlier readings during this investigation that appeared to show a version not yet deployed cannot now be fully trusted for that reason.
- `/device-config`, `/fm-data`, `/telemetry`, `/addon-config` and `/model-upload` are now explicitly never cached, by one list rather than an incidental pattern match. The central model (`/model/*.glb`, version-stamped) and evidence photos (`/fm-evidence/<id>`, content-addressed by a never-reused id) stay cache-first, which is correct and is the whole point of that cache. The cache name is bumped to `villa-kiosk-v7` so the `activate` handler evicts the wrongly-cached API responses already sitting on every installed device.

## 2.63.1

### Changes
- **The store revision is now an opaque string, which fixes shared config having been silently unwritable since 2.60.0.** With 2.63.0 finally pushing correctly, the sync telemetry showed the next failure immediately: the desktop logged `op:"pull" aborted:"pending-local-edit" dismissed:6` — correctly detecting it was holding an edit — followed by `op:"push" ok:false reason:"conflict-retries-exhausted"`, with an unchanging revision of `1785586961413682700` on every event from every device. That number is the store file's mtime in **nanoseconds**, roughly 1.8e18, which is about **198x past JavaScript's `MAX_SAFE_INTEGER`**. At that magnitude the representable doubles are 256 apart, so a browser cannot hold the value exactly: it parsed a rounded number, sent that back as the expected revision, and the server's comparison against the true integer could never match. Every conditional write was therefore rejected with 409, on every retry, permanently — the shared config had been readable but **unwritable from any browser** since optimistic concurrency was introduced in 2.60.0, which is why the entity dismissals could never reach the server no matter which device made them. The revision is now a string end to end (server, both store clients, and the shared push protocol); nothing parses it, it is only ever passed back. A non-string `rev` from an older client is treated as absent rather than mismatched, so 2.62.0/2.63.0 clients regain the ability to write at all (unconditionally, without the concurrency check) instead of being blocked forever.
- **Four regression tests pin the hazard** (103 passing): the revision must be a string, including for a store that doesn't exist yet; it must change when the store is written; and — as positive proof of why it cannot be a number — the underlying value must exceed `MAX_SAFE_INTEGER` and must demonstrably corrupt if round-tripped through a double. Reverting it to an int now fails the suite instead of silently disabling every write.
- Typecheck, production build, and the Python security suite (103/103) clean.

## 2.63.0

### Changes
- **Found and fixed the actual removed-entity bug, which was in the sync code itself and not on the phone at all.** The new `sync` telemetry from 2.62.0 answered it in one read: both devices pulled the same revision reporting `serverHadDismissed:false` — the shared store had never contained `dismissedEntityIds` — while the desktop simultaneously reported `dismissed:6`. The desktop was reading its own localStorage and calling it synced; there was never anything on the server for the phone to receive. Root cause: `pull()` built the sync baseline as `{...local, ...server}`. That merge is correct for deciding what local CONFIG becomes (a key the server omits must not blank the field locally), but it was also being used as the record of what the SERVER holds — so for a key the server had never seen it substituted the local value and marked it already-synced. The push gate ("push only real changes") then compared local against that baseline, saw no difference, and never sent it. **A brand-new shared field could only ever be stranded on whichever device created it, looking perfectly applied there.** The baseline now comes from `baselineFromServer()`, which records server truth with an empty value for any key the server doesn't carry, so the diff correctly reads "local has 6 the server doesn't" and pushes. The empty-store seed path had the same conflation plus its own un-awaited write whose failure nothing could detect; it now commits an honest empty baseline and lets the normal debounced push do the seeding through the one write path that has concurrency control, retries and telemetry.
- **A full audit of every client↔server path found the same three bugs in the Facility Manager store, on more consequential data.** Enumerating from the server's routes rather than sampling the client showed exactly two mutable shared documents; everything else is one-way and was fine (`/addon-config`, `/model-upload`, `/telemetry`, `/fm-evidence` by unique id, auth). `/fm-data` — maintenance schedules, completions, costs, fault tickets and evidence links — was doing a whole-document PUT with **no** revision check and **no** unknown-key carry-over. The practical consequence: the owner resolving a ticket on one device and the facility manager logging a completion on another silently overwrote each other, whole-document, with no error shown, on the records that evidence the property's maintenance. Both roles hold `manageFacility`, so that is the normal working pattern rather than an edge case — the file's own docstring asserted a single-writer model that was never true for a multi-device install.
- **The cause of that second occurrence was a duplicated handler, which is why this release makes the sync machinery genuinely shared rather than merely similar.** The FM store admits `ops` as well as `owner`, and that one role difference had been handled by copying the entire server PUT handler; the copy inherited the auth and validation but not the revision check or the write lock (neither existed when it was copied, and neither got back-ported). On the client, `fmApi` likewise hand-rolled its own fetch/save next to an implementation that already did this correctly. Now: a new `src/utils/keyedSync.ts` owns the per-item diff/apply primitives **and** the fetch→rebase→write→retry protocol, and both stores use it — `DeviceConfigSync`'s own retry loop is gone. Server-side, `_json_store_handlers` gained a `writer_roles` parameter and the bespoke `fm_data_put_handler` is deleted, so the FM store inherits the revision check, the `asyncio` write lock and the validation instead of approximating them. Every FM collection is already `id`-keyed, so the existing keyed machinery applied verbatim with no bespoke merge logic.
- **Seven new regression tests pin the boundary shut** (98 passing, up from 91): the factory must keep `writer_roles`, the revision check and the write lock; a GET must return a revision; *both* stores must be built by that factory; and the reappearance of a hand-written `fm_data_put_handler` is now a test failure rather than a silent loss of protection.
- Typecheck, production build, and the Python security suite (98/98) clean throughout.

## 2.62.0

### Changes
- **The shared-config sync is now observable in telemetry, because it wasn't — and two rounds of diagnosis had been reasoning about a flow with no recorded evidence at all.** The removed-entity bug persisted on one device (a phone) after 2.61.0 fixed it on another (a desktop), and every explanation offered for that was a hypothesis: a stale service-worker bundle (disproved — `__APP_VERSION__` is compiled into the bundle, so the version shown in Advanced Settings *is* the running code), then a mixed-version write, then a sync race. The telemetry ring recorded only `load`/`lifecycle`/`error`/`context-lost` — nothing about whether a pull returned a given field or whether a push ever reached the store, which was exactly the open question. Every pull and push now emits a `sync` event carrying the store revision, the entity count, the dismissed-entity count, and whether the server document even contained the field. Since the ring is one shared server-side store that every client appends to, a dump collected from any owner device shows every device's sync outcomes side by side, distinguished by the user-agent/viewport each event already carries.
- **Deliberately instrumented for the SILENT paths, not just the happy one.** A first pass logged only successful pulls and pushes, which would have left the most-suspected failure — a pull deliberately aborting because that device is holding an edit the server hasn't got — indistinguishable from "no pull ever ran". Aborted pulls (`pending-local-edit`), an unreachable store, the empty-store seed, and a push that exhausts its conflict retries all now report; no branch of either operation can present as silence. Sync events are also deduplicated against the last one reported: the ring keeps only the newest 500 events and a phone fires a pull on every visibilitychange (the reported device does so every few seconds), so logging each one would have evicted the very history the events exist to explain. A change always reports; a steady state reports once.
- **The sync baseline is now persisted rather than living only in memory for the lifetime of the page.** It started as `null` on every fresh load, which reads as "no pending edit to protect", so the first pull after a reload could let the server's copy win over an edit that localStorage had correctly kept. On a desktop the push finishes long before that matters; on the reported Android PWA it does not — its own telemetry shows `pagehide`→`pageshow` cycles two seconds apart, faster than a 900 ms debounce plus a fetch-then-PUT round trip. That is a direct explanation for "the entities disappear when I press Remove, then come back a few seconds later", on that device only. The pending-edit check now works across a reload, so the edit is re-pushed instead of overwritten.
- **A client no longer deletes shared-config fields it doesn't recognise.** Reads deliberately drop unknown keys (a newer version's field must not be injected into config), but a write rebuilt the document from the parsed slice alone — so any client running an older build would silently erase a newer field for every device the moment it pushed anything. Writes now carry unknown server keys back untouched, which makes a mixed-version fleet (the normal state for a while after any release, and longer for an installed PWA) merely stale instead of destructive.
- **Fixed the category browse still listing entities the owner had removed** (visible under "Unmapped"), while the same entities were correctly gone from Advanced Settings. That list is built from the raw entity map, so it needed the dismissal rule too — applied at the single derived set every "is this on the map / does it exist" surface already reads, rather than as a third copy of the rule. Deliberately NOT done by filtering `config.entityMap` itself: rebuilding that object per render is what forced a full multi-second Babylon re-index in 2.58.0.
- Typecheck, production build, and the Python security suite (91/91) clean throughout.

## 2.61.0

### Changes
- **Fixed the removed-entity bug properly: it was TWO bugs, and 2.60.0 only fixed one of them.** Removing a stale entity genuinely did work on `entityMap` — which is why the rows disappeared from Advanced Settings and never showed in the long-press category modal, both of which read `entityMap`. But the **Unavailable devices** list doesn't read `entityMap` at all: it draws from mesh-derived ids, and the villa's GLB still literally contains a mesh named after the removed entity (the pipeline's own naming convention). No amount of deleting config rows can touch a name baked into the 3D model, so the entity was re-derived from the model on every load — which is also why it reappeared on a second device and after a restart. It was never stale stored state; it was regenerated from the model each time, everywhere.
- **"Remove N" now records the DECISION rather than just its effect**, via a new site-wide `dismissedEntityIds` list. It syncs through the shared config store like `entityMap` does, so dismissing on a phone dismisses on the MacBook and the wall tablet, and it survives reloads. Self-healing by construction: a dismissal only applies **while Home Assistant still doesn't know the entity** — if it ever comes back (recreated, renamed back, an integration reloaded), it behaves like any other live device again, so this can never silently become a permanent blocklist that hides a working device or masks a genuine outage. The rule itself lives in exactly one function (`dismissedEntitySet`) rather than being restated at each call site.
- **Fixed a sync path that could wedge a device in both directions.** A pull is deliberately aborted while this device holds an edit the server hasn't got (so a pull can't clobber it) — but if that edit's own push had already failed (a flaky phone connection being the normal case), nothing ever retried it: the push effect only re-fires when the local slice *changes*. The device would sit refusing every pull, for an edit it never sent, until the user happened to edit something else. A pull now retries the pending push instead of just aborting, so an ordinary focus/heartbeat pull is what unwedges it.
- **DRY audit across the shared-concept resolvers, after several surfaces were found deriving the same answer independently.** Three real divergences, each the same failure mode: a fix in one place not reaching the others.
  - **"Unavailable device" had a third implementation.** The Faults tab derived its own "broken devices" shortlist straight off `entityMap` — no device folding, no config-debris filtering, no dismissals — so one physical multi-entity device could count as two there and one on the HUD badge. It now consumes the same list `unavailableDeviceIds` produces, which is exactly what that function's docstring already said it existed to guarantee (it was written because the HUD and Facility readiness disagreed; the Faults tab was never folded in).
  - **Category resolution — the most serious one.** `effectiveCategory` is the canonical resolver (a stored category that merely equals the *legacy* auto-default is deliberately ignored so current defaults apply, and `device_class` participates). Three call sites still used the raw `mapping.category ?? categoryForEntity(...)` pattern, which disagrees with it on both counts — the same divergence behind 2.58.0's "blue glow says Energy, badge says Network". One of the three was `isMappingAllowed`, i.e. **RBAC**: the category deciding what a role may see could disagree with the category the map actually renders. All three (`permissions.ts`, `PickHandler`'s tap gate, `BindingRow`'s dropdown) now go through `effectiveCategory`.
  - **Display label.** `summaryGroups` derived its own from `friendly_name` alone, ignoring the user's stored label, so a device renamed in Advanced Settings kept its old Home Assistant name on that one summary tile while reading correctly everywhere else. Now uses `displayLabelFor`, the same rule as every other surface.
- Known remaining duplication, deliberately left for a follow-up rather than churned now: room-key normalisation (`name.trim().toLowerCase()`) is hand-rolled in ~15 places across the Babylon layer and config instead of one shared `roomKey()` helper. Low individual risk, but a site that forgets the `.trim()` mismatches silently.
- Typecheck, production build, and the Python security suite (91/91) clean throughout.

## 2.60.0

### Changes
- **Fixed entities removed via Advanced Settings' "N entities no longer in Home Assistant → Remove N" reappearing seconds later, on their own, with no reload.** Reported with a concrete example (`climate.gym_room`, confirmed via Home Assistant to genuinely no longer exist) and traced with the help of the app's own telemetry: the villa's owner routinely has the kiosk open on several devices at once (a phone, a MacBook, an iPad), and the reappearance tracked to full page reloads on a *different* device seconds after the removal — not a backend reload loop. Two independent bugs were compounding: (1) the one-shot auto-detect pass that runs on every GLB (re)load re-added any mesh literally named after an entity_id back into `entityMap`, regardless of whether Home Assistant still reported that entity — now gated on a live `getEntitiesSnapshot()` check, so a mesh whose entity has genuinely been removed/renamed is never resurrected, no matter how many times or how many devices reload. (2) Even with that fixed, the shared-config sync itself couldn't survive two devices editing at once: a push sent "everything this device currently has" as one whole-object PUT, which can't distinguish "I changed this" from "I'm just carrying this unchanged" — so a second device's routine background reload, pushing its own (older) full snapshot moments after the first device's deletion, silently overwrote it.
- **Rebuilt shared-config sync (`entityMap`/`meshBindings`/`deviceGroups`/`teleportPoints`) around per-item diffing instead of whole-object last-write-wins, so concurrent edits from different devices to different items now commute instead of racing.** `deviceConfig.ts` gained a diff/merge layer keyed by each item's natural id (entity_id, mesh name, group id, room name); a push now diffs only what THIS device actually changed against the baseline it last synced against, fetches the server's freshest copy, and replays just that diff on top of it — another device's concurrent edit to a different item survives untouched. `supervisor-proxy.py`'s shared JSON store gained an optimistic-concurrency revision (the file's own mtime): a write that's gone stale is rejected with 409 + the fresher copy instead of silently applied, and the client rebases its diff and retries (bounded to 3 attempts) rather than racing blind. Backward compatible — the revision check only applies when the caller sends one, so the single-writer FM-data store is unaffected.
- **A kiosk device that stays foregrounded indefinitely (a wall-mounted tablet that never loses focus) now also re-pulls shared config every 3 minutes while visible**, closing the gap where such a device previously only ever saw another device's edits via focus/visibilitychange — negligible battery/network cost next to the HA WebSocket's own 25s heartbeat ping.
- Audited the app for battery/memory concerns raised alongside the above: the Babylon render loop was already idle-by-default (`renderOnDemand`, ~0% GPU when nothing's happening) and `HAWebSocket.ts` already tears down every timer/listener on close — neither needed changes. One already-known, already-mitigated issue remains as-is: a slow ~37MB/hour idle memory drift (documented in `autoReload.ts`, handled by a nightly 4am reload rather than a live fix, since prior live heap diagnosis on a fielded kiosk crashed a tab at 800MB).
- Typecheck, production build, and the Python security regression suite (91/91) clean throughout.

## 2.59.0

### Changes
- **Fixed the new category long-press modal (2.58.0) showing "No devices in this group" for Network, even though the access points were correctly found.** `SummaryGroupPanel` defaults to filtering out HA-diagnostic entities — the same classification that had hidden the AP badges off the map entirely until 2.58.0 — and Network's membership here is mostly/entirely those diagnostic "State" sensors, so the filtered list came back empty.
- **That first fix was a blanket `filterSuppressed={false}`, which would have shown EVERY diagnostic entity in ANY category, not just the APs — caught before shipping.** Replaced with a precise, per-entity rule instead: a diagnostic-in-HA entity is only kept if it's actually on the map (real geometry, or linked/motion to something that has it) — the same distinction the map-badge fix already established. An orphan RSSI/battery/uptime sensor that was never bound to anything visual stays filtered out exactly as before, category by category, entity by entity. Verified this can't leak into the "Not on the map" section either: a kept diagnostic entity is, by construction, always in the same "on the map" set the modal's own on/off-map split reads, so it can only ever land in the on-map bucket.
- **The room-cluster modal (tap a room's badge pile) gets the identical treatment now, for the same reason** — it's the same kind of "show me everything in this grouping" view as the category browse, and was arbitrarily left on the old blanket-hide-diagnostics behaviour. Its underlying chip COUNT is simplified to match: every entity `EntityVisuals.updateClusters` ever sees already has a real badge (mesh/geometry), so there was never a genuine "diagnostic but unmapped" case to exclude there in the first place — removed a `countedIds`/`ids` split that existed only to work around that, and with it the entire (now-dead) `suppressedEntityIds`-into-Babylon plumbing: the field, its setter, `SceneManager`'s passthrough, and the `Dashboard` effect that fed it. Nothing reads it any more.
- **New: rows that are hidden-in-HA specifically (not just diagnostic-category) now show a small "Hidden in HA" icon** in the room/category browse modals — those are the only two places a suppressed entity can appear at all now, and the user should be able to tell "HA itself says this is hidden" apart from an ordinary device at a glance rather than it just quietly showing up. Backed by a new, narrower `hiddenInHaEntityIds` signal (registry `hidden_by != null` specifically) alongside the existing broader `suppressedEntityIds`.
- **The category browse now also respects the connected profile's own RBAC** (`isMappingAllowed`) — it's built directly from the raw entity map, bypassing the Babylon layer's own device_id/deniedTypes enforcement entirely, so without this a category a role can see could still list an individually-denied device TYPE within it. (The room-cluster list didn't need this: it's sourced from `EntityVisuals`, which already never creates a badge for a denied-type entity in the first place.)
- **Removed the blue "you can hold this" dot from the category filter icons only** — the floor buttons and the camera panel's next-arrow keep theirs (a real hold-vs-tap ambiguity there); the category row already reads as a fixed rank of same-shaped icons, and a permanent hint dot on all of them was just clutter.
- Typecheck and production build clean throughout.

## 2.58.0

### Changes
- **Fixed a real regression: every UniFi access point (Network category) had disappeared from the villa map.** A recent fix meant to make a room-cluster chip's DEVICE COUNT match its modal's list had, as a side effect, hidden the individual 3D badge for any entity HA classifies as diagnostic — and an AP's "State" sensor is diagnostic-category by the UniFi integration's own convention. Reverted: a diagnostic-in-HA entity a user deliberately bound to real geometry stays visible and tappable on the map (that's a different concern from decluttering a flat settings LIST, which is what "diagnostic" is actually for) — the count-matching fix now scopes to the cluster chip's number only, not individual badge visibility.
- **Fixed the blue "clickable" glow only appearing for these same AP sensors when the Energy filter was active, while their badge (and Advanced Settings) correctly showed Network.** The glow's own category resolver call was missing the entity's live `device_class` — the one signal needed to classify an enum sensor as Network — so it silently fell back to the generic "sensor" default (Energy) instead. Now reuses the exact same resolution the badge itself already uses, so a glow and its badge can't disagree again.
- **Fixed switching profile (e.g. Owner → Guest) visibly "reloading" the villa map.** The role-filtered config handed to the 3D scene rebuilt `entityMap`/`meshBindings` as new objects on every switch, which the scene's own change-detection read as a structural edit and answered with a full multi-second re-index (material re-clone, per-light recreation) — just to hide a few badges. Traced every place that actually needs to hide a role-denied entity and confirmed each already re-checks the category/type denial lists on its own, cheaply, with no re-index required. `entityMap`/`meshBindings` now pass through unchanged by reference on a role switch, so the scene's diffing correctly sees "nothing structural changed" and skips the rebuild — hiding behaves identically, the map just doesn't visibly reload any more.
- **Advanced Settings: "Grouped devices" now collapses by default**, matching every other section in that modal (its "Suggested group" button is inside the same collapsed component, not a separate always-visible row).
- **Camera panel: the picker list and prev/next cycling are now alphabetical by DISPLAY LABEL, not raw entity_id** — the two can disagree (e.g. `camera.doorbell_main` showing as "Main Door Camera" used to sort under "d" while reading as "M").
- **New: long-press (or hold Space) a category filter icon in the top bar to list every device in that category** — same group modal a SummaryBar tile or a room cluster already opens. A plain tap still just toggles that category's visibility on the map. The category→icon mapping moved into the shared config module so the top bar and this new modal can never show a different glyph for the same category.
- Typecheck and production build clean throughout.

## 2.57.0

### Changes
- **Fixed settings-style modals (Settings, Advanced Settings, Facility, Legend) resizing to fit their current content on mobile instead of always filling the screen.** Each used `max-height: 100dvh` — a cap, not a fixed height — so the dialog shrank to whatever content happened to be showing. Invisible on Settings/Advanced Settings, which usually have enough content to nearly fill the screen anyway, but glaring on Facility: switching tabs ("No faults recorded" vs. a long list) visibly resized the whole dialog and moved the footer's position around underneath it, tab to tab. This was actually a deliberate prior choice (reasoning that a short view shouldn't leave blank space above its footer) — reversed at the user's explicit request: a stable full-height sheet with the footer always pinned to the true bottom matters more than avoiding blank space under short content. `height: 100dvh` now, not just a cap; `.settings-body`'s existing `flex:1 1 auto` + scroll does the rest. Device panels and the group/room-cluster modal are untouched — a different, deliberately small-card family.
- Typecheck and production build clean.

## 2.56.0

### Changes
- **Camera panel control buttons (linked-entity toggle, prev/next, fullscreen, close) now have a fixed, theme-independent dark-glass style instead of inheriting the app's THEME-driven `.icon-btn` chrome.** The camera bar is always solid black (`.camera-bottom-row`) — a fixed video-viewer convention, not the app's own light/dark theme — but the base `.icon-btn` glass (`--bg-panel`, a near-opaque WHITE in light theme) still applied there, so a light-theme user saw a pale, washed-out blob floating on black while a dark-theme user saw a normal-looking dark glass button: the identical control looked different depending on the app theme, on a background that never changes with it. Now a single fixed white-on-dark glass rule covers the whole cluster — the standard frosted-circle-on-video look native camera/photo apps use, and now identical for every user regardless of theme.
- **Icon sizing in that same cluster is one CSS rule now** (55% of the button, at every size the cluster ever renders at — 56px desktop down to a 34px floor on the phone-landscape rail) **instead of a hand-picked pixel size hardcoded per icon** that only roughly matched. Removed the now-redundant landscape-only duplicate of the same rule.
- Typecheck and production build clean.

## 2.55.0

### Changes
- **Fixed the camera panel's phone-landscape status-rail tooltip appearing at the extreme top of the screen regardless of where you touched it.** `StateTimeline`'s tooltip positioning was written for the horizontal bar only — in vertical mode `hover.x` actually holds a Y-offset, but the same styling (`left: hover.x; bottom: 100%`) still applied, anchoring the tooltip's bottom edge to the (tall, narrow) rail's own top edge no matter where along it you touched. It now opens rightward off the rail, vertically centred on the real touch point. Also gave the rail a left inset matching the control column's own right padding, so it no longer sits flush against the true screen edge.
- **Camera zoom: exiting no longer moves every other control button.** A "reset zoom" button used to appear IN the control cluster the instant you zoomed in, shifting prev/next/fullscreen/close over to make room — replaced with a pill under the camera name (same action, no reflow). Also dropped the "updated HH:MM:SS" text next to the name — redundant next to the status rail already showing the same thing graphically.
- **Camera panel, phone-landscape only: reordered the side control column** — Close now sits at the top, Fullscreen second, Next above Previous, the detection-arm toggle last — a more natural one-handed reach down a side rail. Portrait's row order is untouched.
- **Fixed a real value/unit rendering bug: a device-group panel's readings showed their unit on a separate line below the number** (73, then % underneath) instead of on the same line (73%) the way the single-sensor panel already does it correctly. Same fix applied consistently — the group panel's per-member breakdown now shows the label underneath instead of duplicating the unit there.
- **Fixed the "default view saved" confirmation tooltip wrapping almost every word onto its own line.** It's an absolutely-positioned box anchored past its own narrow containing block's edge (`left: calc(100% + 10px)`) with no explicit width — some browsers compute its shrink-to-fit available width against that narrow container instead of the viewport, collapsing it to near-nothing. `width: max-content` fixes it regardless of that quirk.
- **Settings modal: fixed two section titles ("Dashboard title", "First-person view") that had zero gap before their own content** — both used `style={{ margin: 0 }}`, meant to kill the double-gap at the top of a section, but that zeroed the BOTTOM margin too (the gap before the content that follows), not just the top. Changed to `marginTop: 0` in both places. Also removed the separator above "First-person view" and two matching ones in the Map Colours legend — same "the title's own top margin is enough, a separator on top of it is redundant" rule this modal already follows everywhere else, just missed in these three spots.
- **Facility modal: its tab row was the one piece of that modal that didn't pick up the safe-area-aware padding** the header/body/footer already get on a phone — a flat 22px regardless of a notch/Dynamic-Island inset, unlike everything else in the same modal. Fixed to match. (The modal's overall full-bleed, no-rounded-corner mobile presentation itself is intentional and shared by every settings-style modal — Settings, Advanced Settings, Facility, Legend — not a Facility-specific inconsistency.)
- HUD: the first-person/bird's-eye view toggle now sits immediately after the Facility button instead of immediately before Settings.
- Typecheck and production build clean throughout.

## 2.54.0

### Changes
- **Fixed a real room-cluster count mismatch: the badge pill said 17 devices for a room, its own modal listed only 16.** Root cause: the 3D scene layer (`EntityVisuals`) had no concept of HA's registry-derived "hidden/config/diagnostic" entity set at all, so a room-cluster chip counted every mapped device regardless — while the modal it opens (`SummaryGroupPanel`) already excludes those by default, the same convention every other device list in the app follows. One of the room's devices was hidden in HA (or filed under a diagnostic entity_category), so the badge counted it and the modal correctly didn't show it. Fixed at the root rather than papering over the modal: `suppressedEntityIds` is now threaded from `HAStateStore` through `SceneManager` into `EntityVisuals`, which excludes those entities from getting a 3D badge at all (same insertion point as the existing hidden-category filter in `cullLabels`) — a suppressed entity can no longer inflate a cluster's count, and gets no floating badge on the map either, matching the "I hid this in HA" intent.
- **Every modal's close button is now the same convention: a footer "Close" button, not a header X icon.** `BasePanel` (used by every device panel and the group/room-cluster modal), `FacilityModal` and `LegendModal` all carried a redundant top-right X on top of an already-present footer Close button (or, for `BasePanel`, the X used to be the ONLY way to close for panels with no Edit action); `BadgeColorModal` had the X with no footer at all. `BasePanel`'s footer now always renders — Close on the right always, Edit on the left when that profile can edit — and the header X is gone everywhere it appeared, one shared rule instead of two competing ones (documented as a stale "replaces the old footer Close button" comment that this change makes true again in reverse).
- **The room/group modal's "Turn all on/off" button is icon-only now** (`Power`/`PowerOff`, contextual to current state) — the text label ate real width in the header, worst on a phone. Tooltip and `aria-label` still carry the full "Turn all on"/"Turn all off" text.
- **"Scenes for this room" moved to the bottom of the room-cluster modal**, after the device list — the room's own devices are why that modal gets opened; scenes are a secondary shortcut for the same room, not the first thing to scroll past. The section's hairline separator flipped from below it to above it to match.
- Typecheck and production build clean throughout.

## 2.53.0

### Changes
- **Room-cluster chip: the outline ring and the count pill now carry two separate, correctly-scoped signals instead of one conflated red.** The ring used to fire on `alert || unavailable`, disagreeing with the rule individual device badges already use (`BADGE_RING`: red for `on` or `alert`, unavailable dims instead of ringing) — a room with only an unavailable device but nothing actually on/alerting rang red even though no single badge in that room would have. The ring now fires on the exact same `on || alert` condition individual badges use. The count pill's background was unconditionally red; it now reflects the room's REPORTING status specifically — red if at least one member is unavailable, otherwise the same green used for "available" elsewhere (`--status-on`, mirrored as a new static `AVAILABLE_GREEN_HEX` in `colors.ts` since a Babylon GUI control can't read a CSS custom property). The two signals are independent by design: a room can show a red ring (something's on) with a green pill (everything's still reporting) simultaneously.
- Typecheck and production build clean.

## 2.52.0

### Changes
- **Fixed a misplacement from 2.51.0: the GLB/room-data upload button and its (i) model-info tooltip moved to the main app's top HUD bar, when the actual request was to put them in the Advanced Settings modal's OWN header** — the same treatment the day/night invert toggle gets in the Settings modal's header (icon-only, right-aligned, next to the title), not the global top bar. Moved both out of `HUD.tsx` (inline button, mobile overflow-menu duplicate, hidden file input, all reverted) and into `ConfigEditorModal.tsx`'s header row instead, gated the same Owner-only way. `CentralModelInfo.tsx` and `useGlbUpload.ts` relocated from `components/hud/` to `components/settings/` to match — that's their only consumer now. README's two references to "the upload icon in the top bar" corrected to point at the modal header.
- Typecheck and production build clean.

## 2.51.0

### Changes
- **Removed Import/Export Configuration — redundant now that shared config auto-syncs.** The Owner-only JSON backup/restore in Advanced Settings covered exactly two kinds of field: `entityMap`/`meshBindings`/`deviceGroups`/`teleportPoints`, which have synced automatically to every client through `DeviceConfigSync` for a while now, and per-device settings (render quality, eyeHeight, badgeStyle, …), which are deliberately never shared between devices by design (a phone shouldn't inherit a desktop's render tuning). Re-importing an old export of the first group could actively regress a villa's live shared state with a stale snapshot; re-importing the second group onto a different device worked directly against the "per-device, not synced" reasoning documented for that config tier. `buildConfigExport`/`parseConfigImport`/`ConfigExportBundle` and their two buttons are gone.
- **Moved GLB/room-data upload out of Advanced Settings and into the top bar.** With Import/Export gone, "3D model source" was the only thing left in that section, and it's an infrequent Owner-only administration action, not something that needs a whole modal section. It's now an icon-only upload button in the HUD's top-right cluster (tooltip "Upload GLB Model"), with the existing (i) model-info popover immediately to its left — same reading order as before, same upload mechanics (`useGlbUpload`, extracted out of the old `ModelSource` component so the desktop button and the phone's overflow-menu equivalent share one file input and one upload-state instance instead of duplicating the async flow). The Advanced Settings modal no longer has a "3D model source" section at all.
- **Settings modal: styled "Dashboard title" as a proper section heading** (matching every other section label instead of a plain form `<label>`), and restored the vertical gap between it and "Render quality & look" that a stray `margin: 0` override had collapsed to zero. Removed the trailing separator at the very bottom of "First-person view" — it fenced off nothing (the section already ends there), so it just read as a stray line.
- **Facility Manager: removed the last hardcoded contract-clause references and one named company, both leftover from the earlier hardcoding audit** (see 2.47.0, which fixed the schedule/cap defaults but explicitly deferred this). `fmReport.ts`'s actual generated report text — the Markdown handed to an owner — literally asserted "Clause 3.7", "Clause 3.3(i)", "Clause 6.2(iii)" and named a specific management company as who handles financial reporting, regardless of what any given villa's real contract says or whether it has clause numbers at all; the Facility modal's footer and the Report tab's own body copy repeated the same literals in the live UI. All of it is now generic ("Preventive maintenance", "Maintenance spend", "falls to the Owner") — the per-task free-text `clause` field (Schedule tab) already carries whatever reference an operator wants shown, this file never needs to assert one of its own. Comment-only clause references across `permissions.ts`, `readiness.ts`, `fmEngine.ts`, `fmTypes.ts` and the FM tab components got the same treatment. README's "Where the defaults come from" section, which still described a seeded Bali-villa maintenance schedule that was actually emptied back in 2.47.0, now correctly says there is no seed at all.
- Typecheck and production build clean throughout.

## 2.50.0

### Changes
- **Device panels: removed the entity_id line from the header** (title/room only now, one less technical detail cluttering every panel) **and the separator above the footer's Edit button** — applied to the ONE shared class (`.settings-footer`) backing every settings-style modal (Settings, Advanced Settings, Facility, Legend, First-run Tips) rather than a one-off exception on device panels alone, so the same "no hard separator" look is consistent everywhere it applies.
- **Fixed panel titles/badges still showing a raw technical name** (e.g. "ceiling_fan_gym_room" instead of "Ceiling Fan Gym Room") for entities whose HA `friendly_name` itself defaults to the bare object_id — some integrations and any YAML/UI entity with no explicit name configured do this. Fixed at the source (`displayLabelFor`, the one function every display surface already funnels through — panel titles, map badges, the group modal, device-group rows), so it's corrected everywhere at once, not just in one modal.
- Typecheck and production build clean.

## 2.49.0

### Changes
- **Advanced Settings: the whole "Bound 3D objects" section now collapses by default**, not just the bound-list inside it — the previous fix only hid the row list, leaving the "N unbound objects"/"N HA entities not shown" toggle buttons always visible. Wrapped in the same CollapsibleSection component Auto-detected entity settings and Device telemetry already use.
- **Grouped Devices: the "Add another entity" picker now sits inline on the same row as its group's member pills**, in a new `compact` EntityPicker variant sized to match the pills' own height, instead of a full-size field on its own line below them.
- **Room-cluster count pill: fixed it still overlapping the room name** (e.g. "Guest Bathroom" reading as "Guest Bathroo[4]"). The top-right corner overlay from the previous fix was correctly positioned but nothing stopped the text itself from rendering underneath it — the room name's own text box now reserves the badge's full footprint as space it never renders into, so the two can't collide regardless of room-name length.
- **"Pre-configure a new entity" moved from Auto-detected Entity Settings into Bound 3D Objects** (now collapsed by default) — same "add something new to the entity↔object map" action this section is about.
- Settings: Blue Glow and Natural Scrolling are now single-button segmented toggles (short label + icon) sharing one row, matching the Bottom Summary Bar control's style instead of checkboxes; Bottom Summary Bar renamed and given an icon; Classic/Card badge-style buttons got icons too; the now-redundant "Reset look" button is gone (only three simple sliders are left to reset); the separator between the Dashboard title field and Render Quality & Look is gone.
- Typecheck and production build clean throughout.

## 2.48.0

### Changes
- **Fixed a real config-loss bug: an Advanced Settings edit (a room, a label, a linked device…) could silently revert a few seconds after being made — reproducible on a single device, no second client required.** `DeviceConfigSync`'s push effect marked its "server has this" baseline the instant a PUT was *sent*, not once it was *confirmed* — so if a pull fired in that in-flight window (this device regaining focus, a visibilitychange, another device opening the kiosk), it fetched the server's still-old copy and merged it straight over the edit that hadn't landed yet, tripping right past the existing "never clobber a pending edit" guard because that guard compared against the same too-early baseline. The baseline now only advances on confirmed success, so that guard covers the whole at-risk window instead of just the pre-send debounce.
- **Fixed a linked-device badge ring not appearing until the next unrelated state change.** Linking a device to an already-`on` entity (Advanced Settings' "linked device" field) correctly seeded the internal ring-state set immediately, but never actually repainted the badge — so the ring only appeared once some other event happened to touch it, which might be never if the linked entity doesn't change state again. Now repaints right away.
- **HUD topbar: removed the connection dot from the mobile brand chip** — already duplicated in the overflow menu's header, and dropping it is what actually frees enough width to stop the brand chip colliding with the centred category row on a phone (a real reported overflow, not just a tight fit). Re-verified all topbar icon buttons compile to the same 32×32 at this breakpoint.
- **Room-cluster map chips: the device-count pill is now a genuine top-right corner overlay**, matching the HUD's unavailable-devices/facility icon convention exactly, instead of rendering inline next to the room name (which read as "a second word", not a badge, and wasn't circular since it was sharing the row's flow).
- Advanced Settings: Grouped Devices' suggestions are now collapsed by default (only already-grouped devices show), "New group" moved above the existing-groups list with the redundant separator dropped, Bound 3D Objects is collapsed by default too, and the long description under the GLB/config import-export buttons is gone.
- Settings: removed the Quality Preset picker entirely — the app now always renders at the fixed "High" look by design (no code path left to select a lower tier); Night Dimming shares a row with Brightness; Floating Badge Style is now a 2-button toggle sharing a responsive row with a single-button "Show the bottom summary bar" toggle (renamed, parenthetical dropped); the Scenes section (a pointer to HA's Scene Editor) is fully removed; Natural Scrolling now shares a row with the renamed "Blue glow for clickable devices" toggle.
- SummaryBar's Scene tile now reads "N scenes" (singular-aware) instead of a bare count.
- Typecheck and production build clean throughout.

## 2.47.0

### Changes
- **Scenes now come from Home Assistant's own Scene Editor instead of a second, kiosk-only scene system.** The old `scenes.ts`/`ScenesContext`/`scenesApi.ts` captured a whole-villa state snapshot into the add-on's own `/data` store, authored from Settings — a second, disconnected place to define "Movie Night" alongside whatever the villa already has in HA. Removed entirely, frontend and backend (the `/scenes` endpoint + its store in `supervisor-proxy.py`), and replaced with a pure live read of HA's `scene.*` entities (`config/haScenes.ts`) — a scene's own `attributes.entity_id` already lists every entity it touches, cross-referenced against this villa's room data to know which room(s) it's "about." No storage of its own, so it can't drift: add, edit or delete a scene in HA and it's reflected here on the next state update. Surfaced two ways: globally in the bottom SummaryBar tile (unchanged position/interaction, just reading live HA scenes now), and contextually as a "Scenes for this room" strip at the top of a room's long-press panel, for any scene touching a device mapped to that room. Settings' Scenes section is now a pointer to HA's own editor instead of a capture form.
- **Removed two villa/business-specific hardcoded defaults, same bug class as the earlier EntityMap/TeleportPoints/Sh3dCalibration cleanup, just missed by it.** `ThresholdConfig.ts`'s `DEFAULT_THRESHOLDS` shipped two literal entity_ids from one villa — emptied; `config.alertThresholds` already supports a full per-install override, and binary_sensor alerting still works via HA's own `device_class` fallback with this empty. `fmTypes.ts`'s `DEFAULT_SCHEDULES` and `MINOR_MAINTENANCE_CAP_IDR` hardcoded one specific property-management contract's clauses, intervals and IDR cap as the default for every install — the schedule seed and its now-dead "Load the standard schedule" button are gone (the Schedule tab's own add-task flow is fully generic already), and the cap defaults to 0 ("not configured") with `budgetStatus`/`wouldExceedCap` correctly treating that as "not tracked" rather than "permanently exceeded." The deeper set of `Clause X.Y` references throughout the Facility Manager's generated reports (`fmReport.ts`, `ReportTab.tsx`, etc.) is a separate, bigger, business-content decision — not touched here.
- **Device-group suggestions now use Home Assistant's own device registry first.** `suggestDeviceGroups` used to guess a multi-entity physical device (a combo sensor's separate temperature/humidity entities) purely from an entity_id naming convention — one hardcoded suffix pair, so a device exposing more siblings (battery, battery_voltage…) only ever got the first two grouped. HA's entity registry already links every sibling entity to the same physical `device_id`, authoritatively and for however many entities a device exposes — that's now the primary signal (registry `device_id`, newly read alongside the Area data added last release), with the old suffix heuristic kept only as a fallback for entities HA can't attribute to a device at all. Accepting a suggestion for a primary that already has a group now correctly adds to it instead of creating a second, orphaned group under the same primary.
- **Room-cluster map chips show their device count as a small red pill, matching the HUD's unavailable-devices/facility icons** instead of a plain number appended to the room name. The actual DRY win — since a Babylon GUI chip can't consume CSS — is `utils/countBadge.ts`'s `formatCountBadge()`, now the one shared "cap at 99+" implementation for all four existing HUD count spots and the new cluster-chip pill, replacing five near-identical copies of the same cap logic.
- Typecheck and production build clean throughout.

## 2.46.0

### Changes
- **Fixed the zoom-to-room over-tightening reported against a live villa: tapping a crowded room's chip could land point-blank on a piece of furniture instead of framing the room.** 2.45.1's badge-declutter distance let ANY two badges mounted close together (a ceiling fan's light kit, stacked switches on one plate) collapse the shot all the way to the absolute `MIN_ROOM_FIT_RADIUS` floor (1.5m) regardless of how large the room actually is — confirmed against a real bedroom where a fan+light fixture alone dragged the camera in far tighter than the room's own size warranted. The tightening now floors at a FRACTION of the room's own wall/entity-fit radius instead of an absolute distance, so one close-together fixture can no longer drag a normal-sized room's shot down to a small room's distance; a genuinely spread-out room (the original motivating case — many devices ringing a pool) still gets to zoom in materially tighter than a plain room-fit.
- **Fixed the mobile top bar: the overflow (⋮) menu drifted into the middle of the bar instead of sitting at the true right edge, leaving everything visually bunched toward the left/centre.** It lived inside the same pill as the centred category-filter row, so it rendered wherever that row's content happened to end rather than at the bar's edge — the `.hud-right` grid track sat empty. Moved it into its own single-icon pill inside `.hud-right`, so the existing 3-column grid (brand | category row | overflow) actually centres the category row and pins the overflow button to the right edge on a phone the same way it already did on desktop. Brand/home icon stays left-pinned, unchanged.
- **New: a freshly detected entity's Room is now auto-suggested instead of starting blank.** Auto-detection (a mesh named with its own HA entity_id) used to save every new entity with a placeholder "Unmapped" room, requiring the installer to type the correct room by hand in Advanced Settings for every single device on every fresh install — even though the app already has everything needed to work it out. It's now resolved in priority order, purely from this installation's own live data: (1) does the entity's own mesh anchor sit inside one of this villa's drawn room polygons (`EntityVisuals.roomForEntity`, straight geometric point-in-polygon against the calibrated floor plan)? (2) if there's no anchor to test (or it lands outside every polygon), does Home Assistant's own Area registry assign this entity to an area whose name matches a room this villa's plan actually has (`config/area_registry` + `config/device_registry`, newly read via `HAWebSocket.getAreaRegistry`/`getDeviceRegistry`)? An HA area name is only ever accepted when it lands in that whitelist, so a mismatched or stale HA area can never invent a phantom room bucket. Still fully editable afterwards — this only changes what a first detection starts with. Zero hardcoding: both signals are read live from this specific installation (the loaded GLB's own geometry, this HA instance's own registries), so a brand-new villa gets the same behaviour with no per-site tuning.
- **New: Advanced Settings' Bindings tab now also lists "HA entities not shown anywhere in the model"** — the inverse of the existing "unbound objects" list. An installer previously had no in-app way to tell which of their real HA devices have zero 3D representation at all (no mesh means no badge, no panel, nothing); this surfaces them (scoped to domains the app can render, excluding anything already hidden/diagnostic in HA) with their HA Area for context, so a gap in the model is visible without manually diffing HA's device list by hand.
- Verified against a live villa via a full GLB-vs-HA entity audit (MCP-diagnostic only, per the project's hard rule — none of that data or any of its findings became a literal in shipped code): confirmed the two fixes above against real reported symptoms, and confirmed 6 stale mesh↔entity bindings (5 renamed/removed climate entities, 1 removed binary_sensor) already surface correctly through the existing Unavailable-devices detection with no code change needed. Typecheck and production build clean.

## 2.45.1

### Changes
- **Mobile top bar: the category filter row was pinned to the left edge instead of centred.** The ≤640px tier stretched `.hud-center` full-width and space-betweened its two children (category row left, label-size/overflow group right) to make room after force-hiding the whole brand chip. Reverted to the same two-equal-flexible-side-columns grid the desktop layout already uses (`1fr minmax(0, auto) 1fr`) — that's what centres the middle track regardless of what the side tracks contain — and stopped fully hiding `.hud-brand` on phones: it already sheds its title/clock in the wider tiers above this one, so what's left (villa icon + connection dot) is compact enough to sit beside a category row that scrolls internally when tight, rather than needing the whole chip gone.
- **Left floor/rooms stack (1F/2F) icons were noticeably smaller than the bottom summary bar's icon chips on a phone.** `.hud-stack .icon-btn` now matches `.summary-tile-icon`'s own mobile size (40×40, was 36×38) so the two floating icon groups read as the same family of control.
- **Tapping a crowded room's cluster chip (e.g. "Swimming Pool 8") could zoom in without ever expanding to individual badges.** `computeRoomOverviewPose` only ever fit the room's WALLS in frame; for an elongated or multi-device room that distance can still leave the room's own tightest badge pair too close to separate, so the chip persisted even after the camera visibly moved. Added `EntityVisuals.minPxPerWorldToDeclutterRoom()` (reuses `groupBadges`' own reach/gap formula, solved for the zoom level instead of the grouping outcome) and the zoom-to-room radius now takes whichever is TIGHTER — the wall-fit distance or the badge-declutter distance — so a tap-to-zoom is guaranteed to resolve every one of that room's badges individually. Not yet field-verified against a live villa.
- **Long-press entity panel title truncated too early.** `.panel-header .title h2` — the one modal heading that echoes an arbitrary, unbounded device name rather than a short fixed string — dropped from 22px to 18px so more of a long name shows before the ellipsis.
- **Removed the translucent "glass" background from every dialog** (Settings, a device panel, Config Editor, the badge legend, etc.) — now a solid, opaque fill (`--bg-modal`) instead of the frosted `--bg-glass`/`blur(28px)` treatment. The HUD's own floating chrome over the 3D scene (icon buttons, the category row, the floor stack, dropdown menus) is untouched and stays translucent — a dialog is content to read/edit, the HUD chrome is an overlay on the live view underneath it.

---

## 2.45.0

### Changes
- **Emptied the last hardcoded villa data: `Sh3dCalibration.ts`.** It held one specific villa's entity plan coordinates and room polygons as the fallback used whenever `config.sh3dEntities`/`sh3dRooms` are absent — meaning any *other* villa lacking plan data would be calibrated against a floor plan that isn't its own (wrong scale, origin and mirroring), which is a worse failure than having no calibration at all. Both tables are now empty; the types and the `polygonCentroid` helper stay. Real data comes from `config.sh3dEntities`/`sh3dRooms`, parsed from the uploaded `.sh3d` or read straight out of the GLB's embedded `vk_rooms_json` (pipeline ≥ 2.14.0).
- Verified safe for existing installs before changing it, rather than assuming: the removed fallback described rooms (*Main Room*, *WIC / Dressing*, *Storage / Laundry*) that do not appear in the live app at all, while every room actually in use (*Kitchen*, *Onsen*, *Swimming Pool*, *Staircase 1F*, *Outdoor*, …) was absent from it — proving the running configuration reads real sh3d data and never touched this table.
- **With this, the shipped code contains no device, room or coordinate belonging to any particular villa** — completing the cleanup begun in 2.44.0 (`EntityMap.ts`) and 2.44.1 (`TeleportPoints.ts`). Typecheck and production build clean.

---

## 2.44.1

### Changes
- **Emptied the hardcoded seed room list in `TeleportPoints.ts`** — the companion to 2.44.0's entity-map cleanup. It held the twelve rooms of the one villa this app was first built against: their names ("Master Bedroom", "Pool / Garden"…), hand-derived world coordinates and thumbnail paths, all shipped as the default for `config.teleportPoints`. A fresh install on any other villa therefore opened offering navigation to a dozen rooms that don't exist, at coordinates meaningless in its model. Rooms are produced at runtime instead — `SceneManager` fits the SweetHome plan→world transform and derives a teleport point per room polygon, which Dashboard adopts into the stored config — plus anything the user adds by hand via the Rooms menu. Verified every consumer is safe on an empty list (all `map`/`filter`/`find`; first-person spawn already falls back to a literal start pose; `BabylonCanvas` already resets this array to `[]` on model replacement, so empty was an expected state). The thumbnail paths it referenced pointed at a `public/thumbs/` directory that has never existed, so they were dead already. Typecheck and production build clean.

---

## 2.44.0

### Changes
- **Removed the hardcoded device tables from `EntityMap.ts` — the shipped code no longer contains anyone's devices.** It carried ~22 literal entries (real entity_ids, labels and room names) for the one villa the app was first built against, plus a matching `MESH_ALIASES` table. Both predated auto-detection and the Config Editor, and were simply never removed once those existed. Two consequences, now fixed: (1) a fresh install on **any other villa** started with two dozen devices belonging to somebody else's house; (2) because `DEFAULT_CONFIG` is spread *underneath* stored config on load, deleting one of those seeded entries in Advanced Settings came straight back on the next reload — the "stale entities I can't get rid of" behaviour, whose root cause this was. Both tables are now empty; the map is built entirely at runtime by auto-detection and manual binding, writing to the stored config as the single source of truth. The alias *lookup* is kept so a future villa can supply aliases as data if its model uses the `[type]_[room]` naming convention — meshes named with a real entity_id (what the Blender pipeline emits) are matched without it. No behaviour change for an existing install, whose real configuration already lives in the add-on's stored config. Typecheck and production build clean.

---

## 2.43.0

### Changes
- **Reverted the rotated status rail and replaced it with a genuinely vertical one.** Both previous attempts (a `100dvh` length, then a JS-measured one) were patches on a fundamentally wrong approach: a rotated bar has to be sized from its container's HEIGHT via a property that means WIDTH, so that height must be supplied up front — and every way of supplying it is an assumption that can disagree with the real box, which is why it kept ending up misaligned. `StateTimeline` now takes a `vertical` mode that lays its segments (and its pointer read) on the Y axis, so the bar simply fills its container like any other block, with nothing left to disagree about. One component and one set of segment maths still serve both orientations. The rail is also padded to the same vertical bounds as the control column opposite it, so the two read as a matched pair framing the feed, and its hover tooltip works again (it had to be disabled while rotated, since the pointer maths assumed an unrotated box).
- **Fixed pinch-zoom scaling the whole panel instead of just the video.** The zoom transform is applied to the media wrapper, which already sets `overflow: hidden` — but an element's own overflow cannot clip its OWN transform: scaling it scales its clipping box along with its content, so the enlarged feed spilled across the entire panel. Clipping now happens on the parent region, which isn't itself transformed and therefore can contain it. The controls and status rail stay put and fully visible while zooming, as expected. Typecheck and production build clean.

---

## 2.42.1

### Changes
- **The phone-landscape status rail's length no longer assumes it equals `100dvh`.** That assumed the camera panel exactly fills the dynamic viewport, which doesn't always hold on a real device (embedding, browser-chrome insets, rounding) — reported as the rail looking misaligned. The rotated bar's length is now taken from a live measurement of its own rendered box (the same fix already applied to the portrait centring bug), with `100dvh` kept only as the fallback for the handful of frames before that first measurement lands. Typecheck and production build clean.

---

## 2.42.0

### Changes
- **Fixed the camera feed still sitting too high in portrait.** Real measurement bug, not a tuning one: the space mirrored above the video was read from the controls row's `contentRect`, which is the CONTENT box and so excludes its ~16px top padding, its bottom padding AND the bottom safe-area inset. The row therefore occupied noticeably more height below the feed than was ever reserved above it, and the feed sat high by exactly that difference (~33px on a typical phone) — which is precisely the "centred on the gap above the controls rather than on the screen" that was reported. Now measured as the BORDER box, so the reserved space above and the space occupied below are identical by construction and the feed is genuinely screen-centred at any row height.
- **New side-rail layout for a phone in landscape.** On a short, wide screen vertical pixels are the scarce resource, so nothing stacks above or below the feed any more: the toolbar splits and rotates to the edges — the status history becomes a vertical rail down the LEFT, the controls a vertical column down the RIGHT — giving the video the full screen height between them. The control column is sized from the viewport height and clamped, so it always fits without scrolling however short the screen is, while staying comfortably tappable. Keyed on screen HEIGHT rather than width, since being short is the actual condition this solves (a short landscape window anywhere gets the same benefit). Implemented by dissolving the toolbar's own box with `display: contents` so its two halves become direct children of the panel and can be sent to opposite edges — no DOM change and no leftover wrapper in the middle of the layout. The status rail reuses the existing timeline rotated a quarter turn rather than a second, near-duplicate vertical implementation; its hover tooltip is suppressed there, since the pointer maths behind it assumes an unrotated box and would otherwise report the wrong time. Typecheck and production build clean.

---

## 2.41.0

### Changes
- **Badges now group on whether they actually FIT, not on a device count — fixes a room staying summarised with obvious empty space around it.** The previous rule clustered any pile of more than 3 badges, which is the wrong question: it grouped a bedroom's 5 ceiling devices even zoomed right into that room, and dropping the badge *size* made all 5 appear, proving the space had been there all along. The test is now literally *"does the laid-out row fit across this room?"* — the fanned width is converted to world units at the current zoom and compared against the room's real width from the floor plan. Zoomed out over the villa a dense room's row is many times wider than the room, so it summarises; zoomed into that room the row fits easily and every badge shows. Falls out of the geometry rather than needing a tuned number, and stays a pure function of world positions + zoom, so all the pan/rotate invariance from 2.40.0 is preserved. Verified by simulation on the exact reported case.
- **Removed the "save this room's view" long-press entirely.** Now that a room's framing is derived from its floor-plan footprint on arrival, a hand-saved viewpoint was not just redundant but actively worse — it froze one person's one-time eyeballed zoom into config, and being usually too wide it *also* left that room's badges grouped when you arrived. Gone with it: the stored `overviewPose` (and its type), the re-anchor gesture, its confirmation flash and CSS, the hold-vs-scroll touch arbitration the Rooms grid needed only to host the gesture, and the config-merge step that carried the saved pose across recalibrations. Flying to a room now keeps your **current** heading/tilt and only changes what it's looking at and from how far — the way a map's "zoom to this feature" keeps your bearing.
- **Moved the first-person / bird's-eye switch beside Settings** (top-right), out of the left column — both are "how am I looking at this villa" controls rather than map content. Mirrored into the phone overflow menu in the same position relative to Settings.
- **Fixed the camera feed's title placement.** It was anchored to the video region, so it followed that region's top edge: on a phone in portrait it was stranded mid-way up the black bar above the feed, and on a wide screen it landed on the video's own top-left corner. It's now pinned to the top of the screen, above the feed, in every aspect and orientation.
- **Restyled every dialog as frosted glass** rather than a flat opaque sheet, matching the material the HUD sections and bottom bar already use, so the villa stays faintly visible behind a panel and dialogs read as part of the app. Softer, deeper shadow with an inset top highlight; larger corner radius; footer actions (Edit…) are now soft ghost pills instead of boxy outlined buttons; section captions ("LAST 24 HOURS") are smaller and lighter so they label the content instead of competing with it. Applied via two shared theme tokens, so every current and future modal inherits it from one place. Typecheck and production build clean.

---

## 2.40.0

### Changes
- **Badge grouping is now computed in world space against zoom alone — the root fix for "it groups when I slide the camera and stays grouped when I slide back".** Every previous version tested whether badges overlapped *on screen*, which makes grouping a function of the entire camera pose, so panning and orbiting silently re-grouped rooms. The enter/exit hysteresis added to stop the resulting flicker is what made the state depend on the *path taken* rather than the view arrived at — hysteresis cannot fix path-dependence, it **is** path-dependence. So it's gone, along with the need for it. Badges are now grouped by their distance on the **ground plane** against a radius derived from the current **zoom level only**, exactly the way Google/Apple Maps, Mapbox's Supercluster and Google Earth cluster markers geographically: panning and rotating a map never re-cluster it, and zooming back out reproduces precisely the clusters you had before. Camera rotation, tilt and pan now cannot influence grouping at all, and the same view always renders identically. Zoom is quantised into discrete steps (one third of a doubling), the direct equivalent of a map engine clustering per zoom level, so a slow pinch can't sit on a threshold and chatter. Verified by simulation on a realistic 22-device layout: grouping is unchanged across a pan/orbit path, and a full zoom-in-then-out sweep retraces its own states exactly.
- **Off-screen badges now take part in grouping too.** A room's presentation must not depend on how much of it happens to be framed, which was a second, subtler source of the same inconsistency.
- **Tapping a room chip now genuinely frames that room, and its badges genuinely ungroup.** Both halves of that report had one cause: the framing was computed by comparing a raw span to a camera radius, which under-frames at any tilt other than straight down, and — because grouping is a function of zoom — a shot that isn't tight enough also leaves the room's badges grouped on arrival. Framing now uses the standard **fit-the-bounding-sphere** construction every CAD/3D viewer's zoom-to-fit uses: a sphere subtends the same angle from every direction, so the result is correct for any heading/tilt, and it accounts for both field-of-view axes so a portrait phone gets the same coverage as a landscape desktop. It also orbits about the room's own centre at its **floor** height — a teleport point stores the first-person *eye* position, and reusing that y tilted the framing up by eye height. Room lookups are now case/whitespace-insensitive, since a silent name mismatch between the floor plan and config looked exactly like "zoom-to-room is broken".
- **Fixed device names showing as raw ids (`ceiling_fan_master_bedro…`) in the panel title for some devices but not others.** The check that recognises an auto-generated placeholder label normalised the entity_id but not the label, so the very common variant that still carried its **underscores** differed from the id by punctuation alone, was read as a deliberate user customisation, and was shown verbatim — while the visually identical space-separated variant was correctly upgraded to the friendly name. Same string, two outcomes, decided only by whether an underscore survived. Both sides are now normalised.
- The badge-size stepper no longer needs its "ignore the hysteresis once" escape hatch: with grouping carrying no state between frames, stepping + then − lands back exactly where it started by construction. Typecheck and production build clean.

---

## 2.39.2

### Changes
- **Room-cluster chip colour changed again — the brand blue read as an Energy-category badge.** `CATEGORY_COLORS.energy` is that same sky-to-electric blue, so a chip in it looked like it belonged to a device category rather than being a room summary. Switched to a neutral slate, deliberately outside every category's hue (comfort orange, access-control purple, light gold, network green, energy blue) so a chip reads as UI chrome/navigation, not a device.
- **The Apple system font is now applied everywhere, including the serif "display" font.** The previous pass only fixed `--font-ui` (body text/controls); room titles, modal headings and the villa name in the top bar all still used a separate decorative serif (Cormorant Garamond) by original design, which is exactly what was still showing in the reported screenshots. `--font-display` now aliases `--font-ui` from the ONE place both are defined, so every remaining reference updates automatically — no per-component patching — and the now-fully-unused Google Fonts fetch was removed from `index.html`.
- **Badges that are close together but not in a genuine crowd are now nudged apart a small, fixed amount instead of being left to actually overlap** — explicitly requested ("it's ok to artificially move the icon a bit"). This is NOT a return to the force-relaxation solver that caused the earlier "dancing" reports: there's no iteration and no direction choice that depends on the current relative screen position of two badges (that dependency was the actual bug). A huddle of 2-3 is sorted by entity id — a fixed, camera-independent order — and laid out left-to-right around its own centre; a badge keeps the same slot in its huddle for as long as the huddle exists, so nothing about it can flip or drift as the camera orbits. Caught and fixed a real bug in the first version of this fan step during verification: it assumed every badge in a huddle shared the same raw anchor position, which isn't true in general (two devices near but not AT the same spot) and produced negative (overlapping) gaps for exactly that case — fixed by centring the layout on the huddle's own average position instead. This should also resolve badges staying clustered post-zoom-to-room: many of those were two devices sharing one fixture (e.g. a ceiling fan + its own light), which no amount of zooming ever separates since they sit at the same 3D point — now fanned apart directly regardless of zoom level.
- Every constant introduced across this and the previous release remains a ratio (badge-widths, viewport fractions) or a live-measured value, never a fixed pixel count or anything tied to this specific villa's rooms/entities — reconfirmed while fixing the fan-math bug above. Typecheck and production build clean.

---

## 2.39.1

### Changes
- **Room-cluster chips restyled again — the previous "slate-blue" background still read as black at a glance.** Replaced with a solid, saturated brand blue (the exact colour the DOM's own primary buttons use), which reads unambiguously as a Kiosk element rather than a dark pill — closer to how a map's cluster marker is usually a solid, recognisable colour.
- **Revised the room-clustering trigger — it was grouping far too eagerly.** The previous rule grouped a whole room the instant ANY two of its badges merely touched, which in the field hid far more badges than the available screen space actually required — two or three badges lightly overlapping is a completely normal sight in any map UI (Google/Apple Maps pins overlap constantly at city zoom without being merged). Badges are still never nudged (that's what caused the earlier "dancing" reports, across several attempts, and stays fixed), but a room now only groups once a locally-overlapping PILE of **more than 3** mutually-colliding badges forms, and even then only counts a REAL overlap (a graze at the edge doesn't). A small huddle stays individually visible; only a genuine crowd summarises. Verified by simulation: a 3-badge huddle never clusters, a 5-badge pile does, and the same no-flicker hysteresis under camera drift still holds.
- **Tapping a room chip now genuinely zooms to fit that room**, instead of reusing whatever radius happened to be saved with its teleport point (which was often too wide, and — since the point's own saved framing left the room's badges just as crowded as the overview did — is also why they stayed clustered even after "zooming in"). The camera now frames the room's real drawn dimensions when available (its actual wall polygon), falling back to the bounding box of its own registered entities with extra margin otherwise, while keeping whatever viewing angle was saved — only the zoom distance is recalculated. This also fixes the badges staying clustered post-zoom: framed tightly to just that room, they now have enough on-screen separation to fall back out of their chip on their own.
- **Fixed the camera feed's title/room-label text never actually switching to the new font** (a real miss in 2.39.0, not a caching issue) — the room-cluster chip's own text (the most visible text in the reported screenshots) never had its `fontFamily` set at all, so it silently kept Babylon's canvas default (Arial) regardless of the app's own font setting.
- **Applied the system-font switch at the correct, single, top-level place instead of per-component.** Buttons already set `font-family` explicitly, but `<input>`/`<select>`/`<textarea>` did not — browsers give form controls their own native control font by default, ignoring whatever the page itself sets, which is a universal CSS default, not a per-component bug. One rule (`button, input, select, textarea, optgroup { font-family: inherit }`) now makes every one of them inherit the single source of truth (`html`'s `--font-ui`) instead of needing the same fix repeated wherever the next one gets noticed.
- **The camera feed now looks vertically centred on the whole phone screen even with its non-overlapping controls bar.** That bar reserves real height below the video, which left the video's own centre sitting above true screen-centre; the video's container now gets a live-measured top margin equal to the bar's actual rendered height (which varies by screen width and safe-area), so the reserved space is symmetric top and bottom and the video centres on the full screen — without the controls ever overlapping it. Typecheck and production build clean.

---

## 2.39.0

### Changes
- **Device badges are no longer nudged, ever — root-caused the recurring "dancing" reports for good.** Every earlier attempt (capping the nudge distance, incremental per-badge thinning, a global crowding threshold) still nudged SOME badge away from its true anchor to resolve a collision, and that nudge amount necessarily changes as the camera moves and neighbours' relative positions shift — which reads as the badge drifting, exactly what kept getting reported. Badges now sit at a fixed pixel offset directly above their own anchor, full stop: with the camera and icon size held still that offset is bit-for-bit identical every frame, and it only moves when the anchor's own screen projection moves — same as everything else glued to the 3D scene. A device's badge is therefore always in the same place relative to that device, so the user can build real finger memory for where a given badge lives.
- **Crowding is now resolved by grouping, not by nudging-then-dropping.** When a room's own badges collide with anything on screen — each other, or a neighbouring room's — ALL of that room's currently-visible badges hide together behind one room-cluster chip (unchanged from before: long-press it for the entity list). A room with room to breathe keeps every one of its badges pinned individually; only a genuinely crowded room gives way to its chip, and it's evaluated per room now, not as one global "all fine" / "all clustered" switch. Grouping engages the moment two badges actually touch, and a clustered room only reverts once its members are clearly separated by a much wider margin — the same asymmetric-hysteresis idea as before, just per room, so a room sitting near the boundary settles into one state instead of flickering as the camera drifts.
- **Tapping a room-cluster chip now zooms into that room** (using its saved, per-room camera framing — the same one the radial room dial already navigates to), rather than opening the entity list. Long-pressing it still opens the list, unchanged — the gesture that used to be a tap moved to long-press so the one gesture ("press and hold to see everything here") stays consistent everywhere it appears. A room with no saved viewpoint (the catch-all "Other" bucket) falls back to opening the list on a tap too, rather than doing nothing.
- **Room-cluster chips restyled**: flat near-black background replaced with the same slate-blue overlay tone used everywhere else in the Kiosk's dark surfaces, plus a faint hairline border, so a chip reads as part of this UI instead of a generic dark pill dropped on top of it.
- **Modernized the "on/active" green** (the camera feed's status strip, the linked-entity toggle, and every other use of the same accent) from a flat, slightly garish green to a muted emerald that still reads as unmistakably "on" without clashing with the sky-blue/teal accents used everywhere else.
- **Fixed the camera feed's controls overlapping the video on a phone in portrait.** The non-overlapping layout (video in its own region, a solid-backed status/controls bar below it) was desktop-only, gated behind a min-width media query; a phone in portrait needs it exactly as much as a laptop does, so it's now the only layout, on every screen size and orientation.
- **Switched the UI typeface to the native system font** (San Francisco on iOS/iPadOS/macOS, the platform default elsewhere) instead of a shipped webfont, for a more native, less "generic template" look — and one less network fetch blocking first paint.
- Verified the new clustering logic by simulation (a slowly-drifting pair of badges never flickers between states, a genuine separation clears it, a discrete size-stepper change re-decides immediately, a cross-room collision clusters both rooms). Typecheck and production build clean.

---

## 2.38.3

### Changes
- **Advanced Settings' "Linked entity" and "Motion sensor" pickers can now be cleared.** Reported: once either was set there was no way back to "unset" short of typing over it with a different entity. `EntityPicker` gained an optional `onClear` — a small "×" inside the search box once a value is set — wired up for exactly these two genuinely-optional link fields (in both the auto-detected entity list and the mesh-bindings table). Left off every other `EntityPicker` use (a mesh's own primary binding already has its own "Unbind" button; several others have nothing selected yet to clear), so nothing gained a clear button that didn't already need one. Clearing stores `undefined`, the same convention this field's own migration code already uses, rather than an empty string.
- **Removed the redundant floor-picker ring inside the rooms dial.** Long-pressing a specific floor button already tells the dial which floor you want, so re-offering both floors as chips inside the dial (as `1F`/`2F`, one of them already lit) was an extra, pointless step. The dial now opens straight to that floor's rooms.
- **Room chips in the dial are now alphabetically sorted**, rather than following whatever order they were added in the model.
- **Fixed room chips overlapping when a floor has a lot of rooms.** The fan's angular spread was capped at ±86° regardless of room count, so past about 15 rooms each additional one shrank the angular gap between chips below what the fixed 228px radius could physically separate — exactly the stacked-label mess in the screenshot. The dial now grows its radius to restore the same safe per-room spacing once the angular spread saturates, capped by how much vertical room the current viewport actually has (so it can never run off-screen) — only past THAT cap do labels start to overlap, a deliberate, visible fallback for a genuinely long list rather than the previous silent stacking. Verified numerically: unchanged for the common case (≤15 rooms, still the original 228px/48px-per-room baseline exactly), grows cleanly through ~30 rooms, then degrades gracefully rather than clipping off-screen. Typecheck and production build clean.

---

## 2.38.2

### Changes
- **Removed the standalone Rooms/Compass button.** The floor buttons (1F/2F) now do double duty: a plain tap/click keeps the original behaviour unchanged (switch to that floor, frame its whole bird's-eye view); a LONG-PRESS opens the radial room-picker dial, pre-scoped to *that* button's floor specifically — long-pressing "2F" while standing on 1F goes straight to 2F's rooms, not the floor currently on screen. The dial itself, and picking a room from it, are unchanged. The one thing the old button's long-press reached that this doesn't — the full Rooms list for creating/editing rooms — is preserved as a "Manage rooms" pill pinned at a fixed spot at the bottom of the screen whenever the dial is open, rather than sharing the arc layout (which is sized to the room count and anchored to whichever floor button was held, so anything else sharing that coordinate system risked colliding with a long room list).
- **Root-caused and fixed a real field report: a PWA left running for days on a wall-mounted tablet eventually got permanently stuck showing "Not connected to Home Assistant"**, recoverable only by someone manually reloading it — impossible for an unattended kiosk. Cause: the WebSocket client treated an `auth_invalid` reply as a permanent failure and disabled all future reconnect attempts for the rest of the session, on the assumption it "should never happen" since the Supervisor proxy always injects a valid token. In practice a HA-core/Supervisor restart (a nightly backup, an add-on update, a network blip mid-restart) can plausibly cause exactly one transient auth hiccup, indistinguishable in the old code from "this will never work". `auth_invalid` now falls through to the same handling as any other disconnect, so the existing capped exponential-backoff reconnect (never faster than 30s, already used for ordinary network outages) keeps retrying instead of ever giving up — self-healing exactly like the rest of this client already does, at no extra CPU/memory cost for running 24/7. A genuinely misconfigured add-on still fails visibly (connection dot, any attempted service call) rather than doing so silently forever. Reported once per occurrence (not on every retry) to the add-on's existing telemetry endpoint, so a recurrence is actually visible without needing to spam it. Typecheck and production build clean.

---



### Changes
- **Fixed room (and other Advanced Settings) edits silently reverting a few seconds after being made.** A genuine data-loss race in `DeviceConfigSync`: pushes to the add-on's shared store are debounced 900ms, but `pull()` runs on *every* window focus and visibilitychange — and on several platforms interacting with a native `<select>` blurs then refocuses the window. So choosing a room fired a pull while that very edit was still sitting in the debounce window; the pull fetched the server's older copy and wrote it straight back over the change. The existing merge couldn't help, because it is per-KEY over the shared slice and `entityMap` is a single key, so the server's whole entityMap replaced the local one wholesale, pending edit and all. A third ordering rule now applies: **a pull never clobbers an unpushed local edit** — if the local slice has drifted from what the server was last known to hold, this client is mid-edit and the pull is skipped, leaving its own push to carry the change up. Verified by simulating the exact scenario: the old ordering reverts "Kitchen" back to "Unmapped", the new one keeps it, and a genuine remote change still applies once the two are back in sync.
- **Advanced Settings now flags entities Home Assistant no longer has**, with a one-click "Remove N" cleanup. This answers a report of rows for entities that had been renamed in HA and weren't in the GLB either: `entityMap` only ever *grew* — auto-detection adds a row for any mesh named like an entity ID, and nothing ever removed one — so a renamed or deleted entity left its row behind permanently, stored centrally by the add-on. Stale rows are tinted and flagged rather than auto-deleted, since the entry may still hold a label/room worth re-pointing at the renamed entity via "Change entity ID". The check is guarded on a live, populated HA snapshot, so a reconnecting client can never be told its entire configuration is stale.
- The camera feed's **Previous** arrow no longer opens the camera picker on hold — having the same picker on both arrows was redundant. It stays on **Next**. Previous now steps directly, so it also can't be swallowed by the shared long-press flag that exists only to suppress the click at the end of a hold. Typecheck and production build clean.

---


## 2.38.0

### Changes
- **Room-cluster chips no longer overlap each other.** They were anchored to their room's centroid with no collision handling of their own, so two rooms whose centroids project close together stacked into an unreadable pile (reported: "Master Bathroom 3" sitting across "Outdoor 11" across "Bedroom 1 4"). Chips are far wider than badges because they carry text, which makes them much more prone to it. They now go through the same declutter solver the badges use, with a deliberately generous travel budget: a chip labels a whole *room* rather than pointing at one object, so moving it costs nothing in meaning — unlike a badge, where travel is exactly what made it misleading (see 2.37.5's `MAX_NUDGE_BADGE_WIDTHS`).
- Refactored that solver into one shared `relaxBoxes` used by both badges and chips, rather than duplicating it. Its subtleties — resolve along the axis of least penetration; relax from zero each frame instead of easing toward a target (which fed the render loop and made labels shake); clamp travel *after* solving and measure the residual against the clamped result, i.e. against what is actually drawn — were each bought with a field bug and are not worth reimplementing twice.
- **Grouping now engages earlier**, and on a more meaningful signal. The trigger is no longer an abstract residual-overlap score but **the share of on-screen badges that had to be hidden** because they wouldn't fit. That is what a viewer actually perceives, and it makes the rule directly explainable: *once a view can't honestly show about one badge in twelve, a room summary beats a partial map.* On a realistic 60-device plan the crossover moves from a villa spanning ~600px to ~650px on screen — grouping while the map is still mostly intact, rather than waiting until a quarter of the badges are already missing. Everything above that is unchanged: all 60 badges still shown, with zero hidden, right down to 750px.
- Both thresholds remain fractions of whatever is on screen, and the chip metrics are expressed in multiples of the chip's own height, so nothing here assumes a villa size, device count, room set or screen. Typecheck and production build clean.

---


## 2.37.5

### Changes
- **Found the actual root cause of "never groups, and dances at far zoom"** (2.37.4's shrink-floor change was treating a symptom and did not fix it). Studying the screen recording frame by frame showed the badges fanned out in a wide arc **well beyond the villa's own footprint** — the nudging step had pushed them off their devices into empty space. `declutterLabels` allowed each badge to travel `150px` from its anchor: roughly **four badge widths**.
- That budget was an escape hatch, and it invalidated everything downstream. Faced with a crowded villa the solver never had to fail — it just fanned badges outwards over empty space until they no longer overlapped. So a view that is visibly far too dense still measured as "no overlap left, all fine", which is precisely why clustering could never trigger no matter how far out you zoomed; and the large offsets needed to achieve that swung around chaotically frame to frame, which is the dancing. It also made the badges *wrong*: a badge exists to point at a device, and one sitting four widths away points at nothing.
- The nudge budget is now **1.1 badge widths**, so nudging can only resolve genuinely local crowding and anything worse registers as unresolved — which is what lets clustering take over. Measured on a 95-device villa: maximum badge displacement drops from **106–152px to 31–44px**, and residual overlap now rises with zoom-out instead of being suppressed. On a realistic 60-device plan the handoff is clean and monotonic: **all 60 badges shown with zero residual while the villa spans 750–2400px on screen, room chips below ~550px** — so nothing is grouped while there is room, and grouping reliably engages once there isn't. Expressed in badge widths, so it scales with the user's size setting and assumes nothing about the villa. Typecheck and production build clean.

---


## 2.37.4

### Changes
- **Fixed badges never grouping at far zoom, and dancing again there** (reported with a screen recording: zooming right out produced an unreadable, jittering blob of tiny icons that never became room clusters). Root cause was two mechanisms fighting over the same job. `OverviewController.getIconZoomCap` shrinks badges as you zoom past the whole-villa fit, and its floor was `0.22` — so badges shrank about as fast as the villa did. Clustering engages when badges can no longer be laid out without overlapping, but badges that shrink in step with the scene **never start overlapping**, so the trigger could never fire.
- The metric was in fact *inverted* in that region: measured on a 95-device villa, zooming out from 1.5× to 6× past the fit made residual overlap **fall** (0.17 → 0.00 → 0.08 → 0.38) instead of rise, because the shrink outpaced the crowding. Density decreasing as you zoom out is obviously wrong, and it is exactly why the view could sit in a dense blob indefinitely without ever grouping.
- Fixed by flooring the shrink at a still-legible fraction of the user's chosen badge size (`ICON_ZOOM_MIN_SCALE`), so the two mechanisms hand off instead of competing: badges recede while that remains useful, then genuinely overlap, and clustering takes over and replaces them with room chips. Density now rises monotonically with zoom-out, as it must. Since clusters are anchored to a fixed world-space point, reaching them also ends the dancing at that zoom. The floor is a fraction of the user's own size setting, so it assumes nothing about villa size, device count or screen. Typecheck and production build clean.

---


## 2.37.3

### Changes
- **Fixed badges flickering en masse while rotating the camera** (reported with three screenshots: nudge the angle slightly and most badges vanished, nudge a little further and they all came back). This was a side effect of 2.37.2. That release decided between "nudge everything apart" and "drop every colliding badge" as a single **global mode**, flipped by one measurement crossing a threshold — so a few pixels of camera rotation could add or remove dozens of badges at once. Measured on a 95-device villa under a slow orbit: **worst case 46 badges changing visibility in a single frame.**
- Adding hysteresis to that threshold would only have moved the cliff, not removed it, so the global mode is gone entirely. Layout is now always the same two steps: nudge everything apart, then drop **only** the badges that step could not separate. That is a per-badge, incremental decision — when two badges genuinely cannot fit, exactly one disappears, never forty — so panning and rotating degrade one badge at a time. Worst-case churn drops to **4 badges/frame (avg 0.36)**, a >10× improvement, while 2.37.2's full-visibility gain is untouched (still 124/155 zoom × category-subset combinations showing every badge, vs 54/155 before that release).
- Notably this also **removes the threshold that governed whether a badge is shown at all.** Two successive attempts put one there and both misbehaved in the field — first a raw crowding count (2.37.0, hid badges the nudging would have separated), then a residual-overlap gate (2.37.2, the mass flicker above). A per-badge decision has no cliff for a threshold to sit on, so both classes of bug are now impossible by construction rather than avoided by tuning. One threshold pair remains, and only for the genuine mode change of swapping individual badges for room clusters, where a wide hysteresis gap is appropriate.
- Visibility now carries deliberate temporal hysteresis: a badge already on screen is tested against a slightly smaller box than a hidden one, so it takes a clearly worse conflict to evict a badge than it took to admit it, and a hidden badge must earn real clearance to return. The cost is tolerating ~6px of overlap between badges that are already visible — invisible against their shadows and rounded corners — on the principle that a blinking badge is far more distracting than two badges touching. As always these are ratios of the on-screen badge set, with no counts, pixel budgets or entity/room names tied to this villa. Typecheck and production build clean.

---


## 2.37.2

### Changes
- **Fixed badges being hidden when there was obvious room for them** (reported with three screenshots across different category filters — e.g. with only Lights on, several light badges were missing despite clear space around them). 2.37.0 chose its LOD band from a raw *crowding* count (how many badges start out overlapping), which drops badges the nudging step would have separated perfectly well. The band is now chosen from **residual overlap** — how much overlap is still left *after* the relaxation has run — so the rule became: *if the badges can be nudged into a non-overlapping layout, every one of them is shown.* Nothing is hidden for merely being close to a neighbour.
- Along the way, measurement disproved the obvious-looking signal: gating on whether the solver "converged" is wrong, because a perfectly good layout very often reports `converged=false`. The solver settles into a harmless limit cycle where a few pairs shuffle each other by fractions of a pixel forever while the drawn result has **zero** overlap — so a convergence gate also threw away badges sitting in clear space. Residual overlap tracks the thing that actually matters, and it predicts stability almost exactly. Measured on a 95-device villa with a moving camera: residual 0.00 → 0.00–0.05 px/frame of badge movement (rock steady), 0.11 → 0.25, 0.43 → 1.66 (peaks 217 px), 0.82 → 50.9 px/frame (peaks 608 px — the original "dancing"). A near-zero residual therefore means both "they all fit" *and* "they hold still", which is exactly the condition for showing everything, so one measurement serves both goals.
- Net effect across 155 (zoom × category-subset) combinations on a simulated villa: **1673 more badges shown, and 70 more combinations showing every single badge** (124/155 vs 54/155) — with the anti-dancing guarantee intact, since the escalation threshold now sits in the region where jitter actually begins. Relaxation sweeps raised 12 → 24, since the outcome is now a decision rather than a cosmetic cap and each extra sweep is a layout that gets fully shown instead of thinned (free in the common case — the loop exits as soon as it settles).
- Every threshold involved is a **fraction of the badges currently on screen**, never a count, a pixel budget tied to this villa, or an entity/room name: a villa with 20 devices and one with 500 behave identically, and new rooms, devices or icons need no code change. Room clusters continue to come from `EntityMapping.room` with anchors computed from real geometry. Typecheck and production build clean.

---


## 2.37.1

### Changes
- **Fixed the badge-size stepper being asymmetric against the new clustering LOD** (reported: clustering engaged on the Nth "+" click, but took *five* "−" clicks to release). The LOD band's enter/leave thresholds are deliberately far apart — that dead zone is the hysteresis that stops the band flip-flopping while the camera drifts. But hysteresis is only correct for *continuous* input: a stepper click is a **discrete, deliberate act**, and "+" then "−" is the same control returning to the same state, so it must land in the same band it came from. The band is now re-derived from current crowding alone (same thresholds in both directions, no dead zone) whenever the user changes badge size, making the stepper exactly reversible while camera movement keeps its hysteresis. Verified by simulating a full stepper sweep up and back down at a fixed camera: **asymmetric at 0/12 sizes after, versus a mismatch before.** The badge-style toggle (classic ↔ card) now snaps the same way, since swapping a squircle for a much wider card resizes every collision box and can cross a threshold on its own.
- **Badge size can no longer be set to 0.** The stepper's floor was zero, which scaled every badge to nothing — visually indistinguishable from the villa failing to load, and reachable one click past "smallest" with nothing to explain it. Floor is now one step (0.25): still tiny, still obviously present. Bounds live in one place (`ENTITY_ICON_SCALE_MIN`/`MAX` + `clampIconScale` in AppConfig) and are applied by both the HUD stepper and the scene, so the control's limits and the renderer's clamp cannot drift apart; a value persisted as 0 before this change is clamped on read, so an existing kiosk stuck at 0 recovers by itself rather than showing a dead "−" button. Hiding badges entirely is still a reasonable thing to want, but it belongs behind an explicit toggle rather than the bottom of a size stepper. Typecheck and production build clean.

---


## 2.37.0

### Changes
- **Fixed badges "dancing" when zooming/panning past a certain zoom-out** (reported with a screen recording). Root cause was NOT depth sorting: `declutterLabels`' force-relaxation is only stable while a non-overlapping layout actually exists. Zoomed out far enough the badges' combined area exceeds the villa's screen footprint, so the constraint system is **unsatisfiable** — the solver never converges, exits mid-relaxation at its 12-iteration cap, and because "which axis has least penetration" and "which way do I push" are knife-edge branches whose flips cascade through the whole cluster, it lands in a completely different equilibrium every frame. Measured against a simulated 120-device villa on a moving camera: **badges moved 20–59 px per frame on average, with individual jumps up to 575 px.** No amount of extra iterations, damping or easing can fix an unsolvable system (easing was already tried and reverted in an earlier version) — the only real cure is fewer badges on screen, which is what map engines do.
- Badges now use three level-of-detail bands, the way professional map apps handle marker density:
  - **all** — every badge, nudged apart by the existing relaxation. Safe here precisely because the system is satisfiable.
  - **priority** — badges stay pinned at their *exact* anchors (never nudged, so they cannot jitter at all); where two collide the more important one keeps the spot and the other is dropped. Importance is alerting/unavailable → on → everything else, tie-broken on a hash of the entity_id so the order is a stable total order (two badges swapping rank between frames would reintroduce the very flicker being removed). This is the direct equivalent of Mapbox's `symbol-sort-key` + `icon-allow-overlap: false`.
  - **clusters** — individual badges give way to one chip per room (`Room  N`), anchored at the world-space centroid of that room's badge anchors. A fixed point in the scene projects to a continuous screen path, so this band is stable *by construction*. The chip carries the room's worst state as a red outline — the only attention signal left once individual badges are gone. Tapping one opens the existing `SummaryGroupPanel` with that room's entities, so clusters introduce no new UI concept (membership comes from `EntityMapping.room`, the same field that modal already groups by).
- Band selection runs on **measured crowding** (the fraction of on-screen badges blocked by a higher-priority one) rather than a magic camera radius, so it adapts itself to villa size, entity count, viewport and icon scale. The enter/leave thresholds are deliberately far apart — that gap is the hysteresis that stops the band flip-flopping near a boundary — and the metric is computed identically in every band from the projected anchors only, so a band can never feed back into the measurement that selected it. Verified over a simulated 400-frame zoom-out-and-back: 5 clean transitions (all → priority → clusters → priority → all) with the return thresholds at visibly different zoom levels than the outbound ones, and no oscillation. Frame-to-frame placement changes dropped to 0.05/frame with survivors not moving at all — versus the old solver's 20–59 px/frame of pure jitter.
- Also fixed while implementing: `cullLabels` only ever rejected anchors projecting *behind* the camera, never ones landing outside the viewport, so off-screen badges would have counted toward crowding and pegged the LOD band permanently at high zoom. They are now excluded from both collision resolution and the metric (they cannot visually collide with anything), which is what lets the bands relax back to "all" when you zoom into a room. Room clusters still count their whole room so the chip reports a true device count and its centroid doesn't slide as members cross the viewport edge. `greedyPlace` is also cheaper than what it replaces — one pass with an early break versus 12 sweeps over every pair. Typecheck and production build clean.

---


## 2.36.7

### Changes
- **Root-caused and fixed the recurring PWA-only `MODEL_LOAD_FAILED` / "Failed to fetch" failure** (previous attempts had treated it as a network problem; it never was one). The service worker is registered ONLY on the direct/Cloudflare hostname and deliberately skipped under Ingress (`main.tsx`) — which is exactly why the add-on always worked while the installed PWA could not load at all. In `sw.js`'s `modelCacheFirst`, a cache MISS did `await cache.put(...)` (plus an awaited `keys()`/`delete()` prune) **inside the promise handed to `event.respondWith()`** — i.e. inside the page's own network request, *after* all 15 MB had already downloaded successfully. Any failure in that write — `QuotaExceededError` on a 15 MB entry, a header combination the Cache API refuses (`Vary: *`), or the worker being killed mid-write under memory pressure, which this device does constantly (its telemetry shows `context-lost` past 30 in a single session) — rejected the page's request, and a rejected `respondWith` promise surfaces as precisely `TypeError: Failed to fetch`, indistinguishable from a real outage. Because it was deterministic, every retry re-downloaded 15 MB and died identically until the whole budget was spent: the field report shows **124 s elapsed against the 120 s `MODEL_FETCH_RETRY_BUDGET_MS`**, confirming every attempt failed the same way. The earlier fix guarded only the `fetch()` call and left this entire write path unguarded, which is why it didn't hold.
  - `modelCacheFirst` now returns the response to the page the moment it exists and performs the cache write in the **background**, fully isolated (`event.waitUntil`, itself guarded against `InvalidStateError` if the event already settled). `caches.open`/`cache.match` failures degrade to a plain network fetch instead of failing the request. Nothing about caching can fail a model load any more — worst case is an uncached model (slower next open), never a broken one. This also halves peak memory held in the response path and shrinks the window the worker must stay alive, both of which were feeding the very memory pressure that triggers the kill. A `QuotaExceededError` additionally drops the model cache so the next open has room (no re-`put` with the already-consumed body).
  - Verified by running the real `sw.js` against a stubbed Cache API: the previous code turned all five caching failure modes into "Failed to fetch"; the new code passes the response through in all five, while a genuine network failure with nothing cached still correctly rejects so the client's retry logic keeps owning real outages.
  - Defence in depth: added a `vk-sw-bypass` escape hatch, checked first in the SW's fetch handler (pure network, no interception, no caching). `fetchModelWithRetry` now escalates to it on every retry after a failure when a service worker controls the page — a SW-mediated failure repeats identically forever, so plain retrying cannot recover from one, whereas going around it can. A future SW bug can therefore no longer permanently brick the installed PWA.
  - `MODEL_CACHE` bumped `v1`→`v2` so the `activate` handler reclaims the old cache on deploy: if the failure was quota-driven that frees the space immediately, and otherwise costs one clean re-download. Typecheck and production build clean.

---


## 2.36.6

### Changes
- Fixed a regression from 2.36.5's full-width phone SummaryBar: with enough tiles to overflow (reported from a field screenshot: 4 tiles — Pool/Lights/AC/Energy — wider than the screen), the row's `justify-content: center` made the browser compute centred scroll bounds, so scrolling right reached the last tile fine but scrolling left couldn't reach the first one at all. This is a known CSS trap with `justify-content: center` on an overflowing scrollable flex container. Changed to `justify-content: safe center` (falls back to normal, fully-scrollable start-alignment the instant content overflows, while keeping the centred look when it fits) with the plain `center` declared first as a fallback for any engine that doesn't understand the `safe` keyword. Typecheck and production build clean.

---


## 2.36.5

### Changes
- Fixed a regression from 2.36.3's HUD reorg: on a phone (≤720px), the bottom SummaryBar (the scene/device tile strip) was still anchored `left: 80px` to sit flush against the first-person/bird's-eye view toggle's old bottom-left corner spot — but that button moved into its own section in the left column in 2.36.3, leaving the corner empty and the tile row visually shifted toward the right with a large dead gap on the left (reported from a field screenshot: "Door Lock"/"Pool" tiles hugging the right side instead of spanning the screen). Now spans the full width with small, equal side margins (safe-area aware) and centres its tiles within that width, so a short tile list no longer reads as anchored to one edge. Typecheck and production build clean.

---


## 2.36.4

### Changes
- View-mode toggle (the walking-person/map icon in its own left-column section, see 2.36.3): dropped its `.active` accent styling — it's a plain mode SWITCH, not a state indicator like the floor/anchor buttons above it, so it now stays visually neutral in both first-person and overview mode instead of lighting up blue.
- Top-bar right zone: the Unavailable-devices and Facility alert buttons, moved next to the profile chip in 2.36.3, now share ONE pill background with the profile chip and Settings button (`.hud-right-inline` reuses the same `.hud-group` chrome the category-filter row and label-size stepper already use) instead of each rendering as its own separately-bordered white square. This also fixes a height/alignment mismatch: outside `.hud-group`, a standalone `.icon-btn` is a full 48px glass button with its own border, and once the alert button moved out of the category row its `has-alert` red border rule — previously silently overridden by that row's own icon-btn reset — started actually applying, on top of the size difference, making it read as bigger and higher than its neighbours. Inside the shared pill every button (including the profile chip's own logout button) resets to the same flat 38px sizing, matching the rest of the row. Typecheck and production build clean.

---


## 2.36.3

### Changes
- Narrowed the previous release's "hide config/diagnostic entities from kiosk lists" idea per feedback: it should NOT touch Home Assistant itself (an entity flagged entity_category config/diagnostic stays exactly as visible there as before), and it should ONLY apply to `SummaryGroupPanel`'s device-control-summary role, not its troubleshooting one. `SummaryGroupPanel` gained a `filterSuppressed` prop (default true); HUD's and FacilityModal's "Unavailable devices" modals — which share their entityIds AND count badge with the Facility Readiness tab's guest-readiness "All devices reporting" check — now pass `filterSuppressed={false}`, since a hidden or diagnostic (RSSI, battery…) sensor going offline is exactly the kind of thing that check exists to surface, and filtering it there would also have made the modal's row count silently disagree with its own badge number.
- Layout: moved the first-person/bird's-eye view toggle out of its lone standalone spot in the bottom-left corner (nothing there explained it, and the SummaryBar's tile row could visually extend over it on a narrow phone) into its own dedicated section in HUD's left column, right below the existing floor/rooms/anchor stack — same left-edge vertical flow, no new CSS needed. The bottom bar now holds only the first-person joystick.
- Layout: moved the "Unavailable devices" and "Facility" alert icons out of the category-filter row (top-bar centre) into the right-hand zone, right before the profile chip — grouped with "who's signed in" since both answer "what needs my attention". Added matching items to the phone overflow menu (⋮) so neither loses reachability once `.hud-right-inline` collapses there below 640px. Typecheck and production build clean.

---


## 2.36.2

### Changes
- Fixed two issues reported from the bottom-bar "Pool" group modal. (1) Entities the user hid in HA (Settings > Entities > "Visible" toggle) were still listed under "Not on the map" — the app never fetched HA's entity registry at all (`get_states` only reports live state/attributes, never `hidden_by`), so there was nothing to filter on. Added a one-shot `config/entity_registry/list` fetch (`HAWebSocket.getEntityRegistry`) alongside the existing `get_config` call on connect, stored as `hiddenEntityIds` in `HAStateStore`, and filtered out of `SummaryGroupPanel` (every caller of this shared modal — SummaryBar tiles, Facility Readiness shortcuts, HUD's unavailable-devices list) and out of `SummaryBar`'s own tile derivation so a tile's "N On" count can't disagree with the (also-filtered) list tapping it opens. (2) `switch.outdoor_swimming_pool_light_patio_top` (a pool-area light relay) drew a lightbulb icon instead of the expected pool/energy droplet — its id contains both "light" and "pool", and `EntityCategories.SWITCH_PURPOSE_HINTS` (the shared table that picks both the badge colour and the glyph for every generic `switch.*`/`input_boolean.*`) matched "light" first purely by table order, even though the same switch is grouped under Pool everywhere else in the app. Reordered the table so a switch's SYSTEM (pool/jacuzzi/spa, heating, camera, speaker, outlet) is checked before the generic FIXTURE-type hints (light, fan) that only describe what a system switch happens to control, and anchored every remaining alternative against start/end/"."/"_" (previously only the lock/door/gate entry had this — the rest were bare unanchored substrings, the same bug class as the earlier "outdoor" reverted regression). Also added the same anchoring to `SummaryBar`'s separate pool-tile-membership regex (`pool|jacuzzi|jaccuzi|spa`, previously unanchored — a bare "spa" could false-match e.g. "spartan_gym_relay"), and made `categoryForEntity`'s switch/input_boolean branch check `device_class === "outlet"` first, mirroring `iconKeyFor`'s existing `SWITCH_ICON_KEY` check, so the badge colour and glyph can't drift apart for an entity with an explicit device_class the way they used to for name-only ones. Typecheck and production build clean.

---


## 2.36.1

### Changes
- Cleanup: removed the two TEMPORARY always-on `console.log` diagnostics added while investigating the "Invert day/night preview" toggle report (`SunController.applyDayNight` and `Dashboard`'s `sun.sun`-driven effect) — the user confirmed the toggle is now working correctly, closing that investigation without ever finding a code path that needed changing. No functional change. Typecheck and production build clean.

---


## 2.36.0

### Changes
- Found the REAL root cause of the iPhone "top bar obstructed" report, superseding the 2.35.99 diagnosis. Two clearly-labeled field screenshots (HA Addon vs. direct-hostname PWA) made it possible to isolate the bug for the first time: the PWA screenshot showed the topbar icon row sitting right against the status bar/Dynamic Island, while the Addon screenshot looked correct. That split ruled out the Ingress-vs-PWA theory from 2.35.99 as the actual cause — a genuine per-viewport-width CSS bug was hiding underneath it the whole time. `.hud-topbar`'s `@media (max-width: 1000px)` rule declared `padding: 0 var(--hud-side-pad);` — a 2-value shorthand that sets `padding-top`/`padding-bottom` to `0` as a side effect of only intending to change the left/right padding, silently overriding the base rule's `padding-top: var(--safe-top)`. Because this media query matches essentially every phone (portrait or landscape), the safe-area reservation was being wiped out on real phones across the board, not just under Ingress. It stayed invisible in the Addon/Ingress context specifically because 2.35.99's `.vk-ingress` override already forces `--safe-top` to `0px` there anyway — the shorthand bug and that override coincidentally produced the same result, masking the bug in the one context that got tested. In the direct-hostname PWA, `--safe-top` is meant to hold the real non-zero Dynamic Island inset, and the shorthand was zeroing it, reproducing exactly the reported symptom. Fixed by splitting the shorthand into individual `padding-left`/`padding-right` declarations so the inherited `padding-top` survives. Proactively audited every other safe-area-sensitive rule for the same shorthand-cascade pattern and found one more: `.summary-bar`'s `@media (max-width: 720px)` override set a flat `bottom: 14px;` with no `env()` term at all, silently dropping home-indicator clearance on every phone; changed to `bottom: calc(14px + env(safe-area-inset-bottom, 0px));`. No other selector in the audit had the same conflict — each either has a single rule occurrence or its override already re-declares the safe-area term explicitly. The `--safe-top`/`.vk-ingress` mechanism from 2.35.99 is unaffected and stays in place. Typecheck and production build clean.

---


## 2.35.99

### Changes
- Root-caused the iPhone "top bar still obstructed" report from a field screenshot: it's specifically an HA Ingress/Companion-App issue, not a direct-hostname PWA one (confirmed absent there). Under Ingress this page is ALWAYS embedded below HA's own chrome — the sidebar's bar on desktop, or the Companion App's own toolbar (quick actions, notification bell, overflow menu) on iOS — which is what actually touches the physical screen edge in that context, not us. Our own `env(safe-area-inset-top)` reservation on the topbar (and every other top-anchored element) was still being applied on top of that, reserving a SECOND, redundant Dynamic-Island-sized gap below an area HA's own wrapper had already cleared — pushing the villa-name chip, the floor stack, and the PIN/profile gate down further than the villa's own UI needs, and making the two stacked bars in the screenshot read as one big obstruction. Fixed with a single shared `--safe-top` custom property (replacing 12 separate `env(safe-area-inset-top, 0px)` call sites) that `main.tsx` zeroes out via a `.vk-ingress` class stamped on `<html>` before first paint, detected the same way `ingress.ts` already does (`location.pathname` containing `/api/hassio_ingress/`) — so every top-anchored element (topbar, floor stack, room-name banner, camera header, PIN gate, teleport grid, first-run tips) gets the redundant space removed at once, correctly, with no risk of missing one. Left/right/bottom insets are untouched — HA's wrapper is a horizontal bar at the very top only; it doesn't help with the home indicator or a landscape side notch, both still genuinely needed regardless of Ingress. The direct-hostname PWA is unaffected (`.vk-ingress` never applies there — that page IS the top-level document and genuinely owns the full inset). Typecheck and production build clean.

---


## 2.35.98

### Changes
- Camera panel fullscreen button: found and fixed a real, iPhone-specific gap while checking "does the camera fullscreen view work as well on iOS as Android." `toggleFullscreen` called `Element.requestFullscreen()` unconditionally — iPhone Safari (unlike iPadOS, desktop Safari, and every Android browser) does not support the Fullscreen API on an arbitrary element at all: `document.fullscreenEnabled` is `false` and the call always rejects. The button rendered anyway, so on iPhone specifically it looked pressable but silently did nothing, and its icon never flipped to "exit fullscreen" (`document.fullscreenElement` never becomes truthy there either). Fixed by feature-detecting `document.fullscreenEnabled` (not platform-sniffing — keeps working correctly if Apple ever adds support) and hiding the button entirely where it can't do anything, rather than offering a dead control; also added `.catch()` to both the enter/exit calls as defence in depth. The live feed itself is unaffected either way — `.camera-fullscreen` already covers the full viewport via CSS on every platform, independent of the native Fullscreen API succeeding. Everything else checked (native-HLS-vs-hls.js branching for iOS Safari's MSE support, `playsInline`/`muted`/`autoPlay` on the `<video>` element, the pinch-zoom/pan gesture's `touch-action: none` correctly pre-empting Safari's native page-zoom, safe-area coverage on the header/controls) was already implemented correctly cross-platform — no other iOS-specific gap found. Typecheck and production build clean.

---


## 2.35.97

### Changes
- Full audit of iOS Dynamic Island / notch safe-area coverage, prompted by a field report that the top bar was still obstructed on an iPhone despite the earlier (2.35.94) pass. This time covered EVERY `position: fixed`/`absolute` rule anchored to a screen edge (~47 candidates), not just the top bar, and found the real gaps: **`.auth-screen`** — the PIN/profile-picker gate, the very first screen a guest sees before ever reaching the dashboard — had ZERO safe-area awareness (a flat 24px padding, no `env()` at all); now inset on all four sides. **`.bottom-bar`** (the joystick/view-toggle corner controls) and **`.summary-bar`** (the bottom tile strip) had no `safe-area-inset-bottom`, so they could sit under the home-indicator gesture area. The mobile full-screen `.modal` sheet (Settings/Config Editor on a phone) only had top/bottom `env()` — no left/right — so in LANDSCAPE, where the Dynamic Island's clearance shows up as `inset-left`/`inset-right` instead of `inset-top` (the physical sensor housing doesn't move, but the page's logical top/bottom/left/right remap when the device rotates), its header/body/footer had zero protection on that side; the villa's manifest sets `orientation: "any"`, so this is a real, reachable case, not theoretical. All fixed using the exact same mechanism already correctly in place elsewhere (`.hud-topbar`, `.room-label`, `.camera-header`) — `env(safe-area-inset-*, 0px)` added to the relevant padding — which IS the professional/Apple-recommended standard (WebKit's own `viewport-fit=cover` + `env()` mechanism, already wired up correctly at the meta-tag level); this was a coverage gap on specific elements, not a wrong approach. Typecheck and production build clean.

---


## 2.35.96

### Changes
- Camera panel: hold either the prev/next arrow to open a picker listing every camera by name — jump straight to a specific feed instead of cycling through them one at a time. Same tap-vs-hold convention already used for the Rooms dial and the default-view anchor button (a plain tap still steps as before, only a HOLD opens the picker), including the same persistent "this button does more on hold" dot affordance, so this is purely additive and discoverable without adding any new visible chrome. The picker itself (`hud-menu camera-picker-menu`) reuses the existing glass-chip dropdown styling, positioned to grow upward from the bottom-right control cluster it's opened from (that cluster sits at the screen bottom in every layout, mobile overlay or the desktop in-flow row); dismiss via backdrop tap or Escape. The current camera is marked with a check and can't be re-selected into itself. Typecheck and production build clean.

---


## 2.35.95

### Changes
- Fixed the "app freezes and resets for a few seconds every time you come back to it" report — reproducible on every single minimise/restore or app-switch, desktop and mobile alike, not an occasional glitch. Root-caused, not guessed: `DeviceConfigSync.pull()` runs on mount AND on every `window focus`/`visibilitychange` event (by design, so an edit made on another kiosk shows up here without a reload) and, until now, called `update(server)` UNCONDITIONALLY every single time — even when the server's shared config (entity↔mesh bindings, device groups, room definitions) hadn't changed one bit since the last pull. `update()` always hands React a BRAND NEW object reference for each field (a fresh JSON parse from the HTTP response), and `SceneManager.updateConfig`'s structural-change gate compares `meshBindings` by bare REFERENCE (`prev.meshBindings !== config.meshBindings`) — a fresh-but-identical object always fails that check. Net effect: every single focus regain triggered a full `indexMeshes()` + `applyStructure()` pass — the same multi-second, main-thread-blocking rebuild a genuine structural edit is supposed to cost — for a config that hadn't actually changed. That's the "few seconds unresponsive," and it's also why covers/locks visibly snapped back to their hardcoded default pose (closed/locked/off) before the post-rebuild repaint restored their real state moments later: `EntityVisuals.indexMeshes()` deliberately forces every multi-pose entity to that default first (so an unbound or late-reporting entity doesn't render all its poses at once), normally invisible because it happens once at initial load. Fixed at both ends: `DeviceConfigSync.pull()` now compares the merged result against current local state and skips `update()` entirely when nothing actually changed (mirroring the SAME "push only real changes" discipline the outbound half of this file already had, now applied inbound too); and `SceneManager.updateConfig`'s `meshBindings` check now content-diffs (JSON compare) instead of reference-comparing — the exact same same-content-different-reference guard `entityMapDelta` already gave `entityMap`, now covering the sibling field that was missed when that fix originally shipped, so any OTHER future caller handing a fresh-but-identical `meshBindings` object can't retrigger this either. Typecheck and production build clean.

---


## 2.35.94

### Changes
- Revert a real regression from 2.35.91: door-lock detection was extended to any `switch.*` matching `/\block|unlock|door|gate/i` against its entity_id — the "door"/"gate" alternatives had no word boundary, so they matched as a bare SUBSTRING anywhere, including inside "outdoor" and "aggregate". Every exterior LED/light switch whose id contained "outdoor" (a near-universal naming pattern for exterior lighting) showed up in the Door Lock tile and the Facility "Doors locked" check as a lock, which it plainly isn't. Reverted `SummaryBar`/`readiness.ts` to `lock.*`-domain-only detection (per the user's explicit instruction — no generic, false-positive-free automatic rule was found for classifying a plain switch as a lock; an explicit per-entity opt-in would be the honest way to add one, not attempted here) and removed the now-dead `isLockLikeSwitch`/`isLockSwitchSecured` helpers. Also fixed the SAME unanchored-substring bug at its actual root — `EntityCategories.SWITCH_PURPOSE_HINTS`'s pre-existing door/gate/lock pattern (used for badge icon + category colour, not just the tile) — with a real boundary anchor (`(?:^|[._])(?:lock|unlock|door|gate)(?:[._]|$)`, since `\b` alone doesn't help: `_` counts as a word character, so `\bdoor\b` still matched inside `outdoor_light`). Verified with 14 assertions against the real regex covering every false positive from the field report plus the genuine target case. Facility "View doors"/"View lights": were opening a DIFFERENT, narrower modal than the bottom-bar Locks/Lights tiles (just the readiness check's failing subset, not the full device list) — extracted `locksGroup()`/`lightsGroup()` into a new shared `src/config/summaryGroups.ts` so SummaryBar's tiles and Facility's shortcuts open the byte-identical `SummaryGroupPanel` group, one definition, not two. HUD left column: the floor/rooms stack's left offset was a flat hardcoded 18px while `.hud-topbar`'s own padding (which the villa-name chip sits inside) steps to 24px at the ≥1024px breakpoint and down to 10px below 1000px/640px — introduced a shared `--hud-side-pad` custom property both now read, so they can't drift apart at any breakpoint again. Facility tab row: `.fm-tabs` had zero top padding (only 10px at the bottom, before its border), so the tab buttons sat flush against the row's top edge instead of centred in the band — fixed to symmetric padding. Day/night invert: traced the full call chain (button → `SettingsModal.applyRender` → `SceneManager.setRenderConfig` → `SunController.updateConfig/applyRealSun/applyDayNight` → night-atlas crossfade/exposure/sky/hemi writes → `requestRender`) and found every step reads live state and applies unconditionally in both directions — no code path identified that would silently drop a second toggle. Added always-on (not `devLog`-gated, which is compiled out of production entirely) diagnostic `console.log`s at `SunController.applyDayNight` and the `sun.sun`-driven effect in `Dashboard.tsx` so the next reproduction pins the exact break point instead of continuing to guess blind. Typecheck and production build clean throughout.

---


## 2.35.93

### Changes
- Follow-up to 2.35.92's embedded room data: cleaned up the Advanced Settings upload UI now that a lone `.glb` usually carries its own room data, and closed a real staleness gap. UI: the separate "Upload GLB (+ room data)" and "Upload room data" buttons are now ONE "Upload GLB / room data" button/input (multi-select, `.glb`/`.json` in any combination) — a rooms-only pick still works exactly like the old dedicated button did (update room data without re-uploading the model), it just doesn't need its own button anymore. Correctness fix: previously, uploading a lone `.glb` with no embedded room data (an older pipeline export, or one where the embed failed) left whatever `sh3dRooms`/`sh3dEntities` were already stored completely untouched — meaning a genuinely new floor plan could silently keep "matching" against a PREVIOUS model's room polygons/device positions forever, with no warning. `uploadGlbAndRooms` now uploads a deliberately empty `{rooms:[],entities:[]}` document through the exact same rooms-upload path in that case, so the central store — and every kiosk's next load — resets to a clean slate instead of accumulating redundant/mismatched room definitions across repeated GLB imports (an unchanged floor plan re-exported without its room data attached now needs that `.rooms.json` re-picked alongside it too — a deliberate trade favouring consistency). `applyRoomData` had to learn to tell "deliberately empty" apart from "wrong/garbage file" (`sh3dParser.parseRoomData` rejects zero rooms on purpose, to protect the manual-upload path from a mis-click) before this could apply cleanly instead of surfacing as a confusing upload failure. Typecheck and production build clean.

---


## 2.35.92

### Changes
- Room data now embeds directly in the GLB — no more separate `.rooms.json` upload for a pipeline built with this release. Follow-up to 2.35.91's "select both files together" workaround, which only halved the friction; a lone freshly-exported `.glb` still couldn't carry the villa's room names/positions on its own. Pipeline (blender_pipeline.py 2.14.0): `_compute_room_data` extracts the room/entity-parsing logic that used to live only inside `_write_room_sidecar` into a shared function; `_embed_room_data` (new, runs BEFORE the glTF export) stamps its result as a `vk_rooms_json` JSON-string glTF extra on a new bare "VillaKioskRoomData" Empty node — same `vk_` extras namespace as the structure-role metadata shipped last release. `export_extras=True` is now set EXPLICITLY on the glTF export call (previously relying on Blender's own default, which is also what silently made vk_role/vk_level/vk_exterior work at all — worth pinning down rather than leaving implicit). The legacy `.rooms.json` sidecar is still written every run, unchanged format, now sourced from the same computed data (can't drift from the embedded copy) and kept purely as a fallback for an older/hand-built GLB. App side: new `src/utils/glbRoomDataExtractor.ts` reads the JSON chunk of the raw GLB binary directly per the glTF-Binary spec — no Babylon/WebGL scene needed, so it can run immediately after picking a file in Settings, before any model is loaded. `ConfigEditorModal`'s combined GLB(+rooms) upload now tries this FIRST whenever only a `.glb` was selected: if embedded data is found and validates through the existing `parseRoomData` (same validator an uploaded sidecar goes through — malformed extras are never trusted/uploaded), it's synthesized into a `File` and pushed through the exact same central-rooms-upload path a manually-picked `.rooms.json` would take, reusing 100% of the already-working central-store write + every-load sync/diff/apply machinery. A GLB from an older pipeline (no carrier node) behaves exactly as before — falls back to needing a manual `.rooms.json`, no error surfaced for the missing embed itself. Verified with 11 assertions against the real extractor module (valid payload round-trips through the actual `parseRoomData`, bad magic/wrong chunk type/truncated buffer/non-string extras all resolve to `null` rather than throwing) plus a `python3 -m py_compile` pass on the pipeline script. MODEL_PIPELINE.md updated to describe the new one-file upload path. Typecheck and production build clean.

---


## 2.35.91

### Changes
- Batch of 16 field-reported fixes/requests across the bottom bar, notifications, Facility, HUD layout and infra. Door locks: a relay-controlled door (e.g. a doorbell/intercom strike modelled as a bare `switch.*`, not HA's `lock` domain) now shows up in the Door Lock tile AND the Facility "Doors locked" check automatically — reuses the existing SWITCH_PURPOSE_HINTS lock-glyph classification (EntityCategories.isLockLikeSwitch) as the single source of truth, no new hardcoded pattern, and assumes the standard energise-to-unlock relay convention (documented, not guessed). Motion notifications: unified to always read "Motion detected · <room>" — the camera-motion vs. plain-sensor cases used to differ (one showed just a device label, the other appended "— <device label>" after the room), now both drop the device label whenever a room is known. GLB import: the central-upload GLB picker now accepts multi-select, so the .glb and its .rooms.json sidecar can be chosen together in one OS file dialog and upload sequentially in one action — a real filesystem-sibling auto-discovery isn't possible from a browser file input, so this is the closest "automatic" gets within that constraint; the more optimal fix (folding room data into the GLB's own glTF extras, same mechanism as vk_role/vk_level) needs a pipeline change, noted for next time sources/ is available. Swimming Pool bottom-bar tile: added a second rule (device's configured `room` matches "pool"/"jacuzzi"/"spa") alongside the existing name-based one. Camera status bars: were a fixed 75% of their flex space, so a camera with fewer control buttons (no linked-entity toggle, no prev/next) visibly showed a WIDER bar than one with more — changed to fill 100% of the available space up to the buttons, consistent regardless of button count. "Not on the map": a device with no mesh of its own but used as another device's `linkedEntityId` or a camera's `motionEntityId` is no longer reported as off-map — it's reachable via its host device's badge. Facility Report/Spend tabs: both now support Save / Reopen / Delete of generated documents (new FmSavedDocument type + FmDataContext.saveDocument/removeDocument, one shared SavedDocumentsList renderer), and Spend gained its own "Generate/Save spend statement" workflow (fmReport.buildSpendStatement) mirroring the Report tab's explicit generate-then-save shape. Facility Readiness tab: the "View unavailable devices" shortcut moved onto the same line as its card's title (was stacked below, making that one card taller than its neighbours); the same treatment extended to new "View doors"/"View lights" shortcuts on the Doors-locked/Lights-off cards; tab label text now has `line-height:1` to fix the icon/label vertical-centring; the Report tab's preview area got a `min-height` so generating a report doesn't visibly resize the whole modal (and shift the header/tabs on screen) below the desktop fixed-height breakpoint. HUD left column: the default-view "anchor" button moved out of the standalone bottom-left view-toggle corner and into the 1F/2F/Rooms stack as its 4th button (ViewControls split into the toggle-only default export plus a new DefaultViewButton); that stack's squircle radius is now a shared `--radius-squircle` token also applied to the villa-name/clock brand chip (previously a mismatched full capsule — the one HUD section whose shape didn't match the rest), and the stack's left inset now lines up exactly with the brand chip's own left padding. iOS Dynamic Island: audited every top-of-screen overlay for safe-area handling — the top bar and error/service toasts already reserved `env(safe-area-inset-top)` correctly, but the room-name banner didn't (flat 64px), so it could render under the island on a Dynamic-Island iPhone; fixed to match the toast's existing pattern. PWA "Failed to fetch" reconnect: root-caused from the field telemetry, not guessed — a standalone PWA tab with a large heap (400-500MB+, consistent with the app's known slow memory drift) gets evicted by the OS/browser while backgrounded; on foreground it does a full cold reload (not a bfcache restore — heap resets to ~24MB, `pageshow` reports `persisted:false`) and re-fetches the model right as the device's own network stack is still reassociating Wi-Fi/DNS after resuming from background/sleep. The existing `fetchModelWithRetry` 120s backoff-retry budget is already generous and was hit almost exactly (report timestamp lines up with page-resume + ~2 minutes), so this was a genuinely sustained (if transient) local network gap, not a code bug or a Cloudflare-side failure — `Online: true` and the surrounding successful loads confirm the network and Cloudflare hop are otherwise healthy. Shipped one low-risk improvement: the retry backoff now also wakes early on the browser's own `online` event instead of always sitting out the full delay, shortening recovery in exactly this scenario without changing the worst-case budget. Cloudflare Security Insights review: of the 7 findings, only "Security.txt not configured" was origin-actionable — added `public/.well-known/security.txt` (RFC 9116). The rest (HSTS, Always-Use-HTTPS, Bot Fight Mode, AI-bot blocking/Labyrinth) are Cloudflare dashboard-only toggles; HSTS specifically is already sent correctly by this add-on's own nginx (verified in rootfs/etc/nginx/nginx.conf) for the direct hostname, but `ha-thelyshouse.*` is Home Assistant Core's own web server (outside this add-on's code) so Cloudflare's edge-level HSTS toggle is the only fix available for that domain. Typecheck and production build clean throughout.

---


## 2.35.90

### Changes
- Stop deriving villa structure from mesh NAMES; derive it from pipeline metadata. Deep scan of the codebase and blender_pipeline.py for project-specific hardcoding, prompted by the requirement that this be replicable to any other SH3D plan or villa. Found 19 executable regexes matching villa/language vocabulary. The critical class was the app/pipeline contract: four separate places re-derived structure, storey and indoor/outdoor status by regex-matching the literal English strings Structure / Structure_L<n> / Structure_Exterior. blender_pipeline._split_structure_by_floor ALREADY computes exactly that (it builds {level, exterior} per group) and was throwing it away into a name. Any villa whose structural meshes were named differently — another exporter, a hand-built GLB, or a plan authored in another language — would have loaded with no floor switching, no always-visible exterior and no camera-beam occluders, with nothing on screen to explain why. Fix, both halves: pipeline 2.13.0 stamps vk_role/vk_level/vk_exterior as glTF extras (Blender exports object custom properties into node extras; Babylon surfaces them as mesh.metadata.gltf.extras) purely ADDITIVELY, names unchanged; and a new src/babylon/meshRoles.ts reads that metadata first, falling back to the legacy name pattern only when a GLB predates it. So an old GLB keeps working against the new app, and an old app keeps working against a new GLB. The four duplicated regexes collapse to one documented legacy fallback in that single module, and yesterday's meshPatterns.ts (which I had added, and which was itself an English/French word list) is deleted. Verified with 16 assertions including Bahasa- and French-named structural meshes classifying correctly from metadata alone, metadata overriding a misleading legacy-looking name, and malformed/absent metadata degrading safely. ALSO, same theme: the camera beam's heading offset and default down-tilt were constants I had picked for one specific catalog CCTV model — which way a model faces at angle 0 is a property of how that model was authored, so hardcoding it bakes one asset into the engine and mis-aims every beam for any other villa. Both are now AppConfig settings (cameraBeamOffsetDeg default 180, cameraBeamPitchDeg default 30), so a wrong heading is a value to change rather than a code change. AND the beam-too-short report: a camera is mounted ON structure, so the cone's apex sits centimetres from a large occluder and its edge rays necessarily point back into that mount — with a flat min over all hits, the camera's own mounting wall defined the whole cone's reach, which is why widening the beam made it collapse. Edge rays now ignore hits within a mount clearance, and ignore grazing hits where the beam merely runs alongside a surface rather than into it; the centreline ray is untouched, so a camera genuinely facing a close wall still clips honestly. 11 geometric-vocabulary regexes remain (stairs, wall collision, ceiling hiding, outdoor-room tinting, glass detection) — all are best-effort heuristics over individual catalog pieces the pipeline never classified, and all degrade rather than break (walk through a wall, no stair climbing, a fan that does not spin) instead of failing to load; fixing them properly needs the pipeline to tag individual pieces, which is the natural next step now the extras mechanism exists. Verified: 16 roles + 11 clipping + 8 beam-math + 91 security + 49 existing engine assertions, pipeline compiles, typecheck and build clean

---


## 2.35.89

### Changes
- Camera beam: fix a real regression from the widening in the previous release. Field report with a screenshot: after doubling the cone's size, a beam near a doorway rendered as a short stub again instead of the expected reach across the room. Root cause: CameraBeams.clippedLength samples 8 rays around the cone's SURFACE and takes the MINIMUM reach across all of them (deliberately, to stop the beam's sides poking through a nearby wall its centreline ray missed — a real fix from 2026-07-03). Those rays were tested against the FULL shadowCasters set, which legitimately includes every static mesh for shadow-casting purposes (furniture blocks light too) — but for a beam, that means a single piece of furniture, a curtain, or a door frame grazed by just ONE of those 8 edge rays collapsed the WHOLE cone to a stub, even with a completely clear room ahead of the centreline. Doubling the cone's angular spread in the previous release made this dramatically more likely: a wider cone's edge rays sweep much more off-axis space at the same distance from the camera, so a nearby side object that the old narrow beam would have missed entirely is now squarely in its path. Fix: the beam's occluder set is now restricted to genuinely structural geometry — walls, partitions, railings, fences, glazing, and the baked pipeline's merged Structure_* meshes — via a new isStructuralMeshName, extracted to src/babylon/meshPatterns.ts and shared with SceneManager.applyStructure's existing wall/collision regex (same classification, one definition, not two that could drift apart) rather than the full shadowCasters superset. A door's glass panel still blocks (it is a real optical barrier); its frame/trim and any furniture no longer do, since neither should limit what a camera can conceptually see across a room. Verified two ways: 26 name-classification assertions covering the real pipeline's Structure_L1/_Exterior naming, standard walls/partitions/railings/fences/glass, and a broad set of furniture/door-trim/decor names that must NOT match; and the full existing suite (25 fm + 9 cache + 10 diff + 5 yield + 91 security) still green. Typecheck and build clean

---


## 2.35.88

### Changes
- Camera beam: bigger, per follow-up field report with screenshots confirming last release's heading fix worked (the beam now visibly points where the camera is aimed) but reading as too small to feel like a coverage area. Doubled BEAM_MAX_LENGTH (3m to 6m) and BEAM_END_DIAMETER (3m to 6m) together, which is deliberate: keeping their RATIO fixed preserves the exact same spread angle a prior round of feedback (2026-07-03) had already tuned to fix a DIFFERENT complaint, that the original 6m/1.6m beam read as a long thin streak reaching across multiple rooms. Verified precisely rather than assumed: old half-angle atan(1.5/3) and new half-angle atan(3/6) both compute to 26.565 degrees exactly, so this cannot regress toward that laser-streak shape. Frontal coverage area scales with the square of the radius, so doubling both dimensions quadruples how much of a room the cone visibly covers, matching the requested 'glow of light that gracefully covers the area in front of the camera' rather than a thin spotlight. Applies to every camera at once (single shared constant, same as the direction fix) and stays auto-clipped to nearby walls in a small room exactly as before (clippedLength's own raycast logic is untouched), so a small room does not get a beam poking through its far wall just because the reach ceiling went up. Verified: typecheck and build clean, existing 49-assertion engine/cache/diff/yield suite untouched and still green

---


## 2.35.87

### Changes
- Camera beam: default 30° down-tilt, plus a first-pass correction for the beam's compass heading. Reported with side-by-side screenshots: a camera authored facing one direction in SweetHome, but its motion-triggered beam fanning out in a visibly different one, on the same flat horizontal plane as the camera mesh instead of angled toward the floor it's meant to be watching. TILT (confirmed, mechanical): checked the villa's own .sh3d file directly — none of its camera pieces carry a pitch attribute at all, so  meant every beam was dead level by construction, not a calculation bug. Default changed to  (30°, the requested value), converted from degrees so it composes with the existing sin/cos tilt math unchanged; an operator who sets a real pitch on a camera in SweetHome still overrides it per-device exactly as before. HEADING (first-pass, flagged as such): planAngleToDir assumes angle=0 points along the plan's +Y, the usual SweetHome furniture convention — but that convention is a property of how the specific '71/CCTV.obj' catalog model was authored/imported, not something derivable from the angle number alone, and isn't something I can verify without rendering the actual scene. Ruled out the affine world-transform itself first: camera POSITIONS render correctly (proven independently, and confirmed live by the reporter — the mesh sits exactly where expected), and the position transform and the direction transform share the exact same planToWorld fit, so a transform-level bug would also misplace the cameras, which it doesn't. That isolates the fault to the model's own front-axis assumption. Applied CAMERA_MODEL_FRONT_OFFSET_RAD (180°, the single most common mismatch for this exact model-authoring pattern) to angle before planAngleToDir, added to every camera at once rather than needing a per-device fix. Verified the mechanics directly: the offset is an exact direction flip (unit-length preserved, opposite sign) against both a synthetic case and livingroom_cam's REAL angle value pulled from the villa's own .sh3d file. What is NOT independently verified is that 180° is the CORRECT offset for this specific model — that can only be confirmed by looking at the beam live against the known-correct camera facing. Documented plainly in both the code comment and the README: if the heading is still off after this ships, the fix is trying Math.PI/2 or -Math.PI/2 for that one constant, not touching the transform. Also updated the README's camera-beam section for the new pitch default and to explain the offset constant's role. Verified: 8 beam-math assertions against the real roomCalibration.ts module, full existing suite (25 fm + 9 cache + 10 diff + 5 yield + 91 security + 8 sw) still green, typecheck and build clean

---


## 2.35.86

### Changes
- Fix a service-worker bug that could turn a transient model-fetch failure into a load that never recovers, in the standalone/PWA build specifically. Reported after a fresh GLB upload, on the installed PWA: MODEL_LOAD_FAILED / 'Failed to fetch' at the fetch-model phase, with the 'Connection to the villa is unstable' retry screen not clearing. sw.js's modelCacheFirst had no error handling around its fetch(req) call — on a cache miss (guaranteed right after an upload, since the ?v=<etag> stamp changes) it awaited fetch() bare and handed the result straight to event.respondWith(). If that promise rejected, the rejection propagated through respondWith() as the PAGE's own network request failing, indistinguishable on the page side from a real outage, with the same generic TypeError: Failed to fetch already visible in the report. The app's own retry logic (fetchModelWithRetry) is sound — capped exponential backoff for a 2-minute budget before surfacing a real error — but every retry hit the SAME unguarded fetch(), so if the underlying cause recurred on each attempt, some retries could fail near-instantly (a synchronous SW-level throw, not a real timed-out request) rather than the graceful backoff the UI's 'reconnecting...' message implies. The client's own telemetry from the SAME device shows why this specific failure mode is plausible here beyond an ordinary network blip: context-lost climbing past 30 in one session, meaning the browser is aggressively tearing down and restarting the GPU context AND, by extension, is free to recycle the service worker itself mid-fetch under the same memory pressure — a documented browser behaviour, not a bug in this app, but one the old code had no defence against. Fix: modelCacheFirst now falls back to ANY previously cached copy of the same model path (even a stale ?v=) when the fresh fetch throws, turning a hard failure into a degraded-but-working load whenever one is available, and only reaches the network-failure path when there is genuinely nothing to fall back to — at which point it still rethrows, so the page's retry/error logic keeps seeing real failures rather than a silently swallowed one. Verified behaviourally against the actual sw.js source (not a re-typed mirror), mocking the Cache/fetch globals: cache hit skips the network entirely, a successful fetch still caches-and-prunes old versions exactly as before, a failed fetch with a stale entry available falls back to it instead of throwing, and a failed fetch with nothing cached still rethrows so the page is never left silently stuck. 8/8 assertions pass

---


## 2.35.85

### Changes
- Remove the coloured left-accent stripe from every Facility card — .fm-row, .fm-headline, .fm-cap all carried a saturated 3px colour bar down the left edge regardless of state (grey/green/amber/red), which read as templated: the exact 'obviously generated' tell of colour-coding every row the same way whether or not anything is actually wrong. Replaced with a quieter, more deliberate pattern used consistently across all three: a plain 1px hairline border normally, and — only for a state that actually needs attention — a faint full-card background tint (color-mix, ~6-7% of the status colour into the card background) plus a slightly tinted border, rather than a stripe. Severity now reads primarily from the elements that already carried it honestly: the status pill (.fm-badge, same family as a GitHub/Linear chip), the coloured check icon (.fm-check-icon), and the cap meter's coloured fill (.fm-cap-bar) — none of those changed, since a coloured badge/icon/progress-bar is a normal, deliberate UI pattern and was never what read as generated. .fm-headline (the Readiness tab's 'Not ready' banner) previously had NO icon at all and relied solely on the border stripe to carry its own state — since the stripe is gone, it now gets a coloured icon of its own (reusing the exact same CheckCircle2/AlertTriangle/XCircle set the checks below it use, via the same ICON map), so the headline and its checks read as one consistent system instead of two different ways of saying the same thing. Confirmed no coloured left-border-as-status pattern remains anywhere in the app — grep shows only unrelated 1px hairline dividers left. Verified: typecheck and build clean

---


## 2.35.84

### Changes
- Facility workspace UI/UX pass, seven fixes. FIXED HEIGHT: the modal resized visibly on every tab switch (Spend can be two rows, Faults a dozen); added .modal-fixed-height, a reusable modifier composing with the existing .settings-modal shell rather than a Facility-only hack, gated to desktop/tablet only (mobile's own full-screen-sheet behaviour is unaffected, deliberately). FAULTS/SPEND: fixed the offline-device chip that could select but never un-select (second click on the same chip now clears it); added DeviceSearchPicker, shared by both tabs, searching the villa's curated entityMap (not raw HA entities, which could run into the hundreds) with free text accepted for anything not in the list — a spare part, a device not yet in Home Assistant. FmTicket/FmCost gained deviceLabel, denormalized at entry time so a later rename or removal never blanks a past record. REPORT: replaced the raw <pre> Markdown dump with ReportPreview, a purpose-built renderer for the report's own small fixed grammar (headings/bold/tables/lists/hr) rather than a general Markdown library — verified against real buildMonthlyReport output, which caught a genuine pre-existing bug: schedule titles were never pipe-escaped in the standing-against-schedule table, unlike every other table in the file, so a title containing '|' silently split into extra columns; fixed alongside. Generation is now an explicit 'Generate report' button producing a snapshot (its own 'Generated:' timestamp means the moment someone asked, not whenever the component re-rendered); Copy Report removed as redundant with Download .md. SCHEDULE/TODAY: reordered Schedule before Report (what the report reads from belongs upstream of the annex summarising it); scheduleStatus now computes a target date even for a task that has never been completed, anchored on the schedule's createdAt (stamped automatically by addSchedule/seedDefaults) falling back to 'now' for schedules that predate the field — shown identically in both tabs via a new shared fmEngine.shortDate (moved out of fmReport.ts, which imports it back). Today gained per-card delete and a confirmed delete-all (removeAllSchedules, one atomic write); caught a real bug in my own first draft where the delete-all confirm button counted only ENABLED schedules (board.length) while the action deletes every schedule including paused ones — fixed to count against data.schedules.length so the confirm text matches what actually happens. READINESS: the 'All devices reporting' check's chip-wall replaced with a link to the same Unavailable-devices panel the HUD badge opens; the deeper fix is that HUD's own device-folding/debris-filtering logic (multi-entity combo sensors counted as one device, config debris excluded) was previously duplicated ad hoc in readiness.ts with neither folding nor filtering, so the two screens could disagree. Extracted to one shared config/deviceGroups.unavailableDeviceIds, used by both — verified with a real-module test asserting the two now report the exact same id set. Verified throughout against the REAL TypeScript modules via tsx (not hand-copied JS mirrors): 10 scheduleStatus/shortDate assertions, 7 DRY device-count assertions, 14 report-parser assertions against actual buildMonthlyReport output, plus the existing 91 security + 49 engine/cache/diff/yield suites, all green. README and DOCS.md updated to match actual current behaviour

---


## 2.35.83

### Changes
- Clarify the blank-PIN note in the README — the previous wording read as if a second, separate guest PIN needed adding, which is not the case and confused the owner. There is exactly one guest_pin, in the add-on options, alongside owner_pin and ops_pin. The point being made is narrower: config.yaml ships all three EMPTY, and empty means opposite things depending on the role. For owner and ops, no PIN makes the profile unavailable — auth_verify refuses it outright, so it fails closed. For guest, no PIN makes the profile open to anyone who reaches the URL, with no prompt at all, because a PIN-less guest is the deliberate 'just look around' mode. Since guest can unlock doors by design, that combination is worth stating plainly rather than leaving implied. Reworded as a Blank PIN row that contrasts the two behaviours and says outright that there is no second PIN to add. No behaviour change

---


## 2.35.82

### Changes
- Revert the un-PIN'd-guest restriction on lock/cover — the owner's call, and the right one. Guests unlock doors deliberately: a guest is the person staying in the villa, and permissions.ts puts access_control in their categories for exactly that reason. The guest profile is PIN-protected in this deployment, so the PIN is what authenticates them and a second gate on top of it buys nothing while risking the worst possible failure mode for a rental — a paying guest locked out of the house because a config field was blank. Note the restriction only ever applied when guest_pin was EMPTY, so a PIN'd install was never affected either way. What stays from the audit is everything that was an unambiguous bug rather than a policy opinion: the fail-open REST allowlist, the websocket default-deny that closes the execute_script bypass, server-side logout plus epoch revocation, owner/ops-only evidence photos, the per-client rate limiter that stops one caller locking everyone else out, HSTS, and the Report-Only CSP. The test suite now ASSERTS that a guest can call lock/unlock and cover/open_cover, so a future hardening pass cannot quietly take it away again — the behaviour is pinned as intended, not merely left un-blocked. README's access-control table corrected to match, and it now says plainly to set a guest_pin on any install reachable from outside the LAN, since that is the one configuration where the guest profile authenticates nobody

---


## 2.35.81

### Changes
- Security audit across the 7 requested domains, with fixes and a committed regression suite (tests/security_test.py, 93 assertions — every one of them a hole that was open). CRITICAL, authorization: _rest_call_allowed ended in 'return True'. It blocked only the paths someone had thought to name, and a path that merely LOOKED different sailed through — SERVICES/lock/unlock, ./services/lock/unlock, services//lock/unlock, services/../services/lock/unlock, and the %00 / ;a=b variants all reached Core from a guest session. The same hole passed ./template, which is arbitrary Jinja2 against the whole HA instance. Now refuses ambiguous tails outright, then allows only what the kiosk actually calls. CRITICAL, authorization: the websocket inspected only call_service and forwarded everything else untouched, but the browser is not a boundary — HA accepts execute_script, which runs a sequence of service actions, so a guest could wrap lock.unlock in one and step straight past the allowlist that branch exists to enforce. render_template and supervisor/api were equally open. Replaced with an allowlist of the seven frame types the client sends. HIGH, authentication: logout cleared sessionStorage and React state only and never told the server, so the signed cookie stayed valid for its full 30 days — the next person to open the browser was still authenticated at the role that had just 'left'. Added POST /auth/logout, plus /auth/logout-all which bumps a signing epoch to invalidate every outstanding session for a lost device. HIGH, authorization: evidence photos were readable by ANY session including guest, resting on ids being unguessable rather than on a decision; now owner/ops. MEDIUM, authentication: the brute-force limiter was keyed by ROLE ALONE and shared by all callers, so anyone could send five wrong PINs and lock the real owner out of their villa for five minutes, repeatedly. Now per client IP with a looser global backstop for distributed guessing, and pruned so it cannot be grown without limit. MEDIUM: an un-PIN'd guest profile authenticates nobody, so it may no longer call lock or cover — a PIN'd guest keeps it, since a paying guest must open the door they live behind. SUPPLY CHAIN: removed react-router-dom, clearing both advisories (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) by deleting the dependency rather than tracking versions — it served one static route and a self-redirect, with no useNavigate, no Link and no SSR, so neither CVE was reachable, but an unused dependency is pure supply-chain surface. npm audit now reports 0. HEADERS: added HSTS (safe unconditionally — browsers ignore it over plain HTTP, and TLS terminates upstream) and a Content-Security-Policy derived from what the app verifiably needs, shipped REPORT-ONLY because a wrong CSP bricks a kiosk someone must be physically present to recover; README documents how to promote it. Also: generic error text to callers with detail to the log. CLEAN: no hardcoded secrets, no SQL/NoSQL/ORM anywhere, no shell/eval, evidence and upload paths traversal-checked, source maps already off

---


## 2.35.80

### Changes
- HOTFIX my own v2.35.79 regression, plus the real memory leak. THE REGRESSION: yieldAndDiscount() awaited ITSELF instead of this.yieldFrame(), so loadModel recursed until the stack blew — MODEL_LOAD_FAILED / 'Maximum call stack size exceeded' at the import-mesh phase, on every load. I caused it with a scripted edit that rewrote 'await this.yieldFrame()' to 'await yieldAndDiscount()' across the whole method tail, including inside the helper I had just written, whose body contained that exact line. The field report proved it was not memory pressure: a fresh tab using 256MB of a 4396MB limit still failed instantly. Confirmed by reading the built bundle at the offset from the minified stack trace, and the fix is verified the same way rather than assumed. THE LEAK: rebuildLabels() called clearControls(), which only DETACHES controls — it disposes nothing. Every rebuild orphaned about five controls per entity (panel, badge, glyph Image, value wrapper, value text), roughly 420 on this villa, and each GUI Image carries its own backing canvas. Nothing referenced them but Babylon still held them, so they were never collected. Rebuilds are frequent: every indexMeshes and every repaintBadges, which until the entityMapDelta fix ran on each window focus. Telemetry showed a tab climbing 403MB to 1538MB over thirteen minutes of ordinary use, ending in a WebGL context loss (31 of them) and a failed load; the user confirmed 2.4GB in Chrome. Now disposes the previous control tree — Container.dispose() is recursive over children, and the child array is copied first because dispose() mutates it. Also guards rebuildLabels against a disposed engine: it is reachable from updateConfig on a React commit landing after a context loss, where 'new Image' threw 'Invalid engine. Unable to create a canvas' out of an unawaited promise

---


## 2.35.79

### Changes
- Fix a load that stalls in a background tab, and a model upload that can hang with no error. BACKGROUND-TAB STALL: loadModel yields between its heavy steps via requestAnimationFrame, and browsers do not fire rAF in a hidden tab — so the yield did not 'give the browser a frame', it STOPPED the load until someone looked at the tab again. A villa preloading in a background tab sat unfinished indefinitely. The Advanced Settings panel showed it plainly at post = 51533ms against a normal ~1600ms: that is not slow work, it is ~50s of nobody watching. yieldFrame now races rAF against a 32ms timer — when visible rAF still wins and the paint-before-the-next-step behaviour is unchanged; when hidden there is no paint to wait for, so the timer is the correct answer. This also silently corrupted our own measurements, because time parked in a yield was billed to whichever step ran next: every 'indexMeshes' number I have been reading included any stall before it, and the iPhone figures (1840-1990ms) are the most suspect since that device backgrounds most. Yields are now timed separately and reported as their own phase, and the telemetry panel flags a load that was parked rather than slow, so a hidden-tab load is never read as a regression again. UPLOAD HANG: postUploadRequest had no timeout, so a stalled chunk left the button reading 'Uploading...' forever with nothing logged and no way to tell a slow upload from a dead one — reported from the field with a GLB upload that never completed. Added a 120s per-chunk abort with a readable error (generous on purpose: an 8MB chunk to Bali can legitimately be slow, the timeout exists to surface a hang, not to police speed), plus real per-chunk progress so 'Uploading 67%' distinguishes in-flight from wedged. A 19MB GLB is three round trips and the UI previously showed nothing across all three. Verified: 5 yield/accounting assertions, 10 delta, 9 memoisation, 25 FM engine

---


## 2.35.78

### Changes
- Two real bugs found in the telemetry, one of them the cause of a long-standing 'sometimes I see a beam' report. FIRST: a same-content entityMap replacement was classified as STRUCTURAL and paid a full 1.3-1.8s indexMeshes. cosmeticOnlyDiff answered a boolean 'is this cosmetic?' and returned false when NOTHING had changed — correct for its own question, but the caller read false as 'structural'. That is not an edge case: DeviceConfigSync pulls the shared config on every window focus and parses fresh JSON, so a no-op replacement arrives every time the app is focused. Telemetry caught it directly — five full re-indexes in ninety seconds of idle use, two of them one second apart. Replaced with entityMapDelta returning identical | cosmetic | structural, so a no-op replacement now does no work at all. SECOND, and worse: indexMeshes disposes the camera beams at the top and never rebuilt them — only setCameraDirections built beams, and that runs once during post-load calibration. So the first re-index after load silently killed every beam for the rest of the session, which is exactly the reported symptom of a beam appearing at startup and never again. The debug log showed it plainly: '12 built' at 13:59:23, then 'NO BEAM MESH' for those same cameras two seconds later, right after a re-index. indexMeshes now rebuilds them; direction data survives on cameraDirections and byEntity has just been rebuilt, so the build has everything it needs. Note these two compounded: bug 1 made the re-index fire far more often than intended, which made bug 2 fire almost immediately in normal use. Also confirms the previous release's win with real numbers: desktop post-processing 2709ms median before, ~1740ms after (-36%). indexMeshes remains ~80% of what is left and is the next target. Docs: README gains the camera view-cone rule (mesh + authored rotation + motion sensor on), which was never written down despite being asked about. Verified: 10 delta-classification assertions, 9 memoisation assertions, 25 FM engine assertions

---


## 2.35.77

### Changes
- Load time: found and cut the dominant cost in the post-processing phase. Measured on the villa, 'post' (our own work) was 3363ms vs Babylon's own import at 1798ms — so the bottleneck was never the download (fetch was 248ms) or Draco. Root cause: light placement fires scene.pickWithRay once per fixture to find the surface below it, plus up to THREE more per strip for its light-pool spots — a few hundred casts, each a linear triangle scan because the baked villa's structure is a single ~1.43M-triangle mesh with no picking octree. All of it ran synchronously before the villa could be shown. Fix: all three call sites now funnel through one memoised surfaceBelow() probe. Bucketing is sound rather than convenient — every probe casts straight DOWN looking for a floor, floors are flat within a room, so two fixtures in the same room at the same ceiling height have the same answer by construction. Grid is room-scale in x/z (4m) and storey-scale in y (1m): measured against this villa's fixture layout that collapses ~220 probe calls to ~40 real rays (5.6x, ~319M -> ~57M triangle tests), where 2m only reached 2.6x and 8m starts merging genuinely separate rooms. The y term keeps storeys apart and also separates a lower terrace from an adjacent room. A boundary straddle costs one extra ray, never a wrong answer, since every bucket does its own real probe. Also added per-step timing of the post phase (pickIndex/indexMeshes/applyStructure/spawn), logged with ?debug and reported through telemetry with the slowest step surfaced in the panel — so the remaining time is attributable rather than guessed at, and so the same mistake isn't repeated on the next slow phase. Verified: 9 memoisation assertions, 25 FM engine assertions still green

---


## 2.35.76

### Changes
- Facility Manager workspace — Phase 1 + Phase 2. Extends the EXISTING ops role (already labelled 'Facility manager') with a new manageFacility capability held by ops and owner; guest never sees it. BACKEND: /fm-data store (schedules, completions, costs, tickets) reusing the shared JSON-store pattern with a PUT that admits ops as well as owner, plus /fm-evidence for photos — deliberately NOT chunked like the GLB upload since the client downscales to ~1600px JPEG (~200KB) first; JPEG magic-byte validated, ~18-month automatic pruning on the write path. ENGINES (pure + tested, 25 assertions): due/overdue with a proportional due-soon window so one threshold works for both a 3-day and a 365-day interval; monthly maintenance cap with a projection shown BEFORE an entry is saved, which is when the minor-vs-major decision is still open; resolution-time stats; LOCAL-time month keys so a Bali evening never lands in the previous UTC month; readiness derived entirely from live device state so it cannot be ticked off without being true; Markdown report builder. UI: one Facility modal — Today, Readiness, Faults, Spend, Report, Schedule. Storage is local rather than Google Drive on purpose: HA's Drive integration is backup-scoped with no add-on upload API, and a year of evidence is ~25MB, so local keeps evidence with its data and works when the uplink doesn't. Self-audit against the plan caught three gaps, now closed: schedule editing had NO UI despite the context exposing add/update/remove (and the README already claiming intervals were editable — that claim was false until this commit); there was no alerting outside the modal, so overdue work was only discoverable by going to look for it (now a red count on the HUD icon); and schedules could not bind to a room. Docs: README Facility Manager section, DOCS.md Facility workspace section with the /data file map

---


## 2.35.75

### Changes
- Telemetry panel: add 'Copy all' and 'Download .json' so the raw events can actually be shared. Exports the FULL event objects (not the condensed one-liners the table renders), since the point of exporting is to hand over everything including fields this UI doesn't happen to show. Copy uses the same clipboard-with-textarea-fallback ErrorReport already relies on, so it still works in an insecure context / locked-down kiosk / on iOS

---


## 2.35.74

### Changes
- iOS white-screen root cause + backend telemetry. (1) ROOT CAUSE of the iPhone 'switch to WhatsApp, come back, white unresponsive screen': SceneManager.handlePageHide disposed the whole scene whenever pagehide fired with persisted=false. On iOS that heuristic is simply wrong — Safari/WKWebView fires pagehide with persisted=FALSE when the app is merely backgrounded, then restores the SAME document on return without reloading, so React never remounts and nothing ever rebuilt the scene we just tore down; the canvas stayed dead until a force-quit. iOS reclaims GPU memory from a backgrounded tab itself (that's what the existing context-lost path handles), so the eager dispose bought nothing there. Now skipped on iOS, and a new handlePageShow safety net covers every platform: if the page is restored onto an already-disposed scene whose canvas is still in the DOM, reload once (one-shot guarded so it can never loop). The Chrome/HA-Ingress iframe case the dispose exists for is unaffected. (2) New telemetry backend: bounded 500-event ring in /data/telemetry.json via POST/GET /telemetry (POST open to any authorized session — a guest's failing iPhone is exactly the case worth capturing; GET owner-only since it carries other people's user-agents and error text). Client reports load phase timings, JS errors/unhandled rejections (wired into the existing captureError so nothing is duplicated), WebGL context loss/restore, and page-lifecycle transitions incl. the pagehide 'persisted' flag that misleads on iOS — sent via sendBeacon/keepalive so events fired AS the page is torn down still leave the device. New owner-only Device telemetry panel in Advanced Settings. Ring bounds verified (keeps newest 500, survives a corrupt file)

---


## 2.35.73

### Changes
- README: document the geometry budget (--max-object-faces / --max-entity-faces), why a villa GLB is ~92% geometry and only ~6% textures, the two runaway cases (cloth-sim curtains at ~248k faces per pose, plants at 20-70k per placed copy), which OBJ export files are actually needed, and how to verify an export wasn't truncated. Pipeline v2.11.0 (untracked sources/): entity meshes are now decimated too, on their own far more generous budget — they were exempt entirely, which let 8 multi-pose curtains take 10.97 MB of a 29.2 MB GLB (37.6%). Same helper called twice, no duplicated logic; measured curtain faces 5,957,292 -> 488,800 and GLB ~29.2 -> ~19.1 MB with the low-poly __open poses untouched

---


## 2.35.72

### Changes
- Pose-swap is now fully vocabulary-free and exception-free. App: VARIANT_VOCAB, coverVisualBucket and lockVisualBucket are DELETED — every entity type resolves its pose identically via desiredVariantWord() (the entity's own sanitised HA state), and the virtual 'half' word is available to EVERY type, not just cover: a numeric level attribute mid-range (current_position/brightness/percentage/volume_level, 15-85%) or a transitional state resolves to 'half', so cover.x__half and light.y__half work through the same code. WORD_RANK orders authored poses rest -> part-way -> active purely for the nearest-available fallback (it never gates which words are legal), and an unauthored/uncertain state (unavailable, unknown, a lock's jammed) resolves to the lowest-ranked pose — one rule replacing every previous per-type fail-safe. 'half' always gets a virtual slot in that ordering so a part-way device with only two authored poses falls to the active neighbour instead of collapsing to the rest pose. Verified against 25 cases incl. exact parity with the old cover-only bucket. Pipeline v2.10.0: matching rewrite — any domain can carry poses, and the single shadow-casting mesh per device is chosen by explicit rules (unsuffixed base mesh casts if present, else __open for cover / __off for anything else); 17 scripted cases. README rewritten for the one-rule model

---


## 2.35.71

### Changes
- Removed binary_sensor's special-cased open/closed pose vocabulary — it was a PURE rename (openingVisualBucket did nothing but state==='on'?'open':'closed', no derived data behind it, unlike cover's real current_position-derived 'half' or lock's fail-safe default), so every binary_sensor now uses the same generic state-is-the-pose-word path as switch/light/fan/etc: author __on/__off poses, not __open/__closed. Only cover and lock keep a fixed vocabulary now, both for a real reason. Also fixed a deeper bug this surfaced: indexMeshes' pose GROUPING was still gated on having a VARIANT_VOCAB entry for the type, so switch/light/fan/etc meshes were never grouped into meshVariants at all even after apply()'s DISPATCH logic was generalised last release — the two have to agree, and grouping is what actually decides whether a pose is recognised in the first place. Grouping is now purely suffix-presence-based for every type. Binary_sensor's pose-vs-pulse-tint check now asks 'is this mesh actually a registered pose for this entity' (meshVariants) instead of checking against the removed fixed word list — strictly more correct than the list it replaces. openingVisualBucket deleted from stateColors.ts (unused elsewhere)

---


## 2.35.70

### Changes
- Pose-swap (mesh variant) support is now UNIVERSAL, not opt-in per type — my previous pass only wired it into cover/lock/binary_sensor/sensor, missing exactly what a user was already trying to use it for: switch. apply()'s type dispatch is now cover/lock/opening-binary_sensor (named vocab) else the fully generic state-is-the-pose-word path (applyStateNamedVariant), for every current and future type — light, switch, fan, climate, media_player, camera, assist_satellite, input_boolean included. variantWordsFor's resolver (used by both the construction-time default pass and every live update) widened to match, so the two can't disagree for a type that previously fell through as unhandled

---


## 2.35.69

### Changes
- (1) Camera pose-swap generalised beyond binary_sensor door/window: any 'sensor' entity can now drive a mesh pose swap purely from its live state (sanitised the same way a mesh __suffix is parsed, no fixed vocabulary at all — author __<state> poses for any enum-like sensor), and a non-opening-class binary_sensor (motion/problem/smoke/presence/custom/none) can use __on/__off poses instead of being limited to door/window device_classes. Door/window classes keep their existing named open/closed translation unchanged. Shared variantWordsFor() resolver used by both the construction-time default pass and every live update so the two can never disagree. (2) Desktop camera panel: video feed now sits in its own non-overlapping region above a real (not absolutely-positioned-overlay) status+controls bar, via a new .camera-viewport wrapper — mobile is unaffected (same DOM, the desktop-only media query is what changes the layout)

---


## 2.35.68

### Changes
- (1) Scene tile now shows the CURRENTLY APPLIED scene, or 'Live' when the villa matches none — new sceneMatchesCurrent/activeSceneName in scenes.ts, which re-derives current state through the same callsForEntity() encoding a scene was captured with (so capture and compare cannot drift) with numeric tolerances for dimmer/thermostat round-trip. (2) New shared onOffSummary() gives every count tile one phrasing — AC now says 'All Off' like Lights beside it instead of a bare 'Off'; Pool/Lights/AC all route through it. (3) Narrow desktop windows: the brand chip's villa name wrapped over three lines and covered the floor switch because nothing degraded between full desktop and the 640px phone breakpoint — brand no longer wraps, and the bar now sheds one thing at a time (clock at 1180px, profile name + padding at 1000px, villa name at 860px). (4) Camera beam consistency bug: SceneManager's facing-direction loop required an entityMap entry typed 'camera', so a camera resolved purely by mesh name-inference silently got no direction, hence no beam, hence the room-glow fallback — it now also accepts the camera. entity_id domain. That is why the beam appeared only 'sometimes': it depended on whether the device had happened to be edited in Advanced Settings

---


## 2.35.67

### Changes
- Three top-bar fixes. (1) Inline +/- and (?) still showed on mobile: the real blocker was CSS ORDER, not the media query — the hide rule sat ABOVE '.icon-btn { display: flex }' at equal specificity (0,1,0), so display:flex won the cascade. Moved into the compact-bar block below .icon-btn and scoped through .hud-center so it outranks outright. (2) Badge count said 30 while the list showed 3 — two separate causes, both fixed: SummaryGroupPanel DROPPED any id with no live HA entity, so phantom devices (renamed/deleted in HA but still in the villa model, e.g. binary_sensor.door_network_contact) silently vanished from the list while still being counted; it now substitutes the same phantom stand-in the 3D badge layer uses, so a device faded on the map is guaranteed to appear in the list. And the count now ignores config debris — an entityMap key HA never heard of that ALSO has no map geometry is a leftover, not a broken device; a phantom that IS on the map still counts, which is exactly the door_network_contact case. Count and list are now built from one id set and cannot disagree. PHANTOM_ENTITY extracted from EntityVisuals into shared utils/phantomEntity.ts so both surfaces use one definition. (3) Count badge was clipped at the top: its parent .hud-group-scroll sets overflow-x:auto, which forces vertical clipping too, so the negatively-offset badge lost its top — now tucked fully inside the button bounds

---


## 2.35.66

### Changes
- Linked-entity switch lag: found the actual root cause. The switch rendered ONLY HA-confirmed state, so it could not move until the full round-trip completed INCLUDING the physical device's own confirmation — instant for a light (~100ms), genuinely seconds for something like an access-point LED whose integration calls its controller and polls back. Every previous attempt optimised the app's own render speed, which was already fast and was never the bottleneck; confirmed with the user that lights flip instantly while this device does not. Fix: new reusable useOptimisticToggle hook — paints intent on click, reconciles when real state matches, drops the override after a 10s timeout so a silently-failed call reverts to truth rather than lying, and resets when the panel's target entity changes. Distinct from the optimistic prediction reverted in ~v2.32.7-20: that predicted 3D mesh appearance with no bounded correction; this only overrides a DOM switch and self-corrects on every axis. Panel header ring reads the same optimistic value so ring and switch move together; the MAP badge deliberately stays on confirmed state only. State machine verified against 13 cases incl. the rapid double-toggle that broke the earlier attempt

---


## 2.35.65

### Changes
- Unavailable-devices button, 4 fixes. (1) Badge/list now count DEVICES not entities: candidate ids are the UNION of config.entityMap and mappedEntityIds (catches a mesh literally named after an entity_id that no longer exists in HA, so it never got a saved entityMap entry via an edit — exactly the reported binary_sensor.door_network_contact case), and multi-entity physical devices (e.g. a combo sensor's _temperature/_humidity pair) fold to one representative id via BOTH confirmed config.deviceGroups AND the existing suggestDeviceGroups name-pattern heuristic for pairs not yet formally grouped — verified against a scripted scenario covering all four cases (confirmed pair, unconfirmed pair, phantom mesh-only entity, disabled device excluded). (2) Fixed the '(?) shows twice on mobile' bug: .hud-cat-help's hide rule was width-only (max-width:640px) while the layout switch that reveals the overflow dropdown's OWN 'Map colours' entry also fires on short height (max-width:640px OR max-height:560px) — a device satisfying only the height half showed both. Unified to the same combined query. (3) Applied the identical fix to hide the inline label-size +/- on mobile (new .hud-labelsize-btn class) and added the same stepper as a non-closing row inside the overflow dropdown, always reachable there with no horizontal scroll needed

---


## 2.35.64

### Changes
- (1) New 'unavailable devices' button in the top HUD category row (next to the colour legend help, always visible incl. on mobile — an error indicator earns more visibility than a reference button, not less): a red count badge appears the instant something goes offline/unknown/unreported, tapping it opens the SAME room-grouped list SummaryBar tiles already use (reused via SummaryGroupPanel, new hideBulkToggle prop since 'turn all off' makes no sense for an offline-devices view). (2) Reinstated camera's distinct long-press target, but this time as the deliberate mirror of isQuickToggle's tap/long-press split rather than an ad-hoc type check: light/switch/fan's TAP is their quick action (instant toggle, no panel) and long-press reaches their compact panel; camera's TAP is ITS quick action (jump into the live feed) so long-press must explicitly ask PanelRouter for the compact panel (ActivePanel.detail) instead of resolving to the feed again. Every other type has no quick action distinct from its panel, so tap and long-press correctly still coincide there with no flag at all — documented at the one place (ActivePanel) so this isn't rediscovered as a mystery exception next time

---


## 2.35.63

### Changes
- Uniform long-press + linked-entity switch. (1) Removed the ActivePanel 'detail' flag and its PanelRouter branch entirely — long-press now opens the SAME panel a tap does, chosen purely by entity type, with GenericPanel's state+24h-history remaining the fallback for types that have no controls of their own. No per-type gesture branches left. (2) The camera-only long-press toggle is replaced by a linked-entity on/off switch resolved once in Dashboard and rendered by the shared BasePanel chrome, so EVERY device type gets it automatically whenever linkedEntityId is set; CameraPanel (the one panel that doesn't use BasePanel, being a fullscreen feed) reads the same context and shows it in its control cluster. Reuses the existing summary-entity-toggle switch rather than adding a second one. (3) Advanced Settings: Motion sensor is rendered only for camera entities instead of a dead '—' on every other type, and it now shares one line with Linked entity from tablet width up

---


## 2.35.62

### Changes
- Long-press latency: (1) ROOT CAUSE — long-press was only resolved on pointerUP, so holding gave zero feedback until release and the HA call didn't even start until you let go; TapRecognizer now fires it from its own hold timer the instant the 500ms threshold passes, mid-gesture, with double-fire and ghost-click both handled. (2) Every long-press now spawns the tap-acknowledgment ripple — it is plain DOM with no pointer-type gate, it was simply never spawned on this path, so a held mouse button gave no feedback on desktop at all. (3) Advanced Settings lag: generalised SceneManager's badgeColor-only fast path into a cosmetic-vs-structural entityMap diff (new pure, tested entityMapDiff.ts) — editing a label, room, category, linked/motion entity or light intensity now does a cheap badge repaint instead of a multi-second full mesh re-index; EntityVisuals rebuilds the link indexes itself so the ring/beam stay correct without that pass. (4) Fixed a perf regression from v2.35.61: DeviceConfigSync re-serialised the whole entityMap on every render (i.e. every keystroke) — the slice and its JSON are now memoised and compared as cached strings

---


## 2.35.61

### Changes
- Device configuration is now stored CENTRALLY by the add-on (/data/device-config.json, new GET/PUT /device-config endpoint) instead of per-browser localStorage, so entity/mesh bindings, per-device metadata (label, room, type, category, linked + motion entity, badge colour, disabled), rooms and device groups configured on one client apply to every client — same model as the shared GLB and scenes. DRY: the scenes store's read/write/handler code was factored into one _read_json_store/_write_json_store/_json_store_handlers trio now serving both stores; the shared-vs-per-device field split lives in one SHARED_CONFIG_KEYS list (render quality, theme, eyeHeight/walkSpeed, badgeStyle and other look/feel prefs stay per-device on purpose). Safe by construction: pushes only ever happen after the first pull completes (so a client's freshly auto-detected entityMap can't wipe the owner's edits), only when the slice genuinely changed (no pull/push round-trip loop), and only for the owner role (server 403s the rest)

---


## 2.35.60

### Changes
- On mobile (<=720px), the bottom tile bar now anchors flush to the left, right next to the view-controls corner, and grows rightward to use the rest of the screen width — replacing the symmetric 80px-each-side centering that wasted the whole right side as empty space while still clipping the first tile against the (now pointless, since nothing sits there on mobile) left gutter

---


## 2.35.59

### Changes
- Camera motion: split the merged link field back into two with distinct, non-overlapping roles — 'Linked entity' (any type, user-toggled: drives the red badge ring, and is the long-press toggle target on a camera) and a camera-only read-only 'Motion sensor' (drives the map's detection beam / room glow). Refactor + cleanup: the two indexes were both keyed off the SAME field and built by two near-identical functions (now one shared buildLinkIndex helper); motionActiveCameras was dead code (badgeKind's generic linkActiveIds check returned first, so the camera-specific branch could never fire) and is removed; renamed stale applyLightLinkRouting/buildLightLinkIndex/lightLinkAlert. Camera panel's status timeline now reads the motion sensor (what detected) rather than the control link (whether armed). One-time migration moves an upgraded camera's binary_sensor out of linkedEntityId back into motionEntityId

---


## 2.35.58

### Changes
- Fixed the camera feed's status bar collapsing to a tiny square instead of a bar on real devices — its StateTimeline child is a plain 100%-width block, and nesting it inside another flex context (.camera-status-bar) left it with no definite size to resolve that percentage against. Also redesigned the mobile (<=720px) layout: the status bar now stacks on its own full-width row above the control buttons instead of squeezed into a shared row with them

---


## 2.35.57

### Changes
- SummaryBar (bottom tile row) now reserves an 80px gutter on each side so its own width caps before reaching the bottom-left view-controls corner (bird's-eye/default-view icons), instead of relying on z-index alone to keep them clickable while visually overlapping the tiles underneath on a narrow phone

---


## 2.35.56

### Changes
- (1) Map colours (Legend) modal now uses the standard 780px modal width, same shell as Settings/Config Editor, instead of a one-off narrow card; (2) EntityMapping.motionEntityId is fully merged into linkedEntityId — one 'additional entity' field per device everywhere (UI + backend), with a one-time migration so already-configured cameras keep their motion sensor; only camera long-press toggles it (reverted for binary_sensor, which keeps opening its detail panel like every other type); (3) fixed the Config Editor's 'Linked entity' picker painting two nested grey boxes (a table-wide input rule was outranking the search-pill's own transparent background); (4) root-caused why newly added light assets never got the LED-strip transparent/glow treatment even after the previous fix — the mesh material logic only ever ran from a live HA state event, so an entity that had never once received one stayed at its opaque construction-time default forever; replayed against cached-or-phantom state on every rebuild so a light's first paint is already correct, mirroring the earlier badge-label phantom-entity fix

---


## 2.35.55

### Changes
- (1) SummaryBar lock tile label shortened to generic 'Door Lock'; (2) bird's-eye/default-view buttons moved out of the bottom bar (always visible, standalone), bottom-bar z-index fixed so they're never hidden behind it on phone; (3) Settings' day/night invert button now matches the theme selector's height; (4) camera feed's bottom status bar resized to match the control-button row's height/offset and span 75% of the space left of it, instead of a full-bleed edge strip; (5) EntityMapping.linkedEntityId: a generic per-device linked-entity field (any type) that rings the badge red wherever it's on, plus a long-press toggle specifically on camera/binary_sensor (their own state usually isn't toggleable); (6) SummaryGroupPanel's Turn all on/off now requires a confirm tap before firing; (7) every light fixture mesh — not just marker spheres/inflated strips — now fades translucent when off like an LED strip, so newly added light assets get this automatically with no per-fixture setup

---


## 2.35.54

### Changes
- camera panel: (bottom status bar) a thin full-width strip pinned to the screen edge shows this camera's last 24h as one composite timeline -- green while online, red the instant its linked motion sensor (Advanced Settings) trips, black across any real online/offline gap -- via a new mergeStateHistories() utility feeding the SAME StateTimeline component every other panel's history chart already uses, not a bespoke chart

---


## 2.35.53

### Changes
- bottom-bar group modals: move 'Turn all on/off' into the header (next to close, like Settings' theme buttons) instead of the body; group entities by ROOM within both the on-map and not-on-map sections; hide the not-on-map section entirely for the Guest role. Add BasePanel headerActions slot (reusable by any panel) and a badge.alertRing flag (red ring on the panel header icon, mirrors the map's badge outline) -- wired for a camera whose linked motion sensor is currently on

---


## 2.35.52

### Changes
- fix ugly entity labels for devices ON the map: an auto-bound mesh->entity mapping sometimes got created before HA's friendly_name had arrived, permanently storing the raw all-lowercase entity_id slug as the label (e.g. 'master bedroom master bedroom light ceiling center', doubled because the villa's HA integration names some devices <area>_<area>_<domain>_<fixture>) -- indistinguishable afterward from a real user customisation. New displayLabelFor() (EntityMap.ts) is the one place every display surface now resolves a name: a real stored label always wins, but an untouched raw-fallback label is upgraded live to the current friendly_name, or a properly Title-Cased + deduped version of the id. Applied to the bottom-bar group modal, every device panel title (PanelRouter, centrally), the device-group panel, the motion toast, the SummaryBar tile labels, and Advanced Settings' device-grouping list -- the Label EDIT FIELD itself is untouched, still showing/editing the raw stored value

---


## 2.35.51

### Changes
- move Invert day/night from a labelled checkbox row (deep in Render quality & look) to a single active/inactive icon button in the Settings header, right next to the theme selector (SunMoon icon) -- same baked-villa-only gating preserved

---


## 2.35.50

### Changes
- fix modal navigation: drilling from the group modal (bottom-bar tile) into a row's own detail panel no longer closes the group behind it -- it stays mounted, so closing the detail panel reveals the group again instead of slamming back to the bare villa map. Both share the same .modal-backdrop z-index, so this relies on nothing but DOM render order (SummaryBar mounts before the entity panel block in Dashboard) -- no extra 'return to parent' state needed

---


## 2.35.49

### Changes
- camera fullscreen viewer: move prev/next/fullscreen/close/zoom-reset controls to a bottom-right cluster (easier one-handed thumb reach, title stays top-left, the two can never overlap now), enlarge the buttons (56px vs the app's standard 48px, bigger icons), and add swipe-left/right on the feed itself to cycle cameras (gated on not-zoomed, so it coexists with pinch/pan without stealing those gestures)

---


## 2.35.48

### Changes
- camera fullscreen viewer: title and controls (prev/next/fullscreen/close/zoom-reset) now share one flex header instead of each button individually absolute-positioned at a hand-tuned pixel offset. On mobile (<=640px) the header stacks into two rows -- title above, controls below, wrapping if needed -- so a long camera title no longer draws underneath the button row

---


## 2.35.47

### Changes
- panel header badge (the small icon next to a device's title/room/entity_id) now fades for an unavailable device too, matching both its map badge and the status pill right below it — it previously always rendered full-strength regardless of live state, the actual 'no status icon' gap. Same fix applied to the group-modal's per-row badges (SummaryGroupPanel). Clarify in the (?) legend that the map's fade keeps the device's own category colour (no separate 'unavailable colour' the way the panel pill has amber) — a different, simpler vocabulary by design

---


## 2.35.46

### Changes
- revert the grey desaturation for UNAVAILABLE badges — keep the category's own baseline colour, only alpha changes. The desaturation was a workaround for what turned out to be a different bug (v2.35.45's phantom-entity fix: updateLabel never ran at all for an entity_id absent from HA), not evidence that alpha-only dimming was visually too weak

---


## 2.35.45

### Changes
- found the real bug: an entity_id bound to a mesh but that NEVER exists in Home Assistant (e.g. a stale/misconfigured binding) never receives a single live state event, so apply()/updateLabel() — the ONLY place the unavailable dim/desaturate logic lives — was simply never called for it. Its badge sat frozen at the constructor's plain full-colour default forever, indistinguishable from a healthy device. rebuildLabels now falls back to a synthetic 'unavailable' stub entity for any badge with no cached state, routing it through the exact same dim treatment a real HA-lost-contact device gets (mirrors isUnavailable()'s own 'no entity = unavailable' convention)

---


## 2.35.44

### Changes
- UNAVAILABLE badge: after 3 independent code traces confirmed the alpha-baking logic was firing correctly, switch the visual treatment itself — alpha alone blends toward whatever's BEHIND the badge, so a vivid gradient at 40% alpha over a bright/warm 3D scene can still read as fully coloured (background-dependent, easy to miss). Now DESATURATES the gradient toward grey (70%) on top of the alpha cut, the standard disabled-UI convention, so it reads unambiguously regardless of scene lighting

---


## 2.35.43

### Changes
- make the UNAVAILABLE badge fade robust: bake the dim directly into the glyph's own pixel alpha (canvas globalAlpha at draw time) instead of relying on the Babylon GUI Control.alpha parent->child cascade, which only propagates when both explicitly set their own alpha (an internal Babylon behaviour) and produced a fully opaque, undimmed badge in at least one confirmed case. A baked-in-pixels fade can't fail to render

---


## 2.35.42

### Changes
- categorize door/window/garage contact sensors (binary_sensor device_class door/window/opening/garage_door, or id hints) as access_control instead of falling through to the pale 'others' default — that's what made the UNAVAILABLE badge dim look like nothing changed: an already near-colourless badge going 50% pale reads as no fade at all. Reuses OPENING_DEVICE_CLASSES (the same set the door pose-swap gate trusts) instead of a second list

---


## 2.35.41

### Changes
- motion toast now sits in the villa-map layer (below the fullscreen camera) instead of drawing over a live feed; FIX the unavailable badge fade — alpha was only set on the transparent badge rect, but Babylon GUI doesn't cascade it, so the glyph/pill stayed opaque and an offline device rendered full-strength (contradicting the legend); drop the redundant paragraph under the UNAVAILABLE pill and route AC/Cover/Lock through the one shared UnavailableNotice

---


## 2.35.40

### Changes
- (1) motion alerts: a brief toast names the room + device the moment any motion/presence sensor trips (off->on edges only), and a camera whose linked motion sensor is firing now shows the shared red alert ring on its map badge

---


## 2.35.39

### Changes
- (7) one shared SWITCH_PURPOSE_HINTS table now decides BOTH a generic switch's category (colour) and its badge glyph, so a pool/light/lock relay can no longer show a lightbulb icon on a grey 'others' badge — they were resolved separately and drifted

---


## 2.35.38

### Changes
- (9) unify HUD section glass: brand/clock, category row, floor stack and bottom bar now share the profile chip's lighter --chip-bg; the standalone view buttons get a shared .hud-stack section; move the colour-legend (?) into the category row behind a separator (desktop/tablet only); legend modal now describes the REAL map badge outline (red ring active/alerting, no ring off, dimmed unavailable) separately from the panel status pill, and 'Got it' becomes 'Close'

---


## 2.35.37

### Changes
- (2) prev/next camera buttons in the fullscreen viewer, cycling all cameras without closing; (3) zoom/pan now clamps to the video's actual painted area (object-fit contain) measured untransformed, so you can no longer pan into the letterbox bars; (4) long-press on a camera opens the shared detail/Edit panel (GenericPanel) like every other entity instead of repeating the tap

---


## 2.35.36

### Changes
- (5) group modal now uses the Settings width (780px) with a 2-column device grid, collapsing to 1 on phones; (6) DeviceGroupPanel reuses the shared UnavailableNotice/status-pill instead of its own 'Unavailable' text; (8) placeholder light markers (bulbs/spots) fade out when off, same as inflated LED strips

---


## 2.35.35

### Changes
- move the view-mode + default-view buttons into the bottom bar's left section (separated by a hairline) when it's shown — extracted to a shared ViewControls component so HUD and SummaryBar use ONE implementation; group modal keeps the standard panel width (columns fit inside it)

---


## 2.35.34

### Changes
- badge + modal fixes: card style now applies even to never-reported/unavailable entities; icon stroke is proportional (lucide line style, no longer bold on the smaller card icon); tighter card top/bottom padding; switch icons resolve by device_class/name instead of one generic power glyph (shared iconKeyFor, fixes every surface); group modal gets a responsive 2-3 column grid, a pinned header (same flex layout as Settings - fixes ALL panels), and lists HA-only devices last under a tinted 'Not on the map' section

---


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
