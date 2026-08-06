// src/auth/ProfileContext.tsx
// Who is standing at the kiosk right now. Deliberately separate from
// ConfigContext: the villa configuration is durable and shared, the active
// profile is per-tab and must NOT be.
//
// Persistence is sessionStorage on purpose — it dies with the tab/browser and
// never syncs across tabs or devices. The PIN itself is never stored.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { isRole, type Role } from "./roles";
import { currentSession } from "./PinVerifier";
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
  /** Owner-only: invalidate EVERY outstanding session on this install (a lost
   *  device, a PIN someone saw) by bumping the server's signing epoch — not
   *  just this browser's cookie. Ends this session too, so the caller is
   *  signed out along with everyone else. Resolves false (leaving the local
   *  session untouched) if the server call fails, since silently claiming
   *  "every session revoked" when it might not have happened would be worse
   *  than doing nothing. */
  logoutAll: () => Promise<boolean>;
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
  /** True only while the server is being asked whether this browser's session
   *  cookie already authorizes a profile. The gate must render NOTHING during
   *  it, or a returning device flashes the profile picker for a round trip
   *  before dropping straight into the villa. */
  resolving: boolean;
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
  // Only when this tab has no remembered profile is there anything to ask the
  // server about — and only then must the gate hold back, so it never flashes
  // the profile picker for the ~80ms of the round trip before resolving into
  // the villa. With a stored role there is no wait and no flash.
  const [resolving, setResolving] = useState(() => loadStoredRole() === null);

  // Restore the profile from the SERVER's session cookie, which outlives this
  // document. sessionStorage alone made a returning device re-enter a passcode
  // the server had already accepted and would still honour: Android evicts a
  // backgrounded PWA and relaunches it with empty sessionStorage, so the pad
  // reappeared on essentially every launch. Measured at 2.4-3.1s of the user's
  // wall clock per launch — more than the villa's whole load. The cookie's own
  // expiry (`session_days`) stays the single source of truth for how long a
  // sign-in lasts; this only stops the UI from contradicting it.
  useEffect(() => {
    if (!resolving) return;
    let cancelled = false;
    void currentSession().then((serverRole) => {
      if (cancelled) return;
      if (serverRole) {
        // Deliberately NOT login(): that marks the boot timeline's `auth`
        // milestone, which exists to measure how long a HUMAN took at the
        // gate. Nobody was asked anything here, so recording it would report
        // phantom wait time on exactly the loads this fixes.
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: serverRole, at: Date.now() }));
        } catch { /* storage blocked — in-memory session still works */ }
        setRole(serverRole);
      }
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, [resolving]);

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

  const logoutAll = useCallback(async () => {
    try {
      const resp = await fetch(ingressPath("auth/logout-all"), {
        method: "POST", credentials: "include",
      });
      if (!resp.ok) return false;
    } catch {
      return false;
    }
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore — clearing state below is what matters.
    }
    setRole(null);
    setSwitching(false);
    return true;
  }, []);

  const beginSwitch = useCallback(() => setSwitching(true), []);
  const cancelSwitch = useCallback(() => setSwitching(false), []);

  const value = useMemo(
    () => ({ role, login, logout, logoutAll, switching, beginSwitch, cancelSwitch, resolving }),
    [role, login, logout, logoutAll, switching, beginSwitch, cancelSwitch, resolving],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
