// src/auth/profileSession.ts
// The life of this device's sign-in, as one plain module: checking at start,
// signed in, switching profile, signing out, signing every device out, and
// the server saying the session is gone. The browser pieces (storage, the
// network, the model cache, the boot timeline) are passed in, so the Node
// oracles drive it with stand-ins (tests/oracles/profile_session.mjs); the
// React side is ProfileContext, a thin adapter (2.496.233).
//
// It lived across two screen files, with the "a session now exists" steps
// written out twice, and the tests could only search their text.
//
// ⚠️ A SESSION THAT ENDED WHILE THE APP WAS CLOSED. Only an explicit sign-out
// cleared the service worker's model cache (2.496.206) — a session that
// expired, or was ended by "sign every device out" elsewhere, came back at the
// next start as "no session", and the cached floor plan stayed. Now: at start,
// the server saying NO session clears it too. Unknown (offline) keeps it —
// a wall iPad with no network must not lose its villa for being offline.

import { sessionLostDecision, type ServerSession } from "./sessionLost";
import { isRole, type Role } from "./roles";

export interface SessionState {
  /** Active profile, or null when nobody is signed in. */
  role: Role | null;
  /** The switch-profile overlay is showing over an active session. */
  switching: boolean;
  /** The server is being asked whether this browser is already signed in —
   *  the gate renders nothing meanwhile (no flash of the profile picker). */
  resolving: boolean;
}

export interface LostReport { source: string; role: string; at: number }

export interface SessionAdapters {
  /** This tab's remembered profile (sessionStorage). */
  stored: { read(): Role | null; write(role: Role): void; clear(): void };
  /** A session-lost report waiting for a session to be sent with. */
  pendingLost: { take(): LostReport | null; put(r: LostReport): void };
  askServer(): Promise<ServerSession>;
  /** Tell the server this device signs out (best effort). */
  signOut(): void;
  /** Ask the server to end every session; false when it did not. */
  signOutEverywhere(): Promise<boolean>;
  /** What a signed-out device must no longer hold (the model cache). */
  forget(): void;
  /** A person just got in: the boot timeline's `auth` mark, the model prefetch. */
  signedIn(): void;
  report(lost: LostReport, now: number): void;
  now(): number;
}

export class ProfileSession {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private asking = false;
  private readonly io: SessionAdapters;

  // No parameter property: Node's type stripping (the oracles) refuses one.
  constructor(io: SessionAdapters) {
    this.io = io;
    const stored = io.stored.read();
    this.state = { role: stored, switching: false, resolving: stored === null };
  }

  getState = (): SessionState => this.state;
  onChange = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** At start, with nothing remembered in this tab: is this browser already
   *  signed in (the cookie outlives the tab)? Deliberately NOT login() — no
   *  person was asked, so no `auth` mark. */
  async start(): Promise<void> {
    if (!this.state.resolving) return;
    const server = await this.io.askServer();
    if (typeof server === "object" && isRole(server.role)) {
      this.io.stored.write(server.role);
      this.set({ role: server.role, resolving: false });
      return;
    }
    if (server === "none") this.io.forget();
    this.set({ resolving: false });
  }

  /** A person got in (after the passcode, or one tap on an open profile). */
  login = (role: Role): void => {
    this.io.signedIn();
    const lost = this.io.pendingLost.take();
    if (lost) this.io.report(lost, this.io.now());
    this.io.stored.write(role);
    this.set({ role, switching: false });
  };

  /** Every way a session ends goes through here. */
  private end(): void {
    this.io.stored.clear();
    this.io.forget();
    this.set({ role: null, switching: false });
  }

  logout = (): void => { this.io.signOut(); this.end(); };

  /** Sign every device out; this one only if the server confirmed it. */
  logoutAll = async (): Promise<boolean> => {
    if (!(await this.io.signOutEverywhere())) return false;
    this.end();
    return true;
  };

  beginSwitch = (): void => this.set({ switching: true });
  cancelSwitch = (): void => this.set({ switching: false });

  /** Something was refused as signed out: ask the server once, and sign out
   *  only when it DEFINITELY says there is no session (sessionLostDecision:
   *  unreachable keeps the profile — the right rule for a wall iPad). */
  sessionLost = async (source: string): Promise<void> => {
    const role = this.state.role;
    if (this.asking || role === null) return;
    this.asking = true;
    const server = await this.io.askServer();
    this.asking = false;
    if (sessionLostDecision(role, server) !== "sign-out") return;
    this.io.pendingLost.put({ source, role, at: this.io.now() });
    this.end();
  };
}
