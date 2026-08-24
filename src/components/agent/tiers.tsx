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
import SourceChip, { type Source } from "@/components/common/SourceChip";

export interface Tier {
  /** The tier number from the HLD, kept because the document uses it. */
  n: number;
  /** ⚠️ THE HLD'S OWN WORD. "Reflex", "Observe", "Triage", "Reason", "Act and
   *  Tell" are already plain English — this is the rare case where the
   *  technical vocabulary needs no translation, so translating it would only
   *  break the link between the screen and the document. */
  name: string;
  /** What it does, in one sentence a person can act on. */
  what: string;
  /** How fast it answers. */
  speed: string;
  /** ⚠️ WHETHER A MODEL IS IN THE PATH — the single most important fact on the
   *  row, because it is what a reader is really asking when they ask whether to
   *  trust something. Only tiers 2 and 3 are true. */
  model: boolean;
  /** Whether it still works with no internet. */
  offline: boolean;
  /** Which provenance chip its output carries. */
  source: Source;
}

export const TIERS: Record<string, Tier> = {
  reflex: {
    n: 0, name: "Reflex",
    what: "Acts on its own, in under a second, for the handful of things that "
        + "cannot wait for anyone — a leak, smoke, a critical device dropping "
        + "out. It does something about it; it does not write a report.",
    speed: "under a second", model: false, offline: true, source: "reflex",
  },
  observe: {
    n: 1, name: "Observe",
    what: "Records every meaningful change in the villa and scores it against "
        + "what that same device normally does. No thresholds to set — each "
        + "reading is judged against its own four weeks of history.",
    speed: "continuous", model: false, offline: true, source: "ha",
  },
  triage: {
    n: 2, name: "Triage",
    what: "Every fifteen minutes, one cheap question: is anything here worth a "
        + "person's attention, or a closer look? It cannot act, cannot notify "
        + "and cannot decide how serious something is — it only points.",
    speed: "every 15 minutes", model: true, offline: false, source: "triage",
  },
  reason: {
    n: 3, name: "Reason",
    what: "Investigates what triage pointed at, across everything it can read, "
        + "and writes a conclusion with the evidence behind it. This is the "
        + "only part that decides how serious something is.",
    speed: "when something is escalated", model: true, offline: false,
    source: "agent",
  },
  act: {
    n: 4, name: "Act & Tell",
    what: "Decides who is told, on what channel, and whether the villa is "
        + "allowed to do anything about it. Deliberately not a judgement — a "
        + "fixed table — because deciding who to wake at 3am should not be a "
        + "model's call.",
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
export function TierIntro({ tier, children }: {
  tier: Tier;
  /** Live facts about this tier, if the tab has any. */
  children?: ReactNode;
}) {
  return (
    <div className="tier-intro">
      <div className="tier-intro-head">
        <span className="tier-badge">Step {tier.n}</span>
        <h3 className="settings-section-title">{tier.name}</h3>
        <SourceChip source={tier.source} />
      </div>
      <p className="muted body-text">{tier.what}</p>
      {/* ⚠️ THE THREE FACTS THAT DECIDE TRUST, on one line and always in the
          same order, so they can be compared across tabs at a glance. */}
      <dl className="tier-facts">
        <div><dt>Speed</dt><dd>{tier.speed}</dd></div>
        <div>
          <dt>Uses AI</dt>
          <dd>{tier.model ? "Yes" : "No — fixed rules"}</dd>
        </div>
        <div>
          <dt>Works offline</dt>
          <dd>{tier.offline ? "Yes" : "Needs internet"}</dd>
        </div>
      </dl>
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
  maintenance: { role: "being replaced by the built-in checks" },
  roi: { role: "being replaced by the built-in checks" },
  audit: { role: "proves the alert channel still works" },
};
