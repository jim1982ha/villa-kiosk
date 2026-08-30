// src/vesta/brief/components/RecordTab.tsx
// WHAT HAPPENED — the record the next briefing will read.
//
// ⚠️ THE OWNER'S DESIGN (2026-08-30): one ledger, filled the same way whichever
// position the Supervision switch is in, and visible on the surface that reads
// it. What is on this screen is literally what the next briefing summarises —
// not a similar query, the same one, over the same window.
//
// ⚠️ THIS ABSORBED THE "Instant alerts" TAB. That tab listed automation
// FAMILIES with descriptions and no live data; here the same automations appear
// as what they actually did, with their own figures. A filter replaces a tab,
// which is the simplification the record earns. Its explanation moved into the
// (i) rather than being deleted with it.
//
// ⚠️ DELETING AN ENTRY IS DELETING HISTORY, and the copy says so. That is why
// it lives here and not on the to-do list, where a reader would think they were
// ticking work off.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, Zap } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import Pager, { usePaged } from "@/components/common/Pager";
import { deleteRecordEntry, fetchRecord, type RecordEntry } from "@/vesta/brief/reportsApi";

/** One row as rendered: an entry, or several firings of ONE automation. */
interface Row extends RecordEntry { times: number; }

/** Group repeated firings of the same automation into one row.
 *
 *  ⚠️ THE OWNER'S REASON, WHICH IS THE WHOLE POINT (2026-08-30): an automation
 *  like a motion-triggered light fires dozens of times a day, so one line per
 *  firing turns both this screen and the briefing into a wall of identical
 *  rows nobody reads. Grouped, it says the useful thing — WHICH automation, HOW
 *  OFTEN, and what it cost in total.
 *
 *  ⚠️ ONLY `automation` ROWS GROUP. An alert and a flagged item are each about
 *  a specific moment and a specific judgement; collapsing two investigations of
 *  one pump into "×2" would hide that the agent concluded two different things.
 *
 *  ⚠️ FIGURES ARE SUMMED, NEVER SAMPLED. Showing one firing's "0.3 kWh" beside
 *  "14 times" states a number that is wrong by a factor of fourteen; the total
 *  is the honest form, and a non-numeric payload contributes nothing rather
 *  than guessing. */
function grouped(rows: RecordEntry[]): Row[] {
  const out: Row[] = [];
  const seen = new Map<string, Row>();
  for (const row of rows) {
    if (row.source !== "automation") { out.push({ ...row, times: 1 }); continue; }
    const key = row.subject || row.title;
    const held = seen.get(key);
    if (!held) {
      const fresh: Row = { ...row, times: 1 };
      seen.set(key, fresh);
      out.push(fresh);
      continue;
    }
    held.times += 1;
    // keep the NEWEST time: the list is newest-first, so the row already
    // carries it and later firings are older.
    held.detail = sumFigures(held, row);
  }
  return out;
}

/** Add one firing's figures into the row's running total. */
function sumFigures(held: Row, next: RecordEntry): string {
  const add = (a: unknown, b: unknown): number =>
    (Number(a) || 0) + (Number(b) || 0);
  const kwh = add(held.payload?.kwh, next.payload?.kwh);
  const cost = add(held.payload?.cost_local, next.payload?.cost_local);
  const mins = add(held.payload?.wasted_minutes, next.payload?.wasted_minutes);
  held.payload = { ...(held.payload || {}), kwh, cost_local: cost,
                   wasted_minutes: mins };
  const bits: string[] = [];
  if (mins) bits.push(`${Math.round(mins)} min total`);
  if (kwh) bits.push(`${kwh.toFixed(1)} kWh total`);
  if (cost) bits.push(`about ${Math.round(cost)} total`);
  return bits.join(" · ");
}

/** The filters a reader actually wants: who reported it. */
const SOURCES: { id: string; label: string }[] = [
  { id: "", label: "Everything" },
  { id: "agent", label: "VESTA Agent" },
  { id: "triage", label: "Noticed" },
  { id: "automation", label: "Your automations" },
];

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function RecordTab({ days = 31 }: { days?: number }) {
  const [rows, setRows] = useState<RecordEntry[] | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  // ⚠️ FILTER, THEN GROUP, THEN PAGE — in that order. Grouping before
  // filtering would count firings the reader has filtered away; paging before
  // grouping would put a page boundary in the middle of one automation's
  // firings and show it twice with two different counts.
  const visible = useMemo(
    () => grouped((rows || []).filter((r) => !source || r.source === source)),
    [rows, source]);
  const { shown, pager } = usePaged(visible);

  const load = useCallback(async () => {
    setRows(await fetchRecord(days));
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const remove = useCallback(async (row: RecordEntry) => {
    setBusy(true);
    await deleteRecordEntry(row.at, row.subject);
    setBusy(false);
    await load();
  }, [load]);

  return (
    <div className="reports-pane">
      <h3 className="settings-section-title">What happened</h3>
      <p className="muted body-text">
        {/* ⚠️ IT SAID "everything the next briefing will summarise" AND SHOWED
            31 DAYS (2026-08-30, owner: "I am not sure the WHAT HAPPENED is
            consistent"). It is not: this list is a MONTH and a daily briefing
            is a DAY, so the same automation read 19× here and "12 times" in
            the message — both correct, about different windows, under a
            sentence claiming they were the same. The count line below has
            always named the real window; this heading was the liar. */}
        Everything recorded, newest first — a longer view than any one
        briefing. A daily briefing covers the current day only, so its counts
        are smaller than these.
        <InfoHint label="What happened">
          <p>
            One record, filled the same way whether Supervision is ON or OFF —
            what changes is who is writing to it.
          </p>
          <p>
            <strong>Your automations</strong> appear whenever they fire, in
            either mode, because Home Assistant announces every automation
            itself. Where a blueprint sends its own figures — how long, how
            many kWh, what it cost — those are shown too. These are the same
            automations that alert you on the spot; VESTA never switches them
            on or off, Home Assistant is where you do that.
          </p>
          <p>
            <strong>VESTA Agent</strong> rows are alerts from its
            investigations, tagged with what they are about — water,
            electrical, security. <strong>Noticed</strong> rows are things its
            triage thought worth a closer look, and each says what became of
            it: <em>investigated, nothing to report</em> when it was looked at
            and nothing was wrong, or <em>noticed, not investigated</em> when a
            budget or per-pass limit stopped it before anyone looked. Only the
            second is worth reading when you are deciding how often it should
            look.
          </p>
          <p>
            Deleting a row deletes history — the next briefing will not mention
            it. That is different from ticking a job off your to-do list, which
            is why it is here and not there.
          </p>
        </InfoHint>
      </p>

      <div className="reports-freshness">
        <span className="muted body-text">
          {rows === null
            ? "Could not read the record."
            : `${visible.length} row${visible.length === 1 ? "" : "s"} in the last ${days} days.`}
        </span>
        <div className="chip-row">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              className={`btn ghost${source === s.id ? " active" : ""}`}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? null : rows.length === 0 ? (
        <p className="muted body-text">
          {/* ⚠️ "NOTHING YET" IS NOT A FAULT, AND NOT THE SAME AS A FAILED
              READ — the two render differently above, because an empty period
              and an unreachable ledger mean opposite things. */}
          Nothing has been recorded in this period. On a quiet property with
          Supervision off and no automations enabled, that is correct.
        </p>
      ) : (
        <div className="reports-checks">
          {shown.map((row, i) => (
            <div key={`${row.at}-${i}`} className="fm-row">
              <div className="flag-row-main">
                <div>
                  {row.domain && <span className="reports-domain">{row.domain}</span>}
                  {row.title || row.subject || "—"}
                  {row.times > 1 && (
                    <span className="reports-times">{row.times}×</span>
                  )}
                </div>
                {row.detail && (
                  <div className="muted flag-row-reason">{row.detail}</div>
                )}
                <div className="muted flag-row-status">
                  {row.times > 1 ? `latest ${when(row.at)}` : when(row.at)}
                  {row.source === "triage" && !row.outcome
                    && " · noticed, not investigated"}
                  {row.outcome && ` · ${row.outcome}`}
                  {row.ref && ` · ${row.ref}`}
                </div>
              </div>
              <button
                className="btn danger icon-only"
                aria-label="Delete this entry from the record"
                title="Deletes history — the next briefing will not mention it"
                disabled={busy}
                onClick={() => void remove(row)}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <Pager {...pager} />

      <p className="reports-item muted">
        <Zap size={14} aria-hidden="true" />
        <span>
          Your own automations act instantly and alert you directly — this is
          the record of what they did, not a place to change them.
        </span>
      </p>
    </div>
  );
}
