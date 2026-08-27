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
import InfoHint from "@/components/common/InfoHint";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import type { AgentConfig } from "@/agent/agentApi";
import AgentActSettings from "./AgentActSettings";

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
  "enabled" | "mode" | "mcpUrl" | "triageMinutes" | "monthlyLimit"
  | "dailyUsdLimit" | "haTools"
  | "depth" | "maxOutputTokens"
  | "maxInvestigationsPerPass" | "quietHoursStart" | "quietHoursEnd" | "modelTriage" | "modelReason" | "modelBrief"
  | "modelChat" | "actuableEntities">
  & { triggers: AgentConfig["triggers"] };

const EMPTY: Draft = {
  enabled: false, mode: "observe", mcpUrl: "", triageMinutes: 15, monthlyLimit: 4000,
  haTools: false,
  dailyUsdLimit: 0, depth: "brief", maxOutputTokens: 8192,
  maxInvestigationsPerPass: 2,
  quietHoursStart: "", quietHoursEnd: "",
  modelTriage: "", modelReason: "", modelBrief: "", modelChat: "",
  // ⚠️ EMPTY, AND `config.MUST_BE_EMPTY` MAKES THAT A REQUIREMENT RATHER THAN
  // A DEFAULT: a seeded entry here would be an agent acting on a device nobody
  // authorised, on every villa that has not opened this panel.
  actuableEntities: [],
  triggers: { scheduled: true, chat: false },
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
function Num({ label, note, more, value, min, onChange }: {
  label: string; note: string; more?: React.ReactNode; value: number; min: number;
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
      <p className="muted body-text">{note}{more ? <InfoHint label={label}>{more}</InfoHint> : null}</p>
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
function Choice<T extends string>({ label, note, more, value, options, onChange }: {
  label: string; note: React.ReactNode; more?: React.ReactNode; value: T;
  options: { id: T; text: string; hint: string }[];
  onChange: (v: T) => void;
}) {
  const chosen = options.find((o) => o.id === value) ?? options[0];
  return (
    <label className="fm-field">
      <p className="muted body-text">{note}{more ? <InfoHint label={label}>{more}</InfoHint> : null}</p>
      <div className="segmented segmented-wrap" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" title={o.hint}
                  className={value === o.id ? "active" : ""}
                  onClick={() => onChange(o.id)}>
            {o.text}
          </button>
        ))}
      </div>
      {/* ⚠️ THE NAME GOES DIRECTLY UNDER ITS CONTROL, exactly as `Num` and
          `Text` place theirs — it used to sit AFTER the chosen option's
          explanation, so a paragraph separated a field from its own label and
          the label read as a heading for whatever came next. Reported from the
          Settings tab: "How it should work" floating under a sentence about
          Live mode. `.fm-field` is a plain column with no `order` rules, so
          DOM order is what the reader sees. */}
      <span>{label}</span>
      {/* ⚠️ THE CHOSEN OPTION EXPLAINS ITSELF UNDERNEATH. A segmented control
          shows three words and hides the consequence of picking one; the whole
          point of the merge is fewer controls, not less information. */}
      <p className="muted body-text">{chosen.hint}</p>
    </label>
  );
}


function Text({ label, note, more, value, placeholder, onChange }: {
  label: string; note: string; more?: React.ReactNode; value: string; placeholder?: string;
  onChange: (v: string) => void;
}) {
  // What is in force: the typed value, or the default the placeholder names.
  const effective = value || placeholder || "";
  const known = MODELS.includes(effective);
  const [showBox, setShowBox] = useState(!known);
  return (
    <label className="fm-field">
      {/* Same order as `Num`: explanation, control, then the field's name. */}
      <p className="muted body-text">{note}{more ? <InfoHint label={label}>{more}</InfoHint> : null}</p>
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
    // ⚠️ "observe" WHEN ABSENT OR UNRECOGNISED, matching the backend. Reading
    // an unknown value as "live" would render "delivering" for a villa that is
    // in fact silent — the most misleading possible direction. A config written
    // by a NEWER version survives a downgrade untouched (`config.view` keeps
    // unknown keys), so this can be handed a word it has never heard of.
    mode: (c.mode === "live" || c.mode === "ask") ? c.mode : "observe",
    mcpUrl: String(c.mcpUrl ?? ""),
    triageMinutes: Number(c.triageMinutes ?? EMPTY.triageMinutes),
    monthlyLimit: Number(c.monthlyLimit ?? EMPTY.monthlyLimit),
    dailyUsdLimit: Number(c.dailyUsdLimit ?? EMPTY.dailyUsdLimit),
    haTools: Boolean(c.haTools ?? EMPTY.haTools),
    maxOutputTokens: Number(c.maxOutputTokens ?? EMPTY.maxOutputTokens),
    // ⚠️ SAME RULE AS `mode`: an unrecognised depth reads as the cheapest one.
    depth: (c.depth === "normal" || c.depth === "thorough") ? c.depth : "brief",
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
      {/* ⚠️ THE MASTER SWITCH MOVED TO THE DIALOG HEADER (v2.749.0) AND IS
          NOT DUPLICATED HERE. It is the one control that answers "am I
          spending anything", so it belongs where it is visible from every tab
          rather than as the first row of the fifth one. Two controls over one
          stored key in one dialog is a lost update. */}

      {/* ⚠️ TWO CHECKBOXES BECAME ONE CHOICE BECAUSE THE 2x2 HAD A DEAD CELL,
          AND THE REFERENCE VILLA SPENT ITS WHOLE SHADOW PERIOD IN IT.
          ⚠️ THE MERGE MOVED INTO THE STORE IN 2.756.0 and this control now
          writes ONE key, `mode`. Until then it wrote both, so the dead cell was
          unreachable through this dialog and perfectly reachable by anything
          else that wrote the document. The history below is why the control
          exists; `test_agent_mode_merge.py` is what now makes the cell
          impossible rather than merely unclicked.
          `shadow` and `investigate_mode` WERE independent booleans, so "stay silent" +
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
        /* ⚠️ NOT "from most cautious to fully live" ANY MORE. That framing said
           these are one ladder, and on spending they are not: "Observe only"
           investigated on every pass at full price while "Ask me first" spent
           nothing until approved, so the leftmost option was the most
           expensive. Reported by the owner reading the labels literally, which
           is the correct way to read a label. They are three points in two
           axes — who decides to investigate, and whether you are told at the
           time — and the note now says that instead of implying a ladder. */
        note="Each step does everything the one before it does, and one thing more."
        /* ⚠️ THE TOOLTIP SAYS ONLY WHAT IS TRUE OF ALL THREE. It used to
           compare the modes, which the labels now do themselves — and it
           CONTRADICTED the description below it on the same screen: the tooltip
           read "your briefing is written either way" while Flag & Ask's own
           text read "nothing reaches the briefing". Both were reaching for the
           same fact and only one is right — the briefing is written in every
           mode; what changes is whether the assistant's own findings are IN it.
           Reported by the owner, who had both paragraphs on screen at once. */
        more={<>
          Your briefing is written whichever you pick. Urgent things always
          ignore quiet hours.
        </>}
        value={draft.mode}
        // ⚠️ ONE KEY WRITTEN, NOT TWO (2.756.0). This used to write `shadow`
        // AND `investigateMode` from one control — the merge lived in the UI
        // while the store still held two values that could disagree, with
        // nothing able to say which the villa was actually in.
        // ⚠️ AND A JSX COMMENT CANNOT SIT BETWEEN ATTRIBUTES; this is the third
        // time in one session. `{/* */}` is an EXPRESSION and only belongs
        // where a child goes.
        onChange={(mode) => edit({ mode })}
        options={[
          /* ⚠️ THE STORED IDS ARE UNCHANGED (`observe`/`ask`/`live`). An id is
             written into every villa's config document; renaming one would
             silently reset the setting on read. Only the ORDER and the TEXT
             move.

             ⚠️ THE ORDER IS NOW ASK · OBSERVE · LIVE, AND THAT IS WHAT MAKES IT
             A LADDER AT LAST. Owner's proposal, and it is right: with `observe`
             leftmost, the row was non-monotonic on every axis that matters —
             the "most cautious" option investigated on every pass at full price
             while the middle one spent almost nothing. In this order all three
             axes increase together: spend (≈$0.01 → full → full), autonomy
             (none → investigates → investigates and acts), and what reaches you
             (nothing → the briefing → the briefing, your phone and a job).

             ⚠️ AND THE NAMES ARE THE VERBS, NOT A MOOD. "Observe only" said
             do-less and meant costs-the-same; "Live" said nothing at all. Each
             label now lists what the villa actually does, and each step ADDS a
             verb to the one before it.

             ⚠️ THE FIRST ONE IS "FLAG & ASK", NOT "LOG ONLY (BRIEFING)" — the
             owner's suggested wording, corrected against the code. In `ask`,
             `reason.follow_up` records the escalations and RETURNS without
             calling `investigate_subject`, so no Concern is ever created and
             NOTHING agent-derived reaches the briefing. Naming it after the
             briefing would promise content this mode cannot produce, which is
             the exact defect "Observe only" had. */
          { id: "ask", text: "Flag & Ask",
            hint: "Spends almost nothing on its own. Approving one runs the "
                + "full investigation straight away, and that one then behaves "
                + "like the last step." },
          /* ⚠️ "and nowhere else" WAS THE SHADOW-STORE ERA and stopped being
             true on 2026-08-28: observe-mode concerns now land on the Reason
             tab and are messaged once as an FYI. What this mode still
             withholds is everything that ASKS: no chase, no to-do job. */
          { id: "observe", text: "Investigate & Log Only",
            hint: "Costs the same as the last step. What it concludes appears "
                + "on the Reason tab, in your briefing, and as a one-off "
                + "for-your-information message — nothing is escalated and "
                + "nothing is asked of you." },
          { id: "live", text: "Investigate & Log +Escalation",
            hint: "Messages you when it concludes something, adds a job to "
                + "your to-do list, and chases until someone acknowledges." },
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
          Lets the villa answer questions about your home. Empty still works,
          from a much smaller set of its own.
          <InfoHint label="Home Assistant MCP add-on address">
            Open the Home Assistant MCP add-on, look at its log, and copy the
            address on the line beginning “Starting MCP server” — it ends in a
            long random path.
          </InfoHint>
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
        note={`About ${perDay} checks a day, and the single biggest thing on the bill.`}
        more={<>
          Doubling this roughly halves the cost. It cannot go below{" "}
          {MIN_TRIAGE_MINUTES} minutes. It sets how often the model is asked —
          not how often the villa is observed, which runs on its own faster
          clock and costs nothing.
        </>}
        value={draft.triageMinutes} min={MIN_TRIAGE_MINUTES}
        onChange={(v) => edit({ triageMinutes: v })}
      />

      {/* ⚠️ MONEY FIRST, BECAUSE IT IS THE ONE AN OWNER CAN PRICE. The two
          boxes below count REQUESTS, and on the reference villa one triage pass
          cost $0.010 against $0.37 for one investigation — a 37x spread inside
          the unit — so "4,000 requests" is a ceiling nobody can translate into
          a bill. This is the same question asked in the unit on the invoice. */}
      <Num
        label="Never spend more than … dollars a day"
        note="0 means no daily limit. Reached, the villa stops asking the AI until midnight."
        more={<>
          {/* ⚠️ SHORT SENTENCES, ONE IDEA PER PARAGRAPH — the same rewrite the
              tools hint needed twice. A 32-word sentence with two dashes in it
              is where this one was. */}
          <p>
            The other box counts requests. Requests are not all the same price.
            A quick look costs a fraction of a cent. A full investigation costs
            a few tens of cents.
          </p>
          <p>
            This box is in dollars, so it is the setting that decides your bill.
          </p>
          <p>
            It covers everything: the villa&rsquo;s own checks and your
            conversations. A ceiling with an exemption in it is not a ceiling.
          </p>
        </>}
        value={draft.dailyUsdLimit} min={0}
        onChange={(v) => edit({ dailyUsdLimit: v })}
      />
      <Num
        label="Never use more than … AI requests a month"
        note="A hard ceiling. Reached, the villa stops asking the AI and says so."
        more={<>
          It counts requests, not words — one investigation that thinks eight
          times spends eight of them. This is what stops a bill you did not
          agree to, rather than a warning after the fact.
        </>}
        value={draft.monthlyLimit} min={0}
        onChange={(v) => edit({ monthlyLimit: v })}
      />
      {/* ⚠️ "Of those, keep … aside for answering you" WAS DELETED IN
          2.756.0. It reserved part of the request ceiling for chat so a long
          conversation could not eat the checks' allowance — sound, and the
          least load-bearing of three ceilings for one budget: it defaulted to
          0 ("work it out"), no owner had set one, and it was counted in
          requests, a unit that spans 37x in price. Two remain and they answer
          different questions — the monthly count bounds the provider contract,
          the daily dollar figure bounds the invoice. */}

      {/* ⚠️ STILL ABOVE "how deeply", BY THE OWNER'S OWN PLACEMENT (ADR-021):
          that section is about ONE investigation's depth, and this is about how
          many are started at all. The COST box that used to sit under this pair
          has moved up beside the other two cost boxes, where the question it
          answers actually is; the two toggles below decide what supervision
          does on its own and when it may interrupt you, which is a different
          decision from what it costs and now says so. */}
      <Num
        label="Look into at most … things per check"
        note="Each one is a full, expensive look at a single piece of equipment."
        more={<>
          Anything above this waits for the next check rather than being
          dropped — nothing is lost, it is looked at a little later.
        </>}
        value={draft.maxInvestigationsPerPass} min={0}
        onChange={(v) => edit({ maxInvestigationsPerPass: v })}
      />

      {/* ⚠️ "What it may do without asking" MOVED TO ACT & TELL IN 2.765.0,
          NEXT TO THE LIST IT IS AND-ED WITH. It lived here while the device
          allow-list lived on Act & Tell, so its tooltip had to END with a
          cross-reference — "what it may touch is listed on Act & Tell, both
          must agree" — pointing at something the reader could not see, and
          since 2.759.0 not even in the same dialog. Reported: "there is no
          list and the text is not clear about it".
          ⚠️ THE FIX WAS NOT BETTER WORDING. Two halves of one authority
          decision, two screens: the sentence existed to paper over the split.
          Put them together and it is not needed at all. */}
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
        note="The only setting that changes what one investigation costs."
        more={<>
          An investigation is the slow part that works out <em>why</em>, after a
          check has spotted that something looks wrong. Raise this if
          investigations keep ending without reaching a conclusion.
        </>}
        value={draft.depth}
        onChange={(depth) => edit({ depth })}
        // ⚠️ THE GUIDANCE CHANGED WITH THE MEASUREMENT (2.752.0), not with
        // taste. "Normal suits most villas" was written before anyone had
        // measured a real investigation: every one of them used all eight
        // rounds, which means the cap and not the task was deciding when to
        // stop, and the runs since have answered in four with seven readings.
        // Brief is the shipped default now and the copy says so.
        options={[
          { id: "brief", text: "Brief",
            hint: "Four rounds of thinking and twelve readings — and the "
                + "measured setting: real investigations here finish in four. "
                + "This is the default." },
          { id: "normal", text: "Normal",
            hint: "Eight rounds and twenty-four readings. Roughly twice the "
                + "cost of Brief. Worth it only if investigations keep ending "
                + "without a conclusion." },
          { id: "thorough", text: "Thorough",
            hint: "Twelve rounds and thirty-six readings — three times Brief. "
                + "For a villa where the cause is genuinely hard to reach." },
        ]}
      />
      {/* ⚠️ THIS SITS UNDER "how thorough" BECAUSE IT IS THE OTHER FACTOR OF
          THE SAME PRODUCT. Cost is `prefix x turns`: the box above sets the
          turns, this sets the prefix, and on the reference villa it set 84% of
          it — 44 tool schemas at 43,700 tokens, re-read on every turn, against
          the ten the agent's own trace says it ever calls.
          ⚠️ "FIVE TIMES CHEAPER" WAS WRONG AND SHIPPED (fixed 2.758.0). The
          prefix is 5.3x smaller; the INVESTIGATION is about 2x cheaper, because
          uncached input and output do not shrink with it. Derivation, so the
          next rewording does not restate the wrong one: at 8 turns, cache read
          is turns x prefix x $0.30/M, and the fresh input (~41k tok) and output
          (~4k tok) are unchanged either way — $0.50 on, $0.24 off. Five times
          is what is SENT; twice is what is PAID.
          ⚠️ AND THE COPY LEADS WITH WHAT THE FEATURE DOES, NOT WITH ITS PRICE.
          Reported as "very bad ... not clear what this feature does": it opened
          on instruction sheets and tokens and never said, in the reader's
          terms, what the assistant can do differently when this is on. */}
      <ToggleField
        checked={draft.haTools}
        onChange={(haTools) => edit({ haTools })}
        label="Let it go looking in Home Assistant"
        note="Off, it can only examine devices the villa already knows about."
        more={<>
          {/* ⚠️ THE THIRD REWRITE, AND THE FIRST TWO WERE INACCURATE AS WELL AS
              UNCLEAR. Both implied that OFF means no Home Assistant access. It
              does not: `read_state`, `read_history` and `read_automation_trace`
              all talk to HA either way. What OFF restricts is the REACH — those
              tools take a `ref`, a handle minted from the villa's own records
              (`refs.resolve`), so the assistant can examine any device the
              villa already knows about and cannot go looking for one nobody has
              mentioned. That is the real distinction and it is what a reader
              can act on; "44 tool descriptions instead of 10" is our plumbing. */}
          <p>
            Off, it can still read any device the villa already knows about. It
            sees their state and their history. What it cannot do is go looking
            for something nobody has mentioned.
          </p>
          <p>
            On, it can search Home Assistant itself. It can find a device by
            name. It can open an integration. It can check system health.
          </p>
          <p>
            Turn it on if investigations keep missing something you can see in
            Home Assistant.
          </p>
          <p>
            It roughly doubles what each investigation costs, because every step
            carries a much longer list of what it may use.
          </p>
          <p>
            Your own conversations with the assistant are unaffected. They
            always have everything.
          </p>
        </>}
      />
      {/* ⚠️ A CEILING, NOT A SPEND, AND THE NOTE SAYS SO — otherwise this reads
          as a cost dial and gets turned DOWN, which is the setting that was
          silently killing 7 of every 8 supervision passes. */}
      <Num
        label="Room to think and answer, per step (tokens)"
        note="A limit, not a cost — you pay for what it writes. 8192 suits most villas."
        more={<>
          How much it may write in one step, its own reasoning included. Set too
          low, a step runs out mid-thought and everything it read that step is
          thrown away. Raise it if answers stop arriving.
        </>}
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
        Leave a box empty to use the model named in it.
        <InfoHint label="Choosing a model">
          A bigger model is not better here. Most of the bill goes on the
          routine checks and on answering you, and both of those want a small
          fast model — the one job where a capable model earns its price is
          investigating a problem, which happens rarely.
        </InfoHint>
      </p>
      <Text label="For the routine checks" value={draft.modelTriage}
        placeholder="claude-haiku-4-5"
        note="Runs all day. A small fast model is the right fit."
        more="This is where an expensive choice costs the most, because it runs
              far more often than anything else here."
        onChange={(v) => edit({ modelTriage: v })} />
      <Text label="For answering your questions" value={draft.modelChat}
        placeholder="claude-sonnet-5"
        note="Every message you send the villa. Worth a capable model."
        more="Not the most expensive one, though — you will use this often."
        onChange={(v) => edit({ modelChat: v })} />
      <Text label="For investigating a problem" value={draft.modelReason}
        placeholder="claude-opus-5"
        note="The one job where the best model earns its price."
        more="It runs only on something already judged worth a closer look, so
              it runs rarely — a better model here changes the conclusions you
              get without moving the bill much."
        onChange={(v) => edit({ modelReason: v })} />
      <Text label="For writing your briefings" value={draft.modelBrief}
        placeholder="claude-sonnet-5"
        note="Turns the findings into the summary you receive."
        more="It runs once per briefing, so this choice barely moves the bill."
        onChange={(v) => edit({ modelBrief: v })} />

      {/* ⚠️ MOVED HERE FROM THE "Act & Tell" TAB (2026-08-27, owner's
          judgement: "the content of Act & Tell seems more relevant for
          Settings rather than a visible reporting Tab"). They are right, and
          the tab's own header had argued the other way — that these belong
          beside the tier they govern "so an owner can see the whole of what
          the villa is permitted to do without opening a settings dialog".
          That goal survives; what changes is HOW. Act & Tell now REPORTS those
          permissions in a sentence anybody can read, and editing them happens
          here with every other setting — so the reporting tabs report and the
          settings dialog configures, which is what the other four tiers
          already do. */}
      <AgentActSettings />
    </div>
  );
}
