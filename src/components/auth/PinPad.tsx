// src/components/auth/PinPad.tsx
// Numeric passcode keypad. Pure input component: it collects digits and reports
// the complete code upward — WHO verifies it (server or env) is the caller's
// concern via the PinVerifier abstraction.
//
// Two callers with different rules share it rather than forking: the profile
// gate (4 digits, unlocks a session) and the superadmin elevation prompt (6
// digits, authorises one destructive write). Everything that differs between
// them — length, wording, the escape hatch offered after repeated failures —
// is a prop, so the keypad behaviour, lockout countdown and keyboard handling
// stay identical in both.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Delete } from "lucide-react";

const DEFAULT_PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface Props {
  /** Display name of the profile being unlocked. */
  roleLabel: string;
  /** Resolves true when the code is accepted. Throws on service failure. */
  onSubmit: (pin: string) => Promise<{ ok: boolean; retryAfter?: number }>;
  onAccepted: () => void;
  onBack: () => void;
  /** Digits to collect before submitting. Default 4. */
  length?: number;
  /** Text of the back button. Default "Profiles". */
  backLabel?: string;
  /** Line under the title, replacing the default "Enter the N-digit passcode". */
  subtitle?: string;
  /** Shown after two wrong attempts, in place of the default guidance. */
  helpText?: string;
}

export default function PinPad({
  roleLabel, onSubmit, onAccepted, onBack,
  length = DEFAULT_PIN_LENGTH, backLabel = "Profiles", subtitle, helpText,
}: Props) {
  const PIN_LENGTH = length;
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);
  // Wrong-code streak (server-side lockout has its own separate counter —
  // this is purely local, to decide when to show extra guidance). A wrong
  // code used to be a dead end: "Incorrect code — try again" with no path
  // forward besides the small "Profiles" link, which is easy to miss on a
  // kiosk someone's never used before.
  const [failCount, setFailCount] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Lockout countdown (rate-limited by the verifier). Interval is cleaned up
  // on unmount and whenever the count reaches zero.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setInterval(() => {
      setLockedFor((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [lockedFor > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(pin);
      if (!mounted.current) return;
      if (result.ok) {
        onAccepted();
        return;
      }
      setDigits("");
      if (result.retryAfter) {
        setLockedFor(result.retryAfter);
        setError(null);
      } else {
        setError("Incorrect code — try again.");
        setFailCount((c) => c + 1);
      }
    } catch {
      if (!mounted.current) return;
      setDigits("");
      setError("Couldn't reach the passcode service. Check the connection and try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [onSubmit, onAccepted]);

  const press = useCallback((d: string) => {
    if (busy || lockedFor > 0) return;
    setError(null);
    setDigits((prev) => {
      const next = (prev + d).slice(0, PIN_LENGTH);
      if (next.length === PIN_LENGTH) void submit(next);
      return next;
    });
  }, [busy, lockedFor, submit, PIN_LENGTH]);

  const erase = useCallback(() => {
    if (busy) return;
    setError(null);
    setDigits((prev) => prev.slice(0, -1));
  }, [busy]);

  // Physical keyboard support for desktop browsers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") erase();
      else if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, erase, onBack]);

  const locked = lockedFor > 0;

  return (
    <div className="pinpad" role="group" aria-label={`Passcode for ${roleLabel}`}>
      <button className="pinpad-back" onClick={onBack} aria-label={`Back — ${backLabel}`}>
        <ArrowLeft size={18} /> {backLabel}
      </button>
      <h2 className="pinpad-title">{roleLabel}</h2>
      <p className="pinpad-sub">{subtitle ?? `Enter the ${PIN_LENGTH}-digit passcode`}</p>

      <div className="pinpad-dots" aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={`pinpad-dot${i < digits.length ? " filled" : ""}`} />
        ))}
      </div>

      <div className="pinpad-status" role="alert" aria-live="polite">
        {locked ? (
          <span className="danger-text">
            {`Too many attempts — locked for ${Math.floor(lockedFor / 60)}:${String(lockedFor % 60).padStart(2, "0")}`}
          </span>
        ) : error ? (
          <span className="danger-text">{error}</span>
        ) : busy ? (
          <span className="muted">Checking…</span>
        ) : (
          " "
        )}
      </div>

      {/* After a couple of wrong tries, offer a way forward beyond "try
          again" — someone who genuinely doesn't have this code (a guest who
          mistyped what they were given, or was never told one) has nowhere
          else to go otherwise. */}
      {!locked && failCount >= 2 && (
        <p className="pinpad-help muted body-text">
          {helpText ?? "Don't have the code? Ask whoever manages this villa's kiosk for it."}
        </p>
      )}

      <div className="pinpad-keys">
        {KEYS.map((k) => (
          <button key={k} className="pinpad-key" onClick={() => press(k)} disabled={busy || locked}>
            {k}
          </button>
        ))}
        <span className="pinpad-key spacer" aria-hidden="true" />
        <button className="pinpad-key" onClick={() => press("0")} disabled={busy || locked}>
          0
        </button>
        <button className="pinpad-key" onClick={erase} disabled={busy || digits.length === 0} aria-label="Delete last digit">
          <Delete size={22} />
        </button>
      </div>
    </div>
  );
}
