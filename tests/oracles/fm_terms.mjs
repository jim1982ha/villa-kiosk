// The owner's maintenance contract terms (fm/fmTypes.ts fmTerms) and the ONE
// cap check (fm/fmEngine.ts projectedSpend), driven by value.
//
// Before 2.496.225 the cap (0) and currency ("") were code nothing could set,
// "Minor"/"Major"/"Owner's account" were typed in the report and three
// screens, the 80 % warning was inline — and SpendTab computed its own cap
// check, counting an edited entry's old amount twice.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const T = await import("@/fm/fmTypes");
const E = await import("@/fm/fmEngine");
const R = await import("@/fm/fmDocuments");

console.log("  the stored terms, resolved:");
{
  const none = T.fmTerms(undefined, undefined);
  ck("nothing set: no cap, no currency, warn at 80 %",
     none.monthlyCap === 0 && none.currency === "" && none.warnAt === 0.8);
  const set = T.fmTerms({ monthlyCap: 5000, warnAtPercent: 90 }, "EUR");
  ck("set: the owner's cap and share, with Home Assistant's currency",
     set.monthlyCap === 5000 && set.warnAt === 0.9 && set.currency === "EUR");
  const junk = T.fmTerms({ monthlyCap: -5, warnAtPercent: 250 }, 3);
  ck("junk (a hand-edited store) falls back, never throws or goes negative",
     junk.monthlyCap === 0 && junk.warnAt === 0.8 && junk.currency === "");
  // owner, 2026-10-14: the two category names are gone — always Minor (the cap's) and Major (outside it)
  const old = T.fmTerms({ monthlyCap: 1000, cappedName: "Routine", uncappedName: "Capital" }, "EUR");
  ck("the categories are Minor and Major, whatever an older store still holds",
     T.COST_CATEGORY_NAMES.minor === "Minor" && T.COST_CATEGORY_NAMES.major === "Major" && !("cappedName" in old) && !("uncappedName" in old));
}

console.log("\n  the one cap check:");
const now = Date.parse("2026-09-15T10:00:00Z");
const terms = { monthlyCap: 1000, warnAt: 0.8 };
const costs = [
  { id: "a", at: "2026-09-02T00:00:00Z", label: "x", category: "minor", amountIdr: 600, photoIds: [] },
  { id: "b", at: "2026-09-03T00:00:00Z", label: "y", category: "major", amountIdr: 5000, photoIds: [] },
  { id: "old", at: "2026-08-20T00:00:00Z", label: "z", category: "minor", amountIdr: 900, photoIds: [] },
];
{
  const p = E.projectedSpend(costs, { amount: 300, category: "minor" }, terms, now);
  ck("a new capped entry adds to this month", p.month === "2026-09" && p.minorSpend === 900 && !p.over, JSON.stringify(p));
  ck("  ...and reaching the cap is over", E.projectedSpend(costs, { amount: 400, category: "minor" }, terms, now).over);
  ck("  ...an entry in the other category adds nothing", E.projectedSpend(costs, { amount: 9999, category: "major" }, terms, now).minorSpend === 600);
  const edit = E.projectedSpend(costs, { amount: 650, category: "minor", replacing: "a" }, terms, now);
  ck("EDITING an entry replaces its amount, not adds to it (was counted twice)", edit.minorSpend === 650 && !edit.over, JSON.stringify(edit));
  const editOld = E.projectedSpend(costs, { amount: 950, category: "minor", replacing: "old" }, terms, now);
  ck("an edited entry is judged in ITS month, not today's", editOld.month === "2026-08" && editOld.minorSpend === 950, JSON.stringify(editOld));
  ck("no cap: never over", !E.projectedSpend(costs, { amount: 1e9, category: "minor" }, { monthlyCap: 0, warnAt: 0.8 }, now).over);
  ck("wouldExceedCap is the same check", E.wouldExceedCap(costs, 400, terms, now) && !E.wouldExceedCap(costs, 399, terms, now));
  ck("the warning share is the owner's", E.budgetStatus(costs, "2026-09", { monthlyCap: 1000, warnAt: 0.5 }).state === "approaching"
     && E.budgetStatus(costs, "2026-09", { monthlyCap: 1000, warnAt: 0.7 }).state === "ok");
}

console.log("\n  the report speaks the owner's terms:");
{
  const t = T.fmTerms({ monthlyCap: 1000, cappedName: "Routine", uncappedName: "Capital" }, "EUR");
  const b = E.budgetStatus(costs, "2026-09", t);
  const text = [...R.spendSummary(b, t), ...R.spendTable(b, t)].join("\n");
  ck("Minor and Major, in Home Assistant's currency — an old stored name is not read",
     text.includes("Minor") && text.includes("Major") && /€|EUR/.test(text) && !/Routine|Capital/.test(text), text);
  ck("the month's total is minor plus major, counted once, by the engine", b.totalSpend === b.minorSpend + b.majorSpend && b.totalSpend > 0, b);
  ck("no account is named that the owner did not name", !/Owner's account/.test(text));
  const statement = R.buildSpendStatement({ costs, schedules: [], completions: [], tickets: [], savedDocuments: [] }, "2026-09", "V", t);
  ck("the spend statement uses the same terms", statement.includes("Minor") && /€|EUR/.test(statement));
}

done("✅ the contract terms are the owner's; one cap check, an edit counted once");
