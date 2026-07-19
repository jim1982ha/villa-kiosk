// src/components/auth/ProfileGate.tsx
// Entry gate for the whole app: pick a profile, pass its passcode (when one
// is configured), then the children render. Minimum-click funnel: a profile
// without a configured PIN signs in with a single tap.

import { useEffect, useState, type ReactNode } from "react";
import { UserRound, KeyRound, Wrench, DoorOpen } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useProfile } from "@/auth/ProfileContext";
import { ROLE_ORDER, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/auth/roles";
import { pinRequired as fetchPinRequired, verify, openSession } from "@/auth/PinVerifier";
import { startModelPrefetch, onPrefetchAvailable } from "@/utils/modelPrefetch";
import { isIOS } from "@/utils/diagnostics";
import { isIngress, exitToHomeAssistant } from "@/ha/ingress";
import PinPad from "./PinPad";

const ROLE_ICONS: Record<Role, typeof UserRound> = {
  guest: UserRound,
  owner: KeyRound,
  ops: Wrench,
};

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { role, login, switching, cancelSwitch } = useProfile();
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

  // Flips true once startModelPrefetch above has CONFIRMED /model/ is
  // reachable right now — at that point it's safe to mount `children` (the
  // real Babylon scene) BEFORE login, so the multi-second Draco-decode +
  // mesh-indexing pass also runs while the user is still on this screen.
  //
  // THIS IS AN INFORMED, EXPLICIT TRADE-OFF, not a "solved" problem: that
  // decode is largely synchronous, main-thread-blocking work. v2.29.0 did
  // this and froze clicks on this screen for the whole decode; v2.30.1
  // reverted it for exactly that reason. v2.30.2 restores it at the user's
  // explicit request after being told the only way to make pre-login decode
  // GENUINELY non-blocking is moving the whole Babylon layer into a Web
  // Worker via OffscreenCanvas — a large separate rewrite, not attempted
  // here. What v2.30.2 actually ships instead: SceneManager.loadModel now
  // yields the main thread between its major top-level steps (see its own
  // comments), which shrinks the longest uninterrupted freeze but does NOT
  // eliminate it — expect this screen to still stutter/pause during a
  // preload, just for less time and less continuously than before.
  //
  // EXCLUDES iOS entirely, for an unrelated reason: iOS Safari/WebView has a
  // known, real per-tab memory ceiling that a heavy villa's Draco decode +
  // GPU upload can exceed (see diagnostics.ts's crash-loop guard). Loading
  // early there would retrigger that crash automatically on every reload,
  // before the user even reaches the PIN screen. iOS always loads only
  // after login, regardless of this trade-off.
  const [modelPreloadable, setModelPreloadable] = useState(false);
  useEffect(() => {
    if (role && !switching) return; // already rendering children unconditionally below
    if (isIOS()) return;
    return onPrefetchAvailable(() => setModelPreloadable(true));
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

  if (role && !switching) return <>{children}</>;

  // A profile switch keeps the CURRENT role's villa scene mounted (and thus
  // still fully loaded) underneath this overlay — see ProfileContext's
  // beginSwitch docstring for why: unmounting `children` here would force a
  // full GLB re-fetch + re-parse just to show a PIN pad. `.auth-screen` is a
  // fixed, opaque full-viewport layer (styles.css), so it fully covers the
  // scene beneath exactly like any other modal. The SAME reasoning now also
  // applies to a first-ever (not-yet-logged-in) visit once modelPreloadable
  // is true — see that state's own comment for the trade-off this involves.
  // sceneConfig (BabylonCanvas) stays unfiltered while `role` is still null
  // and reactively re-filters the instant login sets it, so nothing
  // role-restricted is ever exposed by loading early; the opaque overlay
  // below means none of it is visible before login regardless.
  const isSwitch = !!role && switching;
  // Distinct from isSwitch: only isSwitch means there's a session to fall
  // back to (drives the Cancel button below) — modelPreloadable alone (a
  // first-ever, not-yet-logged-in visit) has nothing to cancel back to.
  const showChildrenEarly = isSwitch || modelPreloadable;

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
        .catch(() => setGateError("Couldn't reach the kiosk service — please try again."));
    } else {
      setPending(r);
    }
  };

  const cancel = isSwitch ? cancelSwitch : undefined;

  if (pending) {
    return (
      <>
        {showChildrenEarly && children}
        <div className="auth-screen">
          {isIngress() && (
            <button className="auth-exit-btn" onClick={exitToHomeAssistant} aria-label="Exit to Home Assistant">
              <DoorOpen size={18} /> Exit to Home Assistant
            </button>
          )}
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
        </div>
      </>
    );
  }

  return (
    <>
      {showChildrenEarly && children}
      <div className="auth-screen">
        {isIngress() && (
          <button className="auth-exit-btn" onClick={exitToHomeAssistant} aria-label="Exit to Home Assistant">
            <DoorOpen size={18} /> Exit to Home Assistant
          </button>
        )}
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
      </div>
    </>
  );
}
