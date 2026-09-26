// The summary tiles' groups are built from villaSummary's facts
// (config/summaryGroups, round 10, 2.496.157). locksGroup re-selected `lock.*`
// with an OPTIONAL villa scope and chose its icon by "all locked, else an open
// door" — an unreadable lock showed an OPEN DOOR beside the facts' "1 Unknown".
// And the AC tile appended "°C" whatever Home Assistant's unit system.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const G = await import("@/config/summaryGroups");
const V = await import("@/config/villaSummary");
const { DoorClosed, DoorOpen, Lock } = await import("lucide-react");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const e = (id, state) => ({ entity_id: id, state, attributes: {} });
const ents = (list) => Object.fromEntries(list.map((x) => [x.entity_id, x]));
const villa = { has: (id) => !id.includes("neighbour") };

const locks = (states) => { const es = ents(states.map((s, i) => e(`lock.l${i}`, s))); return [V.lockFacts(es, villa), es]; };
ck("every lock locked: a closed door", G.locksGroup(...locks(["locked", "locked"])).icon === DoorClosed);
ck("one unlocked: an open door", G.locksGroup(...locks(["locked", "unlocked"])).icon === DoorOpen);
ck("one that cannot be read and none unlocked: a plain lock — never an open door", G.locksGroup(...locks(["locked", "unavailable"])).icon === Lock);
ck("  ...an unlocked one still wins over an unreadable one", G.locksGroup(...locks(["unavailable", "unlocked"])).icon === DoorOpen);
const withNeighbour = ents([e("lock.a", "locked"), e("lock.neighbour", "unlocked"), e("light.a", "on"), e("light.neighbour", "on")]);
ck("the group is the facts' devices: the villa's own, nothing else (no optional scope left to forget)",
   G.locksGroup(V.lockFacts(withNeighbour, villa), withNeighbour).entityIds.join() === "lock.a"
   && G.lightsGroup(V.lightFacts(withNeighbour, villa)).entityIds.join() === "light.a");
ck("no locks, no group", G.locksGroup(V.lockFacts(ents([]), villa), {}) === null && G.lightsGroup(null) === null);
ck("the AC temperature in Home Assistant's unit: 24°C, 75°F, a bare degree when unknown",
   V.fmtClimateTemp(24, "°C") === "24°C" && V.fmtClimateTemp(75, "°F") === "75°F" && V.fmtClimateTemp(24) === "24°");

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const sb = src("components/hud/SummaryBar.tsx"), fm = src("components/fm/FacilityModal.tsx"), sg = src("config/summaryGroups.ts");
ck("the tile and the Facility shortcut build the groups from the facts", /locksGroup\(facts\.locks,/.test(sb) && /lightsGroup\(facts\.lights\)/.test(sb) && /locksGroup\(lockFacts\(entities, devices\)/.test(fm));
ck("summaryGroups selects no domain itself and imports no screen", !/startsWith\("lock\.|startsWith\("light\./.test(sg) && !/@\/components\//.test(sg));
ck("no assumed Celsius on the AC tile", !/°C`/.test(sb) && /fmtClimateTemp\(avg, tempUnit\)/.test(sb) && /haConfig\?\.unit_system\?\.temperature/.test(sb));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ a summary's icon and words come from the same facts");
