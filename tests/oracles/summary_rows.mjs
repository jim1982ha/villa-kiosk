// Which rows a device list shows (config/summaryRows, 2.496.276) — by value.
// It was the body of SummaryGroupPanel.tsx, pinned by one regex.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { summaryRows, bucketByRoom, byRoomOrder } = await import("@/config/summaryRows");
const { NO_ROOM_LABEL } = await import("@/config/roomKey");

const E = (id, state = "on") => ({ entity_id: id, state, attributes: {} });
const entities = { "light.a": E("light.a"), "light.b": E("light.b", "off"), "sensor.c": E("sensor.c", "21"), "switch.hidden": E("switch.hidden") };
const ids = ["light.a", "light.b", "sensor.c", "light.gone", "switch.hidden"];
const base = { entities, mapped: new Set(["light.a", "light.gone"]), suppressed: new Set(["switch.hidden"]), filterSuppressed: true, mayListUnmapped: true };
const r = summaryRows(ids, base);
const names = (xs) => xs.map((e) => e.entity_id).join();
ck("three buckets: on the map, in HA only, on the map but not in HA", names(r.onMap) === "light.a" && names(r.offMap) === "light.b,sensor.c" && names(r.notInHa) === "light.gone");
ck("  ...drawn in that order", names(r.rows) === "light.a,light.b,sensor.c,light.gone");
ck("a device HA no longer has is a row (unavailable), never dropped", r.notInHa[0].state === "unavailable");
ck("the list agrees with the count that opened it (bar what is hidden on purpose)", r.rows.length === ids.length - 1);
ck("a guest (may not list unmapped devices) sees no off-map row — but still the not-in-HA one",
   summaryRows(ids, { ...base, mayListUnmapped: false }).offMap.length === 0 && summaryRows(ids, { ...base, mayListUnmapped: false }).notInHa.length === 1);
ck("a health list keeps what HA hides or files as diagnostic", names(summaryRows(ids, { ...base, filterSuppressed: false }).offMap).includes("switch.hidden"));
ck("Turn all on/off addresses real toggleable entities only (no phantom, no sensor)", names(r.toggleables) === "light.a,light.b");

const rooms = { "light.a": "Kitchen", "light.b": "", "sensor.c": "Bath " };
const b = bucketByRoom(r.rows, (e) => e.entity_id, (id) => rooms[id] ?? "");
ck("by room, alphabetical, the no-room bucket last", b.map(([k]) => k).join() === `Bath,Kitchen,${NO_ROOM_LABEL}`, b.map(([k]) => k));
ck("one order for every by-room list — \"Other\" last even after a room alphabetically past it", [NO_ROOM_LABEL, "Pool", "Zebra house", "Bar"].sort(byRoomOrder).join() === `Bar,Pool,Zebra house,${NO_ROOM_LABEL}`);
done("✅ a device list's rows are config/summaryRows'");
