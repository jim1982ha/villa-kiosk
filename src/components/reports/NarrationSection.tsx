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
// ⚠️ THE PRIVACY CLAIM IS NOT RESTATED HERE, AND THAT IS A DRY FIX WITH TEETH.
// This section used to carry a paragraph listing what does and does not leave
// the villa — a second, hand-kept copy of `contracts.PAYLOAD_ALLOWED_FIELDS`,
// written in prose, guaranteed to drift and impossible to check. The payload
// inspector on the Preview tab shows the REAL object, built by the backend's
// own `payload.from_context`, next to the field names it actually dropped. One
// claim, in the one place that can prove it; this section points at it.
//
// ⚠️ AND THE FIELDS ARE `.fm-field`, THE APP'S SHARED LABELLED CONTROL. They
// were `.reports-schedule` — a SCHEDULE ROW — plus four inline `style`
// attributes, which is how a settings form came to look like a schedule that
// had lost its selects. `.fm-field` owns the label rhythm
// (`--field-label-gap`/`--field-label-size`), the control padding, the focus
// ring and the placeholder colour, all of which were being approximated here.

import { useState } from "react";
import { KeyRound } from "lucide-react";
import type { NarrationMode, ReportsConfig } from "@/reports/reportsTypes";

/** `"anthropic"` → `"Anthropic"`. ⚠️ NO PRODUCT NAMES AND NO TABLE: the list of
 *  providers is whatever the server's adapter table holds (see below), so a
 *  display-name map here would be a second copy that goes stale the day a
 *  second adapter ships — and would put a vendor's product name in the bundle
 *  for a provider this install may not even use. */
const titleCase = (name: string) =>
  name.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function NarrationSection({
  draft, set, secretsConfigured, busy, onSaveSecret,
}: {
  draft: ReportsConfig;
  set: (patch: Partial<ReportsConfig>) => void;
  /** ⚠️ THE PROVIDER LIST COMES FROM HERE, keyed by the server's own
   *  `providers.ADAPTERS`. `/reports-secret` returns one entry per adapter, so
   *  the choice offered and the choice the server can honour are the same set
   *  by construction — the SPA never keeps its own list to fall out of date.
   *  The values say which already have a key; the keys say what exists. */
  secretsConfigured: Record<string, boolean>;
  busy: boolean;
  onSaveSecret: (provider: string, value: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const mode: NarrationMode = draft.narration?.mode ?? "deterministic";
  const on = mode === "provider";

  const providers = Object.keys(secretsConfigured).sort();
  const provider = providers.includes(draft.narration?.provider ?? "")
    ? (draft.narration?.provider as string)
    : providers[0] ?? "";
  const keyStored = secretsConfigured[provider] === true;

  const patchNarration = (patch: Partial<NonNullable<ReportsConfig["narration"]>>) =>
    set({ narration: { ...draft.narration, mode, ...patch } });

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
        Off by default: the add-on writes every brief itself, offline, and that
        is the version you read in Preview. Switching this on rephrases the same
        findings — it cannot add, remove or change one. If the service is
        unreachable or over budget, the brief still arrives on time in the
        built-in wording.
      </p>

      {on && (
        <>
          {providers.length === 0 ? (
            <p className="reports-item sev-warning">
              The add-on offers no narration service, or could not be reached.
            </p>
          ) : (
            <>
              <div className="reports-fields">
                <label className="fm-field">
                  <span>Service</span>
                  <select
                    value={provider}
                    disabled={providers.length === 1}
                    onChange={(e) => patchNarration({ provider: e.target.value })}
                  >
                    {providers.map((p) => (
                      <option key={p} value={p}>{titleCase(p)}</option>
                    ))}
                  </select>
                </label>

                {/* ⚠️ THE LABEL SAYS WHAT THE NUMBER DOES, not what it is
                    called. "Most briefings per month" was reported as unclear
                    and it deserved to be: it names a unit without saying what
                    happens at the ceiling, and the two-paragraph explanation
                    underneath was where the answer had been put instead.
                    Answering in the label is what let the paragraphs go. */}
                <label className="fm-field">
                  <span>Stop after this many a month</span>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={draft.narration?.monthlyLimit ?? 200}
                    onChange={(e) =>
                      patchNarration({
                        monthlyLimit: Math.max(0, Number(e.target.value) || 0),
                      })}
                  />
                </label>
              </div>

              <label className="fm-field">
                <span>{keyStored ? "Replace the API key" : "API key"}</span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={keyStored ? "A key is stored — paste a new one to replace it"
                                         : "Paste the API key…"}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </label>

              {/* ⚠️ A SEPARATE SAVE FROM THE REST OF THE FORM, and the buttons
                  say so by sitting apart from the Save at the foot of the tab.
                  The credential does not live in the config store — it is a
                  different file, at 0600, that no store handler serves — so it
                  cannot ride the config PUT, and pretending otherwise would put
                  the key in the document any authorized session can GET. */}
              <div className="reports-actions">
                <button
                  className="btn"
                  disabled={busy || typed.trim() === ""}
                  onClick={() => { onSaveSecret(provider, typed.trim()); setTyped(""); }}
                >
                  <KeyRound size={16} /><span>Store key</span>
                </button>
                {keyStored && (
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => onSaveSecret(provider, "")}
                  >
                    Remove the stored key
                  </button>
                )}
                <span className={keyStored ? "muted body-text" : "sev-warning body-text"}>
                  {keyStored
                    ? "A key is stored on the add-on. It is never shown or logged."
                    : "No key stored — briefings keep using the built-in wording."}
                </span>
              </div>

              {/* ⚠️ TWO LINES, BY INSTRUCTION AND BY MERIT. This was four
                  paragraphs — the ceiling explained twice, the cost, and a
                  pointer to the payload inspector — under a form of three
                  fields, and the owner called it too much text. Everything cut
                  is said better elsewhere: the ceiling by its own label above,
                  and what leaves the property by the inspector itself, which
                  SHOWS the real payload rather than describing it. Prose that
                  restates a control or duplicates a panel is what makes a
                  settings page feel heavy. */}
              <p className="muted body-text">
                Past that many, briefings keep arriving in the built-in wording;
                the count is in memory and resets when the add-on restarts.
                Requests are billed at the service&rsquo;s own rates — Preview
                shows exactly what would be sent.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
