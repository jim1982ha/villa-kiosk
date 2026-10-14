// src/components/fm/ContractTermsEditor.tsx
// The owner sets the maintenance contract's money rules here: the monthly cap
// on MINOR spend (major spend is always outside it), and when the "approaching
// the cap" warning starts. The two category names it once held are gone
// (fmTypes: they read like a choice and were not one). Stored in the shared config
// (`fmContract`), so every device follows. The currency is not set here: it
// is Home Assistant's own (Settings → System → General).

import { useState } from "react";
import { Settings2, Trash2 } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { parseAmount } from "@/fm/fmEngine";
import { useFmTerms } from "@/fm/useFmTerms";
import { validWarnPercent } from "@/fm/fmTypes";
import { formatMoney } from "@/utils/money";
import FormActions from "./FormActions";

export default function ContractTermsEditor() {
  const { config, update } = useConfig();
  const terms = useFmTerms();
  const [open, setOpen] = useState(false);
  const stored = config.fmContract;
  const [cap, setCap] = useState("");
  const [warnAt, setWarnAt] = useState("");

  const start = () => {
    setCap(stored.monthlyCap > 0 ? String(stored.monthlyCap) : "");
    setWarnAt(stored.warnAtPercent > 0 ? String(stored.warnAtPercent) : "");
    setOpen(true);
  };
  const save = () => {
    update({
      fmContract: {
        monthlyCap: parseAmount(cap),
        // 0 = "not set": fmTerms reads it as the default (validWarnPercent).
        warnAtPercent: validWarnPercent(warnAt) ?? 0,
      },
    });
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="btn ghost" onClick={start} style={{ alignSelf: "flex-start" }}>
        <Settings2 size={16} /> Spend settings
        <span className="muted" style={{ marginLeft: 6 }}>
          {terms.monthlyCap > 0
            ? `minor spend capped at ${formatMoney(terms.monthlyCap, terms.currency)} a month`
            : "no monthly cap"}
        </span>
      </button>
    );
  }
  return (
    <div className="fm-form">
      <h3>Spend settings</h3>
      {/* ONE paragraph, its sentences run on (owner, 2026-10-14: no blank line between them) */}
      <p className="muted body-text fm-form-intro">
        Shared by every device. {terms.currency
          ? <>Amounts are in {terms.currency}, the currency set in Home Assistant (Settings → System → General).</>
          : <>No currency is set in Home Assistant, so amounts show as plain numbers (set one in Settings → System → General).</>}
        {" "}Spend is recorded as <b>Minor</b> (routine work, counted against the cap) or <b>Major</b> (larger work,
        always outside the cap).
      </p>
      <div className="slider-pair">
        <label className="fm-field">
          <span>Monthly cap on minor spend{terms.currency ? ` (${terms.currency})` : ""}</span>
          <input value={cap} inputMode="numeric" onChange={(e) => setCap(e.target.value)} placeholder="No cap" />
        </label>
        <label className="fm-field">
          <span>Warn when the month reaches (% of the cap)</span>
          <input value={warnAt} inputMode="numeric" onChange={(e) => setWarnAt(e.target.value)} placeholder="80" />
        </label>
      </div>
      {/* removing a cap is one tap, then Save (owner, 2026-10-14: "how to delete a previously set cap?"); the button
          sits with Cancel and Save, drawn as they are (owner, 2026-10-14) */}
      <FormActions onCancel={() => setOpen(false)} onSave={save} saveLabel="Save"
        extra={cap.trim() !== "" && (
          <button type="button" className="btn ghost" onClick={() => setCap("")}><Trash2 size={16} aria-hidden /> Remove cap</button>
        )} />
    </div>
  );
}
