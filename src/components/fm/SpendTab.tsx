// src/components/fm/SpendTab.tsx
// Maintenance spend against a monthly Minor Maintenance cap — MINOR_MAINTENANCE_CAP_IDR
// (see fmTypes.ts), 0 until an operator's own contract/agreement gives it a
// real one. The cap matters because whatever agreement is in play, it's
// typically the line that decides who pays for a repair: under it, ordinary
// shared maintenance; over it, a bigger expense the owner is on the hook
// for. The warning therefore has to arrive BEFORE the money is committed,
// which is why the entry form projects the new total as you type.

import { useState } from "react";
import { Plus, Sparkles, Save, Download } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useFmData } from "@/fm/FmDataContext";
import { budgetStatus, formatIdr, monthKey, localStamp } from "@/fm/fmEngine";
import { buildSpendStatement } from "@/fm/fmReport";
import { MINOR_MAINTENANCE_CAP_IDR } from "@/fm/fmTypes";
import type { FmSavedDocument } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import DeviceSearchPicker, { buildDeviceOptions } from "./DeviceSearchPicker";
import ErasableRow from "./ErasableRow";
import ReportPreview from "./ReportPreview";
import SavedDocumentsList from "./SavedDocumentsList";

export default function SpendTab({ onOpenEntity }: { onOpenEntity?: (id: string) => void }) {
  const { data, addCost, removeCost, saveDocument } = useFmData();
  const { entities } = useHA();
  const { config } = useConfig();
  const { haConfig } = useHA();
  const [month, setMonth] = useState(monthKey(Date.now()));
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [deviceText, setDeviceText] = useState("");
  const [entityId, setEntityId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"minor" | "major">("minor");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  // The saved-statement workflow — same "explicit Generate, then optionally
  // Save" shape as ReportTab, so a statement is a point-in-time record of
  // this month's spend rather than something that silently changes if an
  // entry is edited or deleted afterwards.
  const [statement, setStatement] = useState<string | null>(null);
  const [statementSaved, setStatementSaved] = useState(false);
  const villaName = resolveSiteTitle(config, haConfig?.location_name);

  const deviceOptions = buildDeviceOptions(config.entityMap, entities);
  const selectDevice = (id: string, name: string) => { setEntityId(id); setDeviceText(name); };
  const clearDevice = () => { setEntityId(""); setDeviceText(""); };
  const resetForm = () => {
    setAdding(false); setLabel(""); setDeviceText(""); setEntityId("");
    setAmount(""); setPhotoIds([]);
  };

  const b = budgetStatus(data.costs, month);
  const amountIdr = Number(amount.replace(/[^\d]/g, "")) || 0;

  const generateStatement = () => {
    setStatement(buildSpendStatement(data, month, villaName));
    setStatementSaved(false);
  };
  const downloadStatement = () => {
    if (!statement) return;
    const url = URL.createObjectURL(new Blob([statement], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${villaName.replace(/\s+/g, "-").toLowerCase()}-spend-${month}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const saveStatement = async () => {
    if (!statement) return;
    await saveDocument({ kind: "spend", month, markdown: statement });
    setStatementSaved(true);
  };
  const reopenStatement = (doc: FmSavedDocument) => {
    setMonth(doc.month);
    setStatement(doc.markdown);
    setStatementSaved(true);
  };
  const projected = b.minorIdr + (category === "minor" ? amountIdr : 0);
  const projectedOver = b.capIdr > 0 && projected >= b.capIdr;

  // Months that actually have entries, newest first — plus the current month so
  // it's always selectable even before anything is recorded in it.
  const months = [...new Set([monthKey(Date.now()), ...data.costs.map((c) => monthKey(c.at))])]
    .sort().reverse();

  return (
    <div className="fm-stack">
      <label className="fm-field" style={{ maxWidth: 220 }}>
        <span>Month</span>
        <select value={month} onChange={(e) => { setMonth(e.target.value); setStatement(null); setStatementSaved(false); }}>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <div className={`fm-cap ${b.state}`}>
        <div className="fm-cap-head">
          <strong>{formatIdr(b.minorIdr)}</strong>
          <span className="muted">
            {b.capIdr > 0 ? `of ${formatIdr(b.capIdr)} Minor Maintenance cap` : "Minor Maintenance spend (no cap configured)"}
          </span>
        </div>
        {b.capIdr > 0 && (
          <div className="fm-cap-bar">
            <span style={{ width: `${Math.min(100, b.fraction * 100)}%` }} />
          </div>
        )}
        {b.state === "exceeded" && (
          <p className="fm-cap-note">
            Cap reached. Further spend this month is Major maintenance, on whatever
            terms your own agreement sets for spend beyond it.
          </p>
        )}
        {b.state === "approaching" && (
          <p className="fm-cap-note">
            Approaching the cap — decide now whether upcoming work is Minor or should
            be raised as Major maintenance.
          </p>
        )}
        {b.majorIdr > 0 && (
          <p className="fm-cap-note">
            Plus {formatIdr(b.majorIdr)} recorded as Major maintenance (Owner&rsquo;s
            account, outside the cap).
          </p>
        )}
      </div>

      {!adding && (
        <button className="btn ghost" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
          <Plus size={16} /> Record spend
        </button>
      )}

      {adding && (
        <div className="fm-form">
          <h3>Record maintenance spend</h3>
          <div className="fm-field">
            <span>Device (search, or type one not listed — leave blank for a whole-villa expense)</span>
            <DeviceSearchPicker
              value={deviceText}
              options={deviceOptions}
              matchedEntityId={entityId || undefined}
              onChangeText={(text) => { setDeviceText(text); setEntityId(""); }}
              onSelect={(opt) => selectDevice(opt.entityId, opt.label)}
              onClear={clearDevice}
            />
          </div>
          <label className="fm-field">
            <span>What the spend is about</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Gas top-up and filter clean" />
          </label>
          <label className="fm-field">
            <span>Amount (IDR)</span>
            <input value={amount} inputMode="numeric"
              onChange={(e) => setAmount(e.target.value)} placeholder="450000" />
          </label>
          <label className="fm-field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as "minor" | "major")}>
              <option value="minor">Minor — shared Direct Expense (Cl. 3.3(i))</option>
              <option value="major">Major — Owner&rsquo;s account (Cl. 6.2(iii))</option>
            </select>
          </label>

          {category === "minor" && amountIdr > 0 && (
            <div className={`fm-banner ${projectedOver ? "warn" : ""}`}>
              This month would become {formatIdr(projected)} of {formatIdr(MINOR_MAINTENANCE_CAP_IDR)}
              {projectedOver && " — over the cap. Consider recording it as Major maintenance instead."}
            </div>
          )}

          <div className="fm-field">
            <span>Receipt / photo</span>
            <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
          </div>

          <div className="modal-actions" style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={resetForm}>Cancel</button>
            <button
              className="btn primary"
              disabled={!label.trim() || amountIdr <= 0}
              onClick={async () => {
                await addCost({
                  at: new Date().toISOString(), amountIdr,
                  label: label.trim(), category, photoIds,
                  entityId: entityId || undefined,
                  deviceLabel: deviceText.trim() || undefined,
                  room: entityId ? config.entityMap[entityId]?.room : undefined,
                });
                resetForm();
              }}
            >Save</button>
          </div>
        </div>
      )}

      <div className="fm-list">
        {b.entries.length === 0 && (
          <p className="muted body-text">No spend recorded for {month}.</p>
        )}
        {b.entries.sort((a, c) => Date.parse(c.at) - Date.parse(a.at)).map((c) => (
          <ErasableRow
            key={c.id}
            intent={{ title: "Erase this spend entry", detail: `${c.label} — ${formatIdr(c.amountIdr)}` }}
            erase={(token) => removeCost(c.id, token)}
          >
            <div className="fm-row-main">
              <div className="fm-row-title">
                <strong>{c.label}</strong>
                <span className="fm-clause">{c.category === "minor" ? "Minor" : "Major"}</span>
              </div>
              <div className="fm-row-sub muted">
                {localStamp(c.at)}{c.photoIds.length > 0 && ` · ${c.photoIds.length} photo(s)`}
              </div>
              {(c.entityId || c.deviceLabel) && (
                <div className="fm-chiprow">
                  {c.entityId ? (
                    <button className="fm-entity-chip" onClick={() => onOpenEntity?.(c.entityId!)}>
                      {c.deviceLabel ?? c.entityId}
                    </button>
                  ) : (
                    <span className="fm-entity-chip" style={{ cursor: "default" }}>
                      {c.deviceLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
            <span className="fm-amount">{formatIdr(c.amountIdr)}</span>
          </ErasableRow>
        ))}
      </div>

      {/* A standalone statement for this month — same explicit Generate ->
          Save shape as the Report tab (see fmReport.buildSpendStatement),
          for handing THIS month's spend over on its own without the rest of
          the operational annex, and for keeping a point-in-time copy even
          after entries above are later edited or removed. */}
      <div className="fm-row-sub muted" style={{ marginTop: 4 }}>Spend statement for {month}</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost" onClick={generateStatement}>
          <Sparkles size={16} /> {statement ? "Regenerate statement" : "Generate statement"}
        </button>
        <button className="btn ghost" onClick={() => void saveStatement()} disabled={!statement || statementSaved}>
          <Save size={16} /> {statementSaved ? "Saved" : "Save statement"}
        </button>
        <button className="btn ghost" onClick={downloadStatement} disabled={!statement}>
          <Download size={16} /> Download .md
        </button>
      </div>
      {statement && <ReportPreview markdown={statement} />}

      <SavedDocumentsList kind="spend" onOpen={reopenStatement} />
    </div>
  );
}
