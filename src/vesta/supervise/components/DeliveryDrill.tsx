// src/vesta/supervise/components/DeliveryDrill.tsx
//
// Send a test alert through the real delivery path, and say what happened.
//
// ⚠️ THE FEATURE EXISTED FOR TEN DAYS WITH NO WAY TO PRESS IT. `_agent_drill`
// raises one synthetic concern and carries it through the REAL sink, routing,
// delivery, to-do and escalation sweep — the only answer to "does an alert
// actually reach my phone?" that does not involve waiting for a real one. It
// shipped guarded and tested; the only thing that ever fired it was a
// developer-side skill, and when that was deleted the capability became
// unreachable. Nothing failed, which is why nothing noticed.
//
// ⚠️ IT BELONGS ON Act & Tell, NOT BESIDE "Check the villa now". That button
// is rendered into the summary's flex row and its own file is emphatic that it
// must return THE BUTTON AND NOTHING ELSE — a sibling there moves it, which was
// reported once already. This rehearses DELIVERY, so it sits under the delivery
// permissions it rehearses.
//
// ⚠️ OWNER-ONLY, AND HIDDEN RATHER THAN DISABLED, the same convention as the
// run button: the proxy refuses a non-owner, and a disabled control advertises
// something the reader can never use.

import { useCallback, useState } from "react";
import { Loader2, Send } from "lucide-react";

import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import { fireDeliveryDrill } from "@/vesta/supervise/agentApi";

export default function DeliveryDrill({ onDone }: { onDone?: () => void }) {
  const { role } = useProfile();
  const mayRun = role != null && hasCapability(role, "editConfig");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const run = useCallback(async () => {
    setBusy(true);
    setNote("");
    const result = await fireDeliveryDrill();
    // ⚠️ A REFUSAL IS USUALLY THE DEDUPE RULE, NOT A FAULT. `raise_concern`
    // refuses a second concern on a subject that is still open, so pressing
    // this twice is answered rather than performed. Saying "it failed" would
    // send somebody looking for a broken notify platform.
    setNote(result.ok
      ? "Sent. Check your phone, and look at the alert it raised below — "
        + "clearing it there is part of the test."
      : result.reason
        ? `Not sent: ${result.reason}`
        : "Not sent, and the add-on gave no reason.");
    setBusy(false);
    onDone?.();
  }, [onDone]);

  if (!mayRun) return null;

  return (
    <div className="reports-pane">
      <h3 className="settings-section-title">Test the delivery path</h3>
      <p className="muted body-text">
        Raises one test alert and carries it the whole way — the same routing,
        the same message, the same to-do list and the same chasing a real one
        gets. No AI is involved and it costs nothing. It does send a real
        message, so not at 3am.
      </p>
      <button
        type="button" className="btn ghost" disabled={busy}
        onClick={() => void run()}
        title="Send one test alert through the real delivery path. It reaches your phone exactly as a real alert would."
      >
        {busy ? <Loader2 size={16} className="spin" aria-hidden />
              : <Send size={16} aria-hidden />}
        <span className="btn-label">Send a test alert</span>
      </button>
      {note && <p className="muted body-text" role="status">{note}</p>}
    </div>
  );
}
