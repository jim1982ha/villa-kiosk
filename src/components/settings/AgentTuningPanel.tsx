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

import { useState } from "react";
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
  | "maxTurns" | "maxToolCalls" | "investigateMode"
  | "maxInvestigationsPerPass" | "modelTriage" | "modelReason" | "modelBrief"
  | "modelChat">
  & { triggers: AgentConfig["triggers"] };

const EMPTY: Draft = {
  enabled: false, shadow: true, triageMinutes: 15, monthlyLimit: 4000,
  chatMonthlyLimit: 0, maxTurns: 8, maxToolCalls: 24,
  investigateMode: "auto", maxInvestigationsPerPass: 3,
  modelTriage: "", modelReason: "", modelBrief: "", modelChat: "",
  triggers: { scheduled: true, event: false, chat: false },
};

/** ⚠️ CLAMPED ON BLUR, NEVER ON KEYSTROKE, AND THE FIRST VERSION DID THE
 *  LATTER: `onChange={Math.max(min, Number(v) || min)}` re-wrote the box on
 *  every character, so typing "24" produced `max(5, 2)` = 5 before the 4
 *  arrived and the field appeared stuck at its minimum. Reported as "I can't
 *  write a number in this box".
 *
 *  ⚠️ AND AN EMPTY BOX IS A STATE, NOT A ZERO. Clearing it to retype gave
 *  `Number("") || min`, which snapped straight back to the minimum — so the
 *  field could not even be emptied. It now holds what was typed, including
 *  nothing, and resolves once the operator leaves.
 *
 *  This is the rule `VillaCoordinates` already states one file over: apply on
 *  blur, because a half-typed number is not a value. */
function Num({ label, note, value, min, onChange }: {
  label: string; note: string; value: number; min: number;
  onChange: (v: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);

  const commit = () => {
    if (typed === null) return;
    const parsed = Number(typed);
    // An unparseable or empty box reverts to the stored value rather than to
    // the minimum: the operator was editing, not asking for the floor.
    onChange(typed.trim() === "" || !Number.isFinite(parsed)
      ? value : Math.max(min, Math.round(parsed)));
    setTyped(null);
  };

  /** ⚠️ THE DRAFT LEARNS ABOUT THE EDIT AS IT IS TYPED, AND THE CLAMP STILL
   *  WAITS FOR THE BLUR. Those are two different questions and the first
   *  version answered both on blur, so the footer's Save stayed greyed while
   *  somebody was visibly typing into the box — reported, and fair: a control
   *  that has changed on screen and a dialog that says nothing has changed
   *  cannot both be right.
   *
   *  Clamping here instead is what made the field untypeable in the first
   *  place (`max(5, 2)` = 5 before the 4 arrives), so the raw number goes up
   *  unclamped and blur resolves it. The window in which the draft holds a
   *  below-minimum value is exactly "while the box has focus" — and pressing
   *  Save blurs the input before the click lands, so the value that reaches
   *  the store has been through `commit`. */
  const type = (raw: string) => {
    setTyped(raw);
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed)) onChange(Math.round(parsed));
  };

  return (
    <label className="fm-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={typed ?? String(value)}
        onChange={(e) => type(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      />
      <p className="muted body-text">{note}</p>
    </label>
  );
}

/** ⚠️ `.segmented` — THE APP'S OWN ONE-OF-N CONTROL, not a third invention.
 *  This was `<datalist>` first, which the browser draws and refuses to style
 *  (on Android it painted over the keyboard), and then a local `.model-chips`
 *  class — which was the same mistake one layer up: writing a control this app
 *  already has. Theme Modes and Villa lighting are both `.segmented`, so the
 *  selected state, the touch target, the accent treatment and the three themes
 *  are all inherited rather than re-derived. Reported as exactly that: "never
 *  recode anything that has been already used elsewhere".
 *
 *  ⚠️ THE SEGMENTS CARRY THE FULL MODEL ID, and the free-text box is HIDDEN
 *  rather than deleted (2026-08-23, owner: "remove the redundant first row and
 *  directly show the real full name in the toggle"). Correct — the box and the
 *  segments were showing the same value twice, once abbreviated, and the row
 *  cost a screenful on a phone.
 *
 *  ⚠️ BUT DELETING IT WOULD PIN THE LIST, which is the one thing ADR-016 says
 *  this app must not do: a model released after this build would need a release
 *  of the KIOSK to become usable on the villa. So the box is still there and
 *  still authoritative — it just only APPEARS when it is the only way to see
 *  the truth: the stored value is not one of the three, or "Other" is picked.
 *  Any value already stored therefore stays visible and editable, including one
 *  a future release adds to this list and an older one does not know. */
const MODELS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"];
const OTHER = "\u2026";  // the escape-hatch segment, not a model id

function Text({ label, note, value, placeholder, onChange }: {
  label: string; note: string; value: string; placeholder?: string;
  onChange: (v: string) => void;
}) {
  // What is in force: the typed value, or the default the placeholder names.
  const effective = value || placeholder || "";
  const known = MODELS.includes(effective);
  const [showBox, setShowBox] = useState(!known);
  return (
    <label className="fm-field">
      <span>{label}</span>
      <div className="segmented segmented-wrap" role="group" aria-label={label}>
        {MODELS.map((m) => (
          <button
            key={m}
            type="button"
            className={known && effective === m ? "active" : ""}
            onClick={() => { setShowBox(false); onChange(m); }}
          >
            {m}
          </button>
        ))}
        <button
          type="button"
          className={`segmented-other${!known || showBox ? " active" : ""}`}
          aria-label="Another model — type its id"
          title="Another model — type its id"
          onClick={() => setShowBox(true)}
        >
          {OTHER}
        </button>
      </div>
      {(showBox || !known) && (
        <input value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} autoFocus={showBox && known}
          spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      )}
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
    // ⚠️ ANYTHING THAT IS NOT `approve` READS AS `auto`, matching the backend's
    // own default rather than trusting the stored value to be one of the two.
    // A config written by a newer version survives a downgrade untouched
    // (`config.view` keeps unknown keys), so this box can be handed a word it
    // has never heard of.
    investigateMode: c.investigateMode === "approve" ? "approve" : "auto",
    maxInvestigationsPerPass: Number(
      c.maxInvestigationsPerPass ?? EMPTY.maxInvestigationsPerPass),
    modelTriage: String(c.modelTriage ?? ""),
    modelReason: String(c.modelReason ?? ""),
    modelBrief: String(c.modelBrief ?? ""),
    modelChat: String(c.modelChat ?? ""),
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
      <p className="muted body-text">Off means nothing runs and nothing is spent.</p>

      <label className="toggle">
        <input type="checkbox" checked={draft.shadow}
          onChange={(e) => edit({ shadow: e.target.checked })} />
        <span>Observe only — record findings, deliver nothing</span>
      </label>
      <p className="muted body-text">
        On by default. It still costs money and the Cockpit still shows what it
        found — turning it off is the moment it starts messaging people.
      </p>

      <div className="settings-section-title">
        How often, and how much
      </div>
      <Num
        label="Check the villa every (minutes)"
        note={`The largest single cost — about ${perDay} checks a day. Doubling`
              + ` it roughly halves the bill. Minimum ${MIN_TRIAGE_MINUTES}.`}
        value={draft.triageMinutes} min={MIN_TRIAGE_MINUTES}
        onChange={(v) => edit({ triageMinutes: v })}
      />

      <Num
        label="Requests a month, at most"
        note="A hard ceiling. Reaching it stops the agent cleanly and says so."
        value={draft.monthlyLimit} min={0}
        onChange={(v) => edit({ monthlyLimit: v })}
      />
      <Num
        label="Of those, reserved for chat (0 = work it out)"
        note="Ring-fenced, so a long conversation cannot starve the checks."
        value={draft.chatMonthlyLimit} min={0}
        onChange={(v) => edit({ chatMonthlyLimit: v })}
      />

      {/* ⚠️ THESE TWO BELONG HERE AND NOT UNDER "How hard it may think", by the
          owner's own placement (ADR-021). That section is about ONE
          investigation's depth; this is about how many investigations a check
          may start, which is where the bill moves from per-check to
          per-finding — the same question the two boxes above answer. */}
      <label className="toggle">
        <input type="checkbox"
          checked={draft.investigateMode === "auto"}
          onChange={(e) => edit({
            investigateMode: e.target.checked ? "auto" : "approve" })} />
        <span>Look into what a check flags, without asking first</span>
      </label>
      <p className="muted body-text">
        On by default, because “observe only” above already stops anything being
        sent. Off records what was flagged and spends nothing until you say so.
      </p>
      <Num
        label="Investigations per check, at most"
        note={"Each one is a full, expensive look at a single thing."
              + " Anything over the limit waits for the next check rather"
              + " than being lost."}
        value={draft.maxInvestigationsPerPass} min={0}
        onChange={(v) => edit({ maxInvestigationsPerPass: v })}
      />

      <div className="settings-section-title">
        How hard it may think
      </div>
      <Num
        label="Steps per investigation, at most"
        note="How many times it may think again. Lower is cheaper and blunter."
        value={draft.maxTurns} min={1}
        onChange={(v) => edit({ maxTurns: v })}
      />
      <Num
        label="Look-ups per investigation, at most"
        note="How much of the villa's data it may read in one go."
        value={draft.maxToolCalls} min={1}
        onChange={(v) => edit({ maxToolCalls: v })}
      />

      {/* ⚠️ THREE HEADINGS OVER TEN FIELDS, after the tab was reported as not
          understandable. The fields were always in order of consequence
          (`ADR-016` and this file's header) and nothing SAID so, so a reader
          met ten similar boxes and no shape. The models come last because they
          are the one group with a sensible blank. */}
      <div className="settings-section-title">
        Which models
      </div>
      {/* ⚠️ FREE TEXT WITH SUGGESTIONS, not a picker. Pinning a model list in
          the app would make THIS the thing that has to ship for a new model to
          be usable (ADR-016) — but blank fields with no hint are how a villa
          ends up on the most expensive default without choosing it, which is
          exactly what happened. The segments SUGGEST; they do not constrain —
          the box stays typeable, so a model this release never heard of is
          reachable without one. */}
      <p className="muted body-text">
        Blank uses the default shown in each box. Cheaper is usually right —
        the villa spends far more requests on routine checks and chat than on
        investigations.
      </p>
      <Text label="Model — routine checks" value={draft.modelTriage}
        placeholder="claude-haiku-4-5"
        note="Runs every cycle — a small fast model is the intended fit."
        onChange={(v) => edit({ modelTriage: v })} />
      <Text label="Model — answering messages" value={draft.modelChat}
        placeholder="claude-sonnet-5"
        note="Every question typed at the villa. This ran on the investigations
              model until v2.664.0, which is where the bill went."
        onChange={(v) => edit({ modelChat: v })} />
      <Text label="Model — investigations" value={draft.modelReason}
        placeholder="claude-opus-5"
        note="Runs only on something worth a closer look — the one place the
              frontier model earns its price."
        onChange={(v) => edit({ modelReason: v })} />
      <Text label="Model — written briefings" value={draft.modelBrief}
        placeholder="claude-sonnet-5"
        note="Used when a briefing is composed."
        onChange={(v) => edit({ modelBrief: v })} />

    </div>
  );
}
