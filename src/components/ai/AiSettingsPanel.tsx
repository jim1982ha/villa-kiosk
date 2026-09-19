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
import { Plug } from "lucide-react";
import {
  EMPTY_AI_SETTINGS, fetchAiSettings, saveAiSettings, testGateway,
  type AiSettings, type AiSettingsDraft, type GatewayTest,
} from "@/ai/settingsApi";
import { MODEL_CHOICES } from "@/ai/models";
import { fetchNotifyTargets, type NotifyTarget } from "@/ai/notifyTargets";

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

/** A list of known-good values that does not become a cage.
 *
 *  ⚠️ EVERY DROPDOWN HERE KEEPS AN ESCAPE HATCH. A closed list of notify
 *  targets is wrong the moment a phone is added, and a closed list of models is
 *  wrong the moment Anthropic ships one — in both cases this add-on would be
 *  the thing standing between the operator and a value that already works. The
 *  list is for the common case; "Something else…" is for the rest. */
function Picker({ id, label, hint, value, onChange, options, empty, placeholder }: {
  id: string; label: string; hint: string; value: string;
  onChange: (v: string) => void;
  options: readonly { id: string; label: string; note?: string }[];
  /** Shown when the list came back empty — with the reason, if there was one. */
  empty?: string;
  placeholder?: string;
}) {
  const known = value === "" || options.some((o) => o.id === value);
  const [custom, setCustom] = useState(!known);
  const showCustom = custom || !known;

  return (
    <div className="ai-field">
      <label htmlFor={id}>{label}</label>
      {showCustom ? (
        <div className="ai-picker-custom">
          <input
            id={id} value={value} spellCheck={false} placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {options.length > 0 && (
            <button type="button" className="btn ghost btn-small"
              onClick={() => { setCustom(false); onChange(options[0].id); }}>
              Choose from the list
            </button>
          )}
        </div>
      ) : (
        <select
          id={id} value={value}
          onChange={(e) => {
            if (e.target.value === "__custom__") { setCustom(true); onChange(""); return; }
            onChange(e.target.value);
          }}
        >
          <option value="">— none —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.note ? `${o.label} — ${o.note}` : o.label}
            </option>
          ))}
          <option value="__custom__">Something else…</option>
        </select>
      )}
      <p className="ai-field-hint">{empty && options.length === 0 ? `${empty} ${hint}` : hint}</p>
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
  const [targets, setTargets] = useState<NotifyTarget[]>([]);
  const [test, setTest] = useState<GatewayTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const t = await fetchNotifyTargets();
      if (!live) return;
      setTargets(t.targets);
      setTargetsError(t.error ?? null);
    })();
    return () => { live = false; };
  }, []);

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

      {/* ⚠️ A TEST, NOT A GUESS. Until this existed the only way to know whether
          an address worked was to save it, wait for the layer's next heartbeat,
          and read a colour on another tab. It runs the LAYER'S OWN client, so a
          pass here cannot mean something different from what the layer does. */}
      <div className="ai-test-row">
        <button
          type="button" className="btn" disabled={testing || !draft.ha_mcp_url}
          onClick={async () => {
            setTesting(true);
            setTest(null);
            setTest(await testGateway({
              ha_mcp_url: draft.ha_mcp_url,
              ...(secret ? { ha_mcp_secret: secret } : {}),
            }));
            setTesting(false);
          }}
        >
          <Plug size={16} /> {testing ? "Testing…" : "Test connection"}
        </button>
        {test && (
          <div className={`ai-test-result ${test.ok ? "ok" : "fail"}`} role="status">
            {test.ok
              ? `Connected — ${test.tools} tools, ${test.entities} entities on the property.`
              : `Not connected — ${test.detail}`}
            {test.endpoint && <div className="ai-test-endpoint">tried {test.endpoint}</div>}
          </div>
        )}
      </div>

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
      <Picker
        id="ai-model-fast" label="Model for routine work" value={draft.model_fast}
        onChange={(v) => set("model_fast", v)} options={MODEL_CHOICES}
        placeholder="a model id"
        hint="The cheaper, quicker model for routine judgement."
      />
      <Picker
        id="ai-model-writing" label="Model for writing" value={draft.model_writing}
        onChange={(v) => set("model_writing", v)} options={MODEL_CHOICES}
        placeholder="a model id"
        hint="The more capable model, used when something has to be explained to
              a person. A model this list has not heard of still works — the
              token meter reports it as unpriced rather than as free."
      />

      <div className="settings-section-title">Who it tells</div>
      <Picker
        id="ai-owner-target" label="Owner notify target" value={draft.owner_target}
        onChange={(v) => set("owner_target", v)}
        options={targets}
        empty={targetsError ? `Could not read the list (${targetsError}).` : undefined}
        placeholder="a notify service or entity"
        hint="Who the layer tells when something is the owner's to decide. This
              list is read from your own Home Assistant — a Telegram chat or a
              phone appears here under its own name. Empty means nothing is sent
              to them."
      />
      <Picker
        id="ai-fm-target" label="Facility manager notify target" value={draft.fm_target}
        onChange={(v) => set("fm_target", v)}
        options={targets}
        empty={targetsError ? `Could not read the list (${targetsError}).` : undefined}
        placeholder="a notify service or entity"
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
