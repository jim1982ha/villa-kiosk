// src/components/settings/ShadowDiffPanel.tsx
//
// What the shadow period found, beside what the rules found. TASK-050/051.
//
// ⚠️ THIS IS THE PH-3 GATE'S ONLY SURFACE, AND UNTIL NOW THE GATE HAD NONE.
// `shadow.diff()` and `shadow.report()` shipped in v2.642.0 with no caller —
// no route, no UI, no command — so the document `TASK-051` asks an owner to
// read could not be produced at all. The checkpoint blocks PH-4 and PH-5, which
// is two whole phases waiting on a page nothing rendered. Same shape as the
// review queue, found the same way: by asking what actually calls the thing.
//
// ⚠️ IT RENDERS THE DIFF'S STRUCTURE, AND THE FIRST VERSION SHOWED `report()`'s
// TEXT VERBATIM. The reasoning then was that the document's section order is an
// argument — what the agent MISSED first, its wins last — and that re-laying it
// out would be a second opinion. The order is still an argument and is still
// obeyed here; what was wrong was showing a monospace document with three zeros
// in it and calling that a decision surface. Reported: "very poorly reporting
// information, not understandable for a user".
//
// ⚠️ THE SECTIONS ARE NAMED BY WHAT THEY MEAN FOR THE DECISION, not by which
// layer produced them. "Caught by the rules and not by the agent" is accurate
// and makes the reader do the inference; "would be lost if you retired the
// automations" is the same set and is the question they came with.
//
// ⚠️ AND THE PAGE SAYS ONE THING AT A TIME. It used to stack a bold `0`, a
// sentence about regressions, a coverage caveat and a "nothing recorded yet"
// banner — four claims about one emptiness, two of them contradicting each
// other. The verdict line is now the headline, the caveat appears only beside
// real evidence, and the empty state explains what to wait for instead.
//
// ⚠️ AND IT IS DELIBERATELY NOT IN THE COCKPIT. The Cockpit is open to every
// profile and shows the state of the VILLA; this is a decision about how the
// villa is SUPERVISED, it is owner-only on the server, and it belongs beside
// the switches that act on it.

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Play, RefreshCw } from "lucide-react";

import { loadShadowDiff, loadTriagePasses, runAgentNow, type ShadowDiff, type TriagePass } from "@/agent/agentApi";

export default function ShadowDiffPanel() {
  /** ⚠️ THREE STATES, NOT TWO. `undefined` is "not asked yet", `null` is "asked
   *  and could not read it", and a value is an answer — which may legitimately
   *  be an empty diff. Collapsing the middle one renders a failed read as a
   *  clean period, and this is the page a cutover is decided on. */
  const [diff, setDiff] = useState<ShadowDiff | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /** What the last forced run said, if one was asked for. */
  const [note, setNote] = useState<string | null>(null);

  const [passes, setPasses] = useState<TriagePass[]>([]);
  const load = useCallback(async () => {
    setBusy(true);
    // ⚠️ BOTH, ALWAYS. The diff alone cannot say whether a pass happened, and
    // that is the question every round of this review has actually been about.
    const [d, p] = await Promise.all([loadShadowDiff(), loadTriagePasses()]);
    setDiff(d);
    setPasses(p);
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** The three lists as CSV, one row per finding with the column that decides.
   *
   *  ⚠️ THE `caught_by` COLUMN IS THE POINT. A flat list of titles is the page
   *  again; what a spreadsheet adds is sorting and filtering on WHICH SIDE
   *  found each one, which is the only question this document exists to answer.
   *
   *  ⚠️ AND IT CARRIES THE COVERAGE FLAG ON EVERY ROW. The caveat is a banner
   *  on screen and would be lost in an export — a file whose rows look
   *  conclusive when the period was not fully observed is worse than no file. */
  const download = () => {
    if (!diff) return;
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["caught_by", "finding", "coverage_complete"].map(cell).join(",")];
    const add = (side: string, titles: string[]) => titles.forEach((t) =>
      rows.push([side, t, String(diff.coverageComplete)].map(cell).join(",")));
    add("rules only — would be lost", diff.rulesOnly);
    add("both", diff.both);
    add("villa only", diff.agentOnly);
    const url = URL.createObjectURL(
      new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vesta-cutover-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** ⚠️ ONE RUN, NOW, SO THE GATE CAN BE TESTED TODAY. Waiting a cadence is the
   *  honest instruction for judging a real period and a terrible one for
   *  finding out whether this page works at all — and the last two defects here
   *  were both invisible until somebody put evidence beside it. It spends real
   *  budget, which the button says. */
  const runNow = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const result = await runAgentNow();
    // ⚠️ A RUN IS NOT A CONCERN, AND SAYING SO IS THE HONEST ANSWER. This
    // asks the villa a question and reads the reply; a CONCERN — which is what
    // the diff compares — is raised by the triage path when something crosses
    // the bar. So a finished run legitimately adds nothing here, and the first
    // wording ("anything it concluded is below") implied otherwise.
    // ⚠️ THE REASON IS SHOWN VERBATIM, because `run_once` returns WHY it
    // stopped and the five causes need different responses: switched off,
    // shadowed, over budget, no provider, and nothing to escalate look
    // identical from outside and four of them are fine.
    setNote(result.ok
      ? "The check ran. Anything it judged worth raising is in the villa's "
        + "column below; a check that finds the villa well adds nothing, "
        + "which is not a failure."
      : `The check stopped: ${result.reason}`);
    setDiff(await loadShadowDiff());
    setBusy(false);
  }, []);

  if (diff === undefined) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Reading the shadow
        period…
      </p>
    );
  }

  if (diff === null) {
    return (
      <p className="body-text sev-warning" role="alert">
        The shadow diff could not be read. That is not the same as an empty
        one — nothing here should be taken as evidence either way.
      </p>
    );
  }

  /** ⚠️ THREE STATES, AND THE FIRST VERSION RENDERED ALL THREE AT ONCE. It
   *  showed a bold `0`, a sentence about regressions, a coverage banner and a
   *  "nothing recorded yet" banner stacked together — four claims about the
   *  same emptiness, two of which contradicted each other ("nothing was
   *  found" beside "you cannot conclude anything"). Reported as poorly
   *  reporting information, and it was. A page that answers one question gets
   *  to say one thing. */
  const ran = diff.agentTotal > 0 || diff.rulesTotal > 0;
  /** ⚠️ A DIFF WITH AN EMPTY VILLA COLUMN IS NOT A COMPARISON, AND CALLING IT
   *  ONE WOULD HAVE COST THE OWNER THE DECISION. With `rulesTotal` 10 and
   *  `agentTotal` 0 the page said "10 things your automations caught and the
   *  villa did not" — which is arithmetically true and reads as "the agent is
   *  worse", when the identical output is produced by an agent that has never
   *  run. Every rule is in `rulesOnly` by construction when the other side is
   *  empty, so the number carries no information about the agent at all.
   *
   *  This is the shape this project keeps paying for: an instrument reporting
   *  the same value for the two outcomes it exists to separate. */
  const verdict = !ran
    ? "waiting"
    : diff.agentTotal === 0
      ? "one-sided"
      : diff.rulesOnly.length > 0 ? "blocked" : "clear";

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        While “Observe only” is on the villa runs everything and delivers
        nothing. This compares what it concluded against what your existing
        automations concluded, over the same period.
      </p>

      {/* ⚠️ THE HEADLINE IS THE DECISION, NOT A NUMBER. "0" answered a question
          nobody asked; what a reader needs is whether they can act on this
          page yet, and if so which way it points. */}
      <div className={`cockpit-health cockpit-health-${
        verdict === "blocked" ? "warn" : verdict === "clear" ? "ok" : "unknown"}`}>
        <span>
          {verdict === "waiting"
            ? "Not enough evidence yet — neither layer has recorded anything"
            : verdict === "one-sided"
              ? `Not a comparison yet — your automations reported `
                + `${diff.rulesTotal}, the villa nothing`
            : verdict === "blocked"
              ? `${diff.rulesOnly.length} thing${
                  diff.rulesOnly.length === 1 ? "" : "s"} your automations caught`
                + " and the villa did not"
              : "Nothing your automations caught was missed"}
        </span>
      </div>

      {verdict === "one-sided" && (
        <div className="fm-banner">
          Every finding lands in the first list when the other side is empty, so
          that count says nothing about the villa yet — an agent that has raised
          no concerns produces exactly this page. Leave supervision running
          until the Cockpit shows concerns of its own, then compare. Retiring
          anything on this reading would be deciding from one column.
        </div>
      )}

      {verdict === "waiting" ? (
        <p className="muted body-text">
          To fill this page <strong>today</strong>: press “Check the villa now”
          below for the villa&rsquo;s side, and press-and-hold a schedule&rsquo;s
          delete button in Briefings → Schedule to send one briefing for the
          automations&rsquo; side. Both write immediately. Otherwise it fills on
          its own — a briefing a day, and a check every few minutes — and an
          empty page today means the period has not run, not that the villa was
          quiet.
        </p>
      ) : (
        <>
          {/* ⚠️ A ROW READING "(untitled finding …)" IS STALE DATA, NOT A BUG,
              and the page says so rather than leaving the reader to conclude
              the fix did not work. History entries written between v2.662.0 and
              v2.665.0 stored their blueprint findings without a title; re-read
              re-reads those same stored rows, so only a NEW brief carries
              titles. Said here because "I redid it and got the same thing" is
              the correct observation and the wrong conclusion. */}
          {diff.rulesOnly.some((t) => t.startsWith("(untitled")) && (
            <div className="fm-banner">
              Some rows have no title. They were recorded by an older release
              that stored findings without one — generate a briefing (Briefings
              → Schedule, press and hold a row&rsquo;s delete) and they will
              read properly. Re-read alone cannot fix them: it re-reads the
              same stored rows.
            </div>
          )}

          {/* ⚠️ THE THREE LISTS, NAMED BY WHAT THEY MEAN FOR THE DECISION rather
              than by which layer produced them. "Caught by the rules and not by
              the agent" is accurate and makes the reader do the inference; the
              reader wants to know what retiring a rule would cost. */}
          <div className="usage-block">
            <h4 className="usage-block-title">
              Would be lost if you retired the automations ({diff.rulesOnly.length})
            </h4>
            <p className="muted body-text">
              The villa did not reach these on its own. Each one is a reason to
              keep the rule that did.
            </p>
            {diff.rulesOnly.length === 0
              ? <p className="muted body-text">Nothing — no regression to ship.</p>
              : <ul className="body-text">
                  {diff.rulesOnly.map((t) => <li key={t}>{t}</li>)}
                </ul>}
          </div>

          <div className="usage-block">
            <h4 className="usage-block-title">
              Both found ({diff.both.length})
            </h4>
            <p className="muted body-text">
              Covered either way — these are the rules a cutover is safe for.
            </p>
            {diff.both.length > 0 && (
              <ul className="body-text">
                {diff.both.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>

          <div className="usage-block">
            <h4 className="usage-block-title">
              Only the villa found ({diff.agentOnly.length})
            </h4>
            <p className="muted body-text">
              No rule covers these. They are what the agent adds, and they are
              deliberately listed last: this page exists to decide whether to
              retire working automations, and one that opens with the agent's
              wins is written to be agreed with.
            </p>
            {diff.agentOnly.length > 0 && (
              <ul className="body-text">
                {diff.agentOnly.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>
        </>
      )}

      {/* ⚠️ THE COVERAGE CAVEAT IS SHOWN ONLY WHEN IT CHANGES THE READING —
          beside evidence, never beside an empty page where it was one of two
          banners saying the same nothing. */}
      {ran && !diff.coverageComplete && (
        <div className="fm-banner">
          Part of this period was not observed, so something missing from all
          three lists proves nothing.
        </div>
      )}

      {note && <p className="muted body-text">{note}</p>}

      <div className="modal-actions" style={{ margin: 0 }}>
        <button className="btn ghost" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden /> Re-read
        </button>
        <button className="btn ghost" onClick={download}
                disabled={busy || !ran}
                title="Download these three lists as a CSV">
          <Download size={16} aria-hidden /> CSV
        </button>
        {/* ⚠️ IT SPENDS REAL BUDGET AND THE LABEL SAYS SO. A button that costs
            money must not look like a refresh. */}
        <button className="btn" disabled={busy} onClick={() => void runNow()}>
          <Play size={16} aria-hidden />
          {busy ? "Checking…" : "Run a check now (spends a request)"}
        </button>
      </div>

      {/* ⚠️ THE TRACE, AND IT IS NOT DECORATION. Everything above answers "what
          was found"; only this answers "did the agent look, and what was it
          given". A quiet pass and a pass that never happened render the same
          empty column above — that ambiguity is what made four rounds of this
          review inconclusive. `doc=` is here for the same reason: a pass handed
          an empty villa document also reports nothing to escalate, and looks
          exactly like success. */}
      <div className="settings-section-title">Triage passes</div>
      {passes.length === 0 ? (
        <p className="muted body-text">
          No pass has been recorded yet. Until one is, an empty agent column
          above means "not measured", not "the agent agreed".
        </p>
      ) : (
        <ul className="fm-list">
          {passes.slice(-8).reverse().map((p, i) => (
            <li key={`${p.at}-${i}`} className="body-text">
              <strong>{p.verdict === "escalated" ? "escalated" : "quiet"}</strong>
              {" · "}{p.trigger}{" · "}
              <span className="muted">{p.at.replace("T", " ").slice(0, 16)}</span>
              <div className="muted body-text">{p.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
