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

Onboarding runs once in the browser. **No URL and no token to enter** — as an
add-on the kiosk connects to Home Assistant automatically (see *How it connects*):

1. **Upload model** — pick your villa `.glb`. Stored in the browser (IndexedDB).
2. **Room names** *(optional)* — Settings → upload the SweetHome `.sh3d` to label
   rooms automatically.
3. **Location** — pre-filled from your Home Assistant instance; adjust if needed.

> Config and the uploaded model live in the **browser**, per device. To copy a
> set-up device to another, use **Settings → Export backup** then **Import
> backup** on the other device.

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
