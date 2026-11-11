// src/components/fm/SpendTab.tsx
// Maintenance spend against the owner's monthly cap (the shared `fmContract`
// terms, see fmTypes.ts fmTerms) — none until the owner sets one here. The cap matters because whatever agreement is in play, it's
// typically the line that decides who pays for a repair: under it, ordinary
// shared maintenance; over it, a bigger expense the owner is on the hook
// for. The warning therefore has to arrive BEFORE the money is committed,
// which is why the entry form projects the new total as you type.

import { momentText } from "@/utils/dateText";
import InfoTip from "@/components/common/InfoTip";
import { useState } from "react";
import Dropdown from "@/components/common/Dropdown";
import { Pager, usePaged, PAGE_CARDS } from "@/components/common/Paged";
import { DocumentButtons } from "@/components/common/SaveButton";
import { Plus, Sparkles } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { budgetStatus, capNotes, monthLabel, parseAmount, recordsKeptNote } from "@/fm/fmEngine";
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
import RecordCard, { DeviceChip } from "./RecordCard";
import { formatMoney } from "@/utils/money";
import CostFields from "./CostFields";
import { useDeviceChoice } from "./useDeviceChoice";
import { useRecordPlace } from "./useRecordPlace";
import { useCardRoom } from "@/config/VillaModel";
import FormActions from "./FormActions";
import { TONE_OF, toneClass } from "@/fm/tone";
import FmForm from "./FmForm";
import { useListEditor } from "./ListEditor";

export default function SpendTab(
  { onOpenEntity, deviceOptions, inputs }: {
    onOpenEntity?: (id: string) => void;
    /** What the recap is made from, built once by FacilitySections (monthlyDocument.DocumentInputs). */
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
  const roomOf = useCardRoom();
  const { role } = useProfile();
  const terms = useFmTerms();
  const money = (n: number) => formatMoney(n, terms.currency);
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
  // ⚠️ THE MONTH'S RECAP, ONE DOCUMENT (owner, 2026-11-05: "merge the Monthly recap and the Spend report into a single
  // report, in the Spend tab"): the recap's §2 is the spend statement, so the statement went and the recap came here.
  // An explicit Generate, then optionally Save (useMonthlyDocument): a point-in-time record, never silently changed by
  // an entry edited afterwards. Its month is the whole tab's.
  const recap = useMonthlyDocument("recap", inputs);
  const month = recap.month;

  const b = budgetStatus(data.costs, month, terms);
  // the month's entries, newest first, ten a page as every long list
  const entries = usePaged([...b.entries].sort((a, c) => Date.parse(c.at) - Date.parse(a.at)), PAGE_CARDS);
  const amountIdr = parseAmount(amount);

  /** The form's fields emptied: whenever the form closes (saved, cancelled, or its entry gone from the month). */
  const resetForm = () => {
    setFormError(null);
    setLabel(""); clearDevice();
    setAmount(""); setNote(""); setPhotoIds([]); setCategory("minor");
  };
  // ⚠️ THE ENTRY OPEN AS ITS FORM IS ONE OF THE MONTH'S (architecture review round 13: editing an entry, then changing
  // the Month, left no form and no Record spend): another month, its form closes and Record spend is back (ListEditor).
  // One form for a new entry and a correction, same reasoning as the fault form.
  const editor = useListEditor(b.entries.map((c) => c.id), resetForm);
  const editingId = editor.editing;

  const openEditor = (c: FmCost) => {
    editor.edit(c.id);
    setLabel(c.label);
    setAmount(String(c.amountIdr));
    setNote(c.note ?? "");
    setCategory(c.category);
    setPhotoIds(c.photoIds);
    selectDevice(c.entityId ?? "", c.deviceLabel ?? "");
  };

  const form = (
    <FmForm>
      <h3>{editingId ? "Edit spend entry" : "Record maintenance spend"}</h3>
      <div className="fm-field">
        <span className="with-tip">Device
          <InfoTip label="About the device">Search, or type one not listed; leave it blank for a whole-villa expense.</InfoTip></span>
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
        error={formError} onCancel={editor.close} disabled={!label.trim() || amountIdr <= 0}
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
            if (done) editor.close(); else setFormError(why);
          }}
      />
    </FmForm>
  );

  return (
    <div className="fm-stack">
      {/* The terms are the villa's agreement, set by whoever administers the
          kiosk — the shared config only the owner may write. */}
      {roleCan(role, "editConfig") && <ContractTermsEditor />}
      <div className={`fm-cap ${toneClass(TONE_OF.cap[b.state])}`}>
        {/* the month's money on ONE line — minor (against the cap), major (outside it), total — and Record spend at
            its right (owner, 2026-10-14: "what about total or major spend?"); the three share the width equally, each
            word ABOVE its amount (owner, 2026-10-14) */}
        <div className="fm-cap-totals">
          <div className="fm-cap-total"><span className="muted">{COST_CATEGORY_NAMES.minor}{b.cap > 0 ? ` · cap ${money(b.cap)}` : ""}</span><strong>{money(b.minorSpend)}</strong></div>
          <div className="fm-cap-total"><span className="muted">{COST_CATEGORY_NAMES.major}</span><strong>{money(b.majorSpend)}</strong></div>
          <div className="fm-cap-total"><span className="muted">Total</span><strong>{money(b.totalSpend)}</strong></div>
          {editor.addButton && (
            <button className="btn fm-cap-record" onClick={editor.add}><Plus size={16} /> Record spend</button>
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


      {/* a new entry's form here; an edit's in its entry's place, below (FmForm) */}
      {editor.adding && form}

      <div className="fm-list">
        {b.entries.length === 0 && (
          <p className="muted body-text">No spend recorded for {monthLabel(month)}.</p>
        )}
        {entries.page.map((c) => editor.inPlace(c.id, (
          // THE Cockpit card (RecordCard, architecture review 2026-10-15): the amount on the right, its receipt —
          // the whole point of attaching one is that somebody can later check it
          <RecordCard key={c.id} title={c.label} when={momentText(c.at)} notes={[c.note]} photoIds={c.photoIds}
            amount={money(c.amountIdr)} onOpen={() => openEditor(c)}
            erase={{ title: "Erase this spend entry", detail: `${c.label}, ${money(c.amountIdr)}`,
              run: (token) => removeCost(c.id, token) }}
            // its device first on its quiet line, a link, as a ticket's (DeviceChip; the "Status on top" card): it was a
            // chip beside its title, the one card left that way
            device={c.entityId || c.deviceLabel ? <DeviceChip entityId={c.entityId} label={c.deviceLabel ?? c.entityId}
              onOpenEntity={(id) => onOpenEntity?.(id)} /> : undefined}
            // its room, the pill of every Cockpit card (Pill): its device's room now, else the one it was saved with
            room={roomOf(c)}
            pills={<>
              <span className="fm-clause">{COST_CATEGORY_NAMES[c.category]}</span>
              <AgentMark record={c} />
            </>} />
        ), () => form))}
      </div>
      <Pager paged={entries} />


      {/* ⚠️ THE MONTHLY RECAP, A SECTION OF ITS OWN UNDER THE SPEND (owner, 2026-11-05): its title, then the Month on the
          same line as its recap's buttons (owner, 2026-10-14), its preview, its saved copies. The Month still chooses
          what this whole tab shows, the money card and the list above included, and the recap is of that month. */}
      <div className="settings-section-title">Monthly recap</div>
      {/* ⚠️ THE RECAP'S THREE BUTTONS ARE ONE GROUP (owner, 2026-10-14: Download .md fell alone onto a second line): they
          never part; on a narrow screen the group goes under the Month as a whole. "Save", not "Save recap": beside
          "Generate recap" it says the same, and the three fit one line on the iPad. */}
      <div className="fm-statement-row">
        <span className="fm-inline-label with-tip">Month
          <InfoTip label="About the recap">
            The month's recap, to attach to the owner's monthly statement: maintenance performed against the schedule,
            spend against the monthly cap, faults and response times. Revenue, commissions and payout are out of scope.
            {kept ? ` ${kept}` : ""}
          </InfoTip></span>
        <div style={{ minWidth: 130 }}>
          <Dropdown value={month} ariaLabel="Month" onChange={recap.setMonth}
            options={recap.months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        </div>
        <div className="fm-statement-buttons">
          <button className="btn" onClick={recap.generate}>
            <Sparkles size={16} /> {recap.markdown ? "Regenerate recap" : "Generate recap"}
          </button>
          {/* only with a recap to save or download (owner, 2026-10-22: never greyed out beside nothing) */}
          <DocumentButtons markdown={recap.markdown} saved={recap.saved} saveLabel="Save" onSave={() => void recap.save()} onDownload={recap.download} />
        </div>
      </div>
      {recap.markdown && <MarkdownPreview markdown={recap.markdown} />}

      {/* The month's recap (its buttons sit with the Month, just above): its saved copies, the statements saved before the
          two were one among them (fmTypes.recapKind) */}
      <SavedDocumentsList kind="recap" onOpen={recap.reopen} />
    </div>
  );
}
