// src/auth/ProfileContext.tsx
// Who is standing at the kiosk right now. Deliberately separate from
// ConfigContext: the villa configuration is durable and travels in backups;
// the active profile is per-tab and must NOT.
//
// Persistence is sessionStorage on purpose — it dies with the tab/browser,
// never syncs across tabs or devices, and utils/backup.ts (which serialises
// AppConfig only) can never export it. The PIN itself is never stored.

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
  /** Back to the profile-select screen. */
  logout: () => void;
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

  const login = useCallback((next: Role) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: next, at: Date.now() }));
    } catch {
      // Storage full/blocked — the in-memory session still works for this tab.
    }
    setRole(next);
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore — clearing state below is what matters.
    }
    setRole(null);
  }, []);

  const value = useMemo(() => ({ role, login, logout }), [role, login, logout]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
