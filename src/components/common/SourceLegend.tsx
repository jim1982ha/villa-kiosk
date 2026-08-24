// src/components/common/SourceLegend.tsx
//
// The key to the colour code, at the foot of the screens that use it.
//
// ⚠️ A COLOUR CODE NOBODY EXPLAINS IS A SECOND THING TO LEARN, NOT A REMOVAL OF
// ONE. v2.721.0 put a coloured chip on every finding and left the vocabulary to
// be inferred from hovering them one at a time — which works on a desk with a
// mouse and not on a wall-mounted tablet, where there is no hover at all. The
// owner asked for "a footer or a colour code"; the chips are the code and this
// is the footer, and neither is sufficient alone.
//
// ⚠️ IT READS `SOURCES`, SO IT CANNOT DISAGREE WITH THE CHIPS IT EXPLAINS. A
// hand-written legend is the classic drift: a source gets renamed, the rows
// change, the key still describes last month's vocabulary, and it is WORSE than
// no key because it is read as authoritative. Adding a seventh source adds a
// line here for free.

import SourceChip, { SOURCES, type Source } from "./SourceChip";

/** ⚠️ ORDERED FROM THE MOST DIRECT CLAIM TO THE MOST DERIVED — a reading, then
 *  a reflex that acted on it, then arithmetic over it, then a guess, then a
 *  judgement, then a paraphrase, then a person. That ordering is the answer to
 *  "how much of this is the villa and how much is inference", which is the
 *  question the whole vocabulary exists to make askable. */
const ORDER: Source[] = [
  "ha", "reflex", "check", "triage", "agent", "llm", "person",
];

export default function SourceLegend({ only }: {
  /** Show a subset — a screen explains the labels it actually uses, because a
   *  key listing four sources that appear nowhere on the page sends the reader
   *  hunting for them. Omit to show all seven. */
  only?: readonly Source[];
}) {
  const shown = only ? ORDER.filter((s) => only.includes(s)) : ORDER;
  if (shown.length === 0) return null;
  return (
    <div className="source-legend">
      <div className="settings-section-title">Where this comes from</div>
      <dl className="source-legend-list">
        {shown.map((s) => (
          <div key={s} className="source-legend-row">
            <dt><SourceChip source={s} /></dt>
            {/* ⚠️ THE SAME SENTENCE THE CHIP CARRIES IN `title`, not a second
                wording of it. Two explanations of one label is how the tooltip
                and the key start contradicting each other, and the reader has
                no way to know which is current. */}
            <dd className="muted body-text">{SOURCES[s].hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
