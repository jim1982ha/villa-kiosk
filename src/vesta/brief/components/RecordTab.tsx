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

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, Zap } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import { deleteRecordEntry, fetchRecord, type RecordEntry } from "@/vesta/brief/reportsApi";

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
        Everything the next briefing will summarise, newest first.
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
            triage thought worth a closer look but never investigated, usually
            because a budget or per-pass limit stopped it: worth reading if you
            are deciding how often it should look.
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
            : `${rows.length} entr${rows.length === 1 ? "y" : "ies"} in the last ${days} days.`}
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
          {rows.filter((r) => !source || r.source === source).map((row, i) => (
            <div key={`${row.at}-${i}`} className="fm-row">
              <div className="flag-row-main">
                <div>
                  {row.domain && <span className="reports-domain">{row.domain}</span>}
                  {row.title || row.subject || "—"}
                </div>
                {row.detail && (
                  <div className="muted flag-row-reason">{row.detail}</div>
                )}
                <div className="muted flag-row-status">
                  {when(row.at)}
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
