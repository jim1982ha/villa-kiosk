# Villa Kiosk

A first-person 3D walkthrough of your villa, wired live to Home Assistant. Open
it right in the HA sidebar through Ingress, **or** on the add-on's own hostname
(direct / Cloudflare Tunnel) as a full-screen, installable PWA with none of the
Home Assistant UI around it — same single app either way.

## Install

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add
   `https://github.com/jim1982ha/villa-kiosk`.
2. The **Villa Kiosk** add-on appears in the store. Open it → **Install**
   (it pulls a prebuilt image — no on-device build).
3. Enable **Start on boot** + **Watchdog**, then **Start**.
4. Click **Villa Kiosk** in the sidebar (or *Open Web UI*).

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

## Notes

- Requires **Home Assistant OS** or **Supervised** (add-ons need the Supervisor).
- Ingress fronts the *UI*; Core access uses the Supervisor proxy (`homeassistant_api`).
- The 3D model lives in the add-on's private `/data` volume — the add-on no
  longer needs write access to your HA config folder.
