// src/components/reports/PayloadInspector.tsx
// Exactly what would leave this property, shown rather than promised.
//
// ⚠️ THE PLAN PUT THIS AT THE END OF ONBOARDING, BEFORE "ENABLE" IS OFFERED,
// and that placement is the whole argument: an operator decides whether to let
// an AI service write their property's brief, and "only numbers are sent, never
// entity ids or free text" is a sentence they have to take on trust. On a
// redistributable add-on the reader cannot audit the source, so the sentence is
// worth very little on its own. This is the sentence made checkable.
//
// ⚠️ IT RENDERS THE BACKEND'S OWN OUTPUT, NOT A RECONSTRUCTION. The object here
// comes from `payload.from_context` — the same function, on the same report,
// that a real narration transmits — and the verdict beside it is
// `payload.audit()`, the same gate the narrator asks immediately before
// sending. A panel that rebuilt this from a second copy of the allow-list kept
// in the SPA would be a privacy claim verified against the wrong thing: it
// would keep saying the right words after the backend changed.
//
// ⚠️ AND THE WITHHELD LIST IS THE HALF THAT CONVINCES. A list of PERMITTED
// field names tells a reader what the policy says. A list of names the policy
// actually dropped, on their own property's data, shows it applying. Names
// only — printing the values would mean leaking them into the panel whose
// entire purpose is to show they are not leaked.

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReportPreview } from "@/reports/reportsApi";
import type { NarrationMode } from "@/reports/reportsTypes";

export default function PayloadInspector({
  preview, mode,
}: {
  preview: ReportPreview;
  /** ⚠️ WHAT IS CONFIGURED RIGHT NOW, so the panel can lead with the fact that
   *  matters most: on the default setting the answer to "what leaves this
   *  property" is *nothing*, and everything below is hypothetical. Saying that
   *  first is more honest than a JSON dump that implies transmission. */
  mode: NarrationMode;
}) {
  const [open, setOpen] = useState(false);
  const payload = preview.payload;

  if (!payload) return null;

  const clean = payload.problems.length === 0;
  const findings = Array.isArray((payload.body as { findings?: unknown })?.findings)
    ? ((payload.body as { findings: unknown[] }).findings).length
    : 0;

  return (
    <div className="reports-entry">
      <div className="reports-entry-head">
        <button
          className="btn ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>What would leave this property</span>
        </button>
        <span className={clean ? "muted" : "sev-critical"}>
          {clean
            ? <><ShieldCheck size={14} aria-hidden="true" /> {findings} finding{findings === 1 ? "" : "s"}, checked</>
            : <><ShieldAlert size={14} aria-hidden="true" /> {payload.problems.length} problem(s)</>}
        </span>
      </div>

      {mode !== "provider" && (
        <p className="muted body-text">
          <strong>Nothing is being transmitted.</strong> This brief was written
          by the add-on itself, on this property. The panel below is what{" "}
          <em>would</em> be sent if you switched narration on — shown here so
          that decision can be made by reading rather than by trusting.
        </p>
      )}

      {open && (
        <>
          {/* ⚠️ THE WITHHELD LIST GOES FIRST, ABOVE THE JSON. A reader who
              opens this wants the answer to "does it send my entity ids", and
              scrolling a JSON block to satisfy themselves that something is
              ABSENT is a poor way to answer a question about absence. */}
          {payload.withheld.length > 0 && (
            <>
              <p className="muted body-text" style={{ marginTop: 8 }}>
                Present on this property&rsquo;s findings and <strong>not
                sent</strong>:
              </p>
              <ul className="reports-list">
                {payload.withheld.map((field) => (
                  <li key={field} className="reports-item muted">
                    <Check size={14} aria-hidden="true" />
                    <span><code>{field}</code> withheld</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!clean && (
            <ul className="reports-list">
              {payload.problems.map((p, i) => (
                <li key={i} className="reports-item sev-critical">{p}</li>
              ))}
              <li className="reports-item sev-critical">
                A brief with any of these is refused before it is sent, and the
                add-on writes it itself instead.
              </li>
            </ul>
          )}

          {/* ⚠️ SCROLLS INSIDE ITS OWN BOX. A JSON dump is the widest thing in
              this dialog by a wide margin, and a page that scrolls sideways on
              a phone because of one panel is the layout bug CLAUDE.md's own
              gotcha list warns about. */}
          <pre className="reports-payload">
            {JSON.stringify(payload.body, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
