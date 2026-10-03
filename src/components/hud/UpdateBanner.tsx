// src/components/hud/UpdateBanner.tsx
// "A new version is ready" — the installed app's update notice (2.496.256).
//
// The installed app now opens from its saved copy (public/sw.js), so a new
// build is downloaded in the background and used from the next start. When it
// finishes downloading while the app is open, this says so and switches on a
// tap (utils/swUpdate.applyUpdate: the new worker takes over, the page
// reloads). Never shown under Home Assistant, where no service worker runs, and
// never shown for the very first install, which is not an update.

import { useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { applyUpdate, subscribeUpdate, updateReady } from "@/utils/swUpdate";

export default function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  if (!ready) return null;
  return (
    <button type="button" className="update-banner" onClick={applyUpdate} aria-live="polite">
      <RefreshCw size={16} />
      <span>A new version of VESTA is ready — tap to reload</span>
    </button>
  );
}
