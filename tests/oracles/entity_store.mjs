// The live Home Assistant picture (src/ha/entityStore.ts), driven against a
// fake socket playing Home Assistant — by value.
//
// Until 2.496.226 this logic lived inside the React provider, and its rules
// were pinned by regexes on SOURCE ORDER (push_batch, registry_refresh,
// registry_resolve). Now the store is a plain module, and these checks read
// what it sends and what it holds.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const noop = () => {};
globalThis.window = { addEventListener: noop, removeEventListener: noop, location: { protocol: "http:", host: "localhost", origin: "http://localhost", pathname: "/" },
  innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop, querySelector: () => null };
globalThis.screen = { width: 1024, height: 768 };
Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: () => true, onLine: true }, configurable: true });
globalThis.fetch = async () => ({ status: 200 });

// What the fake Home Assistant holds; tests change it between steps.
const ha = {
  states: [
    { entity_id: "light.a", state: "off", last_updated: "t1", attributes: {} },
    { entity_id: "light.b", state: "on", last_updated: "t1", attributes: {} },
  ],
  entityRows: [{ entity_id: "light.a", area_id: "kitchen" }, { entity_id: "light.b", area_id: "patio" }],
  areas: [{ area_id: "kitchen", name: "Kitchen" }, { area_id: "patio", name: "Patio" }],
  areasFail: false,
  config: { location_name: "Test", latitude: 0, longitude: 0, currency: "EUR" },
};
const sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    this.url = url; this.readyState = 0; this.sent = []; this.subs = new Map();
    sockets.push(this);
    setTimeout(() => { this.readyState = 1; this.onopen?.({}); this.emit({ type: "auth_required" }); }, 0);
  }
  emit(msg) { this.onmessage?.({ data: JSON.stringify(msg), target: this }); }
  event(eventType, data) {
    for (const [id, t] of this.subs) if (t === eventType) this.emit({ id, type: "event", event: { event_type: eventType, data } });
  }
  send(raw) {
    const m = JSON.parse(raw); this.sent.push(m);
    const reply = (result, success = true) => setTimeout(() => this.emit({ id: m.id, type: "result", success, result, ...(success ? {} : { error: { message: "no" } }) }), 0);
    if (m.type === "auth") return setTimeout(() => this.emit({ type: "auth_ok" }), 0);
    if (m.type === "subscribe_events") { this.subs.set(m.id, m.event_type); return reply(null); }
    if (m.type === "get_states") return reply(ha.states);
    if (m.type === "get_config") return reply(ha.config);
    if (m.type === "config/entity_registry/list") return reply(ha.entityRows);
    if (m.type === "config/area_registry/list") return ha.areasFail ? reply(null, false) : reply(ha.areas);
    if (m.type === "config/device_registry/list" || m.type === "config/floor_registry/list") return reply([]);
    if (m.id !== undefined && m.type !== "pong") reply(null);
  }
  close(code = 1000) { this.serverClose(code); }
  serverClose(code) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason: "", wasClean: code === 1000 }); }
}
globalThis.WebSocket = FakeSocket;

const { EntityStore } = await import("@/ha/entityStore");
const { HAWebSocket } = await import("@/ha/HAWebSocket");
const until = async (pred, ms = 5000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); return pred(); };
const types = (s) => s.sent.map((m) => (m.type === "subscribe_events" ? `sub:${m.event_type}` : m.type));

const store = new EntityStore(new HAWebSocket(), { pushWindowMs: 3000, registryDebounceMs: 60 });
store.attach();
const pushed = [];
store.subscribeAll((e) => pushed.push(`${e.entity_id}=${e.state}`));
let changes = 0;
store.onChange(() => { changes++; });

console.log("  the first connect:");
await store.connect();
await until(() => Object.keys(store.getState().entityAreaNames).length === 2);
{
  const t = types(sockets[0]);
  ck("it subscribes to state changes BEFORE it reads the states (no change can fall between)",
     t.indexOf("sub:state_changed") >= 0 && t.indexOf("sub:state_changed") < t.indexOf("get_states"), t.join());
  ck("  ...and reads them ONCE (the first connect used to load them twice)", t.filter((x) => x === "get_states").length === 1, t.join());
  ck("  ...then the config and the registry", t.includes("get_config") && t.includes("config/entity_registry/list"));
  const s = store.getState();
  ck("it holds every state, the places, and Home Assistant's config",
     s.entities["light.a"]?.state === "off" && s.entityAreaNames["light.b"] === "Patio" && s.haConfig?.currency === "EUR" && s.connection === "connected");
  ck("the 3D map was handed every entity once", pushed.sort().join() === "light.a=off,light.b=on", pushed.join());
}

console.log("\n  a live change:");
{
  pushed.length = 0;
  const before = changes;
  sockets[0].event("state_changed", { entity_id: "light.a", new_state: { entity_id: "light.a", state: "on", last_updated: "t2", attributes: {} } });
  ck("the 3D map hears it AT ONCE", pushed.join() === "light.a=on", pushed.join());
  ck("  ...React does not yet (one batch per window)", store.getState().entities["light.a"].state === "off" && changes === before);
  ck("  ...but the snapshot is never behind the socket", store.snapshot()["light.a"].state === "on");
  await until(() => store.getState().entities["light.a"].state === "on");
  ck("  ...and after the window React has it, in one change", store.getState().entities["light.a"].state === "on" && changes === before + 1, changes - before);
}

console.log("\n  a reconnect:");
{
  // A change still in the batch when the link drops: the fresh read wins.
  // (The batch window is 3 s here, so it is still pending when the reconnect
  // reads the states — otherwise it drains first and the case never arises.)
  sockets[0].event("state_changed", { entity_id: "light.b", new_state: { entity_id: "light.b", state: "stale", last_updated: "t0", attributes: {} } });
  ha.states = [
    { entity_id: "light.a", state: "on", last_updated: "t2", attributes: {} },   // unchanged since
    { entity_id: "light.b", state: "off", last_updated: "t3", attributes: {} },  // moved while down
  ];
  ha.config = { ...ha.config, currency: "IDR" };
  pushed.length = 0;
  const t0 = Date.now();
  sockets[0].serverClose(1006);
  await until(() => sockets.length === 2 && store.getState().haConfig?.currency === "IDR");
  ck("(the reconnect landed while that change was still waiting)", Date.now() - t0 < 3000, Date.now() - t0);
  const t = types(sockets[1]);
  ck("the subscription is re-sent BEFORE the states are read again", t.indexOf("sub:state_changed") >= 0 && t.indexOf("sub:state_changed") < t.indexOf("get_states"), t.join());
  ck("  ...the states, the config AND the registry are all re-read (a reconnect used to re-read only the states)",
     t.filter((x) => x === "get_states").length === 1 && t.includes("get_config") && t.includes("config/entity_registry/list"), t.join());
  ck("only what CHANGED while down reaches the 3D map", pushed.join() === "light.b=off", pushed.join());
  ck("a full read supersedes a change still batched", store.snapshot()["light.b"].state === "off" && store.getState().entities["light.b"].state === "off");
}

console.log("\n  registry changes:");
{
  const lists = () => sockets[1].sent.filter((m) => m.type === "config/entity_registry/list").length;
  await until(() => lists() >= 1);
  const n0 = lists();
  for (let i = 0; i < 5; i++) sockets[1].event("area_registry_updated", {});
  await new Promise((r) => setTimeout(r, 200));
  ck("a burst of five registry events is ONE refetch", lists() === n0 + 1, lists() - n0);
  ha.areasFail = true;
  sockets[1].event("area_registry_updated", {});
  await until(() => lists() === n0 + 2);
  await new Promise((r) => setTimeout(r, 50));
  ck("an area registry that fails to load keeps the room names it had (it used to blank them all)",
     store.getState().entityAreaNames["light.a"] === "Kitchen");
}

console.log("\n  a refused command:");
{
  const s = sockets[1];
  const orig = s.send.bind(s);
  s.send = (raw) => { const m = JSON.parse(raw); if (m.type === "call_service") { s.sent.push(m); setTimeout(() => s.emit({ id: m.id, type: "result", success: false, error: { message: "refused" } }), 0); return; } orig(raw); };
  const outcome = await store.callService("light", "turn_on", {}, { entity_id: "light.a" });
  ck("resolves the outcome, and the toast's state hears it", outcome.ok === false && store.getState().serviceError?.message === "refused");
}

store.dispose();
done("✅ the entity store: subscribe first, one pass per connect, only changes pushed");
