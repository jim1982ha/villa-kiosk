# Vesta Kiosk

A first-person 3D walkthrough of your villa, wired live to Home Assistant. Open
it right in the HA sidebar through Ingress, **or** on the add-on's own hostname
(direct / Cloudflare Tunnel) as a full-screen, installable PWA with none of the
Home Assistant UI around it — same single app either way.

## Install

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add
   `https://github.com/jim1982ha/villa-kiosk`.
2. The **Vesta Kiosk** add-on appears in the store. Open it → **Install**
   (it pulls a prebuilt image — no on-device build).
3. Enable **Start on boot** + **Watchdog**, then **Start**.
4. Click **Vesta Kiosk** in the sidebar (or *Open Web UI*).

## First run

There's no onboarding at all — **no URL, no token, nothing to enter or click
through**. As an add-on the kiosk connects to Home Assistant automatically
(see *How it connects*) and the villa's location silently adopts your Home
Assistant instance's own coordinates.

The one thing every kiosk needs is a 3D model, set up **once, centrally**, not
per device:

1. Export your villa's SweetHome 3D plan to a `.glb` (+ its `.rooms.json`
   room-data sidecar) — see [MODEL_PIPELINE.md](../MODEL_PIPELINE.md).
2. **Advanced Settings → 3D model source → Upload central GLB** (and
   **Upload room data**), from the **Owner** profile. This writes the files
   into the add-on's own private `/data` store — no SSH/Samba, no path to
   configure, and nothing placed in Home Assistant's `www/` folder.
3. Every kiosk that opens the add-on afterward loads that same file
   automatically. Re-uploading later reloads every open kiosk on its next open.

> Per-device settings (device↔room bindings, room viewpoints, device icons,
> render/UI preferences) live in that device's own browser. To copy a
> configured device's setup to another, use **Advanced Settings → Export
> Configuration** then **Import Configuration** on the other device.

## How it connects

The add-on reaches Home Assistant through the **Supervisor API proxy** using its
own `SUPERVISOR_TOKEN` — so you never create or paste a long-lived token, and the
token never reaches the browser. A small bundled proxy injects it server-side for
both the WebSocket and REST calls. The dashboard title also auto-fills from your
HA instance name (override it in **Settings → Dashboard title**).

## Day-to-day use

Three profiles are available at sign-in — **Guest** (comfort control: lights,
AC, doors, music, a narrower climate range, no cameras or config), **Owner**
(everything, plus config and model administration), and **Facility manager**
(everything, plus the Facility workspace below, but not config administration)
— each optionally protected by its own PIN, verified server-side.

Tapping a light/switch/fan on the 3D map toggles it instantly; long-pressing
any device (or a plain tap on a cover, thermostat, camera, sensor or media
player) opens its full control panel. Long-pressing a floor button opens a
radial dial of that floor's rooms to fly to. The alert icon in the top bar
opens **Cockpit** — a villa-wide status report: what needs attention (offline
devices, open faults, overdue maintenance, alarm-state sensors), a room/floor/
category breakdown of every device, today's energy use, and recent activity
from Home Assistant's own Logbook. Any `scene.*` you've created in Home
Assistant's own Scene Editor appears automatically in the bottom dock's Scene
tile — there's no separate kiosk-side scene system to keep in sync. A device
that reports as more than one HA entity (e.g. a combo temperature/humidity
sensor) can be folded into a single map badge from **Advanced Settings →
Grouped devices**.

## Opening it outside the HA sidebar (optional)

The add-on also publishes itself on host port **8099**, so you can reach the
kiosk on its own hostname — e.g. a **Cloudflare Tunnel** pointing at
`http://<HA-host-ip>:8099` — and install it as a PWA. Profile passcodes
(`guest_pin` / `owner_pin` / `ops_pin` in the add-on options) become the real
gate here: a correct one mints a signed, httpOnly session cookie server-side,
and Home-Assistant control (`/core`) plus the villa floor plan (`/model`) refuse
any direct request without it. Requests coming in through the HA sidebar
(Ingress) skip the cookie — Home Assistant has already authenticated them.

Set at least one passcode before exposing the port, and for defence-in-depth put
**Cloudflare Access** (or equivalent) in front of the hostname. To keep the
kiosk sidebar-only, just leave port 8099 unmapped in the add-on's **Network**
panel.

### Faster first load with `public_model_access` (optional)

By default the villa floor plan can't even start downloading until *after*
you sign in — the "Villa Loading" spinner's real cost is Babylon decoding it
(several seconds for a large villa), and that can only run once the app is
authenticated, so a slow first load stays slow no matter how long you wait on
the PIN screen.

If you already put **Cloudflare Access** (or equivalent) in front of the
hostname — so nobody unauthenticated ever reaches this add-on at all — you can
enable **`public_model_access`** in the add-on options to let the kiosk start
downloading *and decoding* the model the moment the profile-select screen
appears, well before you pick a profile or enter a PIN. This measurably
shortens the spinner, since the multi-second decode now overlaps with the time
you spend on that screen instead of starting after it.

**Only enable this if something else already gates the hostname.** It makes
the villa's 3D floor plan (not Home Assistant control, and not the PINs
themselves — those stay fully gated either way) downloadable by anyone who
reaches the hostname directly, with no PIN at all. Meaningless (and
unnecessary) for Ingress, which is already auto-trusted, and irrelevant if you
never expose port 8099.

## Facility workspace

The **Owner** and **Facility manager** profiles get a clipboard icon in the top
bar that opens a maintenance workspace, six tabs in the operator's own order of
business: Today, Readiness, Faults, Spend, Schedule, Report. It opens at a
fixed height on desktop/tablet, so switching between a two-row tab and a
dozen-row one doesn't resize the dialog around you.

Everything it records lives in the add-on's own `/data` volume, so every device
that opens the kiosk sees the same record:

| File | What it holds |
|---|---|
| `/data/fm-data.json` | Maintenance schedule, completions, spend entries, faults |
| `/data/fm-evidence/` | Photo evidence, downscaled in the browser before upload, pruned after ~18 months |

The maintenance schedule starts completely empty — nothing is pre-filled for
any villa. Add each task from the **Schedule** tab: a title, an interval
(pick a preset like "twice a month" or enter raw days — anything that isn't a
whole number of days rounds down, so a genuinely late task never reads as
compliant), an optional room, and an optional contract-clause reference. Every
task shows the target date its interval implies (from its last completion, or
from when the task was created if it's never been done) — the same date shown
next to each card on the **Today** board. A task can be paused, edited, or
removed individually, or all at once (with a confirm step) from the Today tab;
removing a task keeps whatever completions were already logged against it.

**Faults** and **Spend** entries can be tied to a specific device: search
across every configured device, or type a description freehand if it isn't in
the list (a spare part, something not yet in Home Assistant). The device stays
attached to the record even if it's later renamed or removed.

**Report** builds the monthly operational annex on demand — press **Generate
report** to snapshot the villa's current Readiness/Faults/Spend/Schedule
status into a formatted preview. Press it again for a fresh snapshot; changing
the period clears the previous one so a stale month never lingers on screen.
**Download .md** saves the underlying Markdown unchanged, for pasting into an
email or archiving.

**Readiness**'s "All devices reporting" check links straight to the same
Unavailable-devices list the HUD's own alert badge opens — one shared count,
so the two can never disagree.

The **Guest** profile has no access to any of this.

---

## Notes

- Requires **Home Assistant OS** or **Supervised** (add-ons need the Supervisor).
- Ingress fronts the *UI*; Core access uses the Supervisor proxy (`homeassistant_api`).
- The 3D model lives in the add-on's private `/data` volume — the add-on no
  longer needs write access to your HA config folder.
- The kiosk **auto-reloads once a day, around 04:00 local device time**, if
  idle (no panel/settings open, no interaction in the last 5 minutes) — a
  safety net against slow long-running memory drift, common in any
  browser tab running a complex WebGL scene for days/weeks unattended. It
  silently retries every minute within that hour until it's actually idle,
  and skips entirely on a day it never finds a safe moment. No re-login is
  needed afterward (the signed-in profile survives the reload).
