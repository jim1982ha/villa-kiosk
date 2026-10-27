# Decided: do not re-propose

Questions the owner has closed. Do not raise them again unless the owner does, or new evidence changes the facts the
decision rested on (and then say so before any work).

## Branches retired

Only `main`, `dev2` and `agent-dev` exist. The former `dev` and `ai` branches, the AI layer and their store channels
were deleted on 2026-09-26 at the owner's request. Do not propose, restore or cite them.

## The model's look is accepted

The grey, soft look of the 3D model is accepted (2026-09-13: "I can live with it"). The model is lightmapped, so
environment, sky, HDRI or IBL work cannot change it: the loader switches the environment off on baked materials, on
purpose (the bake already holds the ambient light). Realism is a property of the bake and the source assets.

## KTX2 textures are closed

Baking KTX2 textures was measured by the owner: about +500% model size with no visible loading gain. Do not raise it,
and a "compressed textures: 0" telemetry figure is not a reason to.

## Ceilings: the main behaviour stays

Every ceiling shows while walking and hides in the overview. A rule showing a ceiling only while one is above the eye
was reverted by the owner (2026-10-08). For a roof outdoors, the answer is the plan's own per-room "Display ceiling".

## Badge placement determinism stays

The placement fix that applies each round's room chips after every bucket is judged stays. It is the price of a result
that does not depend on input order, not a defect. Do not revert it.

## Nothing on the map overlaps

No badge, card or room chip is drawn over another, whatever the pose, zoom or tapped room (owner, 2026-10-27: badges
overlapping "whereas we already stated that this shall never be the case"). The `?debug=place` check counts every
overlap as a failure; a category it may skip is listed in its `ALLOWED_FINDINGS` with one of these entries, and only
the owner adds one.

**Why:** comments called overlaps the "accepted cost" of grouping on contact; the owner never accepted them, and two
fixes (2.496.552-553) followed.

## Badges group only when they touch

Badges merge into a card, and a room into its chip, only when their drawn boxes meet: no safety margin, no floor on
the distance between centres (2.413.0, 2026-08-17; owner, 2026-10-14: "a room chip shall only appear when there is
entity overlap"). Grouping on contact is the rule; an overlap is still a failure (the entry above).

## Badges behind a wall hide while walking

In the walking view a badge whose device stands behind a wall is hidden (owner, 2026-10-08: badges "from non visible
entity in the FPS view standpoint are still appearing … globally fix it"). The `?debug=place` check counts them apart
(`byWall`) and allows them.

## Sun and moon placement

The sun and moon follow the real clock on one placement rule; the preview of day or night only changes lights and
colours. Rejected for good: turning a body seen on the viewer's side over to the far side (the sun changed side as the
camera turned; the owner wants consistency when the camera moves) and placing bodies round the screen outline by
camera heading.

## The ~1.2 s freeze is not ours

The occasional ~1.2 s freeze was measured with no app code running during it (garbage collection, compositing or the
driver). Do not reopen it without a new mechanism.

## Intercom calling declined

Calling the door intercom from Telegram was studied and declined (2026-10-02: "it's not worth it, forget about it").
The doorbell automation (snapshot and gate unlock) stays as is.

## Agent sub-agents parked

The Agent uses no SDK sub-agents. Costs showed the gain would be a few tens of cents a month; do not re-propose without
new cost figures. Start only when the owner asks.

## Asleep devices: one list, the Kiosk's

Devices unavailable by design (battery devices that sleep between reports) are one list kept in the Kiosk's Advanced
Settings. The Agent reads it from the Kiosk's heartbeat answer and never keeps an editable copy.

**Why:** owner, 2026-10-21: "the KIOSK will be always here and the agent might not always be configured … a list at a
unique place, and all of the consumers can see it".

## The bake's job table is the owner's

The model bake pipeline (on the owner's machine, not in the repository) keeps its jobs in its own `_BAKE_JOBS` table:
the single source of truth, the owner's tuned configuration. Never reset it, never move it to a sidecar file.

## Automation descriptions stay as written

Blueprint descriptions are short; the long descriptions of the automations built on them stay as they are (owner,
2026-10-20: "no need to change them").
