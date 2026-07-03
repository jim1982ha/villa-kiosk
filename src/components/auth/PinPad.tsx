// src/components/auth/PinPad.tsx
// 4-digit passcode keypad for one profile. Pure input component: it collects
// digits and reports the complete code upward — WHO verifies it (server or
// env) is the caller's concern via the PinVerifier abstraction.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Delete } from "lucide-react";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface Props {
  /** Display name of the profile being unlocked. */
  roleLabel: string;
  /** Resolves true when the code is accepted. Throws on service failure. */
  onSubmit: (pin: string) => Promise<{ ok: boolean; retryAfter?: number }>;
  onAccepted: () => void;
  onBack: () => void;
}

export default function PinPad({ roleLabel, onSubmit, onAccepted, onBack }: Props) {
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);
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
  }, [busy, lockedFor, submit]);

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
      <button className="pinpad-back" onClick={onBack} aria-label="Back to profile choice">
        <ArrowLeft size={18} /> Profiles
      </button>
      <h2 className="pinpad-title">{roleLabel}</h2>
      <p className="pinpad-sub">Enter the 4-digit passcode</p>

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
