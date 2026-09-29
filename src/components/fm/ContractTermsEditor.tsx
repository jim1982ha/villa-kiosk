// src/components/fm/ContractTermsEditor.tsx
// The owner sets the maintenance contract's money rules here: the monthly cap
// on the capped category, what the two categories are called, and when the
// "approaching the cap" warning starts. Stored in the shared config
// (`fmContract`), so every device follows. The currency is not set here: it
// is Home Assistant's own (Settings → System → General).

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { formatMoney, parseAmount } from "@/fm/fmEngine";
import { useFmTerms } from "@/fm/useFmTerms";

export default function ContractTermsEditor() {
  const { config, update } = useConfig();
  const terms = useFmTerms();
  const [open, setOpen] = useState(false);
  const stored = config.fmContract;
  const [cap, setCap] = useState("");
  const [cappedName, setCappedName] = useState("");
  const [uncappedName, setUncappedName] = useState("");
  const [warnAt, setWarnAt] = useState("");

  const start = () => {
    setCap(stored.monthlyCap > 0 ? String(stored.monthlyCap) : "");
    setCappedName(stored.cappedName);
    setUncappedName(stored.uncappedName);
    setWarnAt(stored.warnAtPercent > 0 ? String(stored.warnAtPercent) : "");
    setOpen(true);
  };
  const save = () => {
    const pct = Number(warnAt.replace(/[^\d]/g, ""));
    update({
      fmContract: {
        monthlyCap: parseAmount(cap),
        cappedName: cappedName.trim(),
        uncappedName: uncappedName.trim(),
        warnAtPercent: pct >= 1 && pct <= 99 ? pct : 0,
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
            ? `${terms.cappedName} cap ${formatMoney(terms.monthlyCap, terms.currency)} a month`
            : "no monthly cap"}
        </span>
      </button>
    );
  }
  return (
    <div className="fm-form">
      <h3>Spend settings</h3>
      <p className="muted body-text">
        Shared by every device. {terms.currency
          ? <>Amounts are in {terms.currency}, the currency set in Home Assistant (Settings → System → General).</>
          : <>No currency is set in Home Assistant, so amounts show as plain numbers (set one in Settings → System → General).</>}
      </p>
      <label className="fm-field">
        <span>Monthly cap{terms.currency ? ` (${terms.currency})` : ""} — leave empty for no cap</span>
        <input value={cap} inputMode="numeric" onChange={(e) => setCap(e.target.value)} placeholder="No cap" />
      </label>
      <label className="fm-field">
        <span>Name of the category the cap applies to</span>
        <input value={cappedName} onChange={(e) => setCappedName(e.target.value)} placeholder="Minor" maxLength={40} />
      </label>
      <label className="fm-field">
        <span>Name of the category outside the cap</span>
        <input value={uncappedName} onChange={(e) => setUncappedName(e.target.value)} placeholder="Major" maxLength={40} />
      </label>
      <label className="fm-field">
        <span>Warn when the month reaches (% of the cap)</span>
        <input value={warnAt} inputMode="numeric" onChange={(e) => setWarnAt(e.target.value)} placeholder="80" />
      </label>
      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}
