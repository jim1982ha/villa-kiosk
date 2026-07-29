// src/components/fm/SpendTab.tsx
// Maintenance spend against Clause 3.3(i)'s IDR 3,000,000/month Minor
// Maintenance cap.
//
// The cap matters because it decides WHO PAYS: under it, maintenance is a
// shared Direct Expense Kozystay may action without prior consent (Cl. 6.2(ii));
// over it, it is Major maintenance and the Owner bears it (Cl. 6.2(iii)).
// The warning therefore has to arrive BEFORE the money is committed, which is
// why the entry form projects the new total as you type.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import { budgetStatus, formatIdr, monthKey, localStamp } from "@/fm/fmEngine";
import { MINOR_MAINTENANCE_CAP_IDR } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import DeviceSearchPicker, { buildDeviceOptions } from "./DeviceSearchPicker";

export default function SpendTab({ onOpenEntity }: { onOpenEntity?: (id: string) => void }) {
  const { data, addCost, removeCost } = useFmData();
  const { entities } = useHA();
  const { config } = useConfig();
  const [month, setMonth] = useState(monthKey(Date.now()));
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [deviceText, setDeviceText] = useState("");
  const [entityId, setEntityId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"minor" | "major">("minor");
  const [photoIds, setPhotoIds] = useState<string[]>([]);

  const deviceOptions = buildDeviceOptions(config.entityMap, entities);
  const selectDevice = (id: string, name: string) => { setEntityId(id); setDeviceText(name); };
  const clearDevice = () => { setEntityId(""); setDeviceText(""); };
  const resetForm = () => {
    setAdding(false); setLabel(""); setDeviceText(""); setEntityId("");
    setAmount(""); setPhotoIds([]);
  };

  const b = budgetStatus(data.costs, month);
  const amountIdr = Number(amount.replace(/[^\d]/g, "")) || 0;
  const projected = b.minorIdr + (category === "minor" ? amountIdr : 0);
  const projectedOver = projected >= b.capIdr;

  // Months that actually have entries, newest first — plus the current month so
  // it's always selectable even before anything is recorded in it.
  const months = [...new Set([monthKey(Date.now()), ...data.costs.map((c) => monthKey(c.at))])]
    .sort().reverse();

  return (
    <div className="fm-stack">
      <label className="fm-field" style={{ maxWidth: 220 }}>
        <span>Month</span>
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <div className={`fm-cap ${b.state}`}>
        <div className="fm-cap-head">
          <strong>{formatIdr(b.minorIdr)}</strong>
          <span className="muted">of {formatIdr(b.capIdr)} Minor Maintenance cap</span>
        </div>
        <div className="fm-cap-bar">
          <span style={{ width: `${Math.min(100, b.fraction * 100)}%` }} />
        </div>
        {b.state === "exceeded" && (
          <p className="fm-cap-note">
            Cap reached. Further spend this month is Major maintenance and falls to
            the Owner under Clause 6.2(iii).
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
          <div key={c.id} className="fm-row">
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
            <button className="icon-btn" onClick={() => void removeCost(c.id)} aria-label="Delete entry">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
