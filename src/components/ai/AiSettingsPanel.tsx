// src/components/ai/AiSettingsPanel.tsx
// Everything the AI layer needs, set here rather than on the add-on's
// Configuration page.
//
// ⚠️ ONE PLACE, NOT TWO. These were add-on options as well for one release, and
// two editable copies of one setting is the defect this repository keeps
// paying for: whichever an operator changed, the other silently disagreed and
// neither screen could say which the layer was using. The kiosk's own passcodes
// stay on the add-on page because they are what gets you INTO this screen.

import { useEffect, useState } from "react";
import {
  EMPTY_AI_SETTINGS, fetchAiSettings, saveAiSettings,
  type AiSettings, type AiSettingsDraft,
} from "@/ai/settingsApi";

const LOG_LEVELS = ["trace", "debug", "info", "notice", "warning", "error", "fatal"];

/** A secret the server will not send back: blank means "leave it as it is". */
function SecretField({ id, label, hint, isSet, value, onChange }: {
  id: string; label: string; hint: string; isSet: boolean;
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="ai-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type="password" autoComplete="off" spellCheck={false}
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={isSet ? "•••••••• (stored — leave blank to keep)" : "not set"}
      />
      <p className="ai-field-hint">{hint}</p>
    </div>
  );
}

function Field({ id, label, hint, value, onChange, placeholder, type = "text" }: {
  id: string; label: string; hint: string; value: string;
  onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="ai-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type={type} value={value} spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="ai-field-hint">{hint}</p>
    </div>
  );
}

export interface AiSettingsHandle {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  save: () => Promise<boolean>;
  discard: () => void;
}

export default function AiSettingsPanel({ onState }: {
  /** Lifts the draft state so the shared modal footer can drive Save/Discard,
   *  the same way every other settings surface in this app does. */
  onState: (h: AiSettingsHandle) => void;
}) {
  const [stored, setStored] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<AiSettings>(EMPTY_AI_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await fetchAiSettings();
        if (!live) return;
        setStored(s);
        setDraft(s);
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, []);

  const dirty = stored !== null
    && (JSON.stringify(draft) !== JSON.stringify(stored) || apiKey !== "" || secret !== "");

  useEffect(() => {
    onState({
      dirty, saving, error,
      save: async () => {
        setSaving(true);
        setError(null);
        try {
          const body: AiSettingsDraft = {
            ha_mcp_url: draft.ha_mcp_url, owner_target: draft.owner_target,
            fm_target: draft.fm_target, timezone: draft.timezone,
            daily_usd_limit: draft.daily_usd_limit, model_fast: draft.model_fast,
            model_writing: draft.model_writing, ai_log_level: draft.ai_log_level,
          };
          // ⚠️ ONLY WHEN TYPED. Sending "" for an untouched secret would wipe a
          // key the screen was never allowed to show.
          if (apiKey) body.anthropic_api_key = apiKey;
          if (secret) body.ha_mcp_secret = secret;
          const next = await saveAiSettings(body);
          setStored(next);
          setDraft(next);
          setApiKey("");
          setSecret("");
          return true;
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return false;
        } finally {
          setSaving(false);
        }
      },
      discard: () => {
        if (stored) setDraft(stored);
        setApiKey("");
        setSecret("");
        setError(null);
      },
    });
  }, [dirty, saving, error, draft, apiKey, secret, stored, onState]);

  if (loadError) {
    return (
      <div className="ai-empty">
        <div className="settings-section-title" style={{ marginTop: 0 }}>
          Settings unavailable
        </div>
        <p>{loadError}</p>
      </div>
    );
  }
  if (!stored) return <div className="ai-empty"><p>Reading…</p></div>;

  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="ai-settings">
      <div className="settings-section-title" style={{ marginTop: 0 }}>
        Home Assistant gateway
      </div>
      <Field
        id="ai-mcp-url" label="ha-mcp address" value={draft.ha_mcp_url}
        // ⚠️ NOT A URL-SHAPED PLACEHOLDER. `tests/hard-rules.py` refuses any
        // http(s) host in shipped source, and it is right to: it cannot tell a
        // hint from a fetch, and a fake address here is one copy-paste away
        // from being a real dependency. The hint text below carries the shape.
        placeholder="the ha-mcp add-on's address and port"
        onChange={(v) => set("ha_mcp_url", v)}
        hint="Everything the layer asks about the property goes through the ha-mcp
              add-on. Paste its address — discovering it would need a permission
              that can also start, stop and install add-ons. Set auto_update to
              false on that add-on: it moves its tool set in minor releases."
      />
      <SecretField
        id="ai-mcp-secret" label="ha-mcp secret" isSet={stored.ha_mcp_secret_set}
        value={secret} onChange={setSecret}
        hint="From that add-on's own configuration. It is used as a path on the
              address above, so if the address already ends with it you can leave
              this empty."
      />

      <div className="settings-section-title">The model</div>
      <SecretField
        id="ai-key" label="Anthropic API key" isSet={stored.anthropic_api_key_set}
        value={apiKey} onChange={setApiKey}
        hint="Stored in this add-on and never sent back to this screen. Leave it
              empty and the layer still runs and reports its health — it simply
              does not think."
      />
      <Field
        id="ai-limit" label="Daily spend limit (USD)" type="number"
        value={String(draft.daily_usd_limit)}
        onChange={(v) => set("daily_usd_limit", Number(v) || 0)}
        hint="The most it may spend in a day. 0 means no limit, not 'never
              spend'. What it reports is measured call by call, never estimated."
      />
      <Field
        id="ai-model-fast" label="Model for routine work" value={draft.model_fast}
        onChange={(v) => set("model_fast", v)}
        hint="The cheaper, quicker model for routine judgement."
      />
      <Field
        id="ai-model-writing" label="Model for writing" value={draft.model_writing}
        onChange={(v) => set("model_writing", v)}
        hint="The more capable model, used when something has to be explained to
              a person."
      />

      <div className="settings-section-title">Who it tells</div>
      <Field
        id="ai-owner-target" label="Owner notify target" value={draft.owner_target}
        placeholder="notify.mobile_app_…"
        onChange={(v) => set("owner_target", v)}
        hint="Which Home Assistant notify service reaches the owner. Empty means
              nothing is sent to them."
      />
      <Field
        id="ai-fm-target" label="Facility manager notify target" value={draft.fm_target}
        placeholder="notify.mobile_app_…"
        onChange={(v) => set("fm_target", v)}
        hint="Whoever looks after the property day to day. Empty means nothing is
              sent to them."
      />

      <div className="settings-section-title">Housekeeping</div>
      <Field
        id="ai-timezone" label="Time zone" value={draft.timezone}
        placeholder="follows Home Assistant"
        onChange={(v) => set("timezone", v)}
        hint="Leave empty to follow Home Assistant, which is almost always what
              you want."
      />
      <div className="ai-field">
        <label htmlFor="ai-log-level">Log level</label>
        <select
          id="ai-log-level" value={draft.ai_log_level}
          onChange={(e) => set("ai_log_level", e.target.value)}
        >
          {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <p className="ai-field-hint">
          How much the layer writes into this add-on&apos;s log. A failure to
          publish its own status is reported at every level — a broken layer
          cannot go quiet in both of its places at once.
        </p>
      </div>

      <p className="ai-note">
        Saved settings take effect within a few minutes — the layer re-reads them
        on its own heartbeat, so nothing needs restarting.
      </p>
    </div>
  );
}
