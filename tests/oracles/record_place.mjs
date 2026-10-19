// Where a record is — its device, the device's name and its room — is built in ONE place (fm/recordPlace, bound to
// the live config by components/fm/useRecordPlace) for the three forms that file a record about a device: the fault
// form, a guest's report and the Spend tab. ⚠️ ASSEMBLED THREE TIMES (architecture review, 2026-10-19): each wrote
// `{ entityId, deviceLabel, room: entityId ? deviceRoom(...) : undefined }` by hand, the label from a different source.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { recordPlace } = await import("@/fm/recordPlace");

console.log("  by value:");
const rooms = { "light.a": "Hall", "light.b": "" };
ck("a picked device: its id, the name as typed or shown, its room",
   JSON.stringify(recordPlace("light.a", "Hall lamp", rooms)) === JSON.stringify({ entityId: "light.a", deviceLabel: "Hall lamp", room: "Hall" }),
   recordPlace("light.a", "Hall lamp", rooms));
ck("  ...a device with no room keeps an empty room (as deviceRoom says it), never a made-up one",
   JSON.stringify(recordPlace("light.b", "Bed lamp", rooms)) === JSON.stringify({ entityId: "light.b", deviceLabel: "Bed lamp", room: "" }));
ck("free text for a device the villa's system does not know: no id, the text, no room",
   JSON.stringify(recordPlace("", "  Spare pool pump ", rooms)) === JSON.stringify({ deviceLabel: "Spare pool pump" }), recordPlace("", "  Spare pool pump ", rooms));
ck("  ...and nothing at all (a whole-villa expense): nothing", JSON.stringify(recordPlace(undefined, "", rooms)) === "{}"
   && JSON.stringify(recordPlace("  ", undefined, rooms)) === "{}");

console.log("\n  the three forms (wiring: each needs the Facility data to draw):");
const code = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
const forms = ["components/fm/FaultForm.tsx", "components/fm/GuestReportModal.tsx", "components/fm/SpendTab.tsx"];
ck("each files its record through useRecordPlace, spread into the record",
   forms.every((p) => /const place = useRecordPlace\(\);/.test(code(p)) && /\.\.\.place\(/.test(code(p))), forms.filter((p) => !/\.\.\.place\(/.test(code(p))));
ck("  ...and none builds a room, a label or the device field itself",
   forms.every((p) => !/room:|deviceRoom\(|deviceLabel:|entityId: entityId/.test(code(p))), forms.filter((p) => /room:|deviceRoom\(|deviceLabel:/.test(code(p))));
ck("the hook names a device nobody typed a name for (a guest's report from a panel) by its label on screen",
   /deviceText \?\? \(entityId \? label\(entityId\) : undefined\)/.test(code("components/fm/useRecordPlace.ts")));

done("✅ one builder of a record's place, three forms");
