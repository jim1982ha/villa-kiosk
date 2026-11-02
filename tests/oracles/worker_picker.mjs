// "Done by" and "Who's handling it" are TYPED, never offered (owner, 2026-11-02: "this shouldn't be read from any cache.
// it shall be a value the user has to manually enter"). From 2026-10-30 (architecture review round 8) both offered every
// name any record held (fmEngine.knownWorkers, WorkerPicker); the forms now hold one text box (components/fm/WorkerName),
// the browser's memory of earlier entries off. The forms' markup read through the compiler; the record driven by value.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { existsSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, propText } from "../consistency/jsx.mjs";
const E = await import("@/fm/fmEngine");
const { applyFmCommand } = await import("@/fm/fmCommands");

const at = (d) => `2026-10-${String(d).padStart(2, "0")}T08:00:00.000Z`;

console.log("\n  the forms take the name typed:");
for (const [rel, prop] of [["components/fm/TodayTab.tsx", "who"], ["components/fm/FaultStageModal.tsx", "who"]]) {
  const tree = parseTsx(rel);
  const boxes = elements(tree, "WorkerName");
  ck(`${rel}: the name is the one WorkerName box on its state; no picker, no other box`,
     boxes.length === 1 && propText(boxes[0], "value") === prop && elements(tree, "WorkerPicker").length === 0
     && elements(tree, "SearchPicker").length === 0 && elements(tree, "input").length === 0, boxes.map((b) => propText(b, "value")));
}
{
  const tree = parseTsx("components/fm/WorkerName.tsx");
  const [box] = elements(tree, "input");
  ck("WorkerName: one text box, nothing offered, the browser's memory of earlier names off",
     !!box && elements(tree, "input").length === 1 && elements(tree, "datalist").length === 0
     && propText(box, "autoComplete") === '"off"' && propText(box, "list") === null && propText(box, "value") === "value",
     box && ["autoComplete", "list", "value"].map((k) => `${k}: ${propText(box, k)}`));
}
ck("nothing reads the names already given any more: the picker and the list are gone",
   !existsSync(new URL("../../src/components/fm/WorkerPicker.tsx", import.meta.url)) && !("knownWorkers" in E) && !("isKnownWorker" in E));

// owner, 2026-11-02: "Open a ticket" showed Who's handling it's list open, never tapped — a window puts the focus in its
// first field (useModalA11y), and the shared search box opened its list on the focus
{
  const [box] = elements(parseTsx("components/common/SearchPicker.tsx"), "input");
  ck("the shared search list opens on a tap, typing or the down arrow, never on the focus a window gives its first field",
     !!box && propText(box, "onFocus") === null && propText(box, "onClick") === "() => setOpen(true)"
     && /setOpen\(true\)/.test(propText(box, "onChange") ?? "") && /ArrowDown/.test(propText(box, "onKeyDown") ?? ""),
     box && ["onFocus", "onClick", "onKeyDown"].map((k) => `${k}: ${propText(box, k)}`));
}
// the Today tab's name is who DID it; `by` is the signed-in profile, stamped by the one command (fmCommands)
const logged = applyFmCommand({ schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [] },
  { type: "logCompletion", completion: { scheduleId: "s", at: at(9), by: "", who: "Ketut", photoIds: [] } },
  { now: at(9), id: (p) => `${p}1`, by: "ops" });
const c = logged.completions[0];
ck("a logged completion keeps the name as who did it, and the profile that recorded it",
   c.who === "Ketut" && c.by === "Facility Manager" && c.role === "ops" && E.workedBy(c) === "Ketut", c);

done("✅ the name of who does the work is typed, never offered");
