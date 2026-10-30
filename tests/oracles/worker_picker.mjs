// "Done by" and "Who's handling it" offer the names already given (architecture review round 8, 2026-10-30): each form
// had its own blank box, so one person became three in Recent work ("Wayan", "wayan", "Wayan / AC contractor").
// fm/fmEngine.knownWorkers collects them, components/fm/WorkerPicker.tsx offers them (workerChoices) with "Use …" for a
// new one, and the Today tab's completion (components/fm/TodayTab.tsx) and a fault's stage
// (components/fm/FaultStageModal.tsx) pick from it. Driven by value; the forms' markup read through the compiler.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, propText } from "../consistency/jsx.mjs";
const E = await import("@/fm/fmEngine");
const { workerChoices } = await import("@/components/fm/WorkerPicker");
const { applyFmCommand } = await import("@/fm/fmCommands");

const at = (d) => `2026-10-${String(d).padStart(2, "0")}T08:00:00.000Z`;
const step = (d, who) => ({ at: at(d), status: "in_progress", photoIds: [], ...(who ? { who } : {}), by: "Owner", role: "owner" });
const data = {
  completions: [
    { id: "c1", scheduleId: "s", at: at(1), by: "Ketut", photoIds: [] },              // before 2.496.623: the typed name in `by`
    { id: "c2", scheduleId: "", ticketId: "t", at: at(2), by: "Owner", role: "owner", who: "Wayan", photoIds: [] },
    { id: "c3", scheduleId: "", ticketId: "t", at: at(3), by: "VESTA Agent", who: "wayan", photoIds: [] },
    { id: "c4", scheduleId: "", ticketId: "t", at: at(4), by: "VESTA Agent", photoIds: [] },   // the Agent's, nobody named
    { id: "c5", scheduleId: "s", at: at(5), by: "Facility manager", photoIds: [] },   // a profile's old words: no name
    { id: "c6", scheduleId: "", ticketId: "t", at: at(6), by: "—", photoIds: [] },
    { id: "c7", scheduleId: "s", at: at(7), by: "", role: "ops", who: "  Wayan  ", photoIds: [] },
    { id: "c8", scheduleId: "s", at: at(7), by: "Owner", role: "owner", who: "Ketut", photoIds: [] },
  ],
  tickets: [{ id: "t", status: "in_progress", openedAt: at(1), title: "Leak", photoIds: [],
    updates: [step(2, "Wayan / AC contractor"), step(3), step(8, "ketut")] }],
};
const known = E.knownWorkers(data);

console.log("  the names already given:");
ck("every name given, once each whatever its case and spaces, sorted by name",
   JSON.stringify(known) === JSON.stringify(["Ketut", "Wayan", "Wayan / AC contractor"]), known);
ck("  ...spelled as most records spell them", known.includes("Wayan") && known.includes("Ketut") && !known.includes("ketut"), known);
const tie = E.knownWorkers({ completions: [], tickets: [{ id: "t", updates: [step(1, "ketut"), step(9, "KETUT")] }] });
ck("  ...the latest spelling of equals", JSON.stringify(tie) === JSON.stringify(["KETUT"]), tie);
ck("  ...never a profile's words, the VESTA Agent's stamp or a blank", !known.some((n) => /owner|facility|vesta|—/i.test(n)), known);
ck("  ...nothing given: nothing offered", E.knownWorkers({ completions: [], tickets: [] }).length === 0);

console.log("\n  what the open list offers:");
const all = workerChoices(known, "");
ck("nothing typed: every name, no Use", JSON.stringify(all.names) === JSON.stringify(known) && all.use === null, all);
const way = workerChoices(known, "WAY");
ck("typed: the names it matches, case ignored, and Use for what is typed", JSON.stringify(way.names) === JSON.stringify(["Wayan", "Wayan / AC contractor"])
   && way.use === "WAY", way);
ck("  ...a name already given (any case, any spaces) offers no Use: it is picked",
   workerChoices(known, " ketut ").use === null && workerChoices(known, "wayan").use === null);
ck("  ...a new name is offered as typed, spaces joined", workerChoices(known, "  Made   Sudi ").use === "Made Sudi");

console.log("\n  the forms pick, never type:");
for (const [rel, prop] of [["components/fm/TodayTab.tsx", "who"], ["components/fm/FaultStageModal.tsx", "who"]]) {
  const tree = parseTsx(rel);
  const pickers = elements(tree, "WorkerPicker");
  ck(`${rel}: the name is a WorkerPicker on its state, and no text box is left`,
     pickers.length === 1 && propText(pickers[0], "value") === prop && elements(tree, "input").length === 0,
     pickers.map((p) => propText(p, "value")));
}
// the Today tab's name is who DID it; `by` is the signed-in profile, stamped by the one command (fmCommands)
const logged = applyFmCommand({ schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [] },
  { type: "logCompletion", completion: { scheduleId: "s", at: at(9), by: "", who: "Ketut", photoIds: [] } },
  { now: at(9), id: (p) => `${p}1`, by: "ops" });
const c = logged.completions[0];
ck("a logged completion keeps the name as who did it, and the profile that recorded it",
   c.who === "Ketut" && c.by === "Facility Manager" && c.role === "ops" && E.workedBy(c) === "Ketut", c);

done("✅ the names already given are offered, never typed again");
