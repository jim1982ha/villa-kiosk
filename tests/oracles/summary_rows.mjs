// Which rows a device list shows (config/summaryRows, 2.496.276) — by value.
// It was the body of SummaryGroupPanel.tsx, pinned by one regex.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { summaryRows, bucketByRoom, bucketByFloor, listSections, offersGrouping, byRoomOrder } = await import("@/config/summaryRows");
import { elements, guardsOf, parseTsx, propText } from "../consistency/jsx.mjs";
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
// owner, 2026-10-20: every device list splits Per Room (when it opens) or Per Floor — the Cockpit's Room / Floor /
// Category tiles moved here — each heading with its own "Turn all on/off"
{
  const rooms = [["Bath", [1]], ["Kitchen", [2]], ["Pool", [3]], [NO_ROOM_LABEL, [4]]];
  const fl = { Bath: 2, Kitchen: 1, Pool: 1 };
  const f = bucketByFloor(rooms, (r) => fl[r] ?? null);
  ck("by floor, ascending, the no-floor rooms last", f.map(([k]) => String(k)).join() === "1,2,null", f.map(([k]) => k));
  ck("  ...each floor keeps its rooms in by-room order", f[0][1].map(([r]) => r).join() === "Kitchen,Pool");
  const roomOf = { a: "Pool", b: "Kitchen", c: "Bath", d: "", e: "Kitchen" };
  const ids = Object.keys(roomOf);
  const sec = (g) => listSections(ids, (id) => id, (id) => roomOf[id], (r) => fl[r] ?? null, g);
  ck("Per Room: one heading per room, by-room order, each with its devices",
     JSON.stringify(sec("room").map((x) => [x.title, x.items])) === JSON.stringify([["Bath", ["c"]], ["Kitchen", ["b", "e"]], ["Pool", ["a"]], [NO_ROOM_LABEL, ["d"]]]), sec("room"));
  ck("Per Floor: one heading per floor (\"1F\", \"2F\", the no-floor ones last), its devices in their rooms' order",
     JSON.stringify(sec("floor").map((x) => [x.title, x.items])) === JSON.stringify([["1F", ["b", "e", "a"]], ["2F", ["c"]], [NO_ROOM_LABEL, ["d"]]]), sec("floor"));
  ck("  ...every device once, whichever split", ["room", "floor"].every((g) => sec(g).flatMap((x) => x.items).sort().join() === "a,b,c,d,e"));
  ck("the split is offered only for a list spanning rooms (a room's own list has one heading either way)",
     offersGrouping(ids, (id) => id, (id) => roomOf[id]) && !offersGrouping(["b", "e"], (id) => id, (id) => roomOf[id]));
  const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
  const panel = read("components/panels/SummaryGroupPanel.tsx");
  const toggles = elements(parseTsx("components/panels/SummaryGroupPanel.tsx"), "BulkToggle").map((el) => propText(el, "devices"));
  ck("ONE 'Turn all on/off' control, for the header and each heading (BulkToggle)",
     elements(parseTsx("components/panels/SummaryGroupPanel.tsx"), "button").filter((el) => propText(el, "title") === "words").length === 1
     && toggles.length === 2 && toggles.includes("toggleables") && toggles.includes("toggleables.filter((e) => inSection.has(e.entity_id))"), toggles);
  ck("  ...shown over any heading with ONE device a row switches (owner, 2026-10-20: a lone switch, four locks), never zero",
     /if \(devices\.length === 0\) return null;/.test(panel) && !/devices\.length < 2/.test(panel)
     && /bulkSwitchPlan\(devices\.map\(\(e\) => e\.entity_id\), !anyOn, ROW_SWITCH_DOMAINS\)/.test(panel));
  ck("  ...a floor is the villa's one answer (devicePlace, through useRoomFloors), not a second rule", /useRoomFloors\(\)/.test(panel) && /floorOfRoom\(roomFloors, room\)/.test(panel));
  const seg = elements(parseTsx("components/panels/SummaryGroupPanel.tsx"), "SegmentedGroup");
  ck("  ...the window opens Per Room, and offers the toggle when the list asks for it",
     /useState<Grouping>\("room"\)/.test(panel) && /const splits = offersGrouping\(rows,/.test(panel)
     && seg.length === 1 && propText(seg[0], "active") === "grouping" && guardsOf(seg[0]).join() === "splits");
  const openers = ["pages/Dashboard.tsx", "components/hud/SummaryBar.tsx", "components/fm/FacilitySections.tsx", "components/hud/HUD.tsx"]
    .flatMap((f) => elements(parseTsx(f), "SummaryGroupPanel").map((el) => [f, propText(el, "grouping")]));
  ck("  ...the same from every opener: none passes a grouping", openers.length > 0 && openers.every(([, g]) => g === null), openers);
  const overview = parseTsx("components/cockpit/IssueCard.tsx");
  ck("the Cockpit has no Room / Floor / Category tiles and no Recent activity any more",
     ["SummaryGroupPanel", "SegmentedGroup"].every((t) => elements(overview, t).length === 0)
     // its one folded list is the watched faults' (owner, 2026-10-25), never a Recent activity again
     && elements(overview, "FoldedList").every((e) => propText(e, "rows") === "watched")
     && !/^import .*(logbook|Logbook|cockpitData)/m.test(read("components/cockpit/IssueCard.tsx")));
}

done("✅ a device list's rows are config/summaryRows'");
