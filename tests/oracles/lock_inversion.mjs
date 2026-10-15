// A lock mounted upside down (owner, 2026-10-15): marked inverted in Advanced Settings, it is read and moved the right
// way round EVERYWHERE — because it is done once, at the app's one connection to the villa's system (ha/stateLens.ts in
// HAWebSocket and HAHistoryAPI). Driven here through the real socket and store against a fake villa system: what the
// store holds and tells the map, what it sends for Lock / Unlock, the history and logbook rows, a settings change, and
// the Overview's Live card that must disappear on its own.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const noop = () => {};
globalThis.window = { addEventListener: noop, removeEventListener: noop, location: { protocol: "http:", host: "localhost", origin: "http://localhost", pathname: "/" },
  innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop, querySelector: () => null };
globalThis.screen = { width: 1024, height: 768 };
Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: () => true, onLine: true }, configurable: true });

// The villa's system as it REPORTS: the two Aqara-like locks say "unlocked" while physically locked; the front door is
// mounted the right way.
const ha = {
  states: [
    { entity_id: "lock.laundry", state: "unlocked", last_updated: "t1", attributes: {} },
    { entity_id: "lock.bedroom", state: "unlocked", last_updated: "t1", attributes: {} },
    { entity_id: "lock.front", state: "unlocked", last_updated: "t1", attributes: {} },
  ],
  logbook: [{ when: 1, entity_id: "lock.laundry", state: "locked" }, { when: 2, entity_id: "lock.front", state: "locked" }],
};
const sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor() {
    this.readyState = 0; this.sent = []; this.subs = new Map(); sockets.push(this);
    setTimeout(() => { this.readyState = 1; this.onopen?.({}); this.emit({ type: "auth_required" }); }, 0);
  }
  emit(msg) { this.onmessage?.({ data: JSON.stringify(msg), target: this }); }
  event(eventType, data) {
    for (const [id, t] of this.subs) if (t === eventType) this.emit({ id, type: "event", event: { event_type: eventType, data } });
  }
  send(raw) {
    const m = JSON.parse(raw); this.sent.push(m);
    const reply = (result) => setTimeout(() => this.emit({ id: m.id, type: "result", success: true, result }), 0);
    if (m.type === "auth") return setTimeout(() => this.emit({ type: "auth_ok" }), 0);
    if (m.type === "subscribe_events") { this.subs.set(m.id, m.event_type); return reply(null); }
    if (m.type === "get_states") return reply(ha.states);
    if (m.type === "logbook/get_events") return reply(ha.logbook);
    if (m.type === "get_config") return reply({ location_name: "x", latitude: 0, longitude: 0 });
    if (m.type?.startsWith("config/")) return reply([]);
    if (m.id !== undefined && m.type !== "pong") reply(null);
  }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: "", wasClean: true }); }
}
globalThis.WebSocket = FakeSocket;

const L = await import("@/ha/stateLens");
const { EntityStore } = await import("@/ha/entityStore");
const { HAWebSocket } = await import("@/ha/HAWebSocket");
const { haHistoryPort } = await import("@/ha/HAHistoryAPI");
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
const until = async (pred, ms = 5000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); return pred(); };

console.log("  the lens the settings ask for:");
const entityMap = {
  "lock.laundry": { entityId: "lock.laundry", type: "lock", label: "", invertLock: true },
  "lock.bedroom": { entityId: "lock.bedroom", type: "lock", label: "", invertLock: true },
  "lock.front": { entityId: "lock.front", type: "lock", label: "" },
  "switch.gate": { entityId: "switch.gate", type: "switch", label: "", invertLock: true },   // not a lock: ignored
};
const lens = L.lensFrom(entityMap);
ck("every lock marked inverted, and only lock entities", [...lens.invertedLocks].sort().join() === "lock.bedroom,lock.laundry");
ck("  ...the same marks are the same lens; none is NO_LENS",
   L.sameLens(lens, L.lensFrom({ ...entityMap })) && L.lensFrom({}) === L.NO_LENS && !L.sameLens(lens, L.NO_LENS));
ck("locked ⇄ unlocked and locking ⇄ unlocking; jammed, open and unavailable mean the same either way",
   ["locked", "unlocked", "locking", "unlocking", "jammed", "open", "unavailable"].map((s) => L.viewState(lens, "lock.laundry", s)).join()
   === "unlocked,locked,unlocking,locking,jammed,open,unavailable"
   && L.viewState(lens, "lock.front", "locked") === "locked");
const split = L.viewServiceCall(lens, { domain: "lock", service: "lock", data: {}, target: { entity_id: ["lock.front", "lock.laundry"] } });
ck("a Lock naming an inverted and a plain lock: split, each moved the way the press meant",
   JSON.stringify(split.map((c) => [c.service, c.target.entity_id])) === JSON.stringify([["lock", "lock.front"], ["unlock", "lock.laundry"]]));
ck("  ...anything but lock/unlock goes as it is (lock.open unlatches: no opposite)",
   L.viewServiceCall(lens, { domain: "lock", service: "open", data: {}, target: { entity_id: "lock.laundry" } })[0].service === "open"
   && L.viewServiceCall(lens, { domain: "switch", service: "turn_on", data: {}, target: { entity_id: "lock.laundry" } })[0].service === "turn_on");

console.log("\n  through the real connection and store:");
const store = new EntityStore(new HAWebSocket(), { pushWindowMs: 50, registryDebounceMs: 60 });
store.setLens(lens);                     // set before the first read (HAStateStore does it at creation)
store.attach();
const told = [];
store.subscribeAll((e) => told.push(`${e.entity_id}=${e.state}`));
await store.connect();
await until(() => store.getState().entities["lock.laundry"]);
const now = () => Object.fromEntries(Object.entries(store.snapshot()).map(([id, e]) => [id, e.state]));
ck("the first read: the inverted locks are LOCKED, the plain one as reported",
   JSON.stringify(now()) === JSON.stringify({ "lock.laundry": "locked", "lock.bedroom": "locked", "lock.front": "unlocked" }), now());
ck("  ...and the map was told the same", told.includes("lock.laundry=locked") && !told.includes("lock.laundry=unlocked"), told);
const sock = sockets.at(-1);
told.length = 0;
sock.event("state_changed", { entity_id: "lock.laundry", new_state: { entity_id: "lock.laundry", state: "locked", last_updated: "t2", attributes: {} },
  old_state: { entity_id: "lock.laundry", state: "unlocked", last_updated: "t1", attributes: {} } });
await until(() => store.getState().entities["lock.laundry"]?.state === "unlocked", 1000);
ck("a live change (it reports locked = physically unlocked): unlocked for the map at once and every screen",
   told.at(-1) === "lock.laundry=unlocked" && store.getState().entities["lock.laundry"].state === "unlocked", [told, now()]);

const before = sock.sent.length;
await store.callService("lock", "lock", {}, { entity_id: "lock.laundry" });
await store.callService("lock", "unlock", {}, { entity_id: "lock.front" });
const calls = sock.sent.slice(before).filter((m) => m.type === "call_service").map((m) => `${m.service} ${m.target.entity_id}`);
ck("Lock pressed on the inverted lock goes out as unlock (it then reports unlocked = locked); the plain one as pressed",
   calls.join() === "unlock lock.laundry,unlock lock.front", calls);

const rows = await store.ws.getLogbookEvents("2026-10-15T00:00:00Z");
ck("the logbook: the inverted lock's row reads unlocked, the plain one as reported",
   rows.map((r) => `${r.entity_id}=${r.state}`).join() === "lock.laundry=unlocked,lock.front=locked", rows);

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [[{ state: "unlocked", last_changed: "a" }, { state: "locked", last_changed: "b" }, { state: null, last_changed: "c" }]] });
const hist = await haHistoryPort(store.ws).stateRows("lock.laundry", 0, 3_600_000);
const plain = await haHistoryPort(store.ws).stateRows("lock.front", 0, 3_600_000);
ck("its history: every row the right way round (a row with no state kept); the plain lock's as reported",
   hist.map((r) => r.state).join() === "locked,unlocked," && plain.map((r) => r.state).join() === "unlocked,locked,", [hist, plain]);

console.log("\n  the Overview's Live card goes by itself:");
const look = (entities) => (id) => deviceLook(id, storeLookSource(entities, { entityMap, alertThresholds: {} })).alert;
ha.states = ha.states.map((s) => s.entity_id === "lock.laundry" ? { ...s, state: "unlocked", last_updated: "t3" } : s);
store.setLens(L.NO_LENS);                 // the switch turned off: every state read again, as reported
await until(() => store.getState().entities["lock.laundry"]?.state === "unlocked" && store.getState().entities["lock.bedroom"]?.state === "unlocked", 2000);
const off = store.getState().entities;
ck("without the switch: both locks read unlocked — red, each a Live card", look(off)("lock.laundry") && look(off)("lock.bedroom"));
told.length = 0;
store.setLens(lens);                      // switched on in Advanced Settings: read again through the lens, at once
await until(() => store.getState().entities["lock.bedroom"]?.state === "locked", 2000);
const on = store.getState().entities;
ck("switched on: both read LOCKED — no red badge, so no Live card (attention.ts lists every red badge)",
   on["lock.laundry"].state === "locked" && !look(on)("lock.laundry") && !look(on)("lock.bedroom") && look(on)("lock.front"), now());
ck("  ...the map repainted only the locks that moved", told.length === 2 && told.every((t) => /lock\.(laundry|bedroom)=locked/.test(t)), told);
const reads = sock.sent.filter((m) => m.type === "get_states").length;
store.setLens(L.lensFrom({ ...entityMap }));
await new Promise((r) => setTimeout(r, 100));
ck("a settings sync that changes nothing reads nothing again", sock.sent.filter((m) => m.type === "get_states").length === reads);

console.log("\n  the one seam:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the settings set the lens where the store is made, before its first read, and keep it in step (HAStateStore)",
   /storeRef\.current = new EntityStore\(\);\s*storeRef\.current\.setLens\(lens\);/.test(src("ha/HAStateStore.tsx"))
   && /useEffect\(\(\) => store\.setLens\(lens\), \[store, lens\]\)/.test(src("ha/HAStateStore.tsx")));
ck("Advanced Settings offers the switch on every lock entity (whatever its panel type)",
   /\{isLockEntity\(entityId\) && cell\("invert", "Invert Device State"/.test(src("components/settings/MappingFields.tsx")));
// the field's readers: its type, the lens, the switch, the scene's "cosmetic" list — no screen of its own
const { readdirSync, statSync } = await import("node:fs");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
const root = new URL("../../src", import.meta.url).pathname;
const readers = walk(root).filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(f, "utf8").includes("invertLock"))
  .map((f) => f.slice(root.length + 1)).sort();
ck("no screen inverts on its own: invertLock is read by the lens alone (and declared, offered, listed)",
   readers.join() === "babylon/entityMapDiff.ts,components/settings/MappingFields.tsx,ha/stateLens.ts,types/scene.types.ts", readers);

// the badge's invert pill (owner, 2026-10-15): wherever a lock's badge is drawn — the map's (both styles and a group's
// cells), the device panel's header, a group's list — it carries the flag, and the bake keeps it in its cache key
const badgeCalls = walk(root).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("badgeIcons.ts"))
  .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/badgeImage\(\{([\s\S]*?)\}\)/g)].map((m) => [f.slice(root.length + 1), m[1]]));
ck("every badge drawn passes `inverted` (map, panel header, group list)",
   badgeCalls.length >= 6 && badgeCalls.every(([, body]) => /inverted:/.test(body)), badgeCalls.filter(([, b]) => !/inverted:/.test(b)).map(([f]) => f));
const icons = src("babylon/badgeIcons.ts");
ck("  ...the pill is baked into the picture and its cache key, with lucide's ArrowDownUp",
   /:\$\{inverted\}`;/.test(icons) && /if \(inverted\) drawInvertPill\(ctx, m, size, surface\);/.test(icons)
   && /"arrow-down-up": \[/.test(src("babylon/badgeIconNodes.ts")));

store.dispose();
done("✅ an inverted lock reads and moves the right way round everywhere, from one seam");
