// src/components/settings/AgentTuningPanel.tsx
//
// The agent's cadence, budget and models — the settings that decide what it
// costs and how loudly it speaks.
//
// ⚠️ EVERY ONE OF THESE ALREADY EXISTED IN THE STORE AND NONE WAS REACHABLE.
// `agent/config.py` has honoured a cadence, a monthly ceiling, per-tier models
// and shadow mode since they were written; the only agent setting the SPA ever
// rendered was the sender list. So the single largest recurring line on the
// bill — triage, every fifteen minutes, by default — could only be changed by
// editing JSON on the box. That is what this panel closes.
//
// ⚠️ THE CADENCE IS THE FIRST CONTROL BECAUSE IT IS THE BIGGEST LEVER. Doubling
// the interval halves the largest cost line and changes nothing else about how
// the system behaves; every other dial here is smaller or riskier. Ordering the
// controls by consequence is the difference between a settings page and a form.
//
// ⚠️ SHADOW MODE IS PRESENTED AS THE CUTOVER DECISION, NOT AS A CHECKBOX. It
// ships ON — the opposite of every other flag — so that an agent being switched
// on is OBSERVED for its first period rather than delivering. Turning it off is
// the moment the villa starts speaking to people, and the copy says so.
//
// ⚠️ AND IT IS A RENDERING CONVENIENCE ONLY, like every settings surface here.
// `validate_config` on the proxy is what actually bounds these values, and the
// PUT is owner-only there. Nothing in this file is a control.

import { Loader2 } from "lucide-react";

import { useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import type { AgentConfig } from "@/agent/agentApi";

/** ⚠️ A FLOOR THE BACKEND ALSO ENFORCES (`scheduler.MIN_MINUTES`). Stated here
 *  so the field cannot offer a value the server will silently raise — a control
 *  whose displayed value is not the effective one is worse than no control. */
const MIN_TRIAGE_MINUTES = 5;

/** ⚠️ NOT A LIST OF PRODUCT NAMES. The models are free text because pinning one
 *  in config rather than in code is the whole point (ADR-016): upgrading is a
 *  config change plus an eval run, never a deploy. A hardcoded picker here
 *  would make this app the thing that has to ship for a new model to be usable,
 *  which is exactly what that decision avoided. */
type Draft = Pick<AgentConfig,
  "enabled" | "shadow" | "triageMinutes" | "monthlyLimit" | "chatMonthlyLimit"
  | "maxTurns" | "maxToolCalls" | "modelTriage" | "modelReason" | "modelBrief">
  & { triggers: AgentConfig["triggers"] };

const EMPTY: Draft = {
  enabled: false, shadow: true, triageMinutes: 15, monthlyLimit: 4000,
  chatMonthlyLimit: 0, maxTurns: 8, maxToolCalls: 24,
  modelTriage: "", modelReason: "", modelBrief: "",
  triggers: { scheduled: true, event: false, chat: false },
};

function Num({ label, note, value, min, onChange }: {
  label: string; note: string; value: number; min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="fm-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      />
      <p className="muted body-text">{note}</p>
    </label>
  );
}

function Text({ label, note, value, onChange }: {
  label: string; note: string; value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="fm-field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      <p className="muted body-text">{note}</p>
    </label>
  );
}

export default function AgentTuningPanel() {
  /** ⚠️ ONE DRAFT FOR THE WHOLE DOCUMENT, SHARED WITH THE PEOPLE PANEL ABOVE.
   *  Both edit `/agent-config`, and each holding its own copy and its own
   *  revision is a lost update: saving one made the other's copy stale, so the
   *  second save was refused and the operator's edit vanished. That is what
   *  "settings in Supervision are not saved" was. See `AgentConfigDraft`.
   *
   *  ⚠️ AND THE SAVE BUTTON LEFT THIS PANEL. It was at the bottom of the
   *  panel's own content — below the fold, under ten fields — while the dialog's
   *  footer sat pinned and empty the whole time. `test_modal_shell` pins that
   *  the button which commits a form lives in the footer; this panel predated
   *  Advanced Settings having one. */
  const ctx = useAgentConfigDraft();
  const c = ctx.config;
  const draft: Draft = {
    enabled: c.enabled === true,
    // ⚠️ DEFAULTS TRUE WHEN ABSENT, matching the backend. Reading a missing
    // `shadow` as false would render "delivering" for a villa that is in fact
    // silent — the most misleading possible direction for this flag.
    shadow: c.shadow !== false,
    triageMinutes: Number(c.triageMinutes ?? EMPTY.triageMinutes),
    monthlyLimit: Number(c.monthlyLimit ?? EMPTY.monthlyLimit),
    chatMonthlyLimit: Number(c.chatMonthlyLimit ?? EMPTY.chatMonthlyLimit),
    maxTurns: Number(c.maxTurns ?? EMPTY.maxTurns),
    maxToolCalls: Number(c.maxToolCalls ?? EMPTY.maxToolCalls),
    modelTriage: String(c.modelTriage ?? ""),
    modelReason: String(c.modelReason ?? ""),
    modelBrief: String(c.modelBrief ?? ""),
    triggers: (c.triggers ?? EMPTY.triggers) as AgentConfig["triggers"],
  };
  const edit = (patch: Partial<Draft>) => ctx.edit(patch);

  if (ctx.loading) {
    return <p className="muted body-text"><Loader2 size={14} className="spin" /> Loading…</p>;
  }

  const perDay = draft.triageMinutes > 0
    ? Math.round((24 * 60) / draft.triageMinutes) : 0;

  return (
    <div className="fm-stack">
      <label className="toggle">
        <input type="checkbox" checked={draft.enabled}
          onChange={(e) => edit({ enabled: e.target.checked })} />
        <span>Supervision is switched on</span>
      </label>
      <p className="muted body-text">
        Off means nothing runs and nothing is spent — no scheduled checks, no
        chat replies, no investigations.
      </p>

      <label className="toggle">
        <input type="checkbox" checked={draft.shadow}
          onChange={(e) => edit({ shadow: e.target.checked })} />
        <span>Observe only — record findings, deliver nothing</span>
      </label>
      <p className="muted body-text">
        On by default, and deliberately: it lets the villa run a full period so
        you can read what it would have said before it says anything to anyone.
        It still costs money while on, and the Cockpit still shows what it
        found. Switching it off is the moment it starts messaging people.
      </p>

      <Num
        label="Check the villa every (minutes)"
        note={`The largest single cost. At this setting the villa is checked
               about ${perDay} times a day; doubling the interval roughly halves
               that line and changes nothing else. Minimum ${MIN_TRIAGE_MINUTES}.`}
        value={draft.triageMinutes} min={MIN_TRIAGE_MINUTES}
        onChange={(v) => edit({ triageMinutes: v })}
      />

      <Num
        label="Requests a month, at most"
        note="A hard ceiling counted in requests rather than tokens, because a
              request is something the villa can count for itself. Reaching it
              stops the agent cleanly and says so, rather than failing."
        value={draft.monthlyLimit} min={0}
        onChange={(v) => edit({ monthlyLimit: v })}
      />
      <Num
        label="Of those, reserved for chat (0 = work it out)"
        note="Chat is the one input a person can spend all day. Its own share
              means a long conversation degrades chat and never starves the
              supervision that is the actual product."
        value={draft.chatMonthlyLimit} min={0}
        onChange={(v) => edit({ chatMonthlyLimit: v })}
      />

      <Num
        label="Steps per investigation, at most"
        note="How many times the agent may think again before it must answer.
              Lower is cheaper and blunter."
        value={draft.maxTurns} min={1}
        onChange={(v) => edit({ maxTurns: v })}
      />
      <Num
        label="Look-ups per investigation, at most"
        note="How many times it may consult the villa's data in one go."
        value={draft.maxToolCalls} min={1}
        onChange={(v) => edit({ maxToolCalls: v })}
      />

      <Text label="Model — routine checks" value={draft.modelTriage}
        note="Runs on every cycle, so this is where model choice shows up on the
              bill. A small fast model is the intended fit."
        onChange={(v) => edit({ modelTriage: v })} />
      <Text label="Model — investigations" value={draft.modelReason}
        note="Runs only when something is worth a closer look, and does the
              reasoning you are paying for."
        onChange={(v) => edit({ modelReason: v })} />
      <Text label="Model — written briefings" value={draft.modelBrief}
        note="Used when a briefing is composed."
        onChange={(v) => edit({ modelBrief: v })} />

    </div>
  );
}
