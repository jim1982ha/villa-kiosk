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
const R = await import("@/fm/fmReport");

console.log("  the stored terms, resolved:");
{
  const none = T.fmTerms(undefined, undefined);
  ck("nothing set: no cap, no currency, the generic names, warn at 80 %",
     none.monthlyCap === 0 && none.currency === "" && none.cappedName === "Minor" && none.uncappedName === "Major" && none.warnAt === 0.8);
  const set = T.fmTerms({ monthlyCap: 5000, cappedName: " Routine ", uncappedName: "Capital", warnAtPercent: 90 }, "EUR");
  ck("set: the owner's cap, names (trimmed) and share, with Home Assistant's currency",
     set.monthlyCap === 5000 && set.cappedName === "Routine" && set.uncappedName === "Capital" && set.warnAt === 0.9 && set.currency === "EUR");
  const junk = T.fmTerms({ monthlyCap: -5, cappedName: 7, uncappedName: "  ", warnAtPercent: 250 }, 3);
  ck("junk (a hand-edited store) falls back, never throws or goes negative",
     junk.monthlyCap === 0 && junk.cappedName === "Minor" && junk.uncappedName === "Major" && junk.warnAt === 0.8 && junk.currency === "");
  ck("category names follow the terms", T.categoryName(set, "minor") === "Routine" && T.categoryName(set, "major") === "Capital");
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
  ck("the owner's category names and currency, not \"Minor\"/\"Major\"",
     text.includes("Routine") && text.includes("Capital") && /€|EUR/.test(text) && !/\bMinor\b|\bMajor\b/.test(text), text);
  ck("no account is named that the owner did not name", !/Owner's account/.test(text));
  const statement = R.buildSpendStatement({ costs, schedules: [], completions: [], tickets: [], savedDocuments: [] }, "2026-09", "V", t);
  ck("the spend statement uses the same terms", statement.includes("Routine") && /€|EUR/.test(statement));
}

done("✅ the contract terms are the owner's; one cap check, an edit counted once");
