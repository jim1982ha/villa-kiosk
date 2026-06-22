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

Onboarding runs once in the browser:

1. **Connect HA** — paste your HA URL (`http://<ip>:8123`) and a long-lived
   access token (Profile → Security → Long-lived access tokens → Create).
2. **Upload model** — pick your villa `.glb`. Stored in the browser (IndexedDB).
3. **Room names** *(optional)* — Settings → upload the SweetHome `.sh3d` to label
   rooms automatically.
4. **Location** — confirm coordinates for the day/night sun.

> Config and the uploaded model live in the **browser**, per device. To copy a
> set-up device to another, use **Settings → Export backup** then **Import
> backup** on the other device.

## Notes

- Requires **Home Assistant OS** or **Supervised** (add-ons need the Supervisor).
- Ingress fronts the *UI*; the app talks to HA with the URL + token you enter.
- nginx only accepts the Ingress gateway (`172.30.32.2`); direct port access is
  denied by design.
