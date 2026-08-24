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
import ActuableDevicesPanel from "./ActuableDevicesPanel";
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
  "enabled" | "shadow" | "actEnabled" | "mcpUrl" | "triageMinutes" | "monthlyLimit" | "chatMonthlyLimit"
  | "maxTurns" | "maxToolCalls" | "maxOutputTokens" | "investigateMode"
  | "maxInvestigationsPerPass" | "quietHoursStart" | "quietHoursEnd" | "modelTriage" | "modelReason" | "modelBrief"
  | "modelChat" | "actuableEntities">
  & { triggers: AgentConfig["triggers"] };

const EMPTY: Draft = {
  enabled: false, shadow: true, actEnabled: false, mcpUrl: "", triageMinutes: 15, monthlyLimit: 4000,
  chatMonthlyLimit: 0, maxTurns: 8, maxToolCalls: 24, maxOutputTokens: 8192,
  investigateMode: "auto", maxInvestigationsPerPass: 3,
  quietHoursStart: "", quietHoursEnd: "",
  modelTriage: "", modelReason: "", modelBrief: "", modelChat: "",
  // ⚠️ EMPTY, AND `config.MUST_BE_EMPTY` MAKES THAT A REQUIREMENT RATHER THAN
  // A DEFAULT: a seeded entry here would be an agent acting on a device nobody
  // authorised, on every villa that has not opened this panel.
  actuableEntities: [],
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
    // ⚠️ FALSE WHEN ABSENT, matching the backend. Reading a missing
    // `act_enabled` as true would render "may operate devices" for a villa
    // that cannot — the most misleading possible direction for this flag.
    actEnabled: c.actEnabled === true,
    mcpUrl: String(c.mcpUrl ?? ""),
    triageMinutes: Number(c.triageMinutes ?? EMPTY.triageMinutes),
    monthlyLimit: Number(c.monthlyLimit ?? EMPTY.monthlyLimit),
    chatMonthlyLimit: Number(c.chatMonthlyLimit ?? EMPTY.chatMonthlyLimit),
    maxTurns: Number(c.maxTurns ?? EMPTY.maxTurns),
    maxToolCalls: Number(c.maxToolCalls ?? EMPTY.maxToolCalls),
    maxOutputTokens: Number(c.maxOutputTokens ?? EMPTY.maxOutputTokens),
    // ⚠️ ANYTHING THAT IS NOT `approve` READS AS `auto`, matching the backend's
    // own default rather than trusting the stored value to be one of the two.
    // A config written by a newer version survives a downgrade untouched
    // (`config.view` keeps unknown keys), so this box can be handed a word it
    // has never heard of.
    investigateMode: c.investigateMode === "approve" ? "approve" : "auto",
    maxInvestigationsPerPass: Number(
      c.maxInvestigationsPerPass ?? EMPTY.maxInvestigationsPerPass),
    // ⚠️ AN ARRAY OR NOTHING. A stored non-array (a hand-edited document, an
    // older shape) must read as EMPTY — the direction that authorises nothing —
    // rather than reaching the panel as a value it would then re-save.
    actuableEntities: Array.isArray(c.actuableEntities)
      ? c.actuableEntities.map(String) : [],
    quietHoursStart: String(c.quietHoursStart ?? ""),
    quietHoursEnd: String(c.quietHoursEnd ?? ""),
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
      {/* ⚠️ EVERY LABEL BELOW SAYS WHAT HAPPENS, NOT WHAT THE CODE DOES. The
          tab was reported as "very poorly created, descriptions absolutely not
          user friendly", and the cause was consistent: the words were the
          implementation's. "Cadence", "shadow", "cutover", "triage pass",
          "turns" and "tool calls" are all real names in this codebase and none
          of them is a thing the person who owns the villa has ever heard of.
          The settings themselves are unchanged — only what they are called. */}
      <div className="settings-section-title">
        What supervision is allowed to do
      </div>
      <label className="toggle">
        <input type="checkbox" checked={draft.enabled}
          onChange={(e) => edit({ enabled: e.target.checked })} />
        <span>Watch the villa and look for problems</span>
      </label>
      <p className="muted body-text">
        Off means nothing runs and nothing is spent. Home Assistant keeps
        working exactly as it does today — this only adds the watching.
      </p>

      <label className="toggle">
        <input type="checkbox" checked={draft.shadow}
          onChange={(e) => edit({ shadow: e.target.checked })} />
        <span>Stay silent — write findings down, tell nobody</span>
      </label>
      <p className="muted body-text">
        On to begin with, so you can read a few weeks of what it would have sent
        before it sends anything. ⚠️ It still costs the same while silent — it
        does all the same thinking and only holds back the message. To spend
        nothing, switch the watching off above instead.
      </p>

      <div className="settings-section-title">
        Where it reads Home Assistant from
      </div>
      {/* ⚠️ PASTED, NOT DISCOVERED, AND THAT IS A PRIVILEGE DECISION. Finding
          the add-on automatically needs a Supervisor role that also grants
          installing and stopping add-ons — too much for a dashboard to ask of
          somebody installing it from a repository they do not own, for the sake
          of one hostname. One paste costs the owner nothing and keeps this
          add-on at the least privilege that works. */}
      <label className="fm-field">
        <span>Home Assistant MCP add-on address</span>
        <input
          value={draft.mcpUrl}
          onChange={(e) => edit({ mcpUrl: e.target.value })}
          placeholder="http://<hostname>:9583/<secret path>"
          spellCheck={false} autoCapitalize="off" autoCorrect="off"
        />
        <p className="muted body-text">
          Open the Home Assistant MCP add-on, look at its log, and copy the
          address on the line beginning “Starting MCP server” — it ends in a
          long random path. That add-on is what lets the villa answer questions
          about your home; leave this empty and it answers from a much smaller
          set of its own.
        </p>
      </label>

      <div className="settings-section-title">
        How often it checks, and what that costs
      </div>
      <Num
        label="Check the villa every … minutes"
        note={`About ${perDay} checks a day. This is the single biggest thing`
              + ` on the bill: doubling the number roughly halves it. Cannot be`
              + ` set below ${MIN_TRIAGE_MINUTES} minutes.`}
        value={draft.triageMinutes} min={MIN_TRIAGE_MINUTES}
        onChange={(v) => edit({ triageMinutes: v })}
      />

      <Num
        label="Never use more than … AI requests a month"
        note={"A hard ceiling on everything below. When it is reached the villa"
              + " stops asking the AI and says so, rather than running up a"
              + " bill you did not agree to."}
        value={draft.monthlyLimit} min={0}
        onChange={(v) => edit({ monthlyLimit: v })}
      />
      <Num
        label="Of those, keep … aside for answering you"
        note={"So a long conversation with the villa cannot use up the requests"
              + " its own checks need. Leave at 0 and it works out a sensible"
              + " share on its own."}
        value={draft.chatMonthlyLimit} min={0}
        onChange={(v) => edit({ chatMonthlyLimit: v })}
      />

      {/* ⚠️ STILL ABOVE "how deeply", BY THE OWNER'S OWN PLACEMENT (ADR-021):
          that section is about ONE investigation's depth, and this is about how
          many are started at all. The COST box that used to sit under this pair
          has moved up beside the other two cost boxes, where the question it
          answers actually is; the two toggles below decide what supervision
          does on its own and when it may interrupt you, which is a different
          decision from what it costs and now says so. */}
      <Num
        label="Look into at most … things per check"
        note={"Each investigation is a full, expensive look at one piece of"
              + " equipment. Anything above this waits for the next check"
              + " instead of being dropped, so nothing is lost — it is just"
              + " looked at a little later."}
        value={draft.maxInvestigationsPerPass} min={0}
        onChange={(v) => edit({ maxInvestigationsPerPass: v })}
      />

      <div className="settings-section-title">
        What it may do without asking
      </div>
      {/* ⚠️ THE GATE ON TOUCHING THE VILLA, AND IT SHIPS CLOSED (ADR-023).
          Home Assistant's own MCP add-on is where the villa's readings come
          from, and its tool surface includes calling services, deleting
          entities and restarting Home Assistant. `act_enabled` is the switch
          that decides whether any of that is reachable — it has existed and
          defaulted to false since the agent was written, and nothing in
          Settings could see it, so an owner had no way to know the promise was
          being kept. A guarantee nobody can check is not a guarantee. */}
      <label className="toggle">
        <input type="checkbox" checked={draft.actEnabled}
          onChange={(e) => edit({ actEnabled: e.target.checked })} />
        <span>Let it operate devices, not just watch them</span>
      </label>
      <p className="muted body-text">
        Off, and nothing the villa does can change a switch, a light or a lock —
        it reads and it tells you. This is separate from everything above: those
        decide how much it looks and who it tells, this decides whether it may
        touch anything at all. Leave it off unless you have a reason.
      </p>
      {/* ⚠️ THE SECOND HALF OF THE SWITCH, AND IT HAD NO CONTROL AT ALL UNTIL
          2.718.0 — the same defect the quiet-hours note below records, on the
          setting where it matters most. `may_act` AND-s the toggle above with
          this list, so the toggle alone authorised nothing and an owner turning
          it on had no way to find out why nothing happened.
          ⚠️ SHOWN ONLY WHILE THE SWITCH IS ON, because the list is meaningless
          without it and a device list under an off switch invites somebody to
          fill it in believing that is the grant. */}
      {draft.actEnabled && (
        <ActuableDevicesPanel
          value={draft.actuableEntities}
          onChange={(actuableEntities) => edit({ actuableEntities })}
          disabled={ctx.saving}
        />
      )}
      <label className="toggle">
        <input type="checkbox"
          checked={draft.investigateMode === "auto"}
          onChange={(e) => edit({
            investigateMode: e.target.checked ? "auto" : "approve" })} />
        <span>Investigate what it notices, without asking you first</span>
      </label>
      <p className="muted body-text">
        A check only spots that something looks wrong; an investigation is the
        slow, expensive part that works out why. On by default, because “stay
        silent” above already stops anything reaching you. Off, it lists what it
        wanted to look into and spends nothing until you approve each one.
      </p>
      {/* ⚠️ A SETTING WITH NO CONTROL IS THE SAME DEFECT AS A CONTROL WITH NO
          SETTING, AND I SHIPPED ONE. v2.696.0 added the quiet-hours window to
          the store, the wire map and the TypeScript type, and nothing here
          could edit it — so it stayed empty, which means "never quiet", and the
          feature looked like it was working because nothing was ever held. */}
      <div className="settings-section-title">
        When it may interrupt you
      </div>
      <label className="toggle">
        <input type="checkbox"
          checked={draft.quietHoursStart !== "" && draft.quietHoursEnd !== ""}
          onChange={(e) => edit(e.target.checked
            ? { quietHoursStart: "22:00", quietHoursEnd: "07:00" }
            : { quietHoursStart: "", quietHoursEnd: "" })} />
        <span>Do not wake anyone for something that can wait</span>
      </label>
      <p className="muted body-text">
        Anything urgent still arrives immediately, at any hour — that is what
        makes it urgent. This holds back only the rest, until the morning, and
        only while the property is empty: if someone is staying there they are
        living with the problem, so they are told.
      </p>
      {draft.quietHoursStart !== "" && draft.quietHoursEnd !== "" && (
        <div className="editable-row">
          <div className="editable-row-fields">
            <label className="fm-field">
              <span>Quiet from</span>
              <input type="time" value={draft.quietHoursStart}
                onChange={(e) => edit({ quietHoursStart: e.target.value })} />
            </label>
            <label className="fm-field">
              <span>Until</span>
              <input type="time" value={draft.quietHoursEnd}
                onChange={(e) => edit({ quietHoursEnd: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      <div className="settings-section-title">
        How deeply it looks into one problem
      </div>
      <p className="muted body-text">
        Both of these bound a single investigation. Lower is cheaper and reaches
        shallower conclusions; higher costs more and is more likely to find the
        real cause.
      </p>
      <Num
        label="Think again at most … times"
        note={"Each round it reads what it has found so far and decides what to"
              + " check next. Running out simply ends the investigation with"
              + " what it has."}
        value={draft.maxTurns} min={1}
        onChange={(v) => edit({ maxTurns: v })}
      />
      <Num
        label="Read at most … things from Home Assistant"
        note={"How many separate readings — a device's history, a room's"
              + " temperature, an automation's log — it may take while looking"
              + " into one problem."}
        value={draft.maxToolCalls} min={1}
        onChange={(v) => edit({ maxToolCalls: v })}
      />
      {/* ⚠️ A CEILING, NOT A SPEND, AND THE NOTE SAYS SO — otherwise this reads
          as a cost dial and gets turned DOWN, which is the setting that was
          silently killing 7 of every 8 supervision passes. */}
      <Num
        label="Room to think and answer, per step (tokens)"
        note={"How much the assistant may write in one step, including its"
              + " own reasoning. This is a limit, not a cost: you pay for what"
              + " it actually writes. Set too low, a step runs out mid-thought"
              + " and everything it read is thrown away. Raise it if answers"
              + " stop arriving; 8192 suits most villas."}
        value={draft.maxOutputTokens} min={1024}
        onChange={(v) => edit({ maxOutputTokens: v })}
      />

      {/* ⚠️ THREE HEADINGS OVER TEN FIELDS, after the tab was reported as not
          understandable. The fields were always in order of consequence
          (`ADR-016` and this file's header) and nothing SAID so, so a reader
          met ten similar boxes and no shape. The models come last because they
          are the one group with a sensible blank. */}
      <div className="settings-section-title">
        Which AI model does which job
      </div>
      {/* ⚠️ FREE TEXT WITH SUGGESTIONS, not a picker. Pinning a model list in
          the app would make THIS the thing that has to ship for a new model to
          be usable (ADR-016) — but blank fields with no hint are how a villa
          ends up on the most expensive default without choosing it, which is
          exactly what happened. The segments SUGGEST; they do not constrain —
          the box stays typeable, so a model this release never heard of is
          reachable without one. */}
      <p className="muted body-text">
        Leave a box empty to use the model named in it. A bigger model is not
        better here — most of the bill goes on the routine checks and on
        answering you, and those two want a small fast model.
      </p>
      <Text label="For the routine checks" value={draft.modelTriage}
        placeholder="claude-haiku-4-5"
        note="Runs every few minutes, all day. A small fast model is the right
              fit, and this is where an expensive choice costs the most."
        onChange={(v) => edit({ modelTriage: v })} />
      <Text label="For answering your questions" value={draft.modelChat}
        placeholder="claude-sonnet-5"
        note="Every message you send the villa. Worth a capable model — but not
              the most expensive one, because you will use it often."
        onChange={(v) => edit({ modelChat: v })} />
      <Text label="For investigating a problem" value={draft.modelReason}
        placeholder="claude-opus-5"
        note="Runs only on something already worth a closer look, so it runs
              rarely. This is the one job where the best model earns its price."
        onChange={(v) => edit({ modelReason: v })} />
      <Text label="For writing your briefings" value={draft.modelBrief}
        placeholder="claude-sonnet-5"
        note="Turns the findings into the summary you receive. Runs once per
              briefing, so the choice barely moves the bill."
        onChange={(v) => edit({ modelBrief: v })} />

    </div>
  );
}
