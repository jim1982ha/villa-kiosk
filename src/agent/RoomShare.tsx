// src/agent/RoomShare.tsx
// Headless. Shares the rooms THIS device resolved for the villa's devices with
// the add-on, where the agent's villa model uses them for any device Home
// Assistant has no area for.
//
// ⚠️ ONE OWNER OF THE RULE. "Which room is this device in" is resolveEntityRoom
// (config/EntityMap.ts): Home Assistant's area, else which drawn room the
// device's 3D anchor sits in. The second half exists only in a browser with
// the scene loaded — the add-on has no 3D model to ask — so the add-on does not
// re-derive it; it is told the answer the Kiosk already shows.
//
// Mounted only while the agent is configured and the profile may see it
// (AgentProvider), so an install without the agent never writes this store.
// Written when the answer CHANGES, not on a timer: the resolved set only moves
// on a registry change or a re-calibration.

import { useEffect, useRef } from "react";
import { useConfig } from "@/config/ConfigContext";
import { shareKioskRooms } from "./agentApi";

/** Let a burst of recalculations settle (a model load re-resolves every room). */
const SETTLE_MS = 5000;

export default function RoomShare() {
  const { resolvedRooms } = useConfig();
  const lastSent = useRef<string>("");

  useEffect(() => {
    const rooms = Object.fromEntries(
      Object.entries(resolvedRooms).filter(([, room]) => room).sort(([a], [b]) => a.localeCompare(b)),
    );
    const key = JSON.stringify(rooms);
    if (key === lastSent.current || key === "{}") return;
    const t = setTimeout(() => {
      void shareKioskRooms(rooms).then((ok) => { if (ok) lastSent.current = key; });
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [resolvedRooms]);

  return null;
}
