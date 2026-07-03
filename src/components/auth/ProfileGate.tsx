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
import { getPinVerifier } from "@/auth/PinVerifier";
import PinPad from "./PinPad";

const ROLE_ICONS: Record<Role, typeof UserRound> = {
  guest: UserRound,
  owner: KeyRound,
  ops: Wrench,
};

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { role, login } = useProfile();
  const { config } = useConfig();
  const [pending, setPending] = useState<Role | null>(null);
  const [pinRequired, setPinRequired] = useState<Record<Role, boolean> | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  // Which profiles are gated — fetched once per visit to the select screen.
  // Until the answer arrives we assume every profile needs a PIN (fail closed).
  useEffect(() => {
    if (role) return; // already signed in, nothing to fetch
    let cancelled = false;
    getPinVerifier()
      .pinRequired()
      .then((req) => { if (!cancelled) setPinRequired(req); })
      .catch(() => {
        if (!cancelled) {
          setPinRequired({ guest: true, owner: true, ops: true });
          setGateError("Couldn't load the passcode settings — a passcode will be asked for every profile.");
        }
      });
    return () => { cancelled = true; };
  }, [role]);

  if (role) return <>{children}</>;

  const choose = (r: Role) => {
    setGateError(null);
    if (pinRequired && !pinRequired[r]) {
      login(r); // un-gated profile: one tap and in
    } else {
      setPending(r);
    }
  };

  if (pending) {
    return (
      <div className="auth-screen">
        <PinPad
          roleLabel={ROLE_LABELS[pending]}
          onSubmit={(pin) => getPinVerifier().verify(pending, pin)}
          onAccepted={() => { login(pending); setPending(null); }}
          onBack={() => setPending(null)}
        />
      </div>
    );
  }

  return (
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
      </div>
    </div>
  );
}
