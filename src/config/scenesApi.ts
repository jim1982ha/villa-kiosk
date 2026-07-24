// src/config/scenesApi.ts
// Client for the add-on's shared-scenes endpoint (supervisor-proxy.py's
// /scenes). Scenes live server-side in the add-on's /data volume so every
// device that connects sees the same set — unlike the rest of AppConfig,
// which is per-device localStorage. Same-origin, cookie-authed (the session
// cookie rides along automatically); no token handling here.

import { ingressPath } from "@/ha/ingress";
import type { KioskScene } from "./scenes";

/** Fetch the shared scenes. Returns null on a transport/parse failure so the
 *  caller can distinguish "server said empty" ([]) from "couldn't reach it"
 *  (null) — the latter must NOT overwrite whatever the device already has. */
export async function fetchScenes(): Promise<KioskScene[] | null> {
  try {
    const resp = await fetch(ingressPath("scenes"), { credentials: "same-origin" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { scenes?: unknown };
    return Array.isArray(data.scenes) ? (data.scenes as KioskScene[]) : [];
  } catch {
    return null;
  }
}

/** Replace the shared scenes (owner only — the server 403s other roles).
 *  Resolves true on success so the caller can surface a failure. */
export async function saveScenes(scenes: KioskScene[]): Promise<boolean> {
  try {
    const resp = await fetch(ingressPath("scenes"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenes }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
