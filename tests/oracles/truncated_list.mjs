// "The first few, then the rest" (architecture review 2026-10-31 round 12 #3; the owner's rule "long lists are
// tables paged ten rows at a time"): one list for Settings' tables, "Also on this device" and Readiness' devices.
// The view driven by value, its button and pager drawn, its callers read through the compiler's tree.
import { h, draw, text } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
import { elements, parseTsx, propText } from "../consistency/jsx.mjs";
import ts from "typescript";
const { truncatedView, ShowAll } = await import("@/components/common/TruncatedList");
const { PAGE_ROWS } = await import("@/components/common/paging");
const J = JSON.stringify;
const items = Array.from({ length: 25 }, (_, i) => i + 1);

console.log("  the view, by value:");
const shut = truncatedView(items, false, 0);
ck("closed: the first three, and how many more", J(shut.visible) === J([1, 2, 3]) && shut.hidden === 22 && !shut.expanded, shut);
const p0 = truncatedView(items, true, 0), p1 = truncatedView(items, true, 1), p2 = truncatedView(items, true, 2);
ck("opened: the whole list a page of ten at a time, never all 25 at once",
   PAGE_ROWS === 10 && J(p0.visible) === J(items.slice(0, 10)) && J(p1.visible) === J(items.slice(10, 20))
   && J(p2.visible) === J(items.slice(20)) && p0.paged?.lastPage === 2, [p0.visible, p2.visible]);
ck("  ...a page past the end reads the last one (the list shrank under the reader)",
   J(truncatedView(items, true, 9).visible) === J(items.slice(20)));
ck("a short list: nothing to open, whatever was asked", truncatedView([1, 2], true, 3).hidden === 0
   && J(truncatedView([1, 2], true, 3).visible) === J([1, 2]) && !truncatedView([1, 2], true, 3).expanded);
ck("  ...a caller's own first few (Readiness' eight chips)", truncatedView(items, false, 0, 8).visible.length === 8
   && truncatedView(items, false, 0, 8).hidden === 17);

console.log("\n  drawn:");
const listOf = (v) => ({ ...v, toggle: () => {}, go: () => {} });
const closed = text(draw(h(ShowAll, { list: listOf(shut), noun: "entity", plural: "entities" })));
const second = text(draw(h(ShowAll, { list: listOf(p1), noun: "entity", plural: "entities" })));
ck("closed: one button with the count, no pager", /Show all, 22 more entities/.test(closed) && !/of 25/.test(closed), closed);
ck("opened: where the reader stands, the arrows, and a way back to fewer",
   /11–20 of 25/.test(second) && /Show fewer/.test(second) && (draw(h(ShowAll, { list: listOf(p1), noun: "entity" })).match(/aria-label="(Previous|Next) page"/g) ?? []).length === 2,
   second);
const onePage = text(draw(h(ShowAll, { list: listOf(truncatedView(items.slice(0, 8), true, 0)), noun: "entity", plural: "entities" })));
ck("  ...one page only: no pager to read, the way back stays", !/of 8|Previous/.test(onePage) && /Show fewer/.test(onePage), onePage);

console.log("\n  who uses it:");
const calls = (t, name) => { const out = []; const v = (n) => { if (ts.isCallExpression(n) && n.expression.getText() === name) out.push(n); ts.forEachChild(n, v); }; v(t); return out; };
const readings = parseTsx("components/panels/DeviceReadings.tsx");
const rCall = calls(readings, "useTruncated");
ck("\"Also on this device\": the one list, started again for another device (its rows' ids)",
   rCall.length === 1 && rCall[0].arguments.length === 3 && /\.map\(\(r\) => r\.id\)\.join\(\)/.test(rCall[0].arguments[2].getText())
   && elements(readings, "ShowAll").length === 1 && !/slice\(0,/.test(readings.getText()), rCall.map((c) => c.getText()));
const ready = parseTsx("components/fm/ReadinessTab.tsx");
ck("Readiness' devices: the one list, every device reachable (no \"+N more\" that cannot be tapped)",
   calls(ready, "useTruncated").length === 1 && elements(ready, "ShowAll").length === 1
   && !/\.slice\(0, 8\)|more\s*<\/span>/.test(ready.getText()) && elements(ready, "CheckDevices").length === 1);
for (const f of ["settings/BindingsTable.tsx", "settings/ConfigEditor.tsx", "settings/GroupedDevices.tsx"]) {
  const t = parseTsx(`components/${f}`);
  ck(`  ...${f.split("/")[1]}: the same`, calls(t, "useTruncated").length === 1 && elements(t, "ShowAll").length === 1
     && elements(t, "ShowAll").every((s) => propText(s, "noun")));
}

done("✅ the first few, then the rest ten at a time, with a way back, everywhere");
