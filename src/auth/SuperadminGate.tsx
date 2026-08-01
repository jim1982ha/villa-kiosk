// src/auth/SuperadminGate.tsx
// The one place the superadmin code is ever asked for.
//
// Anything in the app that can permanently destroy a record calls
// `authorize()` and receives either a single-use token or null. Callers never
// see the code, never cache the token, and cannot express "the user is a
// superadmin" — there is no such state to hold. That is the point: this is a
// per-action authorisation, not a mode you can forget you are in.
//
// The prompt is deliberately unannounced. There is no "superadmin" entry in
// any menu; you reach it by pressing and holding a record you already have
// permission to see. Someone who wasn't told it exists will not find it by
// browsing, and the small dot in the corner of an erasable row means nothing
// unless you already know what it is.
//
// None of that is the security boundary. The boundary is the server, which
// refuses the write without a token whatever the client claims (see
// _fm_write_guard in supervisor-proxy.py). This module is the way to obtain
// one honestly.

import {
  createContext, useCallback, useContext, useRef, useState, type ReactNode,
} from "react";
import { ShieldAlert } from "lucide-react";
import PinPad from "@/components/auth/PinPad";
import { requestElevation } from "./elevation";

export interface ElevationIntent {
  /** What is about to be destroyed, in the operator's words: "Delete fault". */
  title: string;
  /** The specific record, so nobody erases the wrong row after a mis-tap. */
  detail?: string;
}

interface SuperadminContextValue {
  /** Ask for the code. Resolves with a single-use token, or null if the
   *  operator backed out / the capability isn't configured. Each call
   *  authorises exactly one write — never reuse the result. */
  authorize: (intent: ElevationIntent) => Promise<string | null>;
}

const Ctx = createContext<SuperadminContextValue | null>(null);

export function SuperadminGate({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<ElevationIntent | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  // The in-flight request's resolver and the token PinPad just earned. Refs,
  // not state: settling the promise must not depend on a re-render landing.
  const resolver = useRef<((token: string | null) => void) | null>(null);
  const token = useRef<string | null>(null);

  const settle = useCallback((value: string | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    token.current = null;
    setIntent(null);
    setUnconfigured(false);
    resolve?.(value);
  }, []);

  const authorize = useCallback((next: ElevationIntent) => {
    // A second prompt while one is open would strand the first promise
    // forever; cancel it explicitly instead.
    settle(null);
    setIntent(next);
    return new Promise<string | null>((resolve) => { resolver.current = resolve; });
  }, [settle]);

  const submit = useCallback(async (pin: string) => {
    const result = await requestElevation(pin);
    if (result.ok) {
      token.current = result.token;
      return { ok: true };
    }
    if (result.reason === "disabled") {
      setUnconfigured(true);
      return { ok: false };
    }
    if (result.reason === "locked-out") return { ok: false, retryAfter: result.retryAfter };
    if (result.reason === "error") throw new Error("elevation service unreachable");
    return { ok: false };
  }, []);

  return (
    <Ctx.Provider value={{ authorize }}>
      {children}
      {intent && (
        <div className="modal-backdrop" onClick={() => settle(null)}>
          <div className="superadmin-prompt" onClick={(e) => e.stopPropagation()}>
            <div className="superadmin-prompt-head">
              <ShieldAlert size={16} />
              <span>{intent.title}</span>
            </div>
            {intent.detail && <p className="superadmin-prompt-detail">{intent.detail}</p>}
            {unconfigured ? (
              <>
                <p className="superadmin-prompt-note danger-text">
                  No superadmin code is set for this installation, so records
                  cannot be erased. It is configured in the add-on&apos;s options.
                </p>
                <button className="btn" onClick={() => settle(null)}>Close</button>
              </>
            ) : (
              <PinPad
                roleLabel="Authorisation required"
                subtitle="Enter the 6-digit superadmin code"
                length={6}
                backLabel="Cancel"
                helpText="This code is held by whoever is accountable for the villa's records. It authorises this one deletion and nothing else."
                onSubmit={submit}
                onAccepted={() => settle(token.current)}
                onBack={() => settle(null)}
              />
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useSuperadmin(): SuperadminContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSuperadmin must be used within a SuperadminGate");
  return ctx;
}
