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
  // scene beneath exactly like any other modal.
  const isSwitch = !!role && switching;

  const choose = (r: Role) => {
    setGateError(null);
    if (pinRequired && !pinRequired[r]) {
      // Un-gated profile: one tap and in — but still establish a server session
      // first, so direct/Cloudflare access is authorized (the cookie, not this
      // click, is what unlocks /core and /model).
      openSession(r)
        .then((res) => {
          if (res.ok) login(r);
          else setGateError("Couldn't start a session — please try again.");
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
        {isSwitch && children}
        <div className="auth-screen">
          <PinPad
            roleLabel={ROLE_LABELS[pending]}
            onSubmit={(pin) => verify(pending, pin)}
            onAccepted={() => { login(pending); setPending(null); }}
            onBack={() => setPending(null)}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {isSwitch && children}
      <div className="auth-screen">
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
