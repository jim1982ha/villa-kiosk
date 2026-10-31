// A Cockpit form opens where it was asked for, and in view (owner, 2026-11-01: tapping a ticket opened its form at the
// top of the tab, the card left as it was below, "without focus to shift it … How can you improve this
// consistently?"). An edit takes its card's place in every list; a task's log opens under its task; every form is the
// one frame (FmForm) that brings itself into view as it opens. Node cannot run a React effect, so the wiring is read
// from the compiler's tree and the source.
import { readFileSync, readdirSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, guardsOf } from "../consistency/jsx.mjs";
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

console.log("\n  every form is the one frame:");
const fmDir = new URL("../../src/components/fm/", import.meta.url);
const files = readdirSync(fmDir).filter((f) => f.endsWith(".tsx") && f !== "FmForm.tsx");
const raw = files.filter((f) => /className="fm-form"/.test(rd(`components/fm/${f}`)));
const framed = files.filter((f) => elements(parseTsx(`components/fm/${f}`), "FmForm").length > 0);
ck("no form draws its own frame: each is FmForm", raw.length === 0, raw);
ck("  ...the ticket, spend, task, log and spend-settings forms all are",
   ["FaultForm.tsx", "SpendTab.tsx", "ScheduleEditor.tsx", "TodayTab.tsx", "ContractTermsEditor.tsx"].every((f) => framed.includes(f)), framed);
const frame = rd("components/fm/FmForm.tsx");
ck("  ...which brings itself into view as it opens, its heading at the top",
   /useEffect\(\(\) => \{[\s\S]*?scrollIntoView\?\.\(\{ block: "start"/.test(frame) && /\}, \[\]\);/.test(frame)
   && /<div ref=\{ref\} className="fm-form">/.test(frame));

console.log("\n  an edit takes its card's place:");
const tickets = rd("components/fm/TicketsTab.tsx");
ck("Tickets: the record being edited is drawn as its form, where its card was; no form above the list",
   /const record = \([^)]*\) => \{\s*(\/\/[^\n]*\n\s*)*if \(editing\?\.id === t\.id\) \{\s*return <FaultForm key=\{editing\.id\} editing=\{editing\}/.test(tickets)
   && (tickets.match(/<FaultForm /g) ?? []).length === 1);
const spend = rd("components/fm/SpendTab.tsx");
ck("Spend: the entry being edited is its form, in its place; the form at the top is a new entry's only",
   /\.map\(\(c\) => c\.id === editingId\s*\? <Fragment key=\{c\.id\}>\{form\}<\/Fragment>/.test(spend)
   && /\{adding && !editingId && form\}/.test(spend) && (spend.match(/\{form\}|&& form\}/g) ?? []).length === 2);
const sched = rd("components/fm/ScheduleEditor.tsx");
ck("Schedule: the task being edited is its form, in its place; the form at the top is a new task's only",
   /if \(s\.id === editingId\) return <Fragment key=\{s\.id\}>\{form\}<\/Fragment>;/.test(sched)
   && /\{adding && form\}/.test(sched) && !/adding \|\| editingId\) && form/.test(sched));
const log = elements(parseTsx("components/fm/TodayTab.tsx"), "LogCompletion")[0];
ck("a task's Log opens its form right under that task's card, not under Recent work",
   !!log && guardsOf(log).some((g) => /openId === s\.schedule\.id/.test(g)), log && guardsOf(log));

done();
