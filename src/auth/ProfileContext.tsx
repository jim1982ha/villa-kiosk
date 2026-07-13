// src/auth/ProfileContext.tsx
// Who is standing at the kiosk right now. Deliberately separate from
// ConfigContext: the villa configuration is durable and shared, the active
// profile is per-tab and must NOT be.
//
// Persistence is sessionStorage on purpose — it dies with the tab/browser and
// never syncs across tabs or devices. The PIN itself is never stored.

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from "react";
import { isRole, type Role } from "./roles";

const SESSION_KEY = "villa-kiosk:profile:v1";

interface ProfileContextType {
  /** Active profile, or null when nobody is signed in. */
  role: Role | null;
  /** Activate a profile (call only AFTER the PIN gate has passed). */
  login: (role: Role) => void;
  /** Back to the profile-select screen, clearing the session entirely. */
  logout: () => void;
  /** True while the HUD's "Switch profile" flow is showing the picker/PIN
   *  overlay over an ALREADY-active session (see beginSwitch). */
  switching: boolean;
  /** Show the profile-switch overlay WITHOUT clearing the current role —
   *  unlike logout(), ProfileGate keeps `children` (the whole villa scene)
   *  mounted underneath, so switching profiles doesn't force Babylon to
   *  re-fetch and re-parse the GLB from scratch just to show a PIN pad.
   *  login() (on success) or cancelSwitch() (on back-out) both clear this. */
  beginSwitch: () => void;
  /** Cancel an in-progress switch, returning to the current role unchanged. */
  cancelSwitch: () => void;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

function loadStoredRole(): Role | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    const role = (parsed as { role?: unknown } | null)?.role;
    // Whitelist-validate: a tampered value falls back to signed-out.
    return isRole(role) ? role : null;
  } catch {
    return null;
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(loadStoredRole);
  const [switching, setSwitching] = useState(false);

  const login = useCallback((next: Role) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: next, at: Date.now() }));
    } catch {
      // Storage full/blocked — the in-memory session still works for this tab.
    }
    setRole(next);
    setSwitching(false);
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore — clearing state below is what matters.
    }
    setRole(null);
    setSwitching(false);
  }, []);

  const beginSwitch = useCallback(() => setSwitching(true), []);
  const cancelSwitch = useCallback(() => setSwitching(false), []);

  const value = useMemo(
    () => ({ role, login, logout, switching, beginSwitch, cancelSwitch }),
    [role, login, logout, switching, beginSwitch, cancelSwitch],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
