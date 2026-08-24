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

/** Every producer of a statement about the villa. ⚠️ ORDERED BY HOW DIRECT THE
 *  CLAIM IS — from a raw reading to a paraphrase of a judgement — because that
 *  ordering is the one a reader actually wants when two rows disagree. */
export type Source =
  | "ha"
  | "reflex"
  | "check"
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
    label: "Built-in check",
    hint: "A fixed calculation over weeks of this villa's own history. It "
      + "always works the same way, and you can switch it off.",
    tone: "check",
  },
  triage: {
    label: "Flagged for a look",
    hint: "A quick pass thought this was worth examining. It has NOT been "
      + "investigated yet, and carries no severity — that comes later.",
    tone: "triage",
  },
  agent: {
    label: "Investigated",
    hint: "Looked into properly, with the evidence it used recorded. The "
      + "severity is its own judgement.",
    tone: "agent",
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
 * ⚠️ A `<span>`, NOT A BUTTON, AND NOT A TOOLTIP COMPONENT. It is a label on a
 * row that already has its own actions; making it interactive would put a
 * second tap target inside a row whose whole surface is often the control, and
 * on a wall tablet that is how a reader opens something they meant to read.
 * The explanation rides `title` for exactly that reason.
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
    <span
      className={`source-chip source-${spec.tone}${className ? ` ${className}` : ""}`}
      title={spec.hint}
    >
      {spec.label}
    </span>
  );
}
