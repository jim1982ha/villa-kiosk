// src/components/reports/PreviewTab.tsx
// Compose a report and read it, before deciding to receive them.
//
// ⚠️ THIS TAB IS WHY THE `preview` FLAG EXISTS. "Enable it and see what
// arrives" means finding out that a module is noisy on somebody's phone, at
// whatever hour the schedule fires. A preview composes everything, sends
// nothing and records nothing.

import { FileText, Loader2 } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import SourceChip from "@/components/common/SourceChip";
import type { ReportPreview } from "@/vesta/brief/reportsApi";
import type { NarrationMode } from "@/vesta/shared/reportsTypes";
import PayloadInspector from "./PayloadInspector";

export default function PreviewTab({
  preview, busy, narrationMode, onCompose,
}: {
  preview: ReportPreview | null;
  busy: boolean;
  /** ⚠️ SO THE INSPECTOR CAN LEAD WITH "NOTHING IS BEING TRANSMITTED" on the
   *  default setting. A payload panel with no such statement implies the data
   *  is leaving, which on every install that has not switched narration on is
   *  the opposite of the truth. */
  narrationMode: NarrationMode;
  onCompose: () => void;
}) {
  return (
    <div className="reports-pane">
      {/* ⚠️ THE SECTION IDIOM THE AGENT DIALOG USES — title, one-line
          subtitle, (i) for the detail (2026-08-29 revamp). This pane had only
          a bare paragraph and a button, which read as a control floating in
          space once the four tabs became sections of one page. */}
      <h3 className="settings-section-title">Try it now</h3>
      <p className="muted body-text">
        See exactly what the next briefing would say, without sending anything.
        <InfoHint label="Try it now">
          <p>
            This composes a full briefing from what the property looks like
            right now, and shows it to you here — nobody is messaged and
            nothing is added to the delivery record below.
          </p>
          <p>
            The little tag beside the result says who wrote the words: VESTA
            itself, or an AI rephrasing VESTA’s findings if you have switched
            that on. The facts are the same either way.
          </p>
        </InfoHint>
      </p>

      <button className="btn primary" onClick={onCompose} disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
        <span>{busy ? "Composing…" : "Compose a test briefing"}</span>
      </button>

      {preview && (
        <>
          {/* ⚠️ WHO WROTE THE WORDS, ON THE ONE SURFACE WHERE IT IS NOT
              OBVIOUS AND MATTERS MOST. `pipeline.run_report` composes the
              deterministic body FIRST, always, and a provider can only REPLACE
              it — so absence, a missing key, an open breaker, a spent budget, a
              timeout and an unusable answer all end with the add-on's own
              prose. A reader looking at this text cannot tell which of the two
              they got, and the difference is exactly "did a model phrase the
              facts, or produce them". It phrased them: the facts are settled
              before any provider is asked, which is what `PayloadInspector`
              below proves rather than asserts. */}
          <div className="reports-title-row">
            <h3 className="settings-section-title">{preview.title}</h3>
            <SourceChip source={narrationMode === "provider" ? "llm" : "addon"} />
          </div>
          {/* ⚠️ PRE, NOT A PARAGRAPH. The renderer emits plain text with
              meaningful line breaks — `deliver.py` sends the intersection of
              what notify platforms accept — and reflowing it here would show
              the operator something different from what arrives on the phone. */}
          <pre className="reports-body">{preview.body}</pre>

          {/* ⚠️ THE AGGREGATION FACTS ROW IS GONE (TASK-075). It counted
              blueprint events read/grouped/priced, and the last producer of
              those events was retired at the cutover — four zeros in a row
              read as a broken pipeline, not a quiet villa. What the preview
              still shows is the brief itself and the exact payload below. */}

          {/* ⚠️ AFTER THE BRIEF, NOT BEFORE IT. The plan puts this at the END
              of onboarding — read a real report from real data, THEN see
              exactly what would be transmitted, and only then decide. Leading
              with a JSON block would bury the thing the operator came to
              read. */}
          <PayloadInspector preview={preview} mode={narrationMode} />
        </>
      )}
    </div>
  );
}
