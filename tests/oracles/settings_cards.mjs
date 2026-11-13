// Settings and Advanced Settings show their records as the Cockpit's card (owner, 2026-11-06: "the same card in Settings
// and Advanced Settings"): a device group and a suggested one, a device asleep between reports, a device of Devices, one
// not on the map and a 3D object whose entity is gone, a full-screen announcement, a chat that gets the messages. Each
// is drawn here through its real section and read: its frame is RecordCard's, its name is in the strip, its action is
// in the bar; the rows and tables it replaced are gone. The telemetry stays a log list, its columns reordered (time,
// kind, device, words). Devices' title counts show its two lists, and each device's "3D object" field holds the
// objects that show it (owner, 2026-11-06: it replaced Villa's "Bound 3D objects" and the pencil on a device's id).
//
// The sections fold their content until tapped and keep their contexts private: a loader (below) opens the folds for
// the drawing and exports the contexts, as the screenshot harness does. Nothing else of the code is changed.
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { ck, done } from "../consistency/check.mjs";
const { h, draw, inside, text } = await import("../consistency/screen.mjs");

// Runs before the alias hook (registered last, asked first): its transpiled module, opened and with its context exported
const HOOK = `
const PATCH = {
  "/src/config/ConfigContext.tsx": [["", "export { ConfigContext as __Ctx };"]],
  "/src/ha/HAStateStore.tsx": [["", "export { HAStateContext as __Ctx };"]],
  "/src/components/settings/Fold.tsx": [["useState(false)", "useState(true)"]],
  "/src/components/settings/GroupedDevices.tsx": [['useState("groups")', 'useState(globalThis.__gview ?? "groups")'],
    ['const [search, setSearch] = useState("")', 'const [search, setSearch] = useState(globalThis.__q ?? "")']],
  "/src/components/settings/ConfigEditor.tsx": [['useState("on")', 'useState(globalThis.__view ?? "on")']],
  "/src/components/settings/UnavailableByDesign.tsx": [['const [search, setSearch] = useState("")', 'const [search, setSearch] = useState(globalThis.__q ?? "")']],
  "/src/components/common/SearchPicker.tsx": [["useState(!!startOpen)", "useState(!!startOpen || !!globalThis.__open)"]],
};
export async function load(url, context, next) {
  const r = await next(url, context);
  const key = Object.keys(PATCH).find((k) => url.endsWith(k));
  if (!key) return r;
  let src = String(r.source);
  for (const [a, b] of PATCH[key]) {
    if (!a) { src += "\\n" + b; continue; }
    if (!src.includes(a)) throw new Error("settings_cards: " + key + " no longer has " + a);
    src = src.replace(a, b);
  }
  return { ...r, source: src, shortCircuit: true };
}`;
register(`data:text/javascript,${encodeURIComponent(HOOK)}`);

globalThis.localStorage = globalThis.localStorage ?? (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();
// the model's objects: one bound by hand, one named after its device, one showing nothing, a wall
localStorage.setItem("villa-kiosk:mesh-catalog", JSON.stringify(["Lamp_Kitchen", "switch.example_pool_pump", "Mesh_Unnamed_042", "Wall_01"]));
const { __Ctx: ConfigCtx } = await import("@/config/ConfigContext");
const { __Ctx: HACtx } = await import("@/ha/HAStateStore");
const { VillaModelProvider } = await import("@/config/VillaModel");
const { DEFAULT_CONFIG } = await import("@/config/AppConfig");
const { PendingFields } = await import("@/hooks/usePendingField");
const { PendingEdits } = await import("@/config/pendingEdits");

const ent = (id, name, state = "on") => ({ entity_id: id, state, attributes: { friendly_name: name }, last_changed: "2026-11-05T09:00:00Z",
  last_updated: "2026-11-05T09:00:00Z", context: { id: "x" } });
const entities = Object.fromEntries([
  ent("input_text.vesta_owner_targets", "Owner targets", "notify.example_owner_chat"),
  ent("input_text.vesta_fm_targets", "FM targets", "notify.example_fm_group"),
  ent("notify.example_owner_chat", "Example Owner"), ent("notify.example_fm_group", "Example House FM group"),
  ent("sensor.example_kitchen_temperature", "Kitchen Temperature", "24"), ent("sensor.example_kitchen_humidity", "Kitchen Humidity", "60"),
  ent("switch.example_pool_pump", "Pool Pump"), ent("sensor.example_pool_pump_power", "Pool Pump Power", "600"),
  ent("light.example_terrace_lamp", "Terrace Lamp"), ent("binary_sensor.example_back_door", "Back Door", "off"),
  ent("fan.example_ceiling_fan", "Ceiling Fan"),
].map((e) => [e.entity_id, e]));
const map = (id, type) => ({ entityId: id, type });
const config = {
  ...DEFAULT_CONFIG,
  fullScreen: [{ title: "Front gate doorbell", seconds: 10 }],
  entityMap: { "sensor.example_kitchen_temperature": map("sensor.example_kitchen_temperature", "sensor"),
    "switch.example_pool_pump": map("switch.example_pool_pump", "switch"), "sensor.example_pool_pump_power": map("sensor.example_pool_pump_power", "sensor"),
    "light.example_terrace_lamp": map("light.example_terrace_lamp", "light") },
  meshBindings: { Lamp_Kitchen: "light.example_terrace_lamp" },
  deviceGroups: [{ id: "g1", primaryEntityId: "sensor.example_kitchen_temperature", memberEntityIds: ["sensor.example_kitchen_humidity"] }],
  unavailableByDesign: ["binary_sensor.example_back_door"],
};
const noop = () => {};
const cfg = { config, update: noop, editByDialog: noop, onDialogEdit: () => noop, mergeRemote: noop, onRemoteChange: () => noop,
  saveProblem: null, setSaveProblem: noop, resolvedRooms: { "switch.example_pool_pump": "Pool" }, setResolvedRooms: noop };
const ha = { entities, suppressedEntityIds: new Set(), hiddenInHaEntityIds: new Set(), unavailableByDesign: new Set(), entityAreaNames: {},
  entityFloorNumbers: {}, entityDeviceIds: { "sensor.example_kitchen_temperature": "d1", "sensor.example_kitchen_humidity": "d1",
    "switch.example_pool_pump": "d2", "sensor.example_pool_pump_power": "d2" }, deviceUnits: {},
  connection: "connected", haConfig: { location_name: "The Example House" }, lastError: null, serviceError: null,
  getEntitiesSnapshot: () => entities, connected: true, ws: null, subscribe: () => noop, subscribeAll: () => noop, callService: async () => ({ ok: true }),
  connect: async () => {}, setUnavailableByDesign: noop };
const rows = Object.entries(config.entityMap).map(([id, mapping]) => ({ id, mapping }));
const villa = { settings: { rows, stale: [], orphans: ["fan.example_gone_fan"] }, sceneEntityIds: new Set() };
const quiet = (f) => { const e = console.error; console.error = () => {}; try { return f(); } finally { console.error = e; } };
const drawIn = (el) => quiet(() => draw(h(ConfigCtx.Provider, { value: cfg }, h(HACtx.Provider, { value: ha },
  h(VillaModelProvider, { value: villa }, h(PendingFields, { pending: new PendingEdits(noop) }, el))))));

/** A segmented control's options: its words, and whether it is the one pressed (filled). */
const views = (html) => [...html.matchAll(/<button type="button" class="(active)?" aria-pressed="(true|false)">([^<]*)<\/button>/g)]
  .map((m) => [m[3], m[2] === "true" && m[1] === "active"]);
const unescape = (t) => t.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** A strip's remove: its icon and its words (its tooltip and aria-label are one `label`); null when it has none. */
const removeOf = (strip) => {
  const m = /<button type="button" class="icon-quiet fm-record-remove( danger)?" aria-label="([^"]*)"[^>]*><svg[^>]*lucide-([a-z0-9-]+)/.exec(strip);
  return m ? { glyph: m[3], label: unescape(m[2]), danger: !!m[1], last: strip.endsWith("</svg></button></div>") } : null;
};
/** Every card drawn: its frame's whole markup, its strip's name, its bar's words, its strip's remove. */
const cards = (html) => {
  const out = []; let at = 0;
  for (;;) {
    const i = html.indexOf('class="fm-record-card', at);
    if (i < 0) return out;
    const card = inside(html.slice(i - 12), "fm-record-card");
    out.push({ name: text(inside(card, "fm-record-name")).replace(/\|/g, ""), remove: removeOf(inside(card, "fm-record-strip")),
      bars: (card.match(/class="fm-record-actions"/g) ?? []).length, bar: text(inside(card, "fm-record-actions")).replace(/\[icon\]/g, "").replace(/\|/g, " ").trim(), card });
    at = i + card.length;
  }
};

const { default: GroupedDevices } = await import("@/components/settings/GroupedDevices");
const { default: UnavailableByDesign } = await import("@/components/settings/UnavailableByDesign");
const { default: ConfigEditor } = await import("@/components/settings/ConfigEditor");
const { FullScreenAnnouncements } = await import("@/components/settings/MessagesSettings");
const { default: WhoGetsMessages } = await import("@/components/settings/WhoGetsMessages");
const { ROLE_LABELS } = await import("@/auth/roles");
const DEVICES = "Auto-detected entity settings";
/** Devices, the list its title's count `view` shows ("on" the map, "off" it), `search` typed (as a panel's edit opens it). */
const devices = (view = "on", search) => { globalThis.__view = view; try { return drawIn(h(ConfigEditor, { title: DEVICES, tip: "What it does.", initialSearch: search })); } finally { globalThis.__view = undefined; } };

/** Grouped devices, the list its title's count `view` shows ("groups", "suggested"). */
const grouped = (view = "groups") => { globalThis.__gview = view; try { return drawIn(h(GroupedDevices, { title: "Grouped devices" })); } finally { globalThis.__gview = undefined; } };
// [kind, drawn, its name, its bar's words ("" no bar), its remove's tooltip at its strip's right, or none]
const KINDS = [
  ["a device group", grouped(), "Kitchen Temperature", "", "Delete the group Kitchen Temperature"],
  ["  ...a suggested group, its main action first", grouped("suggested"), "Pool Pump", "Create this group"],   // the device placed first (deviceFolding PLACED_ORDER), never the name that sorts first,
  ["a device asleep between reports", drawIn(h(UnavailableByDesign, { title: "Asleep between reports" })), "Back Door", "", "Take Back Door off Asleep between reports"],
  ["a device of Devices", devices(), "Pool Pump", "", "Remove Pool Pump's settings"],
  ["a device not on the map (Devices' second list)", devices("off"), "Ceiling Fan", ""],
  ["a 3D object whose entity is gone", devices(), "Example Gone Fan", "Point it there"],
  ["a full-screen announcement", drawIn(h(FullScreenAnnouncements, { value: config.fullScreen, onChange: noop })), "Front gate doorbell", "", "Delete the announcement Front gate doorbell"],
  ["a chat that gets the messages", drawIn(h(WhoGetsMessages, { languages: {}, onLanguages: noop })), "Example House FM group (notify.example_fm_group)", "", `Take Example House FM group off the ${ROLE_LABELS.ops}'s list`],
];
console.log("  every record of Settings is the Cockpit's card:");
for (const [kind, html, name, action, remove] of KINDS) {
  const card = cards(html).find((c) => c.name === name);
  // ⚠️ ONE REMOVE ICON (owner, 2026-11-06): the bin on every card, its tooltip its own words; it was an ✕ on a card
  // taking a thing off a list (a device off Asleep between reports, a chat off a role's list)
  const said = remove ? `its bin "${remove}" at its strip's right` : "no remove";
  ck(`${kind}: a card named "${name}" in its strip, ${action ? `"${action}" in its bar` : "no bar"}, ${said}`,
     !!card && card.bar === action && card.bars === (action ? 1 : 0)
     && (remove ? !!card.remove && card.remove.glyph === "trash-2" && card.remove.label === remove && card.remove.last && card.remove.danger
       : card.remove === null),
     cards(html).map(({ name, bar, bars, remove }) => ({ name, bar, bars, remove })));
}
// owner, 2026-11-06: a remove is an icon in the band, never a word in a bar; a bar holding nothing is not drawn
{
  const every = KINDS.flatMap(([, html]) => cards(html));
  const worded = every.filter((c) => /remove|unbind|take off|delete/i.test(c.bar));
  ck("  ...no removing word left in any Settings card's bar (Remove, Unbind, Take off the list, Delete)", worded.length === 0, worded.map((c) => [c.name, c.bar]));
  const empty = every.filter((c) => [...c.card.matchAll(/<div class="fm-record-actions"[^>]*>(?=<\/div>)/g)].length > 0 || (c.bars > 0 && c.bar === ""));
  ck("  ...and no empty bar", empty.length === 0, empty.map((c) => c.name));
}
// the screens these replaced: the entity table, the 3D objects' rows, the announcements' and chats' bordered lists
const all = KINDS.map(([, html]) => html).join("");
ck("  ...none of the rows and tables they were (a table, .binding-row, .settings-list, a bin in a corner)",
   !/<table|binding-row|settings-list"|settings-list-row|fs-row|recipients-chat/.test(all), all.match(/<table|binding-row|settings-list[\w-]*|fs-row|recipients-chat/g));
// every settings file that draws a record draws RecordCard, none a card of its own
{
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../src/components/settings/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => [f, readFileSync(new URL(f, dir), "utf8")]);
  const drawing = files.filter(([, t]) => /<RecordCard\b/.test(t)).map(([f]) => f).sort();
  // owner, 2026-11-06 (later): "make sure you really centralise the cards": a card standing for an entity is the one
  // EntityCard (its name, its id alone), a 3D object's too (bound to nothing or its entity gone); only what is no entity
  // (an announcement, a chat) draws RecordCard itself, and no Settings file gives a card a room or a line of its own
  ck("  ...the files drawing them, each through RecordCard: an entity's card only through EntityCard",
     JSON.stringify(drawing) === JSON.stringify(["EntityCard.tsx", "MessagesSettings.tsx", "WhoGetsMessages.tsx"]), drawing);
  const ownLine = files.filter(([f, t]) => f !== "EntityCard.tsx" && /<(RecordCard|EntityCard)\b[^>]*?\b(room|pills|device)=\{/.test(t.replace(/\n\s*/g, " "))).map(([f]) => f);
  ck("  ...no Settings card given a room or a first line of its own (EntityCard's, its id alone)", ownLine.length === 0, ownLine);
  ck("  ...and none frames a card of its own", files.every(([, t]) => !/className="fm-record-(card|strip|actions)/.test(t)), files.filter(([, t]) => /className="fm-record-(card|strip|actions)/.test(t)).map(([f]) => f));
}

console.log("\n  the remove icon (owner, 2026-11-06): a press is the button's, Settings' alone, the band's height kept:");
{
  // RecordCard's tree expanded (its plain parts called; the tooltip's child read), the remove found and pressed
  const { default: RecordCard } = await import("@/components/fm/RecordCard");
  const expand = (el) => {
    if (Array.isArray(el)) return el.flatMap(expand);
    if (!el || typeof el !== "object") return [];
    if (typeof el.type === "function") return expand(el.type.name === "Tip" ? el.props.children : el.type(el.props));
    return [el, ...expand(el.props?.children)];
  };
  const ran = [], opened = [];
  const tree = expand(h(RecordCard, { title: "Kitchen Temperature", onOpen: () => opened.push(1),
    remove: { label: "Delete the group Kitchen Temperature", run: () => ran.push(1) } }).type({ title: "Kitchen Temperature",
    onOpen: () => opened.push(1), remove: { label: "Delete the group Kitchen Temperature", run: () => ran.push(1) } }));
  const button = tree.find((e) => e.type === "button" && /fm-record-remove/.test(e.props.className ?? ""));
  const stopped = [];
  const ev = (k) => ({ stopPropagation: () => stopped.push(k) });
  button?.props.onPointerDown?.(ev("down"));
  button?.props.onClick?.(ev("click"));
  ck("pressing the remove runs it once, and neither its press nor its tap reaches the card (its open, its hold)",
     !!button && ran.length === 1 && opened.length === 0 && JSON.stringify(stopped) === JSON.stringify(["down", "click"]), [!!button, ran, stopped]);
  // the Cockpit's cards never pass it: the files giving RecordCard a `remove` are Settings' own
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = new URL(f, d); return statSync(p).isDirectory() ? walk(new URL(f + "/", d)) : f.endsWith(".tsx") ? [p] : []; });
  const giving = walk(new URL("../../src/", import.meta.url)).filter((u) => { const t = readFileSync(u, "utf8"); return /<(RecordCard|EntityCard)\b/.test(t) && /^\s*remove=\{/m.test(t); })
    .map((u) => u.pathname.split("/src/")[1]).sort();
  ck("  ...the files giving a card its remove are Settings' alone, never a Cockpit card",
     JSON.stringify(giving) === JSON.stringify(["components/settings/EntityMapRow.tsx", "components/settings/GroupedDevices.tsx",
       "components/settings/MessagesSettings.tsx", "components/settings/UnavailableByDesign.tsx", "components/settings/WhoGetsMessages.tsx"]), giving);
  // its glyph drawn into the strip's padding so the band keeps its height; its touch target 44px
  const facility = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
  const px = (re) => Number(re.exec(facility)?.[1]);
  const size = px(/\.fm-record-strip \.fm-record-remove \{ width: (\d+)px; height: \1px;/), lift = px(/\.fm-record-strip \.fm-record-remove \{[^}]*margin: -(\d+)px -\d+px -\1px auto;/);
  const line = px(/\.fm-record-strip, \.fm-record-part-head \{\s*--strip-line: (\d+)px;/), pad = px(/\.fm-record-strip \{ min-height: \d+px; padding: (\d+)px/);
  const reach = px(/\.fm-record-strip \.fm-record-remove::after \{ inset: -(\d+)px; \}/);
  ck("  ...a round icon no taller than the name's line in the strip (its overhang inside the strip's padding), a 44px touch target",
     size - 2 * lift <= line && lift <= pad && size + 2 * reach >= 44, { size, lift, line, pad, reach });
}

console.log("\n  one field per list (owner, 2026-11-06): it narrows the list and offers its devices:");
{
  // typed `q`, the field's list open (as a tap opens it): what the section draws
  const typed = (q, el) => { globalThis.__q = q; globalThis.__open = true; try { return drawIn(el); } finally { globalThis.__q = undefined; globalThis.__open = false; } };
  const field = (html) => inside(html, "search-or-add");
  const offers = (html) => [...field(html).matchAll(/<button class="row picker-option( strong)?">([\s\S]*?)<\/button>/g)]
    .map((m) => (m[1] ? "! " : "") + text(m[2]).replace(/^\||\|$/g, "").replace(/\|/g, " / "));
  const groups = (q) => typed(q, h(GroupedDevices, { title: "Grouped devices" }));
  const asleep = (q) => typed(q, h(UnavailableByDesign, { title: "Asleep between reports" }));
  const names = (html) => cards(html).map((c) => c.name);
  const SECTIONS = [
    ["Grouped devices", groups(""), "Search groups, or a device to group…"],
    ["Asleep between reports", asleep(""), "Search, or a device to add…"],
    [DEVICES, devices(), "Search, or a device to prepare…"],
    [`${DEVICES}, not on the map`, devices("off"), "Search, or a device to prepare…"],
  ];
  for (const [name, html, words] of SECTIONS) {
    // the list's fields: the one shared field, plus the pickers INSIDE its cards (a group's "Add another entity…", a
    // bound object's entity) which are the cards' own
    const outside = cards(html).reduce((rest, c) => rest.replace(c.card, ""), html);
    ck(`${name}: one field, the shared one ("${words}"), no second field, no Create or Add button beside it`,
       (outside.match(/class="config-search/g) ?? []).length === 1 && (outside.match(/class="search-or-add"/g) ?? []).length === 1
       && new RegExp(`placeholder="${words}"`).test(field(html))
       && !/New group|Filter by|Add a device…|Search or type entity_id|>Create<|> ?Add<\/button>/.test(text(outside)), text(outside).slice(0, 300));
  }
  const kitchen = groups("kitchen");
  ck("Grouped devices: typing narrows the groups, and offers the devices; one in a group says \"In group <its name>\"",
     JSON.stringify(cards(kitchen).filter((c) => c.bar !== "Create this group").map((c) => c.name)) === JSON.stringify(["Kitchen Temperature"])
     && JSON.stringify(offers(kitchen)) === JSON.stringify(["Kitchen Humidity / sensor.example_kitchen_humidity / In group Kitchen Temperature",
       "Kitchen Temperature / sensor.example_kitchen_temperature / In group Kitchen Temperature"]), [names(kitchen), offers(kitchen)]);
  const pool = groups("pool");
  ck("  ...one in no group \"Create a group\"; no group left: \"No group has '…'\" with the create offer",
     offers(pool).every((o) => o.endsWith(" / Create a group")) && offers(pool).length === 2
     && !names(pool).includes("Kitchen Temperature") && /No group has “pool”\./.test(text(pool))
     && /<button type="button" class="btn">Create a group with Pool Pump Power<\/button>/.test(inside(pool, "search-empty")), [offers(pool), text(inside(pool, "search-empty"))]);
  const exact = groups("switch.example_pool_pump");
  ck("  ...the exact id of a real device in no group: its own row first, \"Create a group with <id>\" (Enter picks it), not repeated",
     offers(exact)[0] === "! Create a group with switch.example_pool_pump / Pool Pump" && offers(exact).filter((o) => o.includes("switch.example_pool_pump")).length === 1
     && offers(groups("switch.example_no_such_thing")).length === 0, offers(exact));
  ck("  ...cleared: every group again, no suggestion", names(groups("")).includes("Kitchen Temperature") && offers(groups("")).length === 0);
  const door = asleep("door"), lamp = asleep("lamp");
  ck("Asleep between reports: the same — a device on the list \"On the list\", another \"Add to the list\"; the cards narrowed",
     JSON.stringify(offers(door)) === JSON.stringify(["Back Door / binary_sensor.example_back_door / On the list"]) && JSON.stringify(names(door)) === JSON.stringify(["Back Door"])
     && JSON.stringify(offers(lamp)) === JSON.stringify(["Terrace Lamp / light.example_terrace_lamp / Add to the list"]) && names(lamp).length === 0
     && /No device on the list has “lamp”\./.test(text(lamp)) && />Add Terrace Lamp to the list</.test(lamp), [offers(door), offers(lamp), names(lamp)]);
  // Devices' field narrows the list shown, and prepares a device (it was Bound 3D objects', owner 2026-11-06)
  const at = (q, view) => { globalThis.__view = view; try { return typed("", h(ConfigEditor, { title: DEVICES, initialSearch: q })); } finally { globalThis.__view = undefined; } };
  const pumps = at("pool", "on"), terrace = at("terrace", "on"), prepared = at("light.example_new_lamp", "on"), fan = at("fan", "off");
  ck(`${DEVICES}: the same field narrows the list shown (by a name, a room, or one of its 3D objects)`,
     JSON.stringify(names(pumps)) === JSON.stringify(["Pool Pump", "Pool Pump Power"]) && JSON.stringify(names(at("lamp_kitchen", "on"))) === JSON.stringify(["Terrace Lamp"])
     && JSON.stringify(names(fan)) === JSON.stringify(["Ceiling Fan"]), [names(pumps), names(at("lamp_kitchen", "on")), names(fan)]);
  ck("  ...and offers its devices: one on the map \"On the map\", one no object shows \"Not on the map\", an id not there yet prepared ahead",
     JSON.stringify(offers(terrace)) === JSON.stringify(["Terrace Lamp / light.example_terrace_lamp / On the map"])
     && offers(fan).includes("Ceiling Fan / fan.example_ceiling_fan / Not on the map")
     && offers(prepared)[0] === "! Prepare “light.example_new_lamp” / not there yet, will activate when it appears", [offers(terrace), offers(fan), offers(prepared)]);
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../src/components/settings/", import.meta.url);
  const using = readdirSync(dir).filter((f) => /<SearchOrAdd\b/.test(readFileSync(new URL(f, dir), "utf8"))).sort();
  ck("  ...the three sections draw the one SearchOrAdd, none its own search box",
     JSON.stringify(using) === JSON.stringify(["ConfigEditor.tsx", "GroupedDevices.tsx", "UnavailableByDesign.tsx"])
     && readdirSync(dir).every((f) => !/<input\s+type="search"/.test(readFileSync(new URL(f, dir), "utf8"))), using);
}

console.log("\n  Devices: its title's counts show its lists:");
{
  const head = (html) => inside(html, "section-title");
  // what each list holds (its first few): the devices on the map, the devices no object shows (a group's member is
  // shown by its group's badge)
  const LISTS = { on: ["Kitchen Temperature", "Pool Pump", "Pool Pump Power"], off: ["Back Door", "Ceiling Fan"] };
  ck("its two counts after its title are the one segmented control, compact, the list shown filled (on the map first)",
     JSON.stringify(views(head(devices()))) === JSON.stringify([["4 on the map", true], ["2 not on the map", false]])
     && /^<div class="section-title with-tip">Auto-detected entity settings<span class="title-after"><div class="segmented segmented-compact section-views" role="group" aria-label="Auto-detected entity settings: which list">/.test(head(devices())), [views(head(devices())), head(devices()).slice(0, 200)]);
  const devicesOf = (html) => cards(html).filter((c) => c.bar !== "Point it there").map((c) => c.name);
  ck("  ...each count shows its own list, one at a time",
     Object.entries(LISTS).every(([v, want], i) => { const html = devices(v); const shown = views(head(html)).map(([, s]) => s);
       return shown.filter(Boolean).length === 1 && shown[i] && JSON.stringify(devicesOf(html)) === JSON.stringify(want); }),
     ["on", "off"].map((v) => [views(head(devices(v))), devicesOf(devices(v))]));
  ck("  ...the missing entity's object with the devices on the map, never with those not on it",
     cards(devices()).some((c) => c.bar === "Point it there") && !cards(devices("off")).some((c) => c.bar === "Point it there"));
}

console.log("\n  every card stands out: one edge and shadow, the theme's:");
{
  const base = readFileSync(new URL("../../src/styles/01-base.css", import.meta.url), "utf8");
  const facility = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
  const frame = facility.match(/\n\.fm-record-card \{([^}]*)\}/)?.[1] ?? "";
  // owner, 2026-11-06: "hard to distinguish each card individually"
  ck("RecordCard's frame (every card: Cockpit, Settings, Advanced) reads the card's edge and shadow tokens",
     /border: var\(--card-border\)/.test(frame) && /box-shadow: var\(--card-shadow\)/.test(frame), frame);
  const hs = [...base.matchAll(/--hairline-strong: ([^;]+);/g)].length, hl = [...base.matchAll(/--hairline: ([^;]+);/g)].length;
  ck("  ...the edge the theme's stronger hairline (defined in each theme), a faint shadow under it",
     /--card-border: 1px solid var\(--hairline-strong\);/.test(base) && /--card-shadow: 0 1px 3px var\(--shadow\);/.test(base) && hs === hl && hs >= 3, [hs, hl]);
  const drawn = cards(devices())[0]?.card ?? "";
  ck("  ...drawn: a Settings card is that frame", /^<div class="fm-record-card">/.test(drawn), drawn.slice(0, 80));
}

console.log("\n  a device of Devices: never folded, no room line, its toggle under its id on a phone:");
{
  const html = devices();
  const card = cards(html).find((c) => c.name === "Pool Pump")?.card ?? "";
  // owner, 2026-11-06: what the chevron opened is always shown; its room under its name said nothing more
  ck("its fields always shown (Type, Category, Label…), no chevron, nothing to expand",
     /card-field-label[^"]*">Type</.test(card) && /card-field-label[^"]*">Label</.test(card) && !/lucide-chevron|aria-expanded|role="button"/.test(inside(card, "device-first-line")), inside(card, "device-first-line"));
  ck("  ...no quiet line (its room)", card !== "" && !/fm-record-meta/.test(card), card);
  ck("  ...its id line: the box, the id, its Confirm before toggling (a switch, which a tap turns); no pencil, no \"3D object: …\"",
     /type="checkbox"[\s\S]*entity-id-text[\s\S]*entity-id-confirm/.test(inside(card, "device-first-line"))
     && /Confirm before toggling/.test(inside(card, "entity-id-confirm")) && text(inside(card, "entity-id-text")).replace(/\|/g, "") === "switch.example_pool_pump"
     && !/lucide-pencil|entity-id-tools|Redirect/.test(html) && !/3D object:/.test(text(html)), inside(card, "device-first-line"));
}

console.log("\n  a device's \"3D object\" field (owner, 2026-11-06): its objects, each with its ✕, then a search to add one:");
{
  const field = (card) => inside(card.slice(card.indexOf('card-field-label">3D object<')), "group-members");
  if (globalThis.__peek) console.log(field(cards(devices("on", "terrace")).find((c) => c.name === "Terrace Lamp")?.card ?? "").slice(0, 1500));
  // a pill: its object's name (after its cube, ObjectName) and its ✕'s words
  const pills = (card) => [...field(card).matchAll(/<span class="fm-entity-chip fm-chip-static fm-chip-removable"[^>]*>[\s\S]*?<span class="object-name">[\s\S]*?<\/svg><span>([\s\S]*?)<\/span><\/span>[\s\S]*?aria-label="([^"]*)"/g)].map((m) => [m[1].replace(/<wbr\/>/g, ""), unescape(m[2])]);
  const lamp = cards(devices("on", "terrace")).find((c) => c.name === "Terrace Lamp")?.card ?? "", pump = cards(devices()).find((c) => c.name === "Pool Pump")?.card ?? "";
  ck("an object bound by hand shows on its device's card, its ✕ \"Take <object> off <device>\"",
     JSON.stringify(pills(lamp)) === JSON.stringify([["Lamp_Kitchen", "Take Lamp_Kitchen off Terrace Lamp"]]), pills(lamp));
  ck("  ...an object linked by its name the same, with the same ✕", JSON.stringify(pills(pump)) === JSON.stringify([["switch.example_pool_pump", "Take switch.example_pool_pump off Pool Pump"]]), pills(pump));
  // owner, 2026-11-11: on the map, the search gives the device another entity (renamed in the villa's system)
  // owner, 2026-11-12: it says what it moves, and that an object was re-mapped to this device (its name not the device's)
  const search = (card) => field(card).match(/<div class="group-members-add"><div class="picker"><div class="config-search config-search-compact">[\s\S]*?placeholder="([^"]*)"/)?.[1];
  ck("  ...then the compact search in the same field, saying an object was re-mapped to the device",
     search(lamp) === "Re-mapped to this device · search to point it at another entity…", search(lamp));
  ck("  ...an object named after its device: the search alone", search(pump) === "Search to point it at another entity…", search(pump));
  // each object by its cube, never as an entity: the model's object, whom it shows on hover
  ck("  ...each object pill drawn as a 3D object (its cube) with the hover saying whom it shows",
     /<span class="object-name"><svg[\s\S]*?Lamp_Kitchen/.test(field(lamp))
     && /3D object of the model, named Lamp_Kitchen: it shows Terrace Lamp/.test(field(lamp)), field(lamp));
  const rowsOf = (card) => [...field(card).matchAll(/<button class="row picker-option">([\s\S]*?)<\/button>/g)].map((m) => text(m[1].replace(/<wbr\/>/g, "")).replace(/^\||\|$/g, "").replace(/\|/g, " / "));
  globalThis.__open = true;
  const open = cards(devices("on", "terrace")).find((c) => c.name === "Terrace Lamp")?.card ?? "";
  const offOpen = cards(devices("off")).find((c) => c.name === "Ceiling Fan")?.card ?? "";
  globalThis.__open = false;
  const rows = rowsOf(open);
  ck("  ...its search lists the villa's entities, never the device itself",
     rows.length > 0 && rows.some((r) => r.startsWith("Pool Pump / switch.example_pool_pump")) && !rows.some((r) => r.includes("light.example_terrace_lamp")), rows);
  const objRows = rowsOf(offOpen), firstNothing = objRows.findIndex((r) => r.endsWith("shows nothing yet"));
  ck("  ...a device not on the map's lists the model's objects: those showing a device first, each saying what picking it does",
     objRows.includes("[icon] / switch.example_pool_pump / shows Pool Pump, moves it here") && firstNothing > 0
     && objRows.every((r) => r.startsWith("[icon] / "))          // each by its cube, as its pill (owner, 2026-11-12)
     && objRows.slice(firstNothing).every((r) => r.endsWith("shows nothing yet")), objRows);
  const off = cards(devices("off")).find((c) => c.name === "Ceiling Fan")?.card ?? "";
  ck("a device not on the map: the same card, its id alone under its name, its \"3D object\" field empty, no box, no bin",
     text(inside(off, "fm-record-meta")).replace(/\|/g, "") === "fan.example_ceiling_fan" && pills(off).length === 0 && /placeholder="Add a 3D object…"/.test(field(off))
     && !/type="checkbox"|fm-record-remove/.test(off), off);
  // pin the caller: what the field's add and ✕ write is the edit the model's check drives (mapping_edits.mjs)
  const { elements, parseTsx, propText } = await import("../consistency/jsx.mjs");
  const ed = parseTsx("components/settings/ConfigEditor.tsx");
  const rowsDrawn = elements(ed, "EntityMapRow");
  ck("  ...both lists' cards are EntityMapRow, given the one add (bindMesh) and the one ✕ (takeObjectOff)",
     rowsDrawn.length === 2 && rowsDrawn.every((r) => propText(r, "onAddObject") === "addObject" && propText(r, "onTakeObjectOff") === "takeOff")
     && /bindMesh\(object, id, entitiesRef\.current\[id\]\)/.test(ed.getText()) && /takeObjectOff\(object, id\)/.test(ed.getText()), rowsDrawn.map((r) => r.getText().slice(0, 80)));
}

console.log("\n  every card for an entity: its friendly name in its strip, its id alone on its first line:");
{
  // owner, 2026-11-06 (later): "the user friendly name of the entity that it controls" in the header, "only showing the
  // baseline entity name" under it ("Other · <id> · primary (keeps the map badge)", "… · 3D object: …" were redundant)
  const { labelOf } = await import("@/config/EntityMap");
  const ENTITY = [
    ["a device group", drawIn(h(GroupedDevices, { title: "Grouped devices" })), "sensor.example_kitchen_temperature"],
    ["a device not on the map", devices("off"), "fan.example_ceiling_fan"],
    ["a device asleep between reports", drawIn(h(UnavailableByDesign, { title: "Asleep between reports" })), "binary_sensor.example_back_door"],
    ["a 3D object whose entity is gone", devices(), "fan.example_gone_fan"],
  ];
  for (const [kind, html, id] of ENTITY) {
    const name = labelOf(id, config.entityMap, entities);
    const card = cards(html).find((c) => c.name === name)?.card ?? "";
    ck(`${kind}: "${name}" (its entity's name, every screen's) in its strip, "${id}" alone under it`,
       card !== "" && text(inside(card, "fm-record-meta")).replace(/\|/g, "") === id, [cards(html).map((c) => c.name), text(inside(card, "fm-record-meta"))]);
  }
  const pump = cards(grouped("suggested")).find((c) => c.bar === "Create this group")?.card ?? "";
  ck("  ...a suggested group: its primary's name, its two ids joined by \"+\"", /\+/.test(text(inside(pump, "fm-record-meta"))) && !/Other|primary/.test(text(inside(pump, "fm-record-meta"))), text(inside(pump, "fm-record-meta")));
  const device = cards(devices()).find((c) => c.name === "Pool Pump")?.card ?? "";
  ck("  ...a device of Devices: its name, its id on its box's line (no second line)", device !== "" && !/fm-record-meta/.test(device), device.slice(0, 200));
}

console.log("\n  every card's field: its name in the one column, its control beside it, as a device's Linked entity:");
{
  const named = (html, name) => [...(cards(html).find((c) => c.name === name)?.card ?? "").matchAll(/<div class="card-field"><span class="eyebrow card-field-label[^"]*">([^<]+)</g)].map((m) => m[1]);
  // UI scan, 2026-11-11: what a field is for was said on hover only (a title, a tip on its box), which a finger never sees
  const tipped = (html, name) => [...(cards(html).find((c) => c.name === name)?.card ?? "").matchAll(/aria-label="About ([^"]+)"/g)].map((m) => m[1]);
  const FIELDS = [
    ["a device group", drawIn(h(GroupedDevices, { title: "Grouped devices" })), "Kitchen Temperature", ["Members"]],
    // owner, 2026-11-06: "3D object" first, right under the card's first line, above Type (it was the last)
    ["a device of Devices (a switch)", devices(), "Pool Pump", ["3D object", "Type", "Category", "Label", "Linked entity"]],
    ["  ...a light, its intensity too", devices("on", "terrace"), "Terrace Lamp", ["3D object", "Type", "Category", "Label", "Intensity", "Linked entity"]],
    ["a device not on the map", devices("off"), "Ceiling Fan", ["3D object"]],
    ["a full-screen announcement", drawIn(h(FullScreenAnnouncements, { value: config.fullScreen, onChange: noop })), "Front gate doorbell", ["On screen"]],
    ["a chat that gets the messages", drawIn(h(WhoGetsMessages, { languages: {}, onLanguages: noop })), "Example House FM group (notify.example_fm_group)", ["Language"]],
  ];
  for (const [kind, html, name, want] of FIELDS)
    ck(`${kind}: ${want.map((w) => `"${w}"`).join(", ")}`, JSON.stringify(named(html, name)) === JSON.stringify(want), named(html, name));
  ck("  ...what a light's fields are for is each name's (i), a tap away: Type, Category, Label, Intensity",
     JSON.stringify(tipped(devices("on", "terrace"), "Terrace Lamp")) === JSON.stringify(["Type", "Category", "Label", "Intensity"]), tipped(devices("on", "terrace"), "Terrace Lamp"));
  const group = cards(drawIn(h(GroupedDevices, { title: "Grouped devices" }))).find((c) => c.name === "Kitchen Temperature")?.card ?? "";
  ck("  ...a group's members and its \"Add another entity…\" inside its Members field", /card-field-label">Members<\/span><div class="group-members">/.test(group), group);
}

console.log("\n  Grouped devices: its title's counts show its groups or its suggestions:");
{
  // owner, 2026-11-06: "Show fewer" and the suggestions' own "15 suggested groups" toggle sat side by side on one line
  const head = (html) => inside(html, "with-tip");
  const shown = (html) => cards(html).map((c) => [c.name, c.bar]);
  const groupsHtml = grouped(), suggestedHtml = grouped("suggested");
  ck("its counts after its title: \"1 group · 1 suggested\", the one segmented control, the groups shown first",
     JSON.stringify(views(head(groupsHtml))) === JSON.stringify([["1 group", true], ["1 suggested", false]])
     && /<\/button><span class="title-after"><div class="segmented segmented-compact section-views" role="group" aria-label="Grouped devices: which list">/.test(head(groupsHtml)),
     [views(head(groupsHtml)), head(groupsHtml).slice(0, 400)]);
  ck("  ...the groups: the groups' cards, no suggestion", JSON.stringify(shown(groupsHtml)) === JSON.stringify([["Kitchen Temperature", ""]]), shown(groupsHtml));
  ck("  ...the suggested: the suggestion cards, Create this group their main action, no group",
     JSON.stringify(shown(suggestedHtml)) === JSON.stringify([["Pool Pump", "Create this group"]])
     && JSON.stringify(views(head(suggestedHtml))) === JSON.stringify([["1 group", false], ["1 suggested", true]]), [shown(suggestedHtml), views(head(suggestedHtml))]);
  const typedIn = (q, view) => { globalThis.__q = q; try { return grouped(view); } finally { globalThis.__q = undefined; } };
  ck("  ...the search narrows the list shown (a suggestion found by either of its devices)",
     shown(typedIn("pool pump power", "suggested")).length === 1 && shown(typedIn("pool", "suggested")).length === 1
     && shown(typedIn("kitchen", "suggested")).length === 0 && /No suggested group has “kitchen”\./.test(text(typedIn("kitchen", "suggested")))
     && JSON.stringify(shown(typedIn("pool", "groups"))) === "[]", [shown(typedIn("pool", "suggested")), shown(typedIn("kitchen", "suggested"))]);
  ck("  ...no fold of their own beside \"Show all / Show fewer\" (\"suggested groups\" said nowhere, one fold toggle: the title's)",
     [groupsHtml, suggestedHtml].every((x) => !/suggested group/.test(text(x)) && (x.match(/class="fold-toggle[ "]/g) ?? []).length === 1)
     && !/FoldToggle|showSuggestions/.test(readFileSync(new URL("../../src/components/settings/GroupedDevices.tsx", import.meta.url), "utf8")),
     [groupsHtml, suggestedHtml].map((x) => [text(x).match(/.{0,40}suggested group.{0,40}/)?.[0], (x.match(/class="fold-toggle[ "]/g) ?? []).length]));
}

console.log("\n  Device telemetry: a log list, its columns time, kind, device, words:");
{
  const { TelemetryRow } = await import("@/components/settings/TelemetryPanel");
  const row = draw(h(TelemetryRow, { e: { kind: "freeze", at: "2026-11-06T03:52:43Z", ua: "Mozilla/5.0 (Macintosh)", role: "owner", v: "2.496.718", ms: 1240 } }));
  const order = [...row.matchAll(/<span class="(?:muted )?(telemetry-[a-z]+)"/g)].map((m) => m[1]);
  ck("an event's time first, then its kind, its device, its words", JSON.stringify(order) === JSON.stringify(["telemetry-time", "telemetry-kind", "telemetry-meta", "telemetry-summary"]), order);
  ck("  ...a row, not a card, its kind in its colour (freeze red)", !/fm-record/.test(row) && /class="telemetry-kind" style="color:var\(--status-danger\)">freeze/.test(row), row);
  const css = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8");
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.>]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  ck("  ...the time and the kind columns of one width, so the rows align (the kind as wide as the page's longest)",
     /tabular-nums/.test(rule(".telemetry-row > .telemetry-time")) && /flex: 0 0 var\(--telemetry-kind/.test(rule(".telemetry-row > .telemetry-kind"))
     && /"--telemetry-kind" as string\]: `\$\{Math\.max\(\.\.\.paged\.page\.map\(\(e\) => e\.kind\.length\)\)\}ch`/.test(readFileSync(new URL("../../src/components/settings/TelemetryPanel.tsx", import.meta.url), "utf8")));
  const phone = css.slice(css.indexOf(".telemetry-row > .telemetry-summary {"));
  ck("  ...on a phone the time, kind and device on the first line, the words under them (never moved by `order`)",
     /@media \(max-width: 640px\) \{[^@]*\.telemetry-row \{ flex-wrap: wrap;[^@]*\.telemetry-row > \.telemetry-summary \{ flex: 1 1 100%; \}[^@]*\.telemetry-row > \.telemetry-meta \{ flex: 1 1 0; min-width: 0;/.test(phone)
     && !/\.telemetry-[a-z]+ \{[^}]*order:/.test(css));
}


// owner, 2026-11-06: a chat's card names it with its id after it, "Fabien (notify.fabien)", the id quiet, broken only by
// IdText's rule (a phone wraps after the name or after a "." or "_", never inside a word of the id)
console.log("\n  a chat's name and its id, in its strip:");
{
  const { namedIdText } = await import("@/components/common/IdText");
  const html = drawIn(h(WhoGetsMessages, { languages: {}, onLanguages: noop }));
  const strips = [...html.matchAll(/<span class="fm-record-name">([\s\S]*?)<\/span><button/g)].map((m) => m[1]);
  ck("each chat's strip: its name, then its id in brackets, quiet, after a space",
     strips.length === 2 && strips[0] === 'Example Owner <span class="named-id">(notify.<wbr/>example_<wbr/>owner_<wbr/>chat)</span>'
     && strips[1] === 'Example House FM group <span class="named-id">(notify.<wbr/>example_<wbr/>fm_<wbr/>group)</span>', strips);
  ck("  ...its words \"Example Owner (notify.example_owner_chat)\", the name first",
     cards(html).map((c) => c.name).join("|") === [namedIdText("Example Owner", "notify.example_owner_chat"),
       namedIdText("Example House FM group", "notify.example_fm_group")].join("|")
     && namedIdText("Example Owner", "notify.example_owner_chat") === "Example Owner (notify.example_owner_chat)"
     && namedIdText("notify.example_x", "notify.example_x") === "notify.example_x", cards(html).map((c) => c.name));
  ck("  ...the id quiet and unbroken inside a word: the name's \"anywhere\" break not inherited",
     /\.named-id \{ color: var\(--text-secondary\); font-weight: 500; overflow-wrap: normal; word-break: normal; \}/.test(
       readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8")));
  // the same need elsewhere: every Settings card naming an entity shows its id (EntityCard's id line, or the chat's strip);
  // a full-screen announcement is no entity
  const dir = new URL("../../src/components/settings/", import.meta.url);
  const { readdirSync } = await import("node:fs");
  const drawers = readdirSync(dir).filter((f) => f.endsWith(".tsx") && /<RecordCard\b/.test(readFileSync(new URL(f, dir), "utf8")));
  ck("  ...every other Settings card naming an entity has its id line (EntityCard); an announcement is no entity",
     JSON.stringify(drawers.sort()) === JSON.stringify(["EntityCard.tsx", "MessagesSettings.tsx", "WhoGetsMessages.tsx"])
     && /title=\{<NamedId name=\{name\(id\)\} id=\{id\} \/>\}/.test(readFileSync(new URL("WhoGetsMessages.tsx", dir), "utf8")), drawers);
}

done("✅ Settings' records are the Cockpit's card, each remove an icon at its strip's right; the telemetry a log in time order; Devices' counts show its lists, each device's 3D objects its field");
