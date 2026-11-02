// A Cockpit form opens where it was asked for, and in view (owner, 2026-11-01: tapping a ticket opened its form at the
// top of the tab, the card left as it was below, "without focus to shift it … How can you improve this
// consistently?"). An edit takes its card's place in every list; a task's log opens under its task; every form is the
// one frame (FmForm) that brings itself into view as it opens.
//
// ⚠️ AND A FORM WHOSE RECORD LEAVES THE LIST CLOSES (architecture review round 13): editing a spend entry, then changing
// the Month, left no form and no Record spend; a task erased on another tablet left no form and no Add a task. Which
// record is open is ONE module's (components/fm/ListEditor): its view driven by value, its hook run under React (the
// record dropped, the add button back, the typed fields emptied), and each list's wiring to it read from the compiler's
// tree.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync, readdirSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, guardsOf, propText } from "../consistency/jsx.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const J = JSON.stringify;

console.log("  every form is the one frame:");
const fmDir = new URL("../../src/components/fm/", import.meta.url);
const files = readdirSync(fmDir).filter((f) => f.endsWith(".tsx") && f !== "FmForm.tsx");
const raw = files.filter((f) => /className="fm-form"/.test(rd(`components/fm/${f}`)));
const framed = files.filter((f) => elements(parseTsx(`components/fm/${f}`), "FmForm").length > 0);
ck("no form draws its own frame: each is FmForm", raw.length === 0, raw);
ck("  ...the ticket, spend, task, log and spend-settings forms all are",
   ["FaultForm.tsx", "SpendTab.tsx", "ScheduleEditor.tsx", "TodayTab.tsx", "ContractTermsEditor.tsx"].every((f) => framed.includes(f)), framed);
const frame = rd("components/fm/FmForm.tsx");
ck("  ...which brings itself into view as it opens, its heading at the top",
   /useInView<HTMLDivElement>\(\)/.test(frame) && /<div ref=\{ref\} className="fm-form">/.test(frame)
   && /active = true, block: ScrollLogicalPosition = "start"/.test(rd("hooks/useInView.ts")));

console.log("\n  which record is open, by value (ListEditor.listEditorView):");
const { listEditorView, NOTHING_OPEN, useListEditor } = await import("@/components/fm/ListEditor");
const view = (state, ids) => J(listEditorView(state, ids));
ck("nothing open: no form, the add button shows",
   view(NOTHING_OPEN, ["a", "b"]) === J({ editing: null, adding: false, addButton: true }));
ck("  ...a new record's form: no card replaced, the add button hidden",
   view({ open: "add" }, ["a"]) === J({ editing: null, adding: true, addButton: false }));
ck("  ...a record's form: that record, in its card's place, the add button hidden",
   view({ open: "edit", id: "b" }, ["a", "b"]) === J({ editing: "b", adding: false, addButton: false }));
ck("a record that left the list (another month, erased elsewhere, closed by VESTA): no form, the add button back",
   view({ open: "edit", id: "b" }, ["a"]) === J({ editing: null, adding: false, addButton: true })
   && view({ open: "edit", id: "b" }, []) === J({ editing: null, adding: false, addButton: true }));

console.log("\n  the list's editor, run under React:");
{
  const { React, act, render, unmount } = mountRoot();
  let ed = null, closed = 0;
  const Probe = ({ ids }) => { ed = useListEditor(ids, () => { closed++; }); return null; };
  await render(React.createElement(Probe, { ids: ["a", "b"] }));
  await act(() => ed.edit("b"));
  const open = { editing: ed.editing, addButton: ed.addButton };
  const card = React.createElement("i", { key: "b" }), form = React.createElement("b");
  const drawn = ed.inPlace("b", card, () => form), other = ed.inPlace("a", card, () => form);
  ck("an edit open: that record drawn as its form in its card's place, every other its card",
     J(open) === J({ editing: "b", addButton: false }) && drawn.type === React.Fragment && drawn.props.children === form
     && other === card, open);
  await render(React.createElement(Probe, { ids: ["a"] }));
  ck("  ...its record gone from the list: the form closed, the add button back, its fields emptied once",
     ed.editing === null && ed.addButton === true && closed === 1, { editing: ed.editing, addButton: ed.addButton, closed });
  await render(React.createElement(Probe, { ids: ["a", "b"] }));
  ck("  ...and forgotten: the record back in the list (its month chosen again) does not reopen it",
     ed.editing === null && ed.addButton === true && closed === 1, { editing: ed.editing, closed });
  await act(() => ed.add());
  ck("  ...a new record's form then opens", ed.adding === true && ed.addButton === false && ed.editing === null);
  await act(() => ed.close());
  ck("  ...and its Cancel or Save closes it, its fields emptied", ed.adding === false && ed.addButton === true && closed === 2);
  await unmount();
}

console.log("\n  every list asks it:");
const tree = (f) => parseTsx(`components/fm/${f}`);
const calls = (f, name) => {
  const out = [];
  const visit = (n) => { if (n.expression && n.arguments && n.expression.getText?.() === name) out.push(n); n.forEachChild(visit); };
  visit(tree(f));
  return out;
};
const lists = { "TicketsTab.tsx": "listed", "SpendTab.tsx": "b.entries.map((c) => c.id)",
  "ScheduleEditor.tsx": "data.schedules.map((s) => s.id)", "TodayTab.tsx": "board.map((s) => s.schedule.id)" };
const asked = Object.fromEntries(Object.keys(lists).map((f) => [f, calls(f, "useListEditor").map((c) => c.arguments[0].getText())]));
ck("Tickets, Spend, Schedule and Today each ask it once, with the records they list now (Spend: the month's)",
   Object.entries(lists).every(([f, ids]) => J(asked[f]) === J([ids])), asked);
ck("  ...none keeps its own note of the record being edited",
   Object.keys(lists).every((f) => !/const \[(editingId|openId|adding), /.test(rd(`components/fm/${f}`))));
ck("  ...Tickets': the records it draws (the tickets in progress and the closed ones)",
   /const listed = useMemo\(\(\) => \[\.\.\.tickets\.flatMap\(\(g\) => g\.records\), \.\.\.closed\]\.map\(\(t\) => t\.id\)/
     .test(rd("components/fm/TicketsTab.tsx")));
// owner, 2026-11-02: Open Ticket moved to the Tickets tab, its NEW ticket's form at the top (as Spend's Record spend);
// an edit stays in its card's place
{
  const forms = elements(tree("TicketsTab.tsx"), "FaultForm");
  const edits = forms.filter((f) => propText(f, "editing") !== null);
  const fresh = forms.filter((f) => propText(f, "editing") === null);
  ck("Tickets: the record being edited is its form, in its place (the editor's inPlace); the form at the top is a new ticket's only",
     calls("TicketsTab.tsx", "editor.inPlace").length === 1 && edits.length === 1 && propText(edits[0], "editing") === "t"
     && fresh.length === 1 && propText(fresh[0], "presetEntity") === "raising.entity", forms.map((f) => f.getText().slice(0, 80)));
}
const button = (f, words) => elements(tree(f), "button").find((b) => b.getText().includes(words));
ck("Spend: Record spend shows while no form is open; the form at the top is a new entry's only; an edit in its place",
   J(guardsOf(button("SpendTab.tsx", "Record spend"))) === J(["editor.addButton"])
   && /\{editor\.adding && form\}/.test(rd("components/fm/SpendTab.tsx")) && calls("SpendTab.tsx", "editor.inPlace").length === 1);
ck("Schedule: Add a task shows while no form is open; the form at the top is a new task's only; an edit in its place",
   J(guardsOf(button("ScheduleEditor.tsx", "Add a task"))) === J(["editor.addButton"])
   && /\{editor\.adding && form\}/.test(rd("components/fm/ScheduleEditor.tsx")) && calls("ScheduleEditor.tsx", "editor.inPlace").length === 1);
const log = elements(tree("TodayTab.tsx"), "LogCompletion")[0];
ck("a task's Log opens its form right under that task's card, not under Recent work",
   !!log && J(guardsOf(log)) === J(["log.editing === s.schedule.id"]), log && guardsOf(log));

done("✅ a form opens in its record's place, and closes when its record leaves the list");
