// src/components/settings/UsagePanel.tsx
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
//
// ⚠️ IT WAS THE ONE DIALOG OUTSIDE THE `.settings-modal` FAMILY (fixed
// v2.653.0) — a bare `.modal` with its own header markup and an X button that
// landed UNDER the title, no footer, and none of the family's padding or fixed
// height. Reported as looking "very bad and inconsistent with other modals",
// correctly. `test_modal_shell` could not see it, because a dialog that never
// claims the family class is not in the set the test derives. It now uses the
// same shell and the same `ModalFooter` as every sibling.
//
// ⚠️ AND THE NUMBERS ARE SHOWN AS SHARES BEFORE THEY ARE SHOWN AS FIGURES. Three
// lists of "key · requests · cost" answered "what did each thing cost" and not
// the question anybody actually opens this for, which is "what is spending my
// money" — a reader had to divide in their head to find out. Each breakdown now
// leads with one stacked bar of the same rows, so the largest slice is visible
// before a single number is read, and the table underneath keeps the exact
// figures the bar can only approximate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { usePaged, Pager } from "@/components/common/Paged";

import { loadUsage, type UsageBucket, type UsageRow, type UsageSummary } from "@/agent/agentApi";
import { downloadFile } from "@/utils/download";

/** ⚠️ FOUR DECIMALS, NOT TWO. The question is "where did a few cents go", and
 *  rounding a fifteen-minute triage call to $0.00 would hide the line item that
 *  matters most — the one that repeats ninety-six times a day. */
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const num = (n: number) => n.toLocaleString();
const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

/** ⚠️ HOW MANY SLICES A BAR MAY HAVE BEFORE THE TAIL BECOMES "other". Past this
 *  the segments are thinner than their own border and the legend is longer than
 *  the thing it explains — and the tail is, by construction, the part that does
 *  not matter. The TABLE below still lists every row, so nothing is hidden by
 *  this; only the picture is simplified. */
const MAX_SLICES = 5;

/** How many requests one page of the log shows.
 *
 *  ⚠️ IT IS A READING LIMIT, NOT A DATA LIMIT. Every figure above the log — the
 *  total, all three breakdowns — is computed by the server over the WHOLE
 *  window and is unaffected by this; the CSV likewise exports every row the
 *  window holds, not the page on screen. Paging only decides how much of a
 *  500-row list a person is asked to scroll past to reach the section below it.
 *
 *  ⚠️ AND THE LEDGER ITSELF IS ALREADY BOUNDED, at `usage.MAX_ROWS` (8,000
 *  rows, roughly two months of triage). Asked directly whether this log could
 *  grow indefinitely: it cannot — `record()` rewrites `entries[-MAX_ROWS:]` on
 *  every append, so the file is a ring like every other store under `/data`. */

/** ⚠️ A SEQUENTIAL RAMP OF ONE HUE, NEVER THE CATEGORY PALETTE. CLAUDE.md's own
 *  gotcha: reusing `CATEGORY_COLORS` for non-category UI made a room chip read
 *  as a mis-tagged badge. These slices are shares of one quantity — money — with
 *  no meaning attached to any particular one, so a ramp of the accent is the
 *  honest encoding: darker is bigger, and nothing implies "this slice is the
 *  energy one". Opacity over the panel background rather than `color-mix`, which
 *  a 2022 iPad's Safari does not have. */
const SLICE_ALPHA = [1, 0.78, 0.58, 0.42, 0.3, 0.2];

function Slices({ rows }: { rows: [string, UsageBucket][] }) {
  const total = rows.reduce((sum, [, b]) => sum + b.cost, 0);
  // ⚠️ A ZERO-COST WINDOW IS A REAL STATE — a cached-only period, or rows the
  // pricing table has no entry for. Dividing by it would paint NaN% bars, so the
  // bar is simply not drawn and the table below still lists the requests.
  if (total <= 0) return null;
  const top = rows.slice(0, MAX_SLICES);
  const tail = rows.slice(MAX_SLICES);
  const tailCost = tail.reduce((sum, [, b]) => sum + b.cost, 0);
  const segments: [string, number][] = [
    ...top.map(([key, b]) => [key, b.cost] as [string, number]),
    ...(tailCost > 0 ? [[`${tail.length} more`, tailCost] as [string, number]] : []),
  ];
  return (
    <>
      <div className="usage-bar" role="img"
           aria-label={segments.map(([key, cost]) =>
             `${key} ${pct(cost / total)}`).join(", ")}>
        {segments.map(([key, cost], i) => (
          <span
            key={key}
            className="usage-bar-seg"
            style={{
              // ⚠️ FLEX-GROW, NOT A PERCENTAGE WIDTH. The segments carry a 1px
              // gap between them, so percentages summing to 100 overflow the
              // track by the gaps and the last slice is clipped — visibly, on
              // the one slice a reader is least likely to check.
              flexGrow: cost,
              background: `var(--accent)`,
              opacity: SLICE_ALPHA[Math.min(i, SLICE_ALPHA.length - 1)],
            }}
            title={`${key} — ${usd(cost)} (${pct(cost / total)})`}
          />
        ))}
      </div>
      <div className="usage-legend">
        {segments.map(([key, cost], i) => (
          <span className="usage-legend-item" key={key}>
            <span className="usage-swatch"
                  style={{ background: "var(--accent)",
                           opacity: SLICE_ALPHA[Math.min(i, SLICE_ALPHA.length - 1)] }} />
            {key} <span className="muted">{pct(cost / total)}</span>
          </span>
        ))}
      </div>
    </>
  );
}

/** `2026-08-23T14:05` — what `datetime-local` reads and writes. */
/** The rows on screen, as CSV.
 *
 *  ⚠️ THE ROWS, NOT THE SUMMARY. A total is one number anybody can read off the
 *  page; what an export is for is the thing you cannot do here — sort it, pivot
 *  it, or reconcile it line by line against the provider's own bill. The
 *  breakdowns are all derivable from these columns.
 *
 *  ⚠️ THE WINDOW IS THE ONE THAT WAS ASKED FOR — every row in it, which since
 *  2.684.0 is MORE than the panel is showing. The log pages at 20 and the file
 *  does not, deliberately: paging is a reading limit on a list somebody has to
 *  scroll past, whereas an export exists precisely to carry the rows the screen
 *  is not showing, and a CSV that stopped at the current page would be the one
 *  download nobody wants. The RANGE still matches the screen, which is the part
 *  that must not drift — a file that quietly widened its own window would be a
 *  spreadsheet disagreeing with the panel it came from.
 *
 *  ⚠️ EVERY FIELD IS QUOTED AND ITS QUOTES DOUBLED. A model id or an actor name
 *  containing a comma would otherwise shift every later column by one, silently
 *  — the failure mode of hand-rolled CSV, and the reason this is nine lines
 *  rather than a join. */
function toCsv(rows: UsageRow[]): string {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["when", "source", "actor", "model", "run_id", "input",
                  "cache_read", "cache_write", "output", "cost_usd"];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([new Date(r.at * 1000).toISOString(), r.source, r.actor,
                r.model, r.run_id, r.input, r.cache_read, r.cache_write,
                r.output, r.cost].map(cell).join(","));
  }
  // ⚠️ A TRAILING NEWLINE. Some tools drop the last row without one.
  return lines.join("\n") + "\n";
}

function toLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Breakdown({ title, rows, note }: {
  title: string; rows: Record<string, UsageBucket>; note: string;
}) {
  // ⚠️ SORTED BY COST, WHICH IS ALSO THE ORDER THE BAR IS DRAWN IN. One sort
  // for both, so the leftmost slice is always the first row of the table — the
  // relationship a reader assumes without being told, and the reason the legend
  // needs no numbering.
  const entries = Object.entries(rows).sort((a, b) => b[1].cost - a[1].cost);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, b]) => sum + b.cost, 0);
  return (
    <div className="usage-block">
      <h4 className="usage-block-title">{title}</h4>
      <p className="muted body-text">{note}</p>
      <Slices rows={entries} />
      <div className="usage-table" role="table">
        <div className="usage-row usage-head" role="row">
          <span className="usage-key">Name</span>
          <span className="usage-num">Share</span>
          <span className="usage-num">Requests</span>
          <span className="usage-num">Cost</span>
        </div>
        {entries.map(([key, b]) => (
          <div className="usage-row" role="row" key={key}>
            <span className="usage-key">{key}</span>
            <span className="usage-num">{total > 0 ? pct(b.cost / total) : "—"}</span>
            <span className="usage-num">{num(b.requests)}</span>
            <span className="usage-num">{usd(b.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsagePanel() {
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

  /** The most recent requests, newest first. ⚠️ SORTED HERE RATHER THAN TRUSTED:
   *  the ledger appends, so it arrives oldest-first, and a list headed "Recent"
   *  that begins at the oldest row is a label contradicting its own content. */
  const recent = useMemo(
    () => [...rows].sort((a, b) => b.at - a.at), [rows]);

  /** ⚠️ THE PAGE RESETS WHEN THE WINDOW MOVES. Without this, changing "Count
   *  from" to a narrower range leaves the reader on page 12 of a list that now
   *  has three pages — an empty table under a heading that says there are
   *  requests, which reads as a bug in the ledger rather than in the pager. */
  const paged = usePaged(recent);
  const page = paged.page;

  /** ⚠️ THE OFFLINE CONSTRAINT THAT USED TO BE STATED HERE NOW LIVES IN
   *  `utils/download.ts`, WHICH IS THE POINT. This comment said "an export
   *  cannot go through a service" and was the ONLY statement of it across five
   *  hand-rolled exports — so a sixth author who did not open this file got
   *  none of it. Encoded in the helper, a caller obeys it by calling. */
  const download = () =>
    downloadFile(`vesta-usage-${since.replace(/[:T]/g, "-")}.csv`,
                 toCsv(recent), "text/csv;charset=utf-8");

  if (summary === null && busy) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Reading the ledger…
      </p>
    );
  }

  return (
    <div className="fm-stack">

          <p className="muted body-text">
            Every request this add-on has made to the AI provider, whoever
            caused it. This includes scheduled checks and chat replies — they
            spend the same key whether or not the setting above is switched on.
          </p>

          {/* ⚠️ THE EXPORT SITS WITH THE RANGE THAT DEFINES IT, not at the
              foot of the page: the file is "what this window contains", and a
              button three sections away from the control that sets the window
              invites the reader to forget which is which. */}
          <div className="usage-since">
            <label className="fm-field" style={{ flex: 1 }}>
            <span>Count from</span>
            <input
              type="datetime-local"
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
            </label>
            <button className="btn ghost" onClick={() => void refresh()}
                    disabled={busy} title="Re-read the ledger">
              <RefreshCw size={16} aria-hidden />
            </button>
            <button className="btn ghost" onClick={download}
                    disabled={busy || recent.length === 0}
                    title="Download these requests as a CSV">
              <Download size={16} aria-hidden /> CSV
            </button>
          </div>

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
              <div className="usage-total">
                <strong>{usd(summary.total.cost)}</strong>
                {/* ⚠️ THE CACHED SHARE IS SHOWN SEPARATELY, because folding it
                    into one "in" figure hides the single largest cost lever in
                    the subsystem. The Villa Document is re-sent on every turn
                    of every tool loop; with a cache breakpoint those repeats
                    are billed at a fraction. Adding them together meant the fix
                    and its absence looked identical here — asked directly, "how
                    can I test and validate that this is now fixed?", and the
                    honest answer was that this panel could not tell you. */}
                <span className="muted">
                  {num(summary.total.requests)} request(s) ·{" "}
                  {num(summary.total.input)} fresh in ·{" "}
                  {num(summary.total.cache_read)} cached ·{" "}
                  {num(summary.total.output)} out
                </span>
              </div>
              {/* The number that answers "is caching working": a conversation
                  of more than one turn should be mostly cache reads. */}
              {summary.total.cache_read + summary.total.input > 0 && (
                <p className="muted body-text">
                  {Math.round(100 * summary.total.cache_read
                    / (summary.total.cache_read + summary.total.input))}% of
                  input tokens were served from cache. A tool-using answer is
                  four or five turns carrying the same villa document, so
                  anything near zero here means repeats are being re-bought.
                </p>
              )}
              {summary.estimated && (
                <p className="muted body-text">
                  Estimated from published prices and the token counts the
                  provider reported. Your bill is the authority — expect small
                  differences.
                </p>
              )}

              <Breakdown title="By who caused it" rows={summary.by_actor}
                note="“system” and “schedule” are the villa acting on its own; a
                      person’s name means a chat turn they sent." />
              <Breakdown title="By what it was for" rows={summary.by_source}
                note="Scheduled triage, an investigation, a chat reply, or the
                      brief’s narration." />
              <Breakdown title="By model" rows={summary.by_model}
                note="Cheaper models handle the repetitive work; the frontier
                      model is used where judgement is needed." />

              {recent.length > 0 && (
                <div className="usage-block">
                  <h4 className="usage-block-title">Recent requests</h4>
                  {truncated && (
                    <p className="muted body-text">
                      Showing the most recent 500. The totals above cover the
                      whole window.
                    </p>
                  )}
                  {/* ⚠️ THE TABLE CARRIES THE COLUMN COUNT, NOT THE ROWS. It
                      was on the body rows alone, so this three-column list was
                      drawn under the four-column header above — "In/out" and
                      "Cost" sat over the wrong tracks by construction. */}
                  <div className="usage-table usage-table-3" role="table">
                    <div className="usage-row usage-head" role="row">
                      <span className="usage-key">When · what · who</span>
                      <span className="usage-num">In/out</span>
                      <span className="usage-num">Cost</span>
                    </div>
                    {page.map((r, i) => (
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

                  {/* ⚠️ THE RANGE IS SPELLED OUT, NOT JUST THE PAGE NUMBER.
                      "2 / 25" tells a reader nothing about what they are
                      looking at; "21–40 of 500" says where they are in the
                      list and how much of it there is.

                      ⚠️ THE CSV BUTTON THAT WAS HERE IS GONE (2.771.0), AND ITS
                      ARGUMENT IS RECORDED BECAUSE IT WAS A GOOD ONE: the export
                      sat beside the pager because THIS is the control that
                      hides rows, and a reader just told they are seeing 20 of
                      500 is exactly the reader who wants the other 480. It was
                      still the SAME `download` call as the one in the toolbar
                      above — one action, two buttons, and the owner reported the
                      duplication from the screen. A second button does not
                      become a different feature by being well placed. The
                      toolbar keeps it, where it sits with the range picker that
                      decides what would be exported, and it is the copy with the
                      `disabled` guard for an empty list. */}
                  <Pager paged={paged} unit="request" />
                </div>
              )}
            </>
          )}
    </div>
  );
}
