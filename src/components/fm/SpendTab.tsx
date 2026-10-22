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
import { useFmData } from "@/fm/FmDataContext";
import { budgetStatus, capNotes, localStamp, parseAmount, recordsKeptNote } from "@/fm/fmEngine";
import { COST_CATEGORY_NAMES } from "@/fm/fmTypes";
import { useFmTerms } from "@/fm/useFmTerms";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import ContractTermsEditor from "./ContractTermsEditor";
import type { FmCost } from "@/fm/fmTypes";
import { useMonthlyDocument } from "@/fm/useMonthlyDocument";
import type { DocumentInputs } from "@/fm/monthlyDocument";
import EvidenceRow from "./EvidenceRow";
import DeviceSearchPicker, { type DeviceOption } from "./DeviceSearchPicker";
import NotesField from "./NotesField";
import MarkdownPreview from "./MarkdownPreview";
import SavedDocumentsList from "./SavedDocumentsList";
import AgentMark from "./AgentMark";
import RecordCard from "./RecordCard";
import Tip from "@/components/common/Tip";
import { formatMoney } from "@/utils/money";
import CostFields from "./CostFields";
import { useDeviceChoice } from "./useDeviceChoice";
import { useRecordPlace } from "./useRecordPlace";
import FormActions from "./FormActions";
import { TONE_OF, toneClass } from "@/fm/tone";

export default function SpendTab(
  { onOpenEntity, deviceOptions, inputs }: {
    onOpenEntity?: (id: string) => void;
    /** What the statement is made from, built once by FacilitySections (monthlyDocument.DocumentInputs). */
    inputs: DocumentInputs;
    /** Built once by FacilitySections and shared with the ticket form, so
     *  both offer exactly the same devices. */
    deviceOptions: DeviceOption[];
  },
) {
  const { data, addCost, updateCost, removeCost, retention } = useFmData();
  // how long spend is kept (owner, 2026-10-20: the record's retention, said beside the list it shortens)
  const kept = recordsKeptNote(retention, "Spend");
  const place = useRecordPlace();
  const { role } = useProfile();
  const terms = useFmTerms();
  const money = (n: number) => formatMoney(n, terms.currency);
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
  // The month's statement — the recap's "explicit Generate, then optionally
  // Save" (useMonthlyDocument), so a statement is a point-in-time record of
  // this month's spend rather than something that silently changes if an
  // entry is edited or deleted afterwards. Its month is the whole tab's.
  const statement = useMonthlyDocument("spend", inputs);
  const month = statement.month;

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

  return (
    <div className="fm-stack">
      {/* The terms are the villa's agreement, set by whoever administers the
          kiosk — the shared config only the owner may write. */}
      {roleCan(role, "editConfig") && <ContractTermsEditor />}
      {/* The month, on the same line as its statement's buttons (owner, 2026-10-14): it chooses what this whole tab
          shows, and the statement is of that month. */}
      {/* ⚠️ THE STATEMENT'S THREE BUTTONS ARE ONE GROUP (owner, 2026-10-14: Download .md fell alone onto a second
          line): they never part; on a narrow screen the group goes under the Month as a whole. "Save", not "Save
          statement": beside "Generate statement" it says the same, and the three fit one line on the iPad. */}
      <div className="fm-statement-row">
        <span className="fm-inline-label">Month</span>
        <div style={{ minWidth: 130 }}>
          <Dropdown value={month} ariaLabel="Month" onChange={statement.setMonth}
            options={statement.months.map((m) => ({ value: m, label: m }))} />
        </div>
        <div className="fm-statement-buttons">
          <button className="btn ghost" onClick={statement.generate}>
            <Sparkles size={16} /> {statement.markdown ? "Regenerate statement" : "Generate statement"}
          </button>
          <SaveButton saved={statement.saved} label="Save" icon={<Save size={16} />} onClick={() => void statement.save()} disabled={!statement.markdown} />
          <button className="btn ghost" onClick={statement.download} disabled={!statement.markdown}>
            <Download size={16} /> Download .md
          </button>
        </div>
      </div>
      {statement.markdown && <MarkdownPreview markdown={statement.markdown} />}

      <div className={`fm-cap ${toneClass(TONE_OF.cap[b.state])}`}>
        {/* the month's money on ONE line — minor (against the cap), major (outside it), total — and Record spend at
            its right (owner, 2026-10-14: "what about total or major spend?"); the three share the width equally, each
            word ABOVE its amount (owner, 2026-10-14) */}
        <div className="fm-cap-totals">
          <div className="fm-cap-total"><span className="muted">{COST_CATEGORY_NAMES.minor}{b.cap > 0 ? ` · cap ${money(b.cap)}` : ""}</span><strong>{money(b.minorSpend)}</strong></div>
          <div className="fm-cap-total"><span className="muted">{COST_CATEGORY_NAMES.major}</span><strong>{money(b.majorSpend)}</strong></div>
          <div className="fm-cap-total"><span className="muted">Total</span><strong>{money(b.totalSpend)}</strong></div>
          {!adding && (
            <button className="btn ghost fm-cap-record" onClick={() => setAdding(true)}><Plus size={16} /> Record spend</button>
          )}
        </div>
        {b.cap > 0 && (
          <div className="fm-cap-bar">
            <span style={{ width: `${Math.min(100, b.fraction * 100)}%` }} />
          </div>
        )}
        {/* the cap's sentence, ONE per state (fmEngine.capNotes) — the statement's and the cost banner's too */}
        {capNotes(b).map((note) => <p key={note} className="fm-cap-note">{note}</p>)}
      </div>


      {adding && (
        <div className="fm-form">
          <h3>{editingId ? "Edit spend entry" : "Record maintenance spend"}</h3>
          <div className="fm-field">
            <span>Device (search, or type one not listed, leave blank for a whole-villa expense)</span>
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
            placeholder="e.g. Second refill this quarter, check for a leak"
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
                  ...place(entityId, deviceText),   // the device, its name and room: ONE builder (fm/recordPlace)
                };
                // `at` is set once, when the spend happened, and is never
                // rewritten by a later correction — it is what the monthly
                // total and the cap are computed from.
                const { done, note: why } = editingId
                  ? await updateCost(editingId, fields)
                  : await addCost({ ...fields, at: new Date().toISOString() });
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
          // THE Cockpit card (RecordCard, architecture review 2026-10-15): the amount on the right, its receipt —
          // the whole point of attaching one is that somebody can later check it
          <RecordCard key={c.id} title={c.label} when={localStamp(c.at)} notes={[c.note]} photoIds={c.photoIds}
            amount={money(c.amountIdr)} onOpen={() => openEditor(c)}
            erase={{ title: "Erase this spend entry", detail: `${c.label}, ${money(c.amountIdr)}`,
              run: (token) => removeCost(c.id, token) }}
            // its device right after its name, as an Overview card's room (owner, 2026-10-22: "align the Spend cards
            // with the Overview's")
            titlePills={c.entityId ? (
              <Tip text={c.entityId}>
                <button className="fm-entity-chip" onClick={(e) => { e.stopPropagation(); onOpenEntity?.(c.entityId!); }}>
                  {c.deviceLabel ?? c.entityId}
                </button>
              </Tip>
            ) : c.deviceLabel ? (
              <span className="fm-entity-chip fm-chip-static">{c.deviceLabel}</span>
            ) : undefined}
            pills={<>
              <span className="fm-clause">{COST_CATEGORY_NAMES[c.category]}</span>
              <AgentMark record={c} />
            </>} />
        ))}
      </div>

      {kept && <p className="muted body-text fm-kept-note">{kept}</p>}

      {/* The month's statement (its buttons sit with the Month, above): the same explicit Generate -> Save shape as
          the recap (fmDocuments.buildSpendStatement), for handing this month's spend over on its own, and keeping a
          point-in-time copy even after entries are edited or removed. Its saved copies: */}
      <SavedDocumentsList kind="spend" onOpen={statement.reopen} />
    </div>
  );
}
