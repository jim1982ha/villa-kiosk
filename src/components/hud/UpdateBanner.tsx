// src/components/hud/UpdateBanner.tsx
// "A new version is ready" — the installed app's update notice (2.496.256).
//
// The installed app now opens from its saved copy (public/sw.js), so a new build is downloaded in the background and
// used from the next start. When it finishes downloading while the app is open, this says so and switches on a tap
// (utils/swUpdate.applyUpdate: the new worker takes over, the page reloads). Never shown inside the villa's system,
// where no service worker runs, and never for the very first install. Drawn as every notice is (Notice).

import { useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { applyUpdate, subscribeUpdate, updateReady } from "@/utils/swUpdate";
import { NoticeView } from "./Notice";

export default function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  if (!ready) return null;
  return (
    <NoticeView tone="info" icon={<RefreshCw size={16} />} onTap={applyUpdate}>
      A new version of VESTA is ready — tap to reload
    </NoticeView>
  );
}
