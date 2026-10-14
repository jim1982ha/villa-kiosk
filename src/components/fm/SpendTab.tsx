// src/components/fm/SpendTab.tsx
// Maintenance spend against the owner's monthly cap (the shared `fmContract`
// terms, see fmTypes.ts fmTerms) — none until the owner sets one here. The cap matters because whatever agreement is in play, it's
// typically the line that decides who pays for a repair: under it, ordinary
// shared maintenance; over it, a bigger expense the owner is on the hook
// for. The warning therefore has to arrive BEFORE the money is committed,
// which is why the entry form projects the new total as you type.

import { useState } from "react";
import Dropdown from "@/components/common/Dropdown";
import SaveButton from "@/components/common/SaveButton";
import { Plus, Sparkles, Save, Download } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useFmData, fmSaveOutcome } from "@/fm/FmDataContext";
import { budgetStatus, monthKey, localStamp, parseAmount } from "@/fm/fmEngine";
import { COST_CATEGORY_NAMES } from "@/fm/fmTypes";
import { useFmTerms } from "@/fm/useFmTerms";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import ContractTermsEditor from "./ContractTermsEditor";
import { buildSpendStatement } from "@/fm/fmDocuments";
import type { FmCost, FmSavedDocument } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import DeviceSearchPicker, { type DeviceOption } from "./DeviceSearchPicker";
import ErasableRow from "./ErasableRow";
import NotesField from "./NotesField";
import MarkdownPreview from "./MarkdownPreview";
import SavedDocumentsList from "./SavedDocumentsList";
import AgentMark from "./AgentMark";
import RecordMeta from "./RecordMeta";
import { formatMoney } from "@/utils/money";
import CostFields from "./CostFields";
import { useDeviceChoice } from "./useDeviceChoice";
import FormActions from "./FormActions";
import { downloadFile } from "@/utils/download";

export default function SpendTab(
  { onOpenEntity, deviceOptions }: {
    onOpenEntity?: (id: string) => void;
    /** Built once by FacilityModal and shared with the fault form, so both
     *  offer exactly the same devices. */
    deviceOptions: DeviceOption[];
  },
) {
  const { data, addCost, updateCost, removeCost, saveDocument } = useFmData();
  const { config, resolvedRooms } = useConfig();
  const { haConfig } = useHA();
  const { role } = useProfile();
  const terms = useFmTerms();
  const money = (n: number) => formatMoney(n, terms.currency);
  const [month, setMonth] = useState(monthKey(Date.now()));
  const [adding, setAdding] = useState(false);
  /** Id of the entry being corrected, or null when recording a new one — one
   *  form for both, same reasoning as the fault form. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Why the last save was refused — the form keeps what was typed (2.496.252). */
  const [formError, setFormError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  // The device the entry is about — its search text and match, as one (useDeviceChoice).
  const device = useDeviceChoice();
  const { deviceText, entityId, selectDevice, clearDevice } = device;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<"minor" | "major">("minor");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  // The saved-statement workflow — same "explicit Generate, then optionally
  // Save" shape as RecapTab, so a statement is a point-in-time record of
  // this month's spend rather than something that silently changes if an
  // entry is edited or deleted afterwards.
  const [statement, setStatement] = useState<string | null>(null);
  const [statementSaved, setStatementSaved] = useState(false);
  const villaName = resolveSiteTitle(config, haConfig?.location_name);

  const resetForm = () => {
    setFormError(null);
    setAdding(false); setEditingId(null);
    setLabel(""); clearDevice();
    setAmount(""); setNote(""); setPhotoIds([]); setCategory("minor");
  };

  const openEditor = (c: FmCost) => {
    setEditingId(c.id);
    setAdding(true);
    setLabel(c.label);
    setAmount(String(c.amountIdr));
    setNote(c.note ?? "");
    setCategory(c.category);
    setPhotoIds(c.photoIds);
    selectDevice(c.entityId ?? "", c.deviceLabel ?? "");
  };

  const b = budgetStatus(data.costs, month, terms);
  const amountIdr = parseAmount(amount);

  const generateStatement = () => {
    setStatement(buildSpendStatement(data, month, villaName, terms));
    setStatementSaved(false);
  };
  const downloadStatement = () => {
    if (!statement) return;
    downloadFile(`${villaName.replace(/\s+/g, "-").toLowerCase()}-spend-${month}.md`, statement, "text/markdown");
  };
  const saveStatement = async () => {
    if (!statement) return;
    if (await saveDocument({ kind: "spend", month, markdown: statement }) === "saved") setStatementSaved(true);
  };
  const reopenStatement = (doc: FmSavedDocument) => {
    setMonth(doc.month);
    setStatement(doc.markdown);
    setStatementSaved(true);
  };
  // Months that actually have entries, newest first — plus the current month so
  // it's always selectable even before anything is recorded in it.
  const months = [...new Set([monthKey(Date.now()), ...data.costs.map((c) => monthKey(c.at))])]
    .sort().reverse();

  return (
    <div className="fm-stack">
      {/* The terms are the villa's agreement, set by whoever administers the
          kiosk — the shared config only the owner may write. */}
      {roleCan(role, "editConfig") && <ContractTermsEditor />}
      {/* The month, on the same line as its statement's buttons (owner, 2026-10-14): it chooses what this whole tab
          shows, and the statement is of that month. */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="fm-inline-label">Month</span>
        <div style={{ minWidth: 130 }}>
          <Dropdown value={month} ariaLabel="Month" onChange={(m) => { setMonth(m); setStatement(null); setStatementSaved(false); }}
            options={months.map((m) => ({ value: m, label: m }))} />
        </div>
        <button className="btn ghost" onClick={generateStatement}>
          <Sparkles size={16} /> {statement ? "Regenerate statement" : "Generate statement"}
        </button>
        <SaveButton saved={statementSaved} label="Save statement" icon={<Save size={16} />} onClick={() => void saveStatement()} disabled={!statement} />
        <button className="btn ghost" onClick={downloadStatement} disabled={!statement}>
          <Download size={16} /> Download .md
        </button>
      </div>
      {statement && <MarkdownPreview markdown={statement} />}

      <div className={`fm-cap ${b.state}`}>
        {/* the month's money on ONE line — minor (against the cap), major (outside it), total — and Record spend at
            its right (owner, 2026-10-14: "what about total or major spend?") */}
        <div className="fm-cap-head fm-cap-totals">
          <span><strong>{money(b.minorSpend)}</strong> <span className="muted">{COST_CATEGORY_NAMES.minor}{b.cap > 0 ? ` of ${money(b.cap)} cap` : ""}</span></span>
          <span><strong>{money(b.majorSpend)}</strong> <span className="muted">{COST_CATEGORY_NAMES.major}</span></span>
          <span><strong>{money(b.totalSpend)}</strong> <span className="muted">Total</span></span>
          {!adding && (
            <button className="btn ghost fm-cap-record" onClick={() => setAdding(true)}><Plus size={16} /> Record spend</button>
          )}
        </div>
        {b.cap > 0 && (
          <div className="fm-cap-bar">
            <span style={{ width: `${Math.min(100, b.fraction * 100)}%` }} />
          </div>
        )}
        {b.state === "exceeded" && (
          <p className="fm-cap-note">
            Cap reached. Further spend this month belongs to {COST_CATEGORY_NAMES.major}, on
            whatever terms your own agreement sets for spend beyond it.
          </p>
        )}
        {b.state === "approaching" && (
          <p className="fm-cap-note">
            Approaching the cap — decide now whether upcoming work is {COST_CATEGORY_NAMES.minor} or
            should be recorded as {COST_CATEGORY_NAMES.major}.
          </p>
        )}
      </div>


      {adding && (
        <div className="fm-form">
          <h3>{editingId ? "Edit spend entry" : "Record maintenance spend"}</h3>
          <div className="fm-field">
            <span>Device (search, or type one not listed — leave blank for a whole-villa expense)</span>
            <DeviceSearchPicker
              {...device.pickerProps}
              options={deviceOptions}
            />
          </div>
          <label className="fm-field">
            <span>What the spend is about</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Gas top-up and filter clean" />
          </label>
          {/* The same free note a fault carries, for the same reason: the
              person reading this in six months is not the person who typed
              the one-line label. */}
          <NotesField
            label="Notes (optional)"
            value={note}
            onChange={setNote}
            placeholder="e.g. Second refill this quarter — check for a leak"
          />
          <CostFields amount={amount} onAmount={setAmount} category={category} onCategory={setCategory}
            replacing={editingId ?? undefined} />

          <div className="fm-field">
            <span>Receipt / photo</span>
            <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
          </div>

          <FormActions
            error={formError} onCancel={resetForm} disabled={!label.trim() || amountIdr <= 0}
            saveLabel={editingId ? "Save changes" : "Save"}
            onSave={async () => {
                const fields = {
                  amountIdr, label: label.trim(), category, photoIds,
                  note: note.trim() || undefined,
                  entityId: entityId || undefined,
                  deviceLabel: deviceText.trim() || undefined,
                  room: entityId ? resolvedRooms[entityId] : undefined,
                };
                // `at` is set once, when the spend happened, and is never
                // rewritten by a later correction — it is what the monthly
                // total and the cap are computed from.
                const { done, note: why } = fmSaveOutcome(editingId
                  ? await updateCost(editingId, fields)
                  : await addCost({ ...fields, at: new Date().toISOString() }));
                // Empty the form only when saved or queued (2.496.252).
                if (done) resetForm(); else setFormError(why);
              }}
          />
        </div>
      )}

      <div className="fm-list">
        {b.entries.length === 0 && (
          <p className="muted body-text">No spend recorded for {month}.</p>
        )}
        {b.entries.sort((a, c) => Date.parse(c.at) - Date.parse(a.at)).map((c) => (
          <ErasableRow
            key={c.id}
            intent={{ title: "Erase this spend entry", detail: `${c.label} — ${money(c.amountIdr)}` }}
            erase={(token) => removeCost(c.id, token)}
            onOpen={() => openEditor(c)}
          >
            <div className="fm-row-main">
              <div className="fm-row-title">
                <strong>{c.label}</strong>
              </div>
              <RecordMeta when={localStamp(c.at)}>
                <span className="fm-clause">{COST_CATEGORY_NAMES[c.category]}</span>
                <AgentMark record={c} />
                {c.entityId ? (
                  <button className="fm-entity-chip" title={c.entityId}
                    onClick={(e) => { e.stopPropagation(); onOpenEntity?.(c.entityId!); }}>
                    {c.deviceLabel ?? c.entityId}
                  </button>
                ) : c.deviceLabel ? (
                  <span className="fm-entity-chip" style={{ cursor: "default" }}>{c.deviceLabel}</span>
                ) : null}
              </RecordMeta>
              {c.note && <div className="fm-timeline-note">{c.note}</div>}
              {/* The receipt itself, openable — the whole point of attaching
                  one is that somebody can later check it. */}
              {c.photoIds.length > 0 && (
                <EvidenceRow photoIds={c.photoIds} disabled />
              )}
            </div>
            <span className="fm-amount">{money(c.amountIdr)}</span>
          </ErasableRow>
        ))}
      </div>

      {/* The month's statement (its buttons sit with the Month, above): the same explicit Generate -> Save shape as
          the recap (fmDocuments.buildSpendStatement), for handing this month's spend over on its own, and keeping a
          point-in-time copy even after entries are edited or removed. Its saved copies: */}
      <SavedDocumentsList kind="spend" onOpen={reopenStatement} />
    </div>
  );
}
