// src/agent/RoomShare.tsx
// Headless. Shares the rooms THIS device resolved for the villa's devices with
// the add-on, where the agent's villa model uses them for any device Home
// Assistant has no area for.
//
// ⚠️ ONE OWNER OF THE RULE. "Which room is this device in" is resolveEntityRoom
// (config/devicePlace.ts): Home Assistant's area, else which drawn room the
// device's 3D anchor sits in. The second half exists only in a browser with
// the scene loaded — the add-on has no 3D model to ask — so the add-on does not
// re-derive it; it is told the answer the Kiosk already shows.
//
// Mounted only while the agent is configured and the profile may see it
// (AgentProvider), so an install without the agent never writes this store.
// Written when the answer CHANGES, not on a timer and not on every page load:
// what this device last sent is remembered in its own storage, so a reload,
// or the tablet waking, sends nothing unless a room moved (a registry change
// or a re-calibration). Without storage (a private window) it falls back to
// once per page load.

import { useEffect, useMemo } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { readString, writeString } from "@/utils/storedJson";
import { shareKioskRooms } from "./agentApi";
import { deviceViews, roomsToShare } from "./agentView";

/** Let a burst of recalculations settle (a model load re-resolves every room). */
const SETTLE_MS = 5000;
const LAST_SENT_KEY = "villa:agent:rooms-sent";
let sentThisLoad: string | null = null;

export default function RoomShare() {
  const { resolvedRooms, config } = useConfig();
  const { entities } = useHA();
  // each device's name and category as the Kiosk shows them (agentView.deviceViews) — a STRING, so a state push that
  // changes no name or category changes nothing here (and never restarts the settle timer below)
  const viewsKey = JSON.stringify(deviceViews(config.entityMap, entities));
  const views = useMemo(() => JSON.parse(viewsKey) as ReturnType<typeof deviceViews>, [viewsKey]);

  useEffect(() => {
    const share = roomsToShare(resolvedRooms, readString(LAST_SENT_KEY) ?? sentThisLoad, views);
    if (!share) return;
    const t = setTimeout(() => {
      void shareKioskRooms(share.rooms, share.names, share.categories).then((ok) => {
        if (!ok) return;
        sentThisLoad = share.key;
        writeString(LAST_SENT_KEY, share.key);
      });
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [resolvedRooms, views]);

  return null;
}
