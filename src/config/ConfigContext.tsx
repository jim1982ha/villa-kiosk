// src/config/ConfigContext.tsx
// App-wide config state, persisted to localStorage on every change.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { type AppConfig, loadConfig, saveConfig, resetConfig } from "./AppConfig";

interface ConfigContextType {
  config: AppConfig;
  update: (patch: Partial<AppConfig>) => void;
  replace: (next: AppConfig) => void;
  reset: () => void;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());

  const update = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  }, []);

  const replace = useCallback((next: AppConfig) => {
    saveConfig(next);
    setConfig(next);
  }, []);

  const reset = useCallback(() => {
    resetConfig();
    setConfig(loadConfig());
  }, []);

  // Reflect the chosen theme onto the document root so the CSS variable blocks
  // (`:root[data-theme="dark"]` / `"auto"`) take effect. "auto" defers to the OS
  // via the prefers-color-scheme media query in styles.css.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", config.theme);
  }, [config.theme]);

  const value = useMemo(() => ({ config, update, replace, reset }), [config, update, replace, reset]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextType {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
