// The devices asleep by design (AppConfig.unavailableByDesign, owner 2026-10-21): a battery sensor that sleeps between
// reports — a Wi-Fi door contact goes "unavailable" three minutes after each report — shows its last report, never
// "unavailable", through ONE place: the entity store (ha/unavailableByDesign), which every screen reads. Driven against
// a fake socket playing the villa's system and a fake history, by value; then the screens' own reading of "offline"
// (villaDevices.unavailable: the live cards, the counts, the badges) is asked of what the store holds.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, childTags } from "../consistency/jsx.mjs";

const noop = () => {};
globalThis.window = { addEventListener: noop, removeEventListener: noop, location: { protocol: "http:", host: "localhost", origin: "http://localhost", pathname: "/" },
  innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop, querySelector: () => null };
globalThis.screen = { width: 1024, height: 768 };
Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: () => true, onLine: true }, configurable: true });
globalThis.fetch = async () => ({ status: 200 });

const DOOR = "binary_sensor.back_door", OTHER = "binary_sensor.shed_door", LIGHT = "light.a";
const ha = {
  states: [
    { entity_id: DOOR, state: "unavailable", last_changed: "T9", last_updated: "T9", attributes: { device_class: "door" } },
    { entity_id: OTHER, state: "unavailable", last_changed: "T9", last_updated: "T9", attributes: {} },
    { entity_id: LIGHT, state: "on", last_changed: "T1", last_updated: "T1", attributes: {} },
  ],
};
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static last = null;
  constructor(url) {
    this.url = url; this.readyState = 0; this.subs = new Map(); FakeSocket.last = this;
    setTimeout(() => { this.readyState = 1; this.onopen?.({}); this.emit({ type: "auth_required" }); }, 0);
  }
  emit(msg) { this.onmessage?.({ data: JSON.stringify(msg), target: this }); }
  event(eventType, data) {
    for (const [id, t] of this.subs) if (t === eventType) this.emit({ id, type: "event", event: { event_type: eventType, data } });
  }
  send(raw) {
    const m = JSON.parse(raw);
    const reply = (result) => setTimeout(() => this.emit({ id: m.id, type: "result", success: true, result }), 0);
    if (m.type === "auth") return setTimeout(() => this.emit({ type: "auth_ok" }), 0);
    if (m.type === "subscribe_events") { this.subs.set(m.id, m.event_type); return reply(null); }
    if (m.type === "get_states") return reply(ha.states);
    if (m.type?.startsWith("config/") && m.type.endsWith("/list")) return reply([]);
    if (m.id !== undefined && m.type !== "pong") reply(null);
  }
  close() { this.readyState = 3; }
}
globalThis.WebSocket = FakeSocket;

const { EntityStore } = await import("@/ha/entityStore");
const { HAWebSocket } = await import("@/ha/HAWebSocket");
const { villaDevices } = await import("@/config/deviceGroups");
const { contactOf } = await import("@/utils/stateColors");
const until = async (pred, ms = 3000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 5)); return pred(); };

// the villa's history: the door last reported "off" at T0, then dropped off; the shed door has nothing kept
const asked = [];
const history = async (ids) => {
  asked.push(ids.join());
  return { [DOOR]: [{ entity_id: DOOR, state: "off", last_changed: "T0" }, { state: "unavailable", last_changed: "T0b" }] };
};
const store = new EntityStore(new HAWebSocket(), { pushWindowMs: 5, registryDebounceMs: 5, history });
store.attach();
const heard = [];
store.subscribeAll((e) => heard.push(`${e.entity_id}=${e.state}`));
await store.connect();
await until(() => store.getState().entities[DOOR]);
const shown = (id) => store.snapshot()[id];

ck("before the list is given (before sign-in): the villa's own state, and no history read",
   shown(DOOR).state === "unavailable" && asked.length === 0, { state: shown(DOOR).state, asked });

const listedAt = heard.length;
store.setUnavailableByDesign(new Set([DOOR, OTHER]));
await until(() => shown(DOOR).state === "off");
ck("listed while \"unavailable\": its last report, read from the villa's history, with WHEN it last reported",
   shown(DOOR).state === "off" && shown(DOOR).last_changed === "T0" && shown(DOOR).attributes.device_class === "door",
   shown(DOOR));
ck("  ...one history read for the listed devices, once", asked.length === 1 && asked[0].split(",").sort().join() === [DOOR, OTHER].sort().join(), asked);
ck("  ...nothing kept: \"unknown\" (it reports, no value yet) — never lost, never a guessed state", shown(OTHER).state === "unknown");
ck("  ...the 3D map was told too", heard.includes(`${DOOR}=off`), heard);
ck("  ...a device not listed is untouched", shown(LIGHT).state === "on");

FakeSocket.last.event("state_changed", { entity_id: DOOR, new_state: { entity_id: DOOR, state: "on", last_changed: "T5", last_updated: "T5", attributes: {} } });
FakeSocket.last.event("state_changed", { entity_id: DOOR, new_state: { entity_id: DOOR, state: "unavailable", last_changed: "T6", last_updated: "T6", attributes: {} } });
await until(() => store.getState().entities[DOOR]?.last_changed === "T5");
ck("a live report, then asleep again: it keeps showing that report (open, since T5)",
   shown(DOOR).state === "on" && shown(DOOR).last_changed === "T5" && store.getState().entities[DOOR].state === "on", shown(DOOR));
ck("  ...once listed, the map heard the report and never \"unavailable\"",
   heard.at(-1) === `${DOOR}=on` && !heard.slice(listedAt).includes(`${DOOR}=unavailable`), heard.slice(listedAt));

// every screen's "offline" is asked of what the store holds: the live cards, the counts, the badges, the critical list
const map = Object.fromEntries([DOOR, LIGHT].map((id) => [id, { entityId: id, type: "sensor", label: id }]));
const devices = (entities) => villaDevices({ entityMap: map, deviceGroups: [], dismissed: new Set(), hidden: new Set(),
  mappedEntityIds: new Set(), entities, entityDeviceIds: {} });
ck("so no screen calls it offline: not in the villa's unavailable devices, contact not lost",
   devices(store.getState().entities).unavailable.length === 0 && contactOf(shown(DOOR).state) === "ok");

store.setUnavailableByDesign(new Set());
await until(() => shown(DOOR).state === "unavailable");
ck("taken off the list: the villa's own state again, and an offline device again",
   shown(DOOR).state === "unavailable" && devices(store.snapshot()).unavailable.join() === DOOR, shown(DOOR));

// a history that cannot be read: "unknown", never a crash
const failing = new EntityStore(new HAWebSocket(), { pushWindowMs: 5, history: async () => { throw new Error("no"); } });
failing.attach();
await failing.connect();
await until(() => failing.getState().entities[DOOR]);
failing.setUnavailableByDesign(new Set([DOOR]));
await until(() => failing.snapshot()[DOOR].state === "unknown");
ck("a history that cannot be read: \"unknown\" until it next reports", failing.snapshot()[DOOR].state === "unknown");

// the list known before the villa's states arrive (a reconnect, or the setting read first): the read that brings them
// recalls the last report too
const early = new EntityStore(new HAWebSocket(), { pushWindowMs: 5, history });
early.attach();
early.setUnavailableByDesign(new Set([DOOR]));
await early.connect();
await until(() => early.snapshot()[DOOR]?.state === "off");
ck("listed before the states arrive: their read recalls the last report as well", early.snapshot()[DOOR]?.state === "off",
   early.snapshot()[DOOR]);
early.dispose();

// ONE DEPTH (2.496.499): the pill and the chart read back as far as the villa keeps (historySource.readBackFrom). The
// store's recall read a fixed 10 days, the chart further: a contact whose last report was 10.5 days old (the villa
// keeping about 10.9) read "Unknown" on its pill and "Closed" on its week's chart. Here the villa's recorder is played
// by the one REST read both make (HAHistoryAPI.recordedStates), keeping nothing older than `keptAt`; the store and the
// chart run with their own defaults.
{
  const t = Date.now(), DAY = 86400e3, keptAt = t - 10.85 * DAY;
  const recorded = {
    "sun.sun": [{ t: keptAt, state: "above_horizon" }, { t: t - DAY, state: "below_horizon" }],
    [DOOR]: [{ t: t - 10.5 * DAY, state: "off" }, { t: t - 10.5 * DAY + 180e3, state: "unavailable" }],
  };
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), "http://localhost");
    const from = Date.parse(decodeURIComponent(u.pathname.split("/history/period/")[1]));
    const to = Date.parse(u.searchParams.get("end_time"));
    asked.push({ id: u.searchParams.get("filter_entity_id"), from });
    const out = u.searchParams.get("filter_entity_id").split(",").map((id) => {
      const pts = (recorded[id] ?? []).filter((p) => p.t >= keptAt);
      const lead = pts.filter((p) => p.t < from).pop();
      const rows = [...(lead ? [{ ...lead, t: from }] : []), ...pts.filter((p) => p.t >= from && p.t <= to)];
      return rows.map((p, i) => ({ ...(i === 0 ? { entity_id: id } : {}), state: p.state, last_changed: new Date(p.t).toISOString() }));
    }).filter((rows) => rows.length);
    return { ok: true, status: 200, json: async () => out };
  };
  const villa = new EntityStore(new HAWebSocket(), { pushWindowMs: 5 });
  villa.attach();
  await villa.connect();
  await until(() => villa.getState().entities[DOOR]);
  villa.setUnavailableByDesign(new Set([DOOR]));
  await until(() => villa.snapshot()[DOOR].state === "off", 1000);
  const pill = villa.snapshot()[DOOR].state;
  const { haHistoryPort } = await import("@/ha/HAHistoryAPI");
  const { loadOne } = await import("@/ha/historySource");
  const week = await loadOne(haHistoryPort({}, new Set([DOOR])), { kind: "stateWindow", id: DOOR, hours: 168 }, t);
  ck("a contact last heard 10.5 days ago, the villa keeping 10.9: its pill shows that report (it read \"Unknown\")", pill === "off", pill);
  ck("  ...and its week's chart the same one", week.data[0]?.state === pill && week.data.length === 1, week.data);
  villa.dispose();
  ck("  ...both read back to where the villa's detail begins (the probe's oldest change kept), the one depth",
     asked.some((a) => a.id === "sun.sun") && asked.filter((a) => a.id === DOOR).every((a) => a.from >= keptAt - 1), asked);
}

// the list: shared, empty by default (nothing villa-specific ships), and handed to the store from inside the gate
const A = await import("@/config/AppConfig");
const D = await import("@/config/deviceConfig");
const never = D.baselineFromServer({}).unavailableByDesign;
ck("the list is a shared setting, empty by default — on this device and when the villa never stored one",
   D.SHARED_CONFIG_KEYS.includes("unavailableByDesign") && Array.isArray(A.DEFAULT_CONFIG.unavailableByDesign)
   && A.DEFAULT_CONFIG.unavailableByDesign.length === 0 && Array.isArray(never) && never.length === 0, never);
const [gate] = elements(parseTsx("App.tsx"), "ProfileGate");
ck("  ...handed to the store from inside the sign-in gate (the history read needs the session)",
   !!gate && childTags(gate).includes("UnavailableByDesignSync"));
const { withDevice } = await import("@/components/settings/UnavailableByDesign");
ck("  ...picked in Advanced Settings: added once, removed",
   withDevice(["a.b"], "a.b", true).join() === "a.b" && withDevice(["a.b"], "c.d", true).join() === "a.b,c.d"
   && withDevice(["a.b", "c.d"], "a.b", false).join() === "c.d");

// its charts: asleep is no change — the history a panel draws holds the state through each sleep (one read: the REST
// history the charts and the store share, HAHistoryAPI.recordedStates)
const recordedRows = [{ entity_id: DOOR, state: "unavailable", last_changed: "2026-10-20T00:00:00Z" },
  { state: "off", last_changed: "2026-10-20T01:00:00Z" }, { state: "unavailable", last_changed: "2026-10-20T01:03:00Z" },
  { state: "on", last_changed: "2026-10-20T02:00:00Z" }];
// what came before the window: the report it holds ("on" the day before, then asleep)
const FROM = Date.parse("2026-10-20T00:00:00Z"), TO = FROM + 24 * 3600e3;
let beforeRows = [{ entity_id: DOOR, state: "unavailable", last_changed: "2026-10-11T00:00:00Z" },
  { state: "on", last_changed: "2026-10-19T14:57:00Z" }, { state: "unavailable", last_changed: "2026-10-19T15:01:00Z" }];
let windowRows = recordedRows;
const urls = [];
globalThis.fetch = async (url) => {
  urls.push(String(url));
  const before = String(url).includes(`end_time=${encodeURIComponent(new Date(FROM).toISOString())}`);
  return { ok: true, status: 200, json: async () => [before ? beforeRows : windowRows] };
};
const { haHistoryPort } = await import("@/ha/HAHistoryAPI");
const { loadOne } = await import("@/ha/historySource");
const asleepPort = haHistoryPort({}, new Set([DOOR]));
const asleepChart = await asleepPort.stateRows(DOOR, FROM, TO);
const plainChart = await haHistoryPort({}, new Set()).stateRows(DOOR, FROM, TO);
ck("a chart of a device asleep by design: its sleep is no change (on as it opened, off, then on — no outage drawn)",
   asleepChart.map((r) => r.state).join() === "on,off,on" && Date.parse(asleepChart[0].last_changed) === FROM
   && plainChart.map((r) => r.state).join() === "unavailable,off,unavailable,on",
   { asleepChart, plainChart });
// the owner's lock (2026-10-22): its door contact asleep the whole window, since a report the day before
windowRows = [{ entity_id: DOOR, state: "unavailable", last_changed: new Date(FROM).toISOString() }];
const sleptThrough = await loadOne(asleepPort, { kind: "stateWindow", id: DOOR, hours: 24 }, TO);
ck("  ...asleep the whole window: it holds the last report over the SAME window as the device above it, never moved back",
   sleptThrough.lastSeen === undefined && sleptThrough.data.map((p) => p.state).join() === "on" && sleptThrough.data[0].t === FROM,
   sleptThrough);
beforeRows = [{ entity_id: DOOR, state: "unavailable", last_changed: "2026-10-11T00:00:00Z" }];
windowRows = recordedRows;
ck("  ...no report before it: the band starts at its first report",
   (await asleepPort.stateRows(DOOR, FROM, TO)).map((r) => r.state).join() === "off,on");
const hook = parseTsx("hooks/useHistorySource.ts");
ck("  ...with the store's own list, not a copy",
   /haHistoryPort\(ws, unavailableByDesign\)/.test(hook.getText()) && /\{ ws, unavailableByDesign \} = useHA\(\)/.test(hook.getText()));
ck("  ...and the store's list is the one it applies", store.getState().unavailableByDesign.size === 0
   && (store.setUnavailableByDesign(new Set([DOOR])), store.getState().unavailableByDesign.has(DOOR)));

store.dispose(); failing.dispose();
done("✅ a device asleep by design shows its last report, through the one store every screen reads");
