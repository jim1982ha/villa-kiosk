// src/components/reports/NarrationSection.tsx
// Who writes the prose: the add-on itself, or an LLM provider.
//
// ⚠️ THE BUILT-IN WRITER IS THE PRODUCT AND THIS SECTION SAYS SO. Everything
// here is an overlay on prose that already works offline, and the copy is
// written to make that the obvious reading — an operator who switches this on
// expecting it to be REQUIRED for a brief has misunderstood what they bought,
// and one who leaves it off must not feel they are missing the feature.
//
// ⚠️ THE KEY FIELD IS WRITE-ONLY, AND THE SERVER HAS NO READ PATH FOR THE
// VALUE. `/reports-secret` answers "is one stored", never the credential —
// `secrets.configured()` exists precisely so the value is never loaded. So this
// component can show that a key exists and can replace or clear it, and cannot
// display it. That is not a limitation to work around: this browser is a kiosk
// running unattended on a villa wall, and a settings page that renders an API
// key is one shoulder away from disclosing it.
//
// ⚠️ AND IT IS THE ONE PLACE IN THIS APP THAT NEEDS THE INTERNET. CLAUDE.md's
// second hard rule stands — the villa may have no WAN at all — which is why the
// copy states the failure mode rather than hiding it: the brief still arrives,
// written by the built-in renderer, on time.

import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import type { NarrationMode, ReportsConfig } from "@/reports/reportsTypes";

/** The only provider with an adapter. ⚠️ Mirrors `providers.ADAPTERS`; the
 *  server REFUSES a credential for any name it has no adapter for, so an
 *  unknown one can never be written to disk. */
const PROVIDER = "anthropic";
const PROVIDER_LABEL = "Anthropic (Claude)";

export default function NarrationSection({
  draft, set, keyStored, busy, onSaveSecret,
}: {
  draft: ReportsConfig;
  set: (patch: Partial<ReportsConfig>) => void;
  keyStored: boolean;
  busy: boolean;
  onSaveSecret: (provider: string, value: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const mode: NarrationMode = draft.narration?.mode ?? "deterministic";
  const on = mode === "provider";

  return (
    <>
      <h3 className="reports-h3">How briefings are written</h3>

      <label className="toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) =>
            set({ narration: { ...draft.narration,
                               mode: e.target.checked ? "provider" : "deterministic" } })}
        />
        <span>Let an AI service write the summary</span>
      </label>
      <p className="muted body-text">
        Off by default, and the add-on writes every brief itself — that is the
        version you read in Preview. Switching this on rephrases the same
        findings; it never changes them, and it cannot add any. If the service
        is unreachable, over budget, or this villa has no internet, the brief
        still arrives on time in the built-in wording.
      </p>

      {on && (
        <>
          <p className="muted body-text">
            <strong>What leaves the villa:</strong> the findings as numbers —
            a label, a room, a measurement and a severity. Never an entity id,
            never a photo, never free text typed by an operator, and never
            anything about who is home. The exact list is fixed in the add-on
            and checked again on every send.
          </p>

          <div className="reports-schedule">
            <span className="body-text" style={{ flex: "1 1 140px" }}>
              {PROVIDER_LABEL}
            </span>
            <label
              className="body-text"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span className="muted">At most</span>
              <input
                type="number"
                min={0}
                max={2000}
                aria-label="Briefings narrated per month"
                style={{ width: 84, minHeight: "var(--touch-min)" }}
                value={draft.narration?.monthlyLimit ?? 200}
                onChange={(e) =>
                  set({ narration: { ...draft.narration, mode,
                                     monthlyLimit: Math.max(0, Number(e.target.value) || 0) } })}
              />
              <span className="muted">per month</span>
            </label>
          </div>
          <p className="muted body-text">
            A ceiling on requests, so a misconfigured schedule cannot run up a
            bill. Counted in this add-on&rsquo;s memory and reset when it
            restarts — it is a guard against a runaway, not a billing record.
          </p>

          {/* ⚠️ A SEPARATE SAVE FROM THE REST OF THE FORM. The credential does
              not live in the config store — it is a different file, at 0600,
              that no store handler serves — so it cannot ride the config PUT,
              and pretending otherwise would put the key in the document any
              authorized session can GET. */}
          {keyStored ? (
            <div className="reports-item">
              <span><KeyRound size={14} aria-hidden="true" /> A key is stored.</span>
              <button
                className="btn danger icon-only"
                disabled={busy}
                aria-label="Remove the stored key"
                onClick={() => onSaveSecret(PROVIDER, "")}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
            <p className="reports-item sev-warning">
              No key is stored, so briefings will keep using the built-in
              wording.
            </p>
          )}

          <div className="reports-schedule">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={keyStored ? "Replace the stored key" : "API key"}
              placeholder={keyStored ? "Replace the stored key…" : "Paste the API key…"}
              style={{ flex: "1 1 200px", minHeight: "var(--touch-min)" }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || typed.trim() === ""}
              onClick={() => { onSaveSecret(PROVIDER, typed.trim()); setTyped(""); }}
            >
              <KeyRound size={16} /><span>Store key</span>
            </button>
          </div>
          <p className="muted body-text">
            Stored on the add-on only, readable by nobody through this app, and
            never printed in a log. Sending briefings costs money at the
            provider&rsquo;s own rates.
          </p>
        </>
      )}
    </>
  );
}
