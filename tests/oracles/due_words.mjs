// A task's due state has ONE word and ONE tone everywhere (fmEngine.DUE_WORDS — the twin of STAGE_WORDS): the
// Schedule tab's pill, the Overview's late-task line, the recap's Standing table; and ONE sentence for how it stands
// (fmEngine.dueLine: "3 days overdue", "Due today", "Due in 4 days", "No completion recorded yet"), the date appended by
// each reader in its own form. ⚠️ THREE SPELLINGS (architecture review, 2026-10-19): the tab's STATE_LABEL, the recap's
// "**Overdue by 3d**" / "**Never recorded**", the Overview's third copy; the tone sat apart in fm/tone.
// And the recap's Standing table IS the Schedule board, worst first, with the tab's "N tasks need attention" as its
// first line — it walked the stored order with a filter of its own and had no such line.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const E = await import("@/fm/fmEngine");
const R = await import("@/fm/fmDocuments");
const { buildAttentionItems } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const DAY = 86_400_000;
// midday, so every runner's local day is the same calendar day
const now = Date.parse("2026-09-27T12:00:00Z");
const sched = (id, title, everyDays) => ({ id, title, everyDays, enabled: true, createdAt: "2026-09-01T12:00:00Z" });
const logged = (scheduleId, daysAgo) => ({ id: `c-${scheduleId}`, scheduleId, at: new Date(now - daysAgo * DAY).toISOString(), by: "Op", photoIds: [] });
// stored in the WRONG order on purpose: on schedule first, the overdue one third
const fm = { ...EMPTY_FM_DATA,
  schedules: [sched("ok", "Pool filter", 30), sched("soon", "Garden", 30), sched("late", "AC service", 30), sched("never", "Pest control", 30), { ...sched("off", "Paused", 30), enabled: false }],
  completions: [logged("ok", 2), logged("soon", 26), logged("late", 33)] };
const board = E.scheduleBoard(fm, now);
const by = Object.fromEntries(board.map((s) => [s.schedule.id, s]));

console.log("  the words and the sentence, by value:");
ck("four states, four words, three tones",
   Object.entries(E.DUE_WORDS).map(([k, w]) => `${k}:${w.word}/${w.tone}`).join()
   === "overdue:Overdue/danger,never:Never recorded/danger,due-soon:Due soon/warn,ok:On schedule/ok", E.DUE_WORDS);
ck("the board: overdue, never, due soon, on schedule — the paused task not on it",
   board.map((s) => `${s.schedule.id}:${s.state}`).join() === "late:overdue,never:never,soon:due-soon,ok:ok", board.map((s) => s.schedule.id));
ck("the sentence: days overdue / due today / due in N days / no completion yet — without a date",
   E.dueLine(by.late) === "3 days overdue" && E.dueLine(by.never) === "No completion recorded yet" && E.dueLine(by.ok) === "Due in 28 days"
   && E.dueLine(by.soon) === "Due in 4 days" && E.dueLine({ state: "ok", daysUntilDue: 0.2 }) === "Due today"
   && E.dueLine({ state: "overdue", daysUntilDue: -1 }) === "1 day overdue", board.map(E.dueLine));

console.log("\n  the recap's Standing table is the board, worst first, under the tab's count:");
const recap = R.buildMonthlyRecap({ fm, month: "2026-09", villaName: "V", readiness: null, deviceOfRecord: (id) => id, now });
const standing = recap.split("### Standing against schedule")[1].split("## 2.")[0];
const rows = standing.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Task"));
ck("its first line counts the late tasks, as the Schedule tab and the HUD do (fmAttention)",
   standing.includes(`- Tasks needing attention: **${E.fmAttention(fm, now).lateTasks.length}** (overdue or never recorded)`)
   && E.fmAttention(fm, now).lateTasks.length === 2, standing.split("\n").slice(0, 3));
ck("its rows are the board's order — overdue, never, due soon, on schedule — never the stored order; no paused task",
   rows.map((r) => r.split("|")[1].trim()).join() === "AC service,Pest control,Garden,Pool filter", rows);
ck("  ...each row's Status is its state's ONE word (the late ones bold), its Due the sentence with the date as 2026-09-24",
   rows[0].includes(`| **${E.DUE_WORDS.overdue.word}** | 3 days overdue (by 2026-09-24) |`)
   && rows[1].includes(`| **${E.DUE_WORDS.never.word}** | No completion recorded yet (by 2026-10-01) |`)
   && rows[2].includes(`| ${E.DUE_WORDS["due-soon"].word} | Due in 4 days (by 2026-10-01) |`)
   && rows[3].includes(`| ${E.DUE_WORDS.ok.word} | Due in 28 days (by 2026-10-25) |`), rows);
ck("  ...and no word of its own", !/Overdue by|\bLate\b/.test(standing));

console.log("\n  the Overview's late-task line says the same word:");
{
  // late whatever the clock: one never done, one done years ago
  const items = buildAttentionItems({ devices: (await import("../consistency/devices.mjs")).devicesOf(), entities: {}, entityMap: {},
    resolvedRooms: {}, fmData: { ...EMPTY_FM_DATA, schedules: [sched("n", "Pest control", 30), sched("o", "AC service", 30)],
      completions: [{ id: "c", scheduleId: "o", at: "2020-01-01T12:00:00Z", by: "Op", photoIds: [] }] } });
  const detail = Object.fromEntries(items.filter((i) => i.kind === "schedule").map((i) => [i.title, i.detail]));
  ck("never recorded / overdue, from the table", detail["Pest control"] === E.DUE_WORDS.never.word && detail["AC service"] === E.DUE_WORDS.overdue.word, detail);
}

console.log("\n  the screens read the table (wiring a drawing cannot reach — the tab needs the Facility data):");
const code = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
const today = code("components/fm/TodayTab.tsx");
ck("the Schedule tab's pill is the table's word in the table's tone; its line the engine's sentence",
   /status=\{\{ text: DUE_WORDS\[s\.state\]\.word, tone: pillClass\(DUE_WORDS\[s\.state\]\.tone\) \}\}/.test(today) && /dueLine\(s\)/.test(today));
const words = Object.values(E.DUE_WORDS).map((w) => w.word);
const literal = new RegExp(`"(${words.join("|")}|Overdue by|No completion recorded yet)`);
ck("  ...and no screen or document spells a due word itself",
   ["components/fm/TodayTab.tsx", "fm/fmDocuments.ts", "config/attention.ts"].every((p) => !literal.test(code(p)) && !/STATE_LABEL/.test(code(p))),
   ["components/fm/TodayTab.tsx", "fm/fmDocuments.ts", "config/attention.ts"].filter((p) => literal.test(code(p))));

done("✅ one word, one tone and one sentence per due state; the recap's standing is the board");
