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
import { ingressPath } from "@/ha/ingress";
import { markBoot } from "@/utils/bootTimeline";

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
    // The single choke point for "a session now exists" — every sign-in path
    // (un-gated one-tap, passcode accepted, profile switch) ends up here, so
    // this is the one honest boundary between time spent waiting on a PERSON
    // and time spent waiting on the APP. See utils/bootTimeline.
    markBoot("auth");
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: next, at: Date.now() }));
    } catch {
      // Storage full/blocked — the in-memory session still works for this tab.
    }
    setRole(next);
    setSwitching(false);
  }, []);

  const logout = useCallback(() => {
    // Tell the SERVER, not just this tab. Logging out used to clear
    // sessionStorage and React state only — the signed vk_session cookie
    // survived, still authorizing /core, /model, /fm-data and the config
    // stores for its full 30-day life. "Log out" that leaves the session
    // valid is not a log out; the next person to open this browser was still
    // authenticated at whatever role had just "left".
    //
    // keepalive so the request still goes out if this is the last thing the
    // page does before navigating away, and best-effort because a failed
    // network call must not trap the user in a session they asked to end —
    // the local state is cleared either way, and the cookie has an expiry.
    void fetch(ingressPath("auth/logout"), {
      method: "POST", credentials: "include", keepalive: true,
    }).catch(() => { /* offline: local state is still cleared below */ });
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
