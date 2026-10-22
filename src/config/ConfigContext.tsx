// src/config/ConfigContext.tsx
// App-wide config state, persisted to localStorage on every change.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { type AppConfig, loadConfig, saveConfig, normaliseConfig } from "./AppConfig";
import type { ConfigEdit } from "./mappingEdits";
import type { SharedConfigDiff } from "./deviceConfig";
import { resolveEffectiveTheme } from "@/utils/themeTime";
import { beginSpan } from "@/utils/perfSpans";

interface ConfigContextType {
  config: AppConfig;
  /** Apply a patch — or an EDIT (config/mappingEdits.ts), which is computed
   *  from the config React holds at the moment it applies, so two edits in
   *  the same moment both land. An edit that changes nothing re-renders
   *  nothing. */
  update: (patch: Partial<AppConfig> | ConfigEdit) => void;
  /** A change ANOTHER tablet made, arriving through the shared store (DeviceConfigSync): written like `update`, and
   *  told first, item by item (`change`), to every open dialog's draft (hooks/useDraftedSlice), so what Cancel goes
   *  back to moves with it. */
  mergeRemote: (patch: Partial<AppConfig>, change: SharedConfigDiff) => void;
  /** Hear every such change; returns the unsubscribe. */
  onRemoteChange: (listener: (change: SharedConfigDiff) => void) => () => void;
  /** entity_id -> room name, live-computed (HA's own Area assignment, falling
   *  back to GLB geometric detection — see Dashboard.tsx's resolution effect
   *  and config/devicePlace.ts's resolveEntityRoom) rather than stored/edited
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

  const update = useCallback((change: Partial<AppConfig> | ConfigEdit) => {
    // EVERY patch is completed (defaults, bounds — cheap), so no reader ever
    // sees a missing or out-of-range setting. The MAP MIGRATIONS run only when
    // the patch carries one of the two maps they clean — the seam
    // DeviceConfigSync's pull arrives through: update() fires on every
    // keystroke in Advanced Settings, and they walk the whole entityMap.
    setConfig((prev) => {
      const patch = typeof change === "function" ? change(prev) : change;
      if (typeof change === "function" && Object.keys(patch).length === 0) return prev;
      const maps = patch.entityMap !== undefined || patch.meshBindings !== undefined;
      return normaliseConfig({ ...prev, ...patch }, { maps });
    });
  }, []);

  const remoteListeners = useRef(new Set<(change: SharedConfigDiff) => void>());
  const onRemoteChange = useCallback((listener: (change: SharedConfigDiff) => void) => {
    remoteListeners.current.add(listener);
    return () => { remoteListeners.current.delete(listener); };
  }, []);
  // The drafts hear it BEFORE the write is queued: both land in the same render, so Save never lights for a moment.
  const mergeRemote = useCallback((patch: Partial<AppConfig>, change: SharedConfigDiff) => {
    for (const listener of remoteListeners.current) listener(change);
    update(patch);
  }, [update]);

  // ⚠️ NO "replace" NOR "reset" (architecture review B, 2026-10-22): nothing called them, and a reset wired later on the
  // owner's device would have emptied its copy of the shared device setup — DeviceConfigSync would push every device
  // as deleted to every tablet.

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
    // Instrumented: this is a full JSON.stringify plus a SYNCHRONOUS
    // localStorage write of a document that grows with the villa (entityMap,
    // meshBindings, sh3dRooms), and it runs on every config change. Moving it
    // out of the state updater made it stop blocking React's commit, but it
    // still blocks the main thread when it runs — so it belongs in the set of
    // candidates a freeze record can name. See perfSpans.
    const end = beginSpan("saveConfig");
    saveConfig(config);
    end();
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
    () => ({ config, update, mergeRemote, onRemoteChange, resolvedRooms, setResolvedRooms }),
    [config, update, mergeRemote, onRemoteChange, resolvedRooms],
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextType {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
