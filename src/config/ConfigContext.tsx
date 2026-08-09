// src/config/ConfigContext.tsx
// App-wide config state, persisted to localStorage on every change.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { type AppConfig, loadConfig, saveConfig, resetConfig } from "./AppConfig";
import { resolveEffectiveTheme } from "@/utils/themeTime";

interface ConfigContextType {
  config: AppConfig;
  update: (patch: Partial<AppConfig>) => void;
  replace: (next: AppConfig) => void;
  reset: () => void;
  /** entity_id -> room name, live-computed (HA's own Area assignment, falling
   *  back to GLB geometric detection — see Dashboard.tsx's resolution effect
   *  and config/EntityMap.ts's resolveEntityRoom) rather than stored/edited
   *  config. Deliberately NOT part of AppConfig/persisted: every client
   *  independently computes the same answer from the same HA instance + the
   *  same GLB, so there is nothing to save or sync. Empty until the scene
   *  has loaded and HA's registry data has resolved at least once. */
  resolvedRooms: Record<string, string>;
  /** Pushed by Dashboard.tsx whenever HA's registry data or the scene's
   *  plan-to-world calibration changes. Not for general use — every OTHER
   *  consumer should just read resolvedRooms. */
  setResolvedRooms: (rooms: Record<string, string>) => void;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [resolvedRooms, setResolvedRooms] = useState<Record<string, string>>({});

  const update = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const replace = useCallback((next: AppConfig) => {
    setConfig(next);
  }, []);

  const reset = useCallback(() => {
    resetConfig();
    setConfig(loadConfig());
  }, []);

  // Persist to localStorage in an effect, AFTER React commits + the browser
  // paints — not inside the state updater above. JSON.stringify + a
  // synchronous localStorage.setItem of the full config (entityMap,
  // meshBindings, teleportPoints, sh3dRooms — all of which grow with a
  // villa's device count) used to run INSIDE setConfig's updater, blocking
  // React's commit on every single edit: clicking a device's "Show" checkbox
  // in Advanced Settings visibly lagged before the checkbox itself flipped.
  // Saving here instead means the checkbox paints first; persistence follows
  // a moment later, imperceptibly.
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // Reflect the chosen theme onto the document root so the CSS variable
  // blocks (:root[data-theme="dark"/"night"]) take effect. "auto" resolves
  // HERE, not via a CSS media query alone — picking "night" over "dark" needs
  // the real sun position (utils/themeTime.ts), which CSS has no way to
  // express. Re-resolves every few minutes so a kiosk left running overnight
  // crosses into night without anyone touching Settings, and reacts to the
  // OS light/dark switch live — mirrors Dashboard.tsx's own hourly sun.sun
  // fallback for the same "state changes with the clock, not with a render"
  // reason.
  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute(
        "data-theme",
        resolveEffectiveTheme(config.theme, config.latitude, config.longitude),
      );
    };
    apply();
    if (config.theme !== "auto") return;
    const id = window.setInterval(apply, 5 * 60 * 1000);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", apply);
    return () => {
      window.clearInterval(id);
      media?.removeEventListener("change", apply);
    };
  }, [config.theme, config.latitude, config.longitude]);

  const value = useMemo(
    () => ({ config, update, replace, reset, resolvedRooms, setResolvedRooms }),
    [config, update, replace, reset, resolvedRooms],
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextType {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
