// src/components/reports/UsageModal.tsx
// Where the API key's money went, per request, with the actor attached.
//
// ⚠️ IT IS NOT SCOPED TO THE NARRATION TOGGLE, AND THAT IS THE WHOLE REASON IT
// EXISTS. It opens from the row that switches narration on, so the obvious
// reading is "usage caused by this setting" — and that reading is wrong. Triage
// runs every fifteen minutes, every chat turn reasons, and all of it spends the
// same key with narration switched off. The empty state and the source
// breakdown both say so out loud rather than relying on the reader to know.
//
// ⚠️ EVERY FIGURE IS AN ESTIMATE AND IS LABELLED ONE. `summary.estimated`
// arrives in the data rather than being a string typed here, so a second reader
// of this endpoint inherits the caveat. The provider's own console is the
// authority; this exists because the console cannot tell you WHO spent it —
// one key serves the schedule and every person who messages the villa.
//
// ⚠️ AND "nothing spent" IS RENDERED DIFFERENTLY FROM "not recorded yet".
// `recording_since` is what separates them: identical as a total, opposite in
// meaning, and on the release that adds this ledger every earlier request falls
// in the second category. Showing $0.00 for a window that predates the ledger
// would be the most expensive kind of confident wrong answer here.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

import { loadUsage, type UsageBucket, type UsageRow, type UsageSummary } from "@/agent/agentApi";
import { useModalA11y } from "@/hooks/useModalA11y";

/** ⚠️ FOUR DECIMALS, NOT TWO. The question is "where did a few cents go", and
 *  rounding a fifteen-minute triage call to $0.00 would hide the line item that
 *  matters most — the one that repeats ninety-six times a day. */
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const num = (n: number) => n.toLocaleString();

/** `2026-08-23T14:05` — what `datetime-local` reads and writes. */
function toLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Breakdown({ title, rows, note }: {
  title: string; rows: Record<string, UsageBucket>; note: string;
}) {
  const entries = Object.entries(rows).sort((a, b) => b[1].cost - a[1].cost);
  if (entries.length === 0) return null;
  return (
    <div className="fm-field">
      <span>{title}</span>
      <p className="muted body-text">{note}</p>
      <div className="usage-table" role="table">
        {entries.map(([key, b]) => (
          <div className="usage-row" role="row" key={key}>
            <span className="usage-key">{key}</span>
            <span className="usage-num">{num(b.requests)}</span>
            <span className="usage-num">{usd(b.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsageModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalA11y(onClose);
  // ⚠️ DEFAULTS TO SEVEN DAYS, NOT TO EVERYTHING. "Since I topped up" is the
  // real question and only the owner knows that moment, so the control is
  // theirs — but an unbounded default would open on a wall of rows and make the
  // window look like it could not be changed.
  const [since, setSince] = useState(() =>
    toLocalInput(Date.now() / 1000 - 7 * 86400));
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    const seconds = Math.floor(new Date(since).getTime() / 1000);
    const got = await loadUsage(Number.isFinite(seconds) ? seconds : 0);
    setSummary(got.summary);
    setRows(got.rows);
    setTruncated(got.truncated);
    setBusy(false);
  }, [since]);

  useEffect(() => { void refresh(); }, [refresh]);

  // ⚠️ THE LEDGER STARTED LATER THAN THE WINDOW ASKED FOR. Rendered before the
  // totals, because every figure below it is only true from that moment on and
  // a reader who misses this will read a small number as reassurance.
  const startedAfter = summary != null
    && summary.recording_since > 0
    && summary.recording_since > summary.since;
  const neverRecorded = summary != null && summary.recording_since === 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
        role="dialog"
        aria-modal="true"
        aria-label="API usage and cost"
      >
        <div className="modal-header">
          <h2>API usage and cost</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body fm-stack">
          <p className="muted body-text">
            Every request this add-on has made to the AI provider, whoever
            caused it. This includes scheduled checks and chat replies — they
            spend the same key whether or not the setting above is switched on.
          </p>

          <label className="fm-field">
            <span>Count from</span>
            <div className="usage-since">
              <input
                type="datetime-local"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
              <button className="icon-btn" onClick={() => void refresh()}
                aria-label="Refresh" disabled={busy}>
                {busy ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
              </button>
            </div>
          </label>

          {busy && summary === null && (
            <p className="muted body-text">Reading the ledger…</p>
          )}

          {neverRecorded && (
            <div className="fm-banner">
              Nothing has been recorded yet. Usage is logged from the release
              that added this panel onwards — anything spent before then is only
              visible in the provider’s own console.
            </div>
          )}

          {startedAfter && (
            <div className="fm-banner">
              This ledger only starts at{" "}
              {new Date(summary!.recording_since * 1000).toLocaleString()}.
              Requests before that were not recorded, so the totals below cover
              a shorter period than you asked for.
            </div>
          )}

          {summary && !neverRecorded && (
            <>
              <div className="fm-field">
                <span>Total</span>
                <div className="usage-total">
                  <strong>{usd(summary.total.cost)}</strong>
                  <span className="muted">
                    {num(summary.total.requests)} request(s) ·{" "}
                    {num(summary.total.input + summary.total.cache_read
                      + summary.total.cache_write)} in ·{" "}
                    {num(summary.total.output)} out
                  </span>
                </div>
                {summary.estimated && (
                  <p className="muted body-text">
                    Estimated from published prices and the token counts the
                    provider reported. Your bill is the authority — expect small
                    differences.
                  </p>
                )}
              </div>

              <Breakdown title="By who caused it" rows={summary.by_actor}
                note="“system” and “schedule” are the villa acting on its own; a
                      person’s name means a chat turn they sent." />
              <Breakdown title="By what it was for" rows={summary.by_source}
                note="Scheduled triage, an investigation, a chat reply, or the
                      brief’s narration." />
              <Breakdown title="By model" rows={summary.by_model}
                note="Cheaper models handle the repetitive work; the frontier
                      model is used where judgement is needed." />

              {rows.length > 0 && (
                <div className="fm-field">
                  <span>Recent requests</span>
                  {truncated && (
                    <p className="muted body-text">
                      Showing the most recent 500. The totals above cover the
                      whole window.
                    </p>
                  )}
                  <div className="usage-table" role="table">
                    {rows.map((r, i) => (
                      <div className="usage-row" role="row" key={`${r.at}-${i}`}>
                        <span className="usage-key">
                          {new Date(r.at * 1000).toLocaleString()} · {r.source}
                          {r.actor && r.actor !== "system" ? ` · ${r.actor}` : ""}
                        </span>
                        <span className="usage-num">
                          {num(r.input + r.cache_read + r.cache_write)}/{num(r.output)}
                        </span>
                        <span className="usage-num">{usd(r.cost)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
