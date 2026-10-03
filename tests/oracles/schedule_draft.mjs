// The maintenance-task form, as values (src/fm/scheduleDraft.ts, 2.496.259).
// Three defects lived in the component where nothing reached: editing a
// PAUSED task resumed it (the save always sent enabled: true), "1.5" was saved
// as 15, and a blank or mistyped interval was saved as "every day".
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { scheduleWrite, draftDays, scheduleToDraft, EMPTY_SCHEDULE_DRAFT } = await import("@/fm/scheduleDraft");
const { validWarnPercent, fmTerms } = await import("@/fm/fmTypes");

const paused = { id: "s1", title: "Pool pump service", everyDays: 30, enabled: false, room: "Pool", clause: "3.1" };
const edit = scheduleWrite({ ...scheduleToDraft(paused), title: "Pool pump service (yearly kit)" }, "s1");
ck("editing a PAUSED task never carries `enabled` — it stays paused",
   edit.ok && edit.kind === "edit" && edit.id === "s1" && !("enabled" in edit.patch) && edit.patch.title === "Pool pump service (yearly kit)", edit);
ck("  ...and keeps what was not touched (room, clause, interval)",
   edit.ok && edit.patch.room === "Pool" && edit.patch.clause === "3.1" && edit.patch.everyDays === 30);
const add = scheduleWrite({ ...EMPTY_SCHEDULE_DRAFT, title: "Generator service" }, null);
ck("a NEW task starts enabled, at the form's default interval",
   add.ok && add.kind === "add" && add.fields.enabled === true && add.fields.everyDays === 90, add);

ck("the interval is a whole number of days: '1.5' is refused, not saved as 15",
   draftDays("1.5") === null && !scheduleWrite({ ...EMPTY_SCHEDULE_DRAFT, title: "x", everyDays: "1.5" }, null).ok);
ck("  ...blank, words and 0 are refused, not saved as 'every day'",
   ["", "  ", "abc", "0", "-3"].every((v) => draftDays(v) === null)
   && /whole number of days/.test(scheduleWrite({ ...EMPTY_SCHEDULE_DRAFT, title: "x", everyDays: "" }, null).problem ?? ""));
ck("  ...a plain number (with spaces) is read as typed", draftDays(" 14 ") === 14 && draftDays("365") === 365);
ck("a task needs a name", scheduleWrite({ ...EMPTY_SCHEDULE_DRAFT, title: "   " }, null).ok === false);

ck("ONE 'warn at' rule: 1–99 kept, blank / 0 / 100 / words → default, '8.5' is 8.5 not 85",
   validWarnPercent("75") === 75 && validWarnPercent("8.5") === 8.5 && [" ", "", "0", "100", "abc", undefined].every((v) => validWarnPercent(v) === null)
   && fmTerms({ warnAtPercent: 0 }, "EUR").warnAt === 0.8 && fmTerms({ warnAtPercent: 60 }, "EUR").warnAt === 0.6);

// The callers use it (the bug was in how the form built its write).
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const ed = src("components/fm/ScheduleEditor.tsx"), terms = src("components/fm/ContractTermsEditor.tsx");
ck("the task form writes what scheduleWrite builds, and builds nothing itself",
   /const write = scheduleWrite\(draft, editingId\);/.test(ed) && /updateSchedule\(write\.id, write\.patch\)/.test(ed)
   && /addSchedule\(write\.fields\)/.test(ed) && !/enabled: true/.test(ed) && !/replace\(\/\[\^\\d\]\/g/.test(ed));
ck("the contract editor reads the percentage with the same rule", /validWarnPercent\(warnAt\)/.test(terms) && !/pct >= 1 && pct <= 99/.test(terms));

done("✅ the maintenance-task form, decided by value");
