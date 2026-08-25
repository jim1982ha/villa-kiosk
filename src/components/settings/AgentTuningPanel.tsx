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

import ToggleField from "@/components/common/ToggleField";
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
      {/* ⚠️ THE DOM IS IN THE FINAL ORDER TOO, NOT ONLY THE CSS. `.fm-field`
          carries `order` rules that produce exactly this sequence, and they are
          provably in the shipped bundle — yet the owner reported the old order
          on the shipped build twice. Rather than argue with a cascade I cannot
          observe on their device, the markup now says the same thing the
          stylesheet does. The two agree, so `order` is a no-op here and remains
          only to cover the fields still written the other way round. */}
      <p className="muted body-text">{note}</p>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={typed ?? String(value)}
        onChange={(e) => type(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      />
      <span>{label}</span>
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

/** One choice from a small closed set, on the `.segmented` control this
 *  stylesheet already defines. Same reading order as `Num` and `Text`:
 *  explanation, control, name.
 *
 *  ⚠️ IT EXISTS BECAUSE TWO PAIRS OF CONTROLS WERE EACH ONE CONCEPT WEARING
 *  TWO WIDGETS, and one of the pairs had a combination that silently did
 *  nothing. A closed set makes the dead combination unreachable rather than
 *  merely discouraged — the same reason `agent/review.py` puts an unapproved
 *  playbook in a different DIRECTORY instead of behind a flag. */
function Choice<T extends string>({ label, note, value, options, onChange }: {
  label: string; note: React.ReactNode; value: T;
  options: { id: T; text: string; hint: string }[];
  onChange: (v: T) => void;
}) {
  const chosen = options.find((o) => o.id === value) ?? options[0];
  return (
    <label className="fm-field">
      <p className="muted body-text">{note}</p>
      <div className="segmented segmented-wrap" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" title={o.hint}
                  className={value === o.id ? "active" : ""}
                  onClick={() => onChange(o.id)}>
            {o.text}
          </button>
        ))}
      </div>
      {/* ⚠️ THE CHOSEN OPTION EXPLAINS ITSELF UNDERNEATH. A segmented control
          shows three words and hides the consequence of picking one; the whole
          point of the merge is fewer controls, not less information. */}
      <p className="muted body-text">{chosen.hint}</p>
      <span>{label}</span>
    </label>
  );
}


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
      {/* Same order as `Num`: explanation, control, then the field's name. */}
      <p className="muted body-text">{note}</p>
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
      <span>{label}</span>
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
      <ToggleField
        checked={draft.enabled}
        onChange={(enabled) => edit({ enabled })}
        label="Watch the villa and look for problems"
        note={<>
Off means nothing runs and nothing is spent. Home Assistant keeps
        working exactly as it does today — this only adds the watching.
        </>}
      />

      {/* ⚠️ TWO CHECKBOXES BECAME ONE CHOICE BECAUSE THE 2x2 HAD A DEAD CELL,
          AND THE REFERENCE VILLA SPENT ITS WHOLE SHADOW PERIOD IN IT. `shadow`
          and `investigate_mode` are independent booleans, so "stay silent" +
          "ask before investigating" was reachable — and in that combination
          triage escalates, `reason.follow_up` returns early recording each
          escalation as AWAITING, no Concern is ever produced, and the shadow
          diff the cutover is read from compares an empty column against the
          rules. It read "21 things your automations caught and the villa did
          not / Both found (0)" and looked like a verdict on the agent. It was
          a verdict on the settings.
          ⚠️ EACH BOX'S COPY ALSO ASSUMED THE OTHER'S STATE: "read a few weeks
          of what it would have sent" is false when nothing is investigated,
          and "stay silent already stops anything reaching you" is the reason
          auto is safe. Two controls that can only be explained in terms of
          each other are one control.
          ⚠️ THE STORED KEYS ARE UNCHANGED — this writes both, so there is no
          migration and the backend, the API and every test are untouched. */}
      <Choice<"observe" | "ask" | "live">
        label="How it should work"
        note={<>
          Three ways to run it, from most cautious to fully live. The middle one
          is the safe place to start once you want it to reach you.
        </>}
        value={draft.shadow ? "observe"
               : draft.investigateMode === "auto" ? "live" : "ask"}
        onChange={(mode) => edit(
          mode === "observe" ? { shadow: true, investigateMode: "auto" }
          : mode === "ask" ? { shadow: false, investigateMode: "approve" }
          : { shadow: false, investigateMode: "auto" })}
        options={[
          { id: "observe", text: "Observe only",
            hint: "It watches, looks into what it notices and writes findings "
                + "down — and tells you nothing. Use this to read a few weeks "
                + "of what it would have sent. It costs the same as running "
                + "live: it does all the thinking and holds back the message." },
          { id: "ask", text: "Ask me first",
            hint: "It watches and flags what looks wrong, then waits for you "
                + "to approve each closer look before spending anything on it. "
                + "Findings reach you once approved." },
          { id: "live", text: "Live",
            hint: "It watches, looks into what it notices by itself, and tells "
                + "you what it concludes. This is the normal way to run it." },
        ]}
      />

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
        <p className="muted body-text">
          Open the Home Assistant MCP add-on, look at its log, and copy the
          address on the line beginning “Starting MCP server” — it ends in a
          long random path. That add-on is what lets the villa answer questions
          about your home; leave this empty and it answers from a much smaller
          set of its own.
        </p>
        <input
          value={draft.mcpUrl}
          onChange={(e) => edit({ mcpUrl: e.target.value })}
          placeholder="http://<hostname>:9583/<secret path>"
          spellCheck={false} autoCapitalize="off" autoCorrect="off"
        />
        <span>Home Assistant MCP add-on address</span>
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
      <ToggleField
        checked={draft.actEnabled}
        onChange={(actEnabled) => edit({ actEnabled })}
        label="Let it operate devices, not just watch them"
        note={<>
Off, and nothing the villa does can change a switch, a light or a lock —
        it reads and it tells you. This is separate from everything above: those
        decide how much it looks and who it tells, this decides whether it may
        touch anything at all. Leave it off unless you have a reason.
        </>}
      />
      {/* ⚠️ THE DEVICE ALLOW-LIST MOVED TO "ACT & TELL" IN 2.729.0. It is
          AND-ed with the switch above, so it belongs beside it in principle —
          but it is only ever CONSULTED at the authority boundary, and putting
          the whole of "what the villa is permitted to do" on one tab is what
          lets an owner read that permission without assembling it from two
          dialogs. The switch stays here because it is a tuning dial; the list
          is a permission. */}
      {/* ⚠️ A SETTING WITH NO CONTROL IS THE SAME DEFECT AS A CONTROL WITH NO
          SETTING, AND I SHIPPED ONE. v2.696.0 added the quiet-hours window to
          the store, the wire map and the TypeScript type, and nothing here
          could edit it — so it stayed empty, which means "never quiet", and the
          feature looked like it was working because nothing was ever held. */}
      {/* ⚠️ QUIET HOURS MOVED TO "ACT & TELL" IN 2.729.0, for the same reason
          as the allow-list above: the window is consulted by the delivery tier
          and by nothing else, and "who may interrupt me, and when" reads as one
          question rather than two settings in different places. */}
      <div className="settings-section-title">
        How deeply it looks into one problem
      </div>
      {/* ⚠️ TWO NUMBERS BECAME ONE CHOICE, AND THE PARAGRAPH THAT USED TO SIT
          HERE IS WHY: it opened "Both of these bound a single investigation" —
          the screen was already telling a reader this was one concept wearing
          two widgets, and asking them to pick a pair of integers that only
          make sense together. Nobody wants twelve rounds and four readings.
          ⚠️ `max_output_tokens` DELIBERATELY DID NOT JOIN THEM. It is a
          CEILING that costs nothing unused, while these two are each a billable
          round trip — collapsing all three would file a free setting among
          paid ones and invite it to be turned down, which is the setting that
          was silently killing 7 of every 8 supervision passes.
          ⚠️ STORED KEYS UNCHANGED: this writes both, so no migration. */}
      <Choice<"brief" | "normal" | "thorough">
        label="How thorough each investigation is"
        note={<>
          One investigation is a slow, expensive look at one piece of equipment.
          This is the only setting that changes what one costs.
        </>}
        value={draft.maxTurns <= 5 ? "brief"
               : draft.maxTurns >= 11 ? "thorough" : "normal"}
        onChange={(depth) => edit(
          depth === "brief" ? { maxTurns: 4, maxToolCalls: 12 }
          : depth === "thorough" ? { maxTurns: 12, maxToolCalls: 36 }
          : { maxTurns: 8, maxToolCalls: 24 })}
        options={[
          { id: "brief", text: "Brief",
            hint: "Four rounds of thinking and twelve readings. Cheapest, and "
                + "it will sometimes stop before it has worked out the cause." },
          { id: "normal", text: "Normal",
            hint: "Eight rounds and twenty-four readings. Suits most villas." },
          { id: "thorough", text: "Thorough",
            hint: "Twelve rounds and thirty-six readings. Half again the cost "
                + "of Normal, and more likely to reach the real cause. Worth "
                + "it if investigations keep ending without a conclusion." },
        ]}
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
