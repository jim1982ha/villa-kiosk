// src/auth/ProfileContext.tsx
// Who is standing at the kiosk right now. Deliberately separate from
// ConfigContext: the villa configuration is durable and shared, the active
// profile is per-tab and must NOT be.
//
// Persistence is sessionStorage on purpose — it dies with the tab/browser and
// never syncs across tabs or devices. The PIN itself is never stored.

import {
  createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode,
} from "react";
import { isRole, type Role } from "./roles";
import { serverSession } from "./PinVerifier";
import { onSessionLost } from "./sessionLost";
import { ProfileSession, type LostReport, type SessionAdapters } from "./profileSession";
import { report as reportTelemetry } from "@/utils/telemetry";
import { ingressPath } from "@/ha/ingress";
import { purgeModelCache } from "@/utils/modelCache";
import { markBoot } from "@/utils/bootTimeline";
import { startModelPrefetch } from "@/utils/modelPrefetch";
import { readJson, writeJson, removeStored } from "@/utils/storedJson";

const SESSION_KEY = "villa-kiosk:profile:v1";
/** A session-lost report waiting for a session to send it with: the proxy
 *  refuses telemetry from a session it no longer honours, which is exactly
 *  when this report is made, so it goes out right after the next sign-in. */
const PENDING_LOST_KEY = "villa-kiosk:session-lost:v1";

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
    return isRole(role) ? role : null;
  } catch {
    return null;
  }
}

/** The browser pieces the session module is given (see auth/profileSession). */
function browserAdapters(): SessionAdapters {
  return {
    stored: {
      read: loadStoredRole,
      write: (role) => {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role, at: Date.now() })); } catch { /* blocked: in-memory still works */ }
      },
      clear: () => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } },
    },
    pendingLost: {
      take: () => {
        const r = readJson<LostReport>(PENDING_LOST_KEY);
        if (r) removeStored(PENDING_LOST_KEY);
        return r;
      },
      // A refused write is fine: the sign-out still happens.
      put: (r) => { writeJson(PENDING_LOST_KEY, r); },
    },
    askServer: serverSession,
    signOut: () => {
      void fetch(ingressPath("auth/logout"), { method: "POST", credentials: "include", keepalive: true })
        .catch(() => { /* offline: local state is still cleared */ });
    },
    signOutEverywhere: async () => {
      try {
        const resp = await fetch(ingressPath("auth/logout-all"), { method: "POST", credentials: "include" });
        return resp.ok;
      } catch { return false; }
    },
    // The service worker answers a model request from its cache BEFORE
    // nginx's /model/ gate is asked, so a signed-out device must not keep it.
    forget: () => { void purgeModelCache(); },
    // The one honest boundary between waiting on a PERSON and on the APP
    // (bootTimeline), and the model download once a cookie exists.
    signedIn: () => { markBoot("auth"); startModelPrefetch(); },
    report: (p, now) => reportTelemetry("session", { phase: "lost", source: p.source, lostRole: p.role, agoMs: p.at ? now - p.at : undefined }),
    now: () => Date.now(),
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<ProfileSession>();
  if (!sessionRef.current) sessionRef.current = new ProfileSession(browserAdapters());
  const session = sessionRef.current;
  const state = useSyncExternalStore(session.onChange, session.getState);

  useEffect(() => { void session.start(); }, [session]);
  useEffect(() => onSessionLost((source) => { void session.sessionLost(source); }), [session]);

  const value = useMemo<ProfileContextType>(
    () => ({
      role: state.role, switching: state.switching, resolving: state.resolving,
      login: session.login, logout: session.logout, logoutAll: session.logoutAll,
      beginSwitch: session.beginSwitch, cancelSwitch: session.cancelSwitch,
    }),
    [state, session],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
