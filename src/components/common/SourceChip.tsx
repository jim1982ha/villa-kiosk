// src/components/common/SourceChip.tsx
//
// WHO SAID THIS. One chip, one table, every surface that shows a statement
// about the villa.
//
// ⚠️ IT EXISTS BECAUSE THE KIOSK SHOWS SIX KINDS OF STATEMENT IN ONE VOICE.
// A sub-second safety reflex, a statistical check over six weeks of history, a
// frontier model's judgement, a language model's paraphrase, a reading Home
// Assistant reported, and a fault a person typed in are all rendered as the
// same neutral row — so the reader cannot tell which of them to trust, how
// fast it reacted, or whether a model was in the path at all. That distinction
// is the whole product: VESTA is replacing rules with judgement, and a reader
// who cannot see which one they are looking at cannot evaluate the change.
//
// ⚠️ THE TABLE IS THE POINT, NOT THE COMPONENT. Six surfaces would otherwise
// each name these sources in their own words — "agent", "AI", "automatic",
// "system" — and the terminology would drift the first week. `SOURCES` is the
// only place a source is named, coloured or explained, so a rename lands
// everywhere at once and a seventh source is one entry rather than six edits.
//
// ⚠️ AND THE SET IS DERIVED FROM THE FINAL ARCHITECTURE, NOT THE CURRENT ONE.
// `docs/PROGRESS.md` fixes the cutover: `maintenance_*`, `roi_*` and `audit_*`
// (minus `audit_notification_path`) retire, leaving the `critical_*` reflexes
// and the channel heartbeat as the ONLY automations. So `blueprint` here means
// "a reflex that acts in under a second with no model in the path" — its
// permanent role — rather than "the rules we have not deleted yet". Nothing in
// this table becomes wrong on the day that cutover finishes.

import InfoHint from "./InfoHint";

/** Every producer of a statement about the villa. ⚠️ ORDERED BY HOW DIRECT THE
 *  CLAIM IS — from a raw reading to a paraphrase of a judgement — because that
 *  ordering is the one a reader actually wants when two rows disagree. */
export type Source =
  | "ha"
  | "reflex"
  | "check"
  | "addon"
  | "agent"
  | "triage"
  | "llm"
  | "person";

interface SourceSpec {
  /** What the reader sees. ⚠️ Plain language: a person reads "Home Assistant",
   *  never "HA state", and "Safety reflex", never "critical_* blueprint". */
  label: string;
  /** The one-sentence answer to "why am I being shown this, and by what?".
   *  Rendered as the chip's `title`, so it is available on hover and to a
   *  screen reader without adding a line to every row. */
  hint: string;
  /** The CSS modifier. Colours live in `styles.css` beside the other tokens. */
  tone: string;
}

/** ⚠️ THE SINGLE DEFINITION OF WHAT EACH SOURCE MEANS. Adding a producer is an
 *  entry here; it is never a new string in a component. */
export const SOURCES: Record<Source, SourceSpec> = {
  ha: {
    label: "Home Assistant",
    hint: "Read directly from Home Assistant. A fact about the villa, with "
      + "nothing interpreting it.",
    tone: "ha",
  },
  reflex: {
    label: "Safety reflex",
    hint: "An automation that acts in under a second, on this property, with "
      + "no internet and no AI involved. It has already done what it does.",
    tone: "reflex",
  },
  check: {
    // ⚠️ "VESTA check", NOT "Built-in check" (2026-08-29, owner: name these so
    // "user always know what type of checks are currently used"). "Built-in"
    // says where the code came from, which is the one thing a reader does not
    // need; what they need is WHOSE check it is, because the other half of the
    // same screen is "Your automations".
    //
    // ⚠️ AND DELIBERATELY NOT "VESTA AGENT check", WHICH WAS ONE OF THE TWO
    // NAMES PROPOSED. These are fixed arithmetic: the briefing runs them
    // whether or not the agent ever thinks, and this very chip sits beside a
    // "No AI" chip on the tab header. Naming them for the AI tier would
    // contradict the row above them. The agent DOES run the same three classes
    // as a tool (`agent/tools/analysis.py`), which the hint says outright —
    // that is the honest version of "used by the agent".
    //
    // ⚠️ NOR "LEGACY checks", THE OTHER PROPOSAL: it is exactly backwards. The
    // legacy layer is the `maintenance_*`/`roi_*` automations that were
    // RETIRED; these are what replaced them and what runs today.
    label: "Trend check",
    // ⚠️ THIS HINT HAS NOW BEEN WRONG IN BOTH DIRECTIONS IN ONE DAY. First
    // it implied the toggle stopped the agent (it did not, then); 2.873.0 made
    // the toggle reach the agent — one switch, one meaning — and the correction
    // written hours earlier became the new falsehood. The sentence below is
    // the whole contract and nothing more: off means off, everywhere.
    hint: "A fixed calculation over weeks of this villa's own history — a "
      + "slow-pattern detector, distinct from the VESTA Agent's live triage "
      + "runs. It always works the same way, runs whether Supervision is ON "
      + "or OFF, and switching it off stops it everywhere — briefings and "
      + "the VESTA Agent alike.",
    tone: "check",
  },
  triage: {
    label: "Flagged for a look",
    hint: "A quick check thought this was worth examining. It has NOT been "
      + "investigated yet, and carries no severity — that comes later.",
    tone: "triage",
  },
  agent: {
    label: "Investigated",
    hint: "Looked into properly, with the evidence it used recorded. The "
      + "severity is its own judgement.",
    tone: "agent",
  },
  addon: {
    // ⚠️ SPLIT OUT OF `check` (2026-08-29). The briefing's title chip used
    // `check` to mean "this prose was composed by fixed rules, not a model",
    // and read back "A fixed calculation over weeks of this villa's own
    // history ... you can switch it off" — which describes a statistical
    // module, not the wording of a report. One label, two claims; renaming
    // `check` would have entrenched it. It is the exact counterpart of `llm`
    // below and is worded as its pair.
    // ⚠️ `tone: "check"` REUSES `.source-check` on purpose — same visual
    // family, no new CSS class, nothing for the dead-class probe to find.
    label: "Written by VESTA",
    hint: "The wording as well as the facts, composed by the add-on itself "
      + "with no AI involved.",
    tone: "check",
  },
  llm: {
    label: "Written by AI",
    hint: "The wording only. The facts underneath were worked out by the "
      + "add-on before any AI was asked to phrase them.",
    tone: "llm",
  },
  person: {
    label: "Entered by a person",
    hint: "Somebody recorded this — a fault, a task, a note. The villa did "
      + "not decide it.",
    tone: "person",
  },
};

/**
 * ⚠️ THE CHIP IS ITS OWN EXPLANATION, AND IT USED TO BE `title=` (2026-08-28).
 * The header of `InfoHint` has always said why that is wrong here: "a native
 * tooltip needs a hover, and the villa's kiosk is a wall-mounted iPad — so
 * every `title` written as an explanation is an explanation a touch user
 * cannot reach". That rule was rolled out by CALL SITE and this component was
 * not one of them, which is `feedback_audit-applicable-set` exactly: audit what
 * a rule APPLIES to, not where it already appears.
 *
 * ⚠️ THE SIDE EFFECT WAS A LEGEND IN ANOTHER DIALOG. Because the chips could
 * not be read on the target device, a seven-row key was added at the foot of
 * Settings & others — listing every source in the vocabulary, while the chips
 * themselves live in the agent and briefing dialogs. A reader had to leave the
 * screen with the chip on it to find out what the chip meant. Deleted; the
 * word now answers for itself where it stands.
 *
 * ⚠️ IT IS NOW A BUTTON, WHICH THE PREVIOUS COMMENT HERE ARGUED AGAINST — "a
 * second tap target inside a row whose whole surface is often the control". The
 * objection is answered rather than ignored: `InfoHint` stops propagation, so
 * asking what a label means can no longer also perform the row's action, which
 * is a stronger guarantee than a non-interactive span had.
 */
export default function SourceChip({ source, className = "" }: {
  source: Source;
  /** For a caller that needs to place it — spacing belongs to the row. */
  className?: string;
}) {
  const spec = SOURCES[source];
  // ⚠️ AN UNKNOWN SOURCE RENDERS NOTHING RATHER THAN A BROKEN CHIP. The value
  // can arrive from a stored document written by a newer version (config keeps
  // unknown keys so a downgrade survives), and an empty label beside a coloured
  // box reads as a fault in the app rather than as a value it has not heard of.
  if (!spec) return null;
  return (
    <InfoHint
      label={spec.label}
      trigger={
        <span
          className={`source-chip source-${spec.tone}${className ? ` ${className}` : ""}`}
        >
          {spec.label}
        </span>
      }
    >
      {/* ⚠️ `SOURCES[source].hint` — THE ONE DEFINITION, read here and nowhere
          else now that the legend is gone. A source is named, coloured and
          explained in exactly one place, so a rename lands everywhere at once
          and a seventh source is one entry rather than several edits. */}
      <p>{spec.hint}</p>
    </InfoHint>
  );
}
