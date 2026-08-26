// src/components/agent/tiers.tsx
//
// The five tiers of the target architecture, as the UI's own vocabulary.
// One definition, used by every tab, so no two describe the same tier
// differently.
//
// ⚠️ THE STRUCTURE IS THE HLD'S, NOT A UI INVENTION. §4 orders the tiers by how
// fast they must answer and how much judgement they are trusted with —
// "speed decreases and judgement increases as you go up; determinism returns at
// the top, because deciding who to wake at 3am is not a judgement a model
// should make". The tabs are that order, so a reader moving left to right walks
// the villa's own signal path: something happens, it is recorded, something
// cheap asks whether it matters, something expensive works out why, and
// something deterministic decides who is told.
//
// ⚠️ EVERY TIER STATES THREE FACTS BECAUSE THEY ARE THE ONES THAT DECIDE TRUST:
// how fast it answers, whether a model is involved, and whether it still works
// with no internet. §4.1's boundaries are drawn on exactly those axes — the
// reflex/observe line is "a physical deadline", observe/triage is "the
// determinism boundary", triage/reason is "a cost boundary", and reason/act is
// "the authority boundary, and the most important one". A reader who can see
// those three facts per tier can work out the boundaries without being taught
// them.

import type { ReactNode } from "react";
import { Gauge, Sparkles, Wifi } from "lucide-react";
import SourceChip, { type Source } from "@/components/common/SourceChip";
import InfoHint from "@/components/common/InfoHint";

export interface Tier {
  /** The tier number from the HLD, kept because the document uses it. */
  n: number;
  /** ⚠️ THE HLD'S OWN WORD. "Reflex", "Observe", "Triage", "Reason", "Act and
   *  Tell" are already plain English — this is the rare case where the
   *  technical vocabulary needs no translation, so translating it would only
   *  break the link between the screen and the document. */
  name: string;
  /** What it does, in ONE line a person can act on.
   *  ⚠️ ONE LINE, NOT A PARAGRAPH. This renders directly above a facts row and
   *  a control's own description, so three two-line blocks stack into six lines
   *  of grey before the reader reaches a switch — reported from the screen as
   *  the tab being hard to read. Detail goes in `more`. */
  what: string;
  /** The rest, behind the inline (i). */
  more?: string;
  /** How fast it answers. */
  speed: string;
  /** ⚠️ WHETHER A MODEL IS IN THE PATH — the single most important fact on the
   *  row, because it is what a reader is really asking when they ask whether to
   *  trust something. Only tiers 2 and 3 are true. */
  model: boolean;
  /** Whether it still works with no internet. */
  offline: boolean;
  /** Which provenance chip its output carries, if one adds anything.
   *
   *  ⚠️ OPTIONAL, AND THE "Home Assistant" CHIP IS DELIBERATELY NOT USED HERE.
   *  On a finding it answers a real question — who said this. On a STEP HEADER
   *  it labelled the step's data source, which is a different claim and a
   *  confusing one: Observe does not report Home Assistant's opinion, it
   *  records the villa's state and scores it. The chip was saying "this came
   *  from HA" about a tier whose whole job is what VESTA does with what HA
   *  reports. Steps that produce nothing to attribute simply carry none. */
  source?: Source;
}

/** The briefing pipeline's own steps, in the order it runs them.
 *
 *  ⚠️ THE SAME SHAPE AS `TIERS`, AND ON PURPOSE. Two dialogs describing two
 *  workflows should describe them in one visual language or a reader has to
 *  learn the screen twice. Every field means exactly what it means above:
 *  `model` is "is an AI in the path", which for the whole of this pipeline is
 *  NO — the brief is composed by fixed code and a model only ever rewords the
 *  finished text.
 *
 *  ⚠️ AND `n` RESTARTS AT 1 RATHER THAN CONTINUING THE TIERS. This is not a
 *  sixth tier of the agent; it is a parallel, deterministic pipeline that
 *  happens to consume the agent's concerns. Numbering it 5, 6, 7 would claim a
 *  sequence that does not exist. */
export const STEPS: Record<string, Tier> = {
  watched: {
    n: 1, name: "What is watched",
    what: "Fixed checks over this villa's own history, plus your automations.",
    more: "Each check works the same way every time and can be switched off.",
    speed: "each briefing", model: false, offline: true, source: "check",
  },
  visible: {
    n: 2, name: "What it can see",
    what: "Whether this property reports the things a check needs.",
    more: "A check with nothing to read says so rather than passing quietly.",
    speed: "checked live", model: false, offline: false,
  },
  brief: {
    n: 3, name: "The briefing",
    what: "Everything found, written up in one message by the add-on itself.",
    more: "An AI only rewords the finished text, and only if you switch that on.",
    speed: "on the schedule below", model: false, offline: true,
    source: "check",
  },
  sent: {
    n: 4, name: "Sending it",
    what: "When a briefing goes out, and to whom.",
    more: "A record of every delivery is kept, including the ones that failed.",
    speed: "on schedule", model: false, offline: false, source: "check",
  },
  work: {
    n: 5, name: "What it asked for",
    what: "Jobs your automations raised, on a Home Assistant to-do list.",
    more: "Ticking one here records it as done everywhere.",
    speed: "as raised", model: false, offline: false, source: "reflex",
  },
};

export const TIERS: Record<string, Tier> = {
  reflex: {
    n: 0, name: "Reflex",
    what: "Acts on its own, in under a second, on the few things that cannot wait.",
    more: "A leak, smoke, a critical device dropping out. It does something "
        + "about it; it does not write a report.",
    speed: "under a second", model: false, offline: true, source: "reflex",
  },
  observe: {
    n: 1, name: "Observe",
    what: "Records every meaningful change and scores it against that device's own past.",
    more: "No thresholds to set — each reading is judged against its own "
        + "recorded history rather than a number somebody typed in.",
    speed: "continuous", model: false, offline: true,
  },
  triage: {
    n: 2, name: "Triage",
    // ⚠️ NO INTERVAL IN THE PROSE. It said "every fifteen minutes", which is
    // the HLD's example and not this villa's setting — the reference property
    // runs 360. A screen quoting a number the settings contradict is worse than
    // one that omits it, so the sentence describes the JOB and `speed` carries
    // the figure, filled in from config by whoever renders it.
    what: "One cheap question on a schedule: is anything here worth a closer look?",
    more: "It cannot act, cannot notify and cannot decide how serious "
        + "something is — it only points.",
    speed: "on a schedule you set", model: true, offline: false,
    source: "triage",
  },
  reason: {
    n: 3, name: "Reason",
    what: "Investigates what triage pointed at, and writes a conclusion with evidence.",
    more: "This is the only part that decides how serious something is.",
    speed: "when something is escalated", model: true, offline: false,
    source: "agent",
  },
  act: {
    n: 4, name: "Act & Tell",
    // ⚠️ NO BLURB ON THIS TAB, BY REQUEST. Every section below already names
    // what it does, so the sentence restated the tab in words the headings use
    // — and the `<p>` is skipped entirely rather than rendered empty, or its
    // margin leaves the blank line the removal was asked for.
    what: "",
    speed: "immediate", model: false, offline: true, source: "agent",
  },
};

/**
 * The identity block at the top of every tier tab.
 *
 * ⚠️ ONE COMPONENT, FIVE TABS. Five hand-written headers would drift in wording
 * and in layout within a release — this repository has paid for that shape
 * repeatedly — and the whole point of the vocabulary is that a reader learns it
 * once.
 */
export function TierIntro({ tier, speed, children }: {
  tier: Tier;
  /** ⚠️ THE REAL FIGURE, WHERE THE TAB KNOWS IT. A tier's own `speed` is a
   *  description; a villa that has configured a cadence can say the number, and
   *  a number the settings contradict is worse than none. */
  speed?: string;
  /** Live facts about this tier, if the tab has any. */
  children?: ReactNode;
}) {
  return (
    <div className="tier-intro">
      <div className="tier-intro-head">
        <span className="tier-badge">Step {tier.n}</span>
        <h3 className="settings-section-title">{tier.name}</h3>
        {/* ⚠️ PUSHED RIGHT AND CENTRED ON ITS ROW. It sat inline after the
            heading, baseline-aligned — so it hugged a title of unpredictable
            length and rode visibly low against an uppercase eyebrow, which is a
            cap-height, not a baseline, relationship. Right-aligned it has a
            fixed home whatever the heading says. */}
        {tier.source && <SourceChip source={tier.source} className="tier-chip" />}
      </div>
      {/* ⚠️ THE THREE FACTS SIT DIRECTLY UNDER THE STEP LINE, not under the
          description (moved 2.759.0, by request). They are a HEADER — how fast,
          what it costs, whether it survives an outage — and belong with the
          step number and the name, not after a paragraph of prose that a reader
          may or may not finish. The description then reads as detail about a
          tier the reader has already been told the shape of. */}
      {/* ⚠️ ICONS, NOT WORDS, SO THE THREE ALWAYS SHARE ONE ROW. "Speed",
          "Uses AI" and "Works offline" are longer than several of the VALUES
          they head, so at any realistic width the row wrapped and the third
          fact — the one about working offline — dropped to a line of its own.
          A glyph plus its value is short enough that three fit at a phone's
          width, which is the only way this reads as one comparison rather than
          three separate statements.
          ⚠️ THE WORDS ARE NOT LOST, THEY MOVE TO `title` AND `aria-label`. An
          icon on its own is a rebus; a screen reader still hears "Speed", and a
          pointer still gets it on hover. */}
      {/* ⚠️ THE GLYPH FOLLOWS THE VALUE, AND IT USED TO CONTRADICT IT. Both
          icons were FIXED: `WifiOff` rendered beside "Needs internet" and a
          plain `Sparkles` beside "No AI", so on three of the five tabs the
          picture said the opposite of the words next to it. Reported.
          ⚠️ ONE STRIKE RULE, NOT A SECOND GLYPH. lucide ships `Wifi` but no
          `SparklesOff`, and `Sparkles` is this app's established AI mark (HUD,
          Spend, the tab strip) — swapping it for `BotOff` on the negative case
          alone would mean two different metaphors for one fact. So both facts
          render their PLAIN glyph and `.tier-fact-off` draws the diagonal, the
          same grammar lucide uses and one mechanism for any fact added later. */}
      <dl className="tier-facts">
        <div title="Speed">
          <dt aria-label="Speed"><Gauge size={14} aria-hidden="true" /></dt>
          <dd>{speed || tier.speed}</dd>
        </div>
        <div title={tier.model ? "Uses AI" : "Does not use AI"}>
          <dt aria-label={tier.model ? "Uses AI" : "Does not use AI"}
              className={tier.model ? undefined : "tier-fact-off"}>
            <Sparkles size={14} aria-hidden="true" />
          </dt>
          <dd>{tier.model ? "Uses AI" : "No AI"}</dd>
        </div>
        <div title={tier.offline ? "Works offline" : "Needs internet"}>
          <dt aria-label={tier.offline ? "Works offline" : "Needs internet"}
              className={tier.offline ? "tier-fact-off" : undefined}>
            <Wifi size={14} aria-hidden="true" />
          </dt>
          <dd>{tier.offline ? "Works offline" : "Needs internet"}</dd>
        </div>
      </dl>
      {tier.what ? (
        <p className="muted body-text">
          {tier.what}
          {tier.more
            ? <InfoHint label={tier.name}>{tier.more}</InfoHint>
            : null}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** What each shipped blueprint family is FOR, and whether it survives.
 *
 *  ⚠️ MOVED HERE FROM `ModulesTab` SO BOTH READERS SHARE ONE TABLE. The Reflex
 *  tab and the briefing pipeline's Checks tab both describe these families, and
 *  two copies would disagree the first time the cutover moved — which is the
 *  whole point of the table.
 *
 *  ⚠️ DERIVED FROM THE CUTOVER ORDER IN `docs/PROGRESS.md`, NOT FROM TASTE.
 *  `maintenance_*` retires first, then `roi_*`, then `audit_*` EXCEPT
 *  `audit_notification_path`. `critical_*` was never on that list: the HLD §5
 *  keeps ~6 as reflexes because "a model in the path of a leak sensor is a
 *  design error. This is physics, not preference." */
export const FAMILIES: Record<string, { role: string; reflex?: true }> = {
  critical: {
    role: "acts in under a second, on this property, with no AI involved",
    reflex: true,
  },
  // ⚠️ THE ASSISTANT IS THE SUCCESSOR, NOT THE BUILT-IN CHECKS, AND SAYING
  // OTHERWISE WAS A REAL ERROR OF ARCHITECTURE RATHER THAN OF WORDING. The
  // owner spotted it: if these families were replaced by the checks in
  // Briefings, the agent would be depending on the very rule layer it exists to
  // remove. It is not. `sources.build_document` — the only thing triage ever
  // reads — is assembled from the observation journal, salience, the open
  // concerns, the facility ledger and coverage. There is not one reference to a
  // blueprint or to `analysis/modules/` anywhere in `agent/sources.py` or
  // `agent/triage.py`. The agent watches raw state and judges it; it never
  // consumes a rule's output.
  //
  // ⚠️ THE TWO LAYERS MEET ONLY IN THE BRIEF, and since 2.755.0 the rule is one
  // sentence: supervision ON and the assistant supersedes the automations;
  // supervision OFF and the automations do the job. There is no per-device
  // preference, no grace window and no second flag — all of that was deleted
  // after it produced a stand-down that could never expire.
  //
  // ⚠️ `analysis/modules/level_anomaly.py` still carries
  // `superseded_by: ("roi_baseline_deviation",)`, but only to NAME the rule in
  // the skip line an owner reads when supervision is off.
  // True, and a second-order detail: it explains why `docs/PROGRESS.md` calls
  // maintenance "the only family with upside", not who takes over the job.
  maintenance: { role: "superseded — the assistant now spots this itself" },
  roi: { role: "superseded — the assistant now spots this itself" },
  audit: { role: "proves the alert channel still works" },
  // ⚠️ THESE TWO WERE MISSING AND RENDERED AS A BLANK ROLE COLUMN, which reads
  // as "this family does nothing" rather than "nobody has described it". Same
  // shape as the severity rule in `standing.SEVERITY_OF_KIND`: an unlisted kind
  // must not arrive as the quietest thing in the report.
  //
  // ⚠️ BOTH LEGITIMATELY SHOW "nothing yet", AND FOR DIFFERENT REASONS.
  // `control` is the ACTUATING family — 0 of its 8 blueprints carry a rule_id
  // or emit any vesta event, because they operate devices rather than report on
  // them. `vesta` is `vesta_task_actions`, which TRIGGERS ON
  // vesta_maintenance/audit/roi events and emits none of its own; the collector
  // subscribed to `vesta_vesta_event` only because it derives the event name
  // from the blueprint's filename prefix. Neither count will ever move.
  control: { role: "operates devices; never reports, so it has no count here" },
  vesta: { role: "handles the to-do actions in a brief; emits nothing itself" },
};
