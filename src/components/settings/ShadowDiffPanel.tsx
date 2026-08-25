// src/components/settings/ShadowDiffPanel.tsx
//
// How far the handover has got: is the assistant looking, and how much of what
// the old automations report has it reproduced on its own? TASK-050/051.
//
// ⚠️ REBUILT BECAUSE IT ANSWERED A QUESTION THE OWNER HAD ALREADY CLOSED. Every
// earlier version of this page was a DECISION SURFACE for "should you retire
// the automations" — the section order was an argument, the flattering column
// was last on purpose, and the headline read "24 things your automations caught
// and the villa did not". That decision has been taken: the direction is a full
// swap to the assistant and the blueprints are being retired. So a page arguing
// the case reads as noise at best and as "the assistant is losing 24–1" at
// worst, which is the opposite of what the same numbers mean during a handover.
// Reported as: "information looks very technical and no clear insight can be
// derived from it".
//
// The question now is PROGRESS, and it has three parts, in the order a person
// asks them: is it looking → does it have anything to look AT → how much of the
// old coverage has it matched. Nothing on this page asks the reader to decide
// whether to keep a rule.
//
// ⚠️ THE LISTS ARE GROUPED BY TITLE WITH A COUNT, AND THAT IS A FIX, NOT A
// STYLE. `shadow.diff` keys rows on `subject_key` — one row per piece of
// EQUIPMENT — while a finding's title names the CHECK that fired. So four pumps
// failing the same check produced four rows all reading "Pump power factor",
// and the page rendered what looked like the same line four times. A reader
// cannot tell that from a bug in the list, and it was 24 rows of it.
//
// ⚠️ AND A SLUG IS NOT A TITLE. A row shaped `family---instance_name` sat in
// that list between two English sentences — a rule id that reached the title
// field, verbatim, where a check name belongs.
// `pretty()` is the display-side repair; it is generic (no id, no name, no
// villa in it) and deliberately conservative: it only touches a string that is
// ENTIRELY id-shaped, so a real title containing an underscore is left alone.
//
// ⚠️ A PASS THAT NEVER RAN USED TO RENDER AS A QUIET ONE. `audit.record_pass`
// stores `verdict = escalated ? "escalated" : "quiet"`, so "agent disabled",
// "no model provider configured" and "budget: …" — three passes in which the
// assistant did not look at all — all arrived here labelled **quiet**, with the
// real reason buried mid-string in `detail`. That is this subsystem's own
// recurring defect (one value for the two outcomes an instrument exists to
// separate) inside the very panel built to resolve it. There are THREE
// outcomes here — raised, looked-and-quiet, could-not-look — and `outcomeOf`
// derives the third from the reason rather than from the stored verdict.
//
// ⚠️ THE TECHNICAL FIELDS ARE SHOWN WHEN THEY CARRY A FAULT AND NOT OTHERWISE.
// `doc=5246c/51L | escalated=0 | model=claude-haiku-4-5` on every row is the
// same string thirty times, and the one thing in it that ever changes a reading
// — a document of zero characters, i.e. the assistant handed nothing to read —
// was invisible inside it. That case is now a headline. The numbers all survive
// in the CSV, which is where a spreadsheet reader wants them.
//
// ⚠️ AND IT IS DELIBERATELY NOT IN THE COCKPIT. The Cockpit is open to every
// profile and shows the state of the VILLA; this is the state of the villa's
// SUPERVISION, it is owner-only on the server, and it belongs beside the
// switches that act on it.

import { useCallback, useEffect, useMemo, useState } from "react";
import InfoHint from "@/components/common/InfoHint";
import { AlertTriangle, CheckCircle2, Download, Eye, Loader2, Play, RefreshCw } from "lucide-react";

import RecentChecks from "@/components/agent/RecentChecks";
import { loadShadowDiff, loadTriagePasses, runAgentNow, type ShadowDiff, type TriagePass } from "@/agent/agentApi";

/** Titles that are entirely id-shaped, rendered as a person would write them.
 *
 *  ⚠️ CONSERVATIVE ON PURPOSE. The test is anchored at both ends and admits
 *  only lowercase words joined by `_`/`-`, so a real check name — which has
 *  spaces and capitals — passes through untouched. A prettifier
 *  that reached into real prose would corrupt the titles that are already fine
 *  in order to repair the few that are not. */
export function pretty(title: string): string {
  if (!/^[a-z0-9]+(?:[-_]{1,3}[a-z0-9]+)+$/.test(title)) return title;
  return title
    // `---` is the naming convention's family/instance separator, not a dash.
    .replace(/[-_]{2,}/g, " · ")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `["Pump power factor", "Pump power factor", …]` → `[{label, n}]`, commonest
 *  first. ⚠️ THE COUNT IS THE INFORMATION: "Pump power factor ×4" says four
 *  pieces of equipment, which four identical lines did not. */
export function groupTitles(titles: string[]): Array<{ label: string; n: number }> {
  const seen = new Map<string, number>();
  for (const t of titles) {
    const label = pretty(t);
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  return [...seen.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/** What a pass actually did. ⚠️ THREE, NOT THE TWO THE STORE HOLDS — see the
 *  header. `blocked` is every reason that is not one of the two the triage path
 *  produces when it ran, which is why it is derived by exclusion: a new guard
 *  added to `scheduler._run_once` returns a new reason string and lands here as
 *  "could not run" without anybody remembering to update this file. */
export type PassOutcome = "raised" | "quiet" | "blocked";

export function outcomeOf(reason: string): PassOutcome {
  if (reason.startsWith("escalated ")) return "raised";
  if (reason === "nothing to escalate") return "quiet";
  return "blocked";
}

/** The human half of `detail`: `audit.record_pass` joins the reason and the
 *  numbers with " | ", and everything after the first separator is the numbers. */
export const reasonOf = (p: TriagePass) => (p.detail || "").split(" | ")[0].trim();

/** How many subjects a pass INVESTIGATED and how many concerns came back, out
 *  of `Followup.clause` ("investigated 3, 1 concern").
 *
 *  ⚠️ THIS IS WHERE THE MONEY GOES AND THE PAGE WAS BLIND TO IT. An
 *  investigation is a frontier-model run; "reached 0 of 24" reads as an
 *  assistant that is not working, and cannot be told apart from one that
 *  looked twenty times and correctly concluded nothing — which `reason.SYSTEM`
 *  instructs outright ("finding nothing is a good outcome and a complete
 *  answer"). Both numbers were already in the sentence; neither was on screen. */
export function yieldOf(reason: string): { looked: number; raised: number } {
  const looked = /investigated (\d+)/.exec(reason);
  const raised = /(\d+) concerns?/.exec(reason);
  return { looked: looked ? Number(looked[1]) : 0,
           raised: raised ? Number(raised[1]) : 0 };
}

/** `escalated 2 (investigated 2): A, B` → `A, B`. */
export const subjectsOf = (reason: string) => {
  const i = reason.indexOf(": ");
  return i < 0 ? "" : reason.slice(i + 2).trim();
};

/** "3 minutes ago" from an ISO stamp. ⚠️ RELATIVE, because the question is
 *  always "is this still happening" and the reader is standing at a wall. */
function ago(iso: string): string {
  const then = Date.parse(iso || "");
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`;
}

export default function ShadowDiffPanel() {
  /** ⚠️ THREE STATES, NOT TWO. `undefined` is "not asked yet", `null` is "asked
   *  and could not read it", and a value is an answer — which may legitimately
   *  be an empty diff. Collapsing the middle one renders a failed read as a
   *  clean period. */
  const [diff, setDiff] = useState<ShadowDiff | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
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

  /** Newest first, with the outcome already decided once. */
  const recent = useMemo(() => [...passes].reverse().map((p) => {
    const reason = reasonOf(p);
    return { pass: p, reason, outcome: outcomeOf(reason) };
  }), [passes]);

  const last = recent[0];
  /** ⚠️ SUMMED OVER EVERY RECORDED PASS, not the page, because a reader
   *  paging back is not changing the villa's history. */
  const work = useMemo(() => recent.reduce((acc, r) => {
    const y = yieldOf(r.reason);
    return { looked: acc.looked + y.looked, raised: acc.raised + y.raised };
  }, { looked: 0, raised: 0 }), [recent]);
  /** Passes in the last 24 h — the honest measure of "is it running", where a
   *  total since install would keep reading healthy long after it stopped. */
  const dayPasses = useMemo(() => {
    const since = Date.now() - 86_400_000;
    return recent.filter((r) => (Date.parse(r.pass.at || "") || 0) >= since).length;
  }, [recent]);
  /** ⚠️ `undefined` IS NOT ZERO HERE. Rows written before v2.685.0 carry no
   *  `docChars` at all, and treating that as an empty document would raise the
   *  loudest alarm on this page about a pass that was probably fine. */
  const blind = last !== undefined && last.pass.docChars === 0;

  /** The three lists as CSV, one row per finding with the column that decides.
   *
   *  ⚠️ THE `caught_by` COLUMN IS THE POINT — a spreadsheet adds sorting and
   *  filtering on WHICH SIDE found each one, and it carries the coverage flag on
   *  every row because a banner is lost in an export.
   *
   *  ⚠️ ONE FLAT TABLE WITH A `section` COLUMN. Two sections each with their own
   *  header is not two tables to a spreadsheet: every pass row landed under the
   *  FINDINGS headers, so `pass_at` sat under "caught_by" and `detail` in a
   *  column with no header at all. Reported as "can you include the triage
   *  passes in the CSV" — of a file that already contained them.
   *
   *  ⚠️ AND THE ROWS ARE UNGROUPED, UNLIKE THE PAGE. Grouping is a reading aid;
   *  a spreadsheet groups by itself and cannot ungroup, so the file keeps one
   *  row per subject. It is the same relationship as `detail` beside the numeric
   *  columns: one rendering for a person, one for a tool, from one source. */
  const download = () => {
    if (!diff) return;
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["section", "caught_by", "finding", "coverage_complete",
                  "pass_at", "verdict", "trigger", "doc_chars", "doc_lines",
                  "escalated", "model", "detail"];
    const rows = [head.map(cell).join(",")];
    const row = (values: Record<string, unknown>) =>
      rows.push(head.map((k) => cell(values[k] ?? "")).join(","));

    const add = (side: string, titles: string[]) => titles.forEach((t) => row({
      section: "finding", caught_by: side, finding: pretty(t),
      coverage_complete: String(diff.coverageComplete),
    }));
    add("automations only — not matched yet", diff.rulesOnly);
    add("both", diff.both);
    add("assistant only", diff.agentOnly);

    if (passes.length === 0) {
      // ⚠️ SAID OUT LOUD, NOT LEFT BLANK. An absent section reads as "the trace
      // was not exported"; this reads as "no pass has run".
      row({ section: "pass", detail: "no triage pass has been recorded" });
    }
    for (const p of passes) {
      row({
        section: "pass", pass_at: p.at,
        // ⚠️ THE DERIVED OUTCOME, NOT THE STORED VERDICT — see the header. The
        // file said "quiet" for a pass that never ran, same as the page did.
        verdict: outcomeOf(reasonOf(p)), trigger: p.trigger,
        doc_chars: p.docChars, doc_lines: p.docLines, escalated: p.escalated,
        model: p.model, detail: p.detail,
      });
    }
    const url = URL.createObjectURL(
      new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vesta-handover-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** ⚠️ ONE RUN, NOW, SO THE PAGE CAN BE TESTED TODAY. Waiting a cadence is the
   *  honest instruction for judging a real period and a terrible one for finding
   *  out whether any of this works. It spends real budget, which the button
   *  says. */
  const runNow = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const result = await runAgentNow();
    // ⚠️ THE REASON IS SHOWN VERBATIM, because `run_once` returns WHY it stopped
    // and the five causes need different responses: switched off, shadowed, over
    // budget, no provider, and nothing to escalate look identical from outside
    // and four of them are fine.
    setNote(result.ok
      ? "The check ran — its result is the first row under “Recent checks”. "
        + "A check that finds the villa well raises nothing, which is not a "
        + "failure."
      : `The check stopped: ${result.reason}`);
    // ⚠️ CALL `load`, DO NOT REPEAT ITS BODY. This refreshed only the diff once,
    // so the press that CREATED a trace row left the trace still reading "no
    // pass has been recorded".
    await load();
  }, [load]);

  if (diff === undefined) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Reading the
        handover…
      </p>
    );
  }

  if (diff === null) {
    return (
      <p className="body-text sev-warning" role="alert">
        This could not be read. That is not the same as an empty one — nothing
        here should be taken as evidence either way.
      </p>
    );
  }

  const matched = diff.both.length;
  const unmatched = diff.rulesOnly.length;
  const covered = matched + unmatched;
  const pct = covered > 0 ? Math.round((100 * matched) / covered) : 0;

  /** ⚠️ THE HEADLINE IS THE ONE THING A READER ACTS ON, so it is ordered by
   *  what BLOCKS what. A coverage percentage computed while the assistant was
   *  never given the villa's notes to read is a number about nothing, so the
   *  two "it could not look" states come first and say so instead. */
  /** ⚠️ `one-sided` WAS IN THE PREVIOUS VERSION AND I DROPPED IT IN THE
   *  REBUILD — a regression, reported the same day as "how come the handover is
   *  blocked by this". EVERY finding lands in "not matched" by construction
   *  when the other column is empty, so `matched of covered` carries no
   *  information about the assistant at all: an assistant that has raised
   *  nothing produces exactly the page an assistant that is failing produces.
   *  That is this project's most repeated defect — one output for the two
   *  outcomes an instrument exists to separate — and the rebuild reintroduced
   *  it while removing five other instances of it. */
  const verdict: "never" | "blocked" | "blind" | "one-sided" | "progress" =
    last === undefined ? "never"
      : last.outcome === "blocked" ? "blocked"
        : blind ? "blind"
          : diff.agentTotal === 0 ? "one-sided"
            : "progress";
  const bad = verdict !== "progress";

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        The assistant is taking over the watching that your Home Assistant
        automations used to do. This page is the state of that handover.
      </p>

      <div className={`cockpit-health cockpit-health-${
        bad ? "warn" : pct === 100 ? "ok" : "info"}`}>
        {bad ? <AlertTriangle size={18} aria-hidden />
             : pct === 100 ? <CheckCircle2 size={18} aria-hidden />
                           : <Eye size={18} aria-hidden />}
        <span>
          {verdict === "never"
            ? "The assistant has not run a check yet"
            : verdict === "blocked"
              ? `The assistant could not run its last check — ${last!.reason}`
              : verdict === "blind"
                ? "The assistant ran, but was handed nothing to read"
              : verdict === "one-sided"
                ? `Not a comparison yet — your automations reported `
                  + `${diff.rulesTotal}, the assistant nothing`
                : covered === 0
                  ? "The assistant is watching. Nothing has been reported by "
                    + "either side yet"
                  : `The assistant reached ${matched} of the ${covered} things `
                    + "your automations reported"}
        </span>
      </div>

      {/* ⚠️ ONE SENTENCE PER STATE, AND ONLY THE STATE'S OWN. The page used to
          stack a bold zero, a regression warning, a coverage caveat and an
          empty-state banner — four claims about one emptiness, two of them
          contradicting each other. */}
      {verdict === "never" && (
        <p className="muted body-text">
          Press “Check the villa now” below to run one immediately, or leave it —
          it checks on its own every few hours. Nothing on this page means
          anything until it has looked at least once.
        </p>
      )}
      {verdict === "blocked" && (
        <p className="muted body-text">
          Nothing is being missed while this lasts: your automations are still
          running and still reporting. Fix the reason above and the assistant
          picks up where it left off.
        </p>
      )}
      {verdict === "one-sided" && (
        <p className="muted body-text">
          That count says nothing about the assistant yet — read
          “Investigated → raised” below instead.
          <InfoHint label="Why this is not a comparison">
            Every finding lands under “not matched” when the other column is
            empty, so an assistant that has raised nothing produces exactly this
            page — the same one a failing assistant would. What it HAS been
            doing is the pair of numbers below: how many subjects it looked
            into, against how many concerns came back. Investigating and
            concluding nothing is a correct outcome and is what it is told to
            do.
          </InfoHint>
        </p>
      )}
      {verdict === "blind" && (
        <p className="muted body-text">
          It looked and found nothing to raise — but it was given an empty set
          of villa notes, so “nothing to raise” proves nothing. This is a fault
          in the recording, not a quiet villa. Check that Observe is listening.
        </p>
      )}

      {/* Three facts, all about the same question: is it looking, how often,
          and did it have anything to look at. */}
      <dl className="reports-facts">
        <div>
          <dt>Last checked</dt>
          <dd>{last ? (ago(last.pass.at) || "—") : "never"}</dd>
        </div>
        <div>
          <dt>Checks in 24 h</dt>
          <dd>{dayPasses}</dd>
        </div>
        <div>
          {/* ⚠️ THE PAIR, NOT EITHER ALONE. "Investigated 10" alone reads as
              busy; "raised 2" alone reads as broken. Together they are the one
              honest measure of what the spend bought, and the gap between them
              is a deliberate instruction rather than a fault. */}
          <dt>Investigated → raised</dt>
          <dd>{work.looked} → {work.raised}</dd>
        </div>
        <div>
          <dt>Villa notes read</dt>
          {/* ⚠️ `?` FOR "CANNOT SAY", NEVER 0. Rows from before v2.685.0 carry
              no size at all, and a zero there is the loudest alarm on the page. */}
          <dd>{last?.pass.docChars === undefined
            ? "?" : `${last.pass.docChars.toLocaleString()} char`}</dd>
        </div>
      </dl>

      <div className="modal-actions" style={{ margin: 0 }}>
        <button className="btn ghost" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden /> Re-read
        </button>
        {/* ⚠️ IT SPENDS REAL BUDGET AND THE LABEL SAYS SO. A button that costs
            money must not look like a refresh. */}
        <button className="btn" disabled={busy} onClick={() => void runNow()}>
          <Play size={16} aria-hidden />
          {busy ? "Checking…" : "Check the villa now (spends a request)"}
        </button>
      </div>
      {note && <p className="muted body-text">{note}</p>}

      {covered > 0 && (
        <div className="usage-block">
          <h4 className="usage-block-title">How much it has taken over</h4>
          <div className="fm-cap-bar" role="img"
               aria-label={`${matched} of ${covered} matched`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="muted body-text">
            {matched} of {covered} matched. The rest are still covered by the
            automation that reported them, so nothing is going unnoticed today —
            they are what the assistant has not reproduced yet.
          </p>
          {/* ⚠️ THE CAVEAT APPEARS BESIDE EVIDENCE AND NOWHERE ELSE. On an empty
              page it was one of two banners saying the same nothing. */}
          {!diff.coverageComplete && (
            <div className="fm-banner">
              Part of this period was not observed, so something missing from
              both columns proves nothing.
            </div>
          )}
        </div>
      )}

      {/* ⚠️ A ROW READING "(untitled finding …)" IS STALE DATA, NOT A BUG, and
          the page says so rather than leaving the reader to conclude the fix did
          not work. Entries written between v2.662.0 and v2.665.0 stored their
          blueprint findings without a title, and re-read re-reads those same
          rows — only a NEW briefing carries titles. */}
      {diff.rulesOnly.some((t) => t.startsWith("(untitled")) && (
        <div className="fm-banner">
          Some rows have no title. They were recorded by an older release that
          stored findings without one — generate a briefing and they will read
          properly. Re-read alone cannot fix them.
        </div>
      )}

      <TitleList
        title="Not matched yet"
        blurb="Your automations reported these and the assistant did not reach
               them on its own. This is the remaining work of the handover."
        empty="Nothing — the assistant reached everything the automations did."
        titles={diff.rulesOnly}
      />
      <TitleList
        title="Found only by the assistant"
        blurb="No automation covers these. This is what the assistant adds."
        empty="Nothing yet."
        titles={diff.agentOnly}
      />
      <TitleList
        title="Found by both"
        blurb="Reported either way."
        empty="Nothing yet."
        titles={diff.both}
      />

      {/* ⚠️ THE TRACE, AND IT IS NOT DECORATION. Everything above answers "what
          was found"; only this answers "did it look, and what happened". A quiet
          pass and a pass that never happened render the same empty column above,
          and that ambiguity is what made four rounds of this review
          inconclusive. */}
      <div className="usage-block">
        <h4 className="usage-block-title">Recent checks</h4>
        <RecentChecks
          passes={passes}
          empty={<>None recorded. Until one is, an empty list above means
                 &ldquo;not measured&rdquo;, not &ldquo;the assistant
                 agreed&rdquo;.</>}
        >
          <button className="btn ghost" onClick={download} disabled={busy}
                  title="Download the findings and the full trace as a CSV">
            <Download size={16} aria-hidden /> CSV
          </button>
        </RecentChecks>
      </div>
    </div>
  );
}

/** One grouped list. ⚠️ A COMPONENT RATHER THAN THREE COPIES: the three lists
 *  differ only in their words, and the previous version wrote the heading
 *  arithmetic, the empty state and the `.map` out three times — three places
 *  for a change to reach two of. */
function TitleList({ title, blurb, empty, titles }: {
  title: string; blurb: string; empty: string; titles: string[];
}) {
  const rows = useMemo(() => groupTitles(titles), [titles]);
  return (
    <div className="usage-block">
      <h4 className="usage-block-title">{title} ({titles.length})</h4>
      <p className="muted body-text">{blurb}</p>
      {rows.length === 0
        ? <p className="muted body-text">{empty}</p>
        : <ul className="body-text">
            {rows.map(({ label, n }) => (
              <li key={label}>
                {label}
                {/* ⚠️ THE COUNT IS WHAT THE FOUR IDENTICAL LINES WERE SAYING —
                    four pieces of equipment, one check. */}
                {n > 1 && <span className="muted"> ×{n}</span>}
              </li>
            ))}
          </ul>}
    </div>
  );
}
