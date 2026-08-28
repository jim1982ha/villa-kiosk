// src/components/settings/ApiKeyPanel.tsx
//
// The provider credential, in the tab that spends it.
//
// ⚠️ IT WAS REACHABLE ONLY THROUGH A SETTING THAT DOES NOT GOVERN IT. The key
// field lived inside Briefings → Schedule → "How briefings are written", behind
// the "Let an AI service write the summary" toggle — and `agent/scheduler.py`
// reads `reports_secrets.get("anthropic")` whether or not that toggle is on.
// So switching the SUPERVISION agent on required first enabling NARRATION, an
// unrelated feature, purely to reach the box. Reported while following the
// setup instructions, which is the only way a trap like this is ever found:
// every individual screen was correct.
//
// ⚠️ ONE KEY, TWO READERS, AND THIS PANEL SAYS SO. `reports/secrets.py` stores
// exactly one credential per provider; narration and the agent both read it.
// A second field here would be a second key for one slot, where the last writer
// silently wins — so this edits the SAME secret the narration section does, and
// each says the other exists.
//
// ⚠️ THERE IS NO READ PATH FOR THE VALUE, ON PURPOSE. `/reports-secret` answers
// only "is one set" (`secrets.configured`), because the alternative is an API
// key in a browser — and this browser is a kiosk running unattended on a villa
// wall. This panel can show that a key exists, replace it, and clear it. It
// cannot show it, and neither can anything else.

import { useCallback, useEffect, useState } from "react";
import InfoHint from "@/components/common/InfoHint";
import { KeyRound } from "lucide-react";

import { fetchNarrationSecrets, saveNarrationSecret } from "@/vesta/brief/reportsApi";
import Loading from "@/components/common/Loading";

/** ⚠️ THE PROVIDER LIST COMES FROM THE SERVER, keyed by `providers.ADAPTERS` —
 *  `/reports-secret` returns one entry per adapter, so the SPA never keeps its
 *  own list to fall out of date. `shared()` refuses a name it has no adapter
 *  for, so an unknown one can never open a socket. */
export default function ApiKeyPanel() {
  const [configured, setConfigured] = useState<Record<string, boolean> | null>(null);
  const [provider, setProvider] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    const got = await fetchNarrationSecrets();
    setConfigured(got);
    setProvider((current) => current || Object.keys(got).sort()[0] || "");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const store = useCallback(async (value: string) => {
    setBusy(true);
    setNotice(null);
    const result = await saveNarrationSecret(provider, value);
    setBusy(false);
    if (!result.ok) { setNotice({ text: result.error, bad: true }); return; }
    setTyped("");
    setNotice({ text: value ? "Key stored." : "Key removed.", bad: false });
    await load();
  }, [provider, load]);

  if (configured === null) {
    return (
      <Loading />
    );
  }

  const providers = Object.keys(configured).sort();
  if (providers.length === 0) {
    return (
      <p className="muted body-text">
        The add-on offers no AI service, or could not be reached.
      </p>
    );
  }
  const stored = configured[provider] === true;

  return (
    <div className="fm-stack">
      <p className="muted body-text">
          One key, spent by everything the villa reasons with.
          <InfoHint label="Provider key">
            The checks on their cadence, every investigation, every answer to a
            message, and a briefing if you have asked for one to be written by a
            service. Nothing here runs without it — and nothing spends it while
            supervision is off.
          </InfoHint>
        </p>

      {providers.length > 1 && (
        <label className="fm-field">
          <span>Service</span>
          <select value={provider} disabled={busy}
                  onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="fm-field">
        <span>{stored ? "Replace the API key" : "API key"}</span>
        <input
          type="password"
          value={typed}
          disabled={busy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={stored
            ? "A key is stored — paste a new one to replace it"
            : "Paste the API key…"}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>

      {/* ⚠️ NOT IN THE DIALOG'S FOOTER, AND THIS IS THE EXEMPTION `test_modal_
          shell` ALREADY RECOGNISES: a credential is not part of the config
          document the footer's Save commits. It goes to its own 0600 file
          through its own endpoint, because riding the config PUT would put an
          API key into a document any authorized session can GET. `.modal-actions`
          is what this codebase has always used to mean a record-scoped
          action. */}
      <div className="modal-actions" style={{ margin: 0 }}>
        {stored && (
          <button className="btn ghost" disabled={busy}
                  onClick={() => void store("")}>
            Remove the stored key
          </button>
        )}
        <button className="btn primary" disabled={busy || !typed.trim()}
                onClick={() => void store(typed.trim())}>
          <KeyRound size={16} aria-hidden />
          <span>{busy ? "Storing…" : "Store key"}</span>
        </button>
      </div>

      {notice && (
        <p className={`body-text${notice.bad ? " sev-warning" : ""}`}
           role={notice.bad ? "alert" : undefined}>
          {notice.text}
        </p>
      )}

      <p className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
        Stored in the add-on&rsquo;s own 0600 file, never in the settings
        document and never sent back to a browser — this panel can tell you a
        key exists, and cannot show it. It is the same key the Briefings dialog
        offers under &ldquo;How briefings are written&rdquo;; setting it in
        either place sets it once.
      </p>
    </div>
  );
}
