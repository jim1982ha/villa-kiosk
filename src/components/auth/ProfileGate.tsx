// src/components/auth/ProfileGate.tsx
// Entry gate for the whole app: pick a profile, pass its passcode (when one
// is configured), then the children render. Minimum-click funnel: a profile
// without a configured PIN signs in with a single tap.

import { useEffect, useState, type ReactNode } from "react";
import { UserRound, KeyRound, Wrench } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useProfile } from "@/auth/ProfileContext";
import { ROLE_ORDER, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/auth/roles";
import { pinRequired as fetchPinRequired, verify, openSession } from "@/auth/PinVerifier";
import { startModelPrefetch } from "@/utils/modelPrefetch";
import { markBoot } from "@/utils/bootTimeline";
import PinPad from "./PinPad";

const ROLE_ICONS: Record<Role, typeof UserRound> = {
  guest: UserRound,
  owner: KeyRound,
  ops: Wrench,
};

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { role, login, switching, cancelSwitch, resolving } = useProfile();
  const { config } = useConfig();
  const [pending, setPending] = useState<Role | null>(null);
  const [pinRequired, setPinRequired] = useState<Record<Role, boolean> | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  // Kick off the (large) central GLB's background BYTE download as early as
  // possible, right when the gate screen first appears — a plain fetch(), no
  // DOM/scene/decode work, so it genuinely can't cause any jank on its own.
  // Under HA Ingress this succeeds immediately (Ingress-sourced requests are
  // auto-trusted) and gives the model a real head start on the download
  // before any profile is even picked. On the direct/Cloudflare-gated
  // deployment /model/ requires a session cookie that doesn't exist yet, so
  // this attempt fails harmlessly and retries right when a profile is
  // actually authorized (see choose() and the PinPad onAccepted below) — the
  // earliest that deployment can legally start it. Skipped when already
  // signed in (a returning session, `role` restored from sessionStorage) —
  // `children` mounts immediately below and BabylonCanvas's own load effect
  // already covers that case; starting a second, redundant fetch of the
  // exact same URL here would just race it. See utils/modelPrefetch.ts.
  useEffect(() => {
    if (!role || switching) startModelPrefetch();
  }, [role, switching]);

  // Which profiles are gated — fetched once per visit to the select screen.
  // Until the answer arrives we assume every profile needs a PIN (fail closed).
  useEffect(() => {
    if (role && !switching) return; // already signed in and not switching, nothing to fetch
    let cancelled = false;
    fetchPinRequired()
      .then((req) => { if (!cancelled) setPinRequired(req); })
      .catch(() => {
        if (!cancelled) {
          setPinRequired({ guest: true, owner: true, ops: true });
          setGateError("Couldn't load the passcode settings — a passcode will be asked for every profile.");
        }
      });
    return () => { cancelled = true; };
  }, [role, switching]);

  // Mark the moment a sign-in screen is actually on display. Everything from
  // here until login() succeeds is a person reading/tapping/typing, not the app
  // being slow — separating the two is the whole point (see bootTimeline's
  // `waitMs`/`activeMs`). Declared above the early returns so the hook order is
  // unconditional; first-write-wins makes the repeat runs harmless. Skipped
  // while `resolving`, since nothing is on display to wait on yet.
  useEffect(() => {
    if ((role && !switching) || resolving) return;
    markBoot(pending ? "pin" : "gate");
  }, [role, switching, pending, resolving]);

  // Distinct from a first-ever visit: only a SWITCH has a session to fall back
  // to, which is what the Cancel button below returns to.
  const isSwitch = !!role && switching;

  const choose = (r: Role) => {
    setGateError(null);
    if (pinRequired && !pinRequired[r]) {
      // Un-gated profile: one tap and in — but still establish a server session
      // first, so direct/Cloudflare access is authorized (the cookie, not this
      // click, is what unlocks /core and /model).
      openSession(r)
        .then((res) => {
          if (res.ok) {
            // Session cookie now exists — retry the prefetch in case the
            // earlier mount-time attempt (before any cookie existed) failed.
            startModelPrefetch();
            login(r);
          } else setGateError("Couldn't start a session — please try again.");
        })
        .catch((err) => setGateError(
          err instanceof Error && err.message && !err.message.startsWith("auth service unavailable")
            ? err.message
            : "Couldn't reach the kiosk service — please try again.",
        ));
    } else {
      setPending(r);
    }
  };

  const cancel = isSwitch ? cancelSwitch : undefined;

  // ── ONE return, ONE tree shape ────────────────────────────────────────
  // This used to return four different shapes: `<>{children}</>` when signed
  // in, `null` while resolving, and `<>{early && children}<div/></>` for the
  // two gate screens. React reconciles a fragment's children BY POSITION, and
  // `children` here is itself an array (the provider tree down to
  // BabylonCanvas) — so moving it between "the fragment's only child" and
  // "index 0 of an array" changed its implicit keys, and React responded by
  // unmounting the entire authenticated tree and building a new one.
  //
  // That is why opening the profile switcher reloaded the villa, and why
  // CANCELLING reloaded it a second time — a full ~2.5s GLB re-parse and a
  // fresh WebGL context for a screen the user backed out of without changing
  // anything. It also explains the WebGL context-loss counter climbing into
  // the teens and the heap growing across a session.
  //
  // Now there is exactly one structure, always two slots in the same order.
  // Slot 0 is `children` whenever a session exists — including while the
  // switch overlay is up — so the villa is never torn down for a profile
  // change. Switching role re-filters the scene through `sceneConfig`
  // (BabylonCanvas's own effect), which is what should happen: the geometry is
  // identical, only what may be shown differs.
  const signedIn = !!role && !switching;
  // Keep the villa mounted whenever there IS a session behind the overlay.
  // On a first-ever visit there is nothing to keep, so this is false and the
  // gate renders alone — the pre-login decode stays disabled exactly as
  // before (see the long note above about 2.76.0/2.79.0).
  const showChildren = signedIn || isSwitch;
  // `resolving` means the server is still being asked whether this browser is
  // already signed in: render neither the villa nor the picker for that one
  // round trip, rather than flashing a profile screen the answer will replace.
  const gateVisible = !signedIn && !resolving;

  return (
    <>
      {showChildren ? children : null}
      {gateVisible && (
        <div className="auth-screen">
          {pending ? (
            <PinPad
              roleLabel={ROLE_LABELS[pending]}
              onSubmit={(pin) => verify(pending, pin)}
              onAccepted={() => {
                // Correct PIN just minted the session cookie — retry the
                // prefetch (the mount-time attempt had no cookie to use yet).
                startModelPrefetch();
                login(pending);
                setPending(null);
              }}
              onBack={() => setPending(null)}
            />
          ) : (
            <div className="profile-select">
              <h1 className="profile-title">{resolveSiteTitle(config)}</h1>
              <p className="profile-sub">Who's using the kiosk?</p>
              {gateError && (
                <p className="profile-error" role="alert">{gateError}</p>
              )}
              <div className="profile-cards">
                {ROLE_ORDER.map((r) => {
                  const Icon = ROLE_ICONS[r];
                  return (
                    <button
                      key={r}
                      className="profile-card"
                      onClick={() => choose(r)}
                      disabled={!pinRequired}
                    >
                      <Icon size={34} aria-hidden="true" />
                      <span className="profile-card-name">{ROLE_LABELS[r]}</span>
                      <span className="profile-card-desc">{ROLE_DESCRIPTIONS[r]}</span>
                    </button>
                  );
                })}
              </div>
              {!pinRequired && !gateError && <div className="muted">Loading profiles…</div>}
              {cancel && (
                <button className="btn ghost mt" onClick={cancel}>Cancel</button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
