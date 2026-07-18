# Villa Kiosk

A first-person 3D walkthrough of your villa, wired live to Home Assistant, shown
right in the HA sidebar through Ingress.

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
   **Upload room data**). This writes the files into Home Assistant's own
   `www/` folder via the add-on — no SSH/Samba needed.
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

## Notes

- Requires **Home Assistant OS** or **Supervised** (add-ons need the Supervisor).
- Ingress fronts the *UI*; Core access uses the Supervisor proxy (`homeassistant_api`).
- nginx only accepts the Ingress gateway (`172.30.32.2`); direct port access is
  denied by design.
