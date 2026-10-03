// src/components/fm/CostFields.tsx
// What something cost, in a Facility form: the amount, its category where the
// form asks, and where it leaves this month against the cap (2.496.263).
//
// ⚠️ THREE FORMS, THREE WORDINGS. Spend, a fault's stage and logging a
// completion each wrote the amount field and the cap warning by hand: three
// labels ("Amount", "What it cost", "Cost (optional, …)"), three cap
// sentences, and a placeholder of one villa's typical amount in its own
// currency. One component; the cap arithmetic is fmEngine.projectedSpend's.

import { useFmData } from "@/fm/FmDataContext";
import { useFmTerms } from "@/fm/useFmTerms";
import { monthKey, monthLabel, parseAmount, projectedSpend } from "@/fm/fmEngine";
import { formatMoney } from "@/utils/money";

type Category = "minor" | "major";

export default function CostFields({ amount, onAmount, category = "minor", onCategory, optional = false, replacing }: {
  /** As typed. */
  amount: string;
  onAmount: (v: string) => void;
  /** The category the cost is recorded under (a completion's is always the
   *  capped one, so that form passes no onCategory). */
  category?: Category;
  /** Present → the category is chosen here. */
  onCategory?: (c: Category) => void;
  /** Leave it blank for nothing spent. */
  optional?: boolean;
  /** An edited entry's id — its old amount is taken out of the month first. */
  replacing?: string;
}) {
  const { data } = useFmData();
  const terms = useFmTerms();
  const value = parseAmount(amount);
  const p = projectedSpend(data.costs, { amount: value, category, replacing }, terms);
  const money = (n: number) => formatMoney(n, terms.currency);
  return (
    <>
      <label className="fm-field">
        <span>Cost{terms.currency ? ` (${terms.currency})` : ""}{optional ? " — optional, leave blank if nothing was spent" : ""}</span>
        <input value={amount} inputMode="decimal" onChange={(e) => onAmount(e.target.value)} placeholder="0" />
      </label>
      {onCategory && (!optional || value > 0) && (
        <label className="fm-field">
          <span>Category</span>
          {/* Neutral words: which contract clause or account a category maps
              to is one villa's arrangement (hard-rules.py, 3b). */}
          <select value={category} onChange={(e) => onCategory(e.target.value as Category)}>
            <option value="minor">{terms.cappedName}{terms.monthlyCap > 0 ? " — counts against the monthly cap" : ""}</option>
            <option value="major">{terms.uncappedName}{terms.monthlyCap > 0 ? " — outside the cap" : ""}</option>
          </select>
        </label>
      )}
      {/* Only with a cap set: with none there is nothing to be over (an
          unconfigured install once read "…of IDR 0"). */}
      {category === "minor" && value > 0 && p.cap > 0 && (
        <div className={`fm-banner ${p.over ? "warn" : ""}`}>
          {p.month === monthKey(Date.now()) ? "This month" : monthLabel(p.month)} would come to {money(p.minorSpend)} of {money(p.cap)}
          {p.over && ` — past the monthly cap. Spend beyond it belongs to ${terms.uncappedName}.`}
        </div>
      )}
    </>
  );
}
