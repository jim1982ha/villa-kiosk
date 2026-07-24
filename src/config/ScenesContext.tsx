// src/config/ScenesContext.tsx
// Keeps config.kioskScenes in sync with the add-on's SHARED server store
// (scenesApi → supervisor-proxy /scenes) so scenes created on one device are
// available on every device. The server is authoritative: we pull it on mount
// and whenever the tab regains focus, and every local edit writes through to
// it. config.kioskScenes stays the in-app source of truth the UI reads (the
// SummaryBar tiles), it's just continuously reconciled with the server here.

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useConfig } from "./ConfigContext";
import { fetchScenes, saveScenes as saveScenesToServer } from "./scenesApi";
import type { KioskScene } from "./scenes";

interface ScenesContextType {
  scenes: KioskScene[];
  /** Replace scenes everywhere: the local mirror (instant) AND the shared
   *  server copy (owner only — the server 403s other roles). */
  setScenes: (next: KioskScene[]) => void;
}

const ScenesContext = createContext<ScenesContextType | null>(null);

export function ScenesProvider({ children }: { children: ReactNode }) {
  const { config, update } = useConfig();
  const scenes = config.kioskScenes ?? [];
  // Read the latest local scenes without making `pull` depend on them (which
  // would re-fire the focus listener on every edit).
  const localRef = useRef(scenes);
  localRef.current = scenes;

  const pull = useCallback(async () => {
    const server = await fetchScenes();
    if (server === null) return; // couldn't reach it — keep what we have
    // First-run migration: a device that already had local-only scenes (saved
    // before shared storage existed, e.g. "Movie Night") seeds them into the
    // still-empty server store instead of being wiped by an empty pull.
    if (server.length === 0 && localRef.current.length > 0) {
      void saveScenesToServer(localRef.current);
      return;
    }
    update({ kioskScenes: server });
  }, [update]);

  // Pull once on mount, then whenever the tab is refocused / becomes visible.
  useEffect(() => {
    void pull();
    const onFocus = () => { void pull(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pull]);

  const setScenes = useCallback((next: KioskScene[]) => {
    update({ kioskScenes: next });   // local mirror — instant UI feedback
    void saveScenesToServer(next);   // shared copy for every other device
  }, [update]);

  return (
    <ScenesContext.Provider value={{ scenes, setScenes }}>
      {children}
    </ScenesContext.Provider>
  );
}

export function useScenes(): ScenesContextType {
  const ctx = useContext(ScenesContext);
  if (!ctx) throw new Error("useScenes must be used within a ScenesProvider");
  return ctx;
}
