// Settings and Advanced Settings show their records as the Cockpit's card (owner, 2026-11-06: "the same card in Settings
// and Advanced Settings"): a device group and a suggested one, a bound 3D object, an object bound to nothing, an entity
// no object shows, a device asleep between reports, a device of Devices and a 3D object whose entity is gone, a
// full-screen announcement, a chat that gets the messages. Each is drawn here through its real section and read: its
// frame is RecordCard's, its name is in the strip, its action is in the bar; the rows and tables it replaced are gone.
// The telemetry stays a log list, its columns reordered (time, kind, device, words), and Bound 3D objects' title counts
// open its lists (the line of three toggles under the title is gone).
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
  "/src/components/settings/GroupedDevices.tsx": [["useState(false)", "useState(true)"],
    ['const [search, setSearch] = useState("")', 'const [search, setSearch] = useState(globalThis.__q ?? "")']],
  "/src/components/settings/BindingsTable.tsx": [['useState("bound")', 'useState(globalThis.__view ?? "bound")'],
    ['const [search, setSearch] = useState("")', 'const [search, setSearch] = useState(globalThis.__q ?? "")']],
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
localStorage.setItem("villa-kiosk:mesh-catalog", JSON.stringify(["Lamp_Kitchen", "Mesh_Unnamed_042"]));
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
const rows = Object.entries(config.entityMap).map(([id, mapping]) => ({ id, mapping, objects: [] }));
const villa = { settings: { rows, stale: [], orphans: ["fan.example_gone_fan"] }, sceneEntityIds: new Set() };
const quiet = (f) => { const e = console.error; console.error = () => {}; try { return f(); } finally { console.error = e; } };
const drawIn = (el) => quiet(() => draw(h(ConfigCtx.Provider, { value: cfg }, h(HACtx.Provider, { value: ha },
  h(VillaModelProvider, { value: villa }, h(PendingFields, { pending: new PendingEdits(noop) }, el))))));

const unescape = (t) => t.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** A strip's remove: its icon and its words (its tooltip and aria-label are one `label`); null when it has none. */
const removeOf = (strip) => {
  const m = /<button type="button" class="icon-btn-sm fm-record-remove( danger)?" aria-label="([^"]*)" data-icon="(bin|x)"><svg[^>]*lucide-(trash-2|x)\b/.exec(strip);
  return m ? { icon: m[3], glyph: m[4], label: unescape(m[2]), danger: !!m[1], last: strip.endsWith("</svg></button></div>") } : null;
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
const { default: BindingsTable } = await import("@/components/settings/BindingsTable");
const { default: UnavailableByDesign } = await import("@/components/settings/UnavailableByDesign");
const { default: ConfigEditor } = await import("@/components/settings/ConfigEditor");
const { FullScreenAnnouncements } = await import("@/components/settings/MessagesSettings");
const { default: WhoGetsMessages } = await import("@/components/settings/WhoGetsMessages");
const { ROLE_LABELS } = await import("@/auth/roles");
const bindings = (view) => { globalThis.__view = view; return drawIn(h(BindingsTable, { title: "Bound 3D objects" })); };

// [kind, drawn, its name, its bar's words ("" no bar), its remove at its strip's right ([icon, tooltip]) or none]
const KINDS = [
  ["a device group", drawIn(h(GroupedDevices, { title: "Grouped devices" })), "Kitchen Temperature", "", ["bin", "Delete the group Kitchen Temperature"]],
  ["  ...a suggested group, its main action first", drawIn(h(GroupedDevices, { title: "Grouped devices" })), "Pool Pump Power + Pool Pump", "Create this group"],
  ["a bound 3D object (named after its entity)", bindings("bound"), "Terrace Lamp", "", ["x", "Unbind Lamp_Kitchen from Terrace Lamp"]],
  ["an object bound to nothing", bindings("unbound"), "Mesh_Unnamed_042", "Bind"],
  ["an entity no object shows", bindings("unshown"), "Ceiling Fan", "Bind"],
  ["a device asleep between reports", drawIn(h(UnavailableByDesign, { title: "Asleep between reports" })), "Back Door", "", ["x", "Take Back Door off Asleep between reports"]],
  ["a device of Devices", drawIn(h(ConfigEditor)), "Pool Pump", "", ["bin", "Remove Pool Pump's settings"]],
  ["a 3D object whose entity is gone", drawIn(h(ConfigEditor)), "fan.example_gone_fan", "Point it there"],
  ["a full-screen announcement", drawIn(h(FullScreenAnnouncements, { value: config.fullScreen, onChange: noop })), "Front gate doorbell", "", ["bin", "Delete the announcement Front gate doorbell"]],
  ["a chat that gets the messages", drawIn(h(WhoGetsMessages)), "Example House FM group", "", ["x", `Take Example House FM group off the ${ROLE_LABELS.ops}'s list`]],
];
console.log("  every record of Settings is the Cockpit's card:");
for (const [kind, html, name, action, remove] of KINDS) {
  const card = cards(html).find((c) => c.name === name);
  const said = remove ? `its ${remove[0] === "bin" ? "bin" : "✕"} "${remove[1]}" at its strip's right` : "no remove";
  ck(`${kind}: a card named "${name}" in its strip, ${action ? `"${action}" in its bar` : "no bar"}, ${said}`,
     !!card && card.bar === action && card.bars === (action ? 1 : 0)
     && (remove ? !!card.remove && card.remove.icon === remove[0] && card.remove.glyph === (remove[0] === "bin" ? "trash-2" : "x")
       && card.remove.label === remove[1] && card.remove.last && card.remove.danger === (remove[0] === "bin") : card.remove === null),
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
  ck("  ...the files drawing them, each through RecordCard",
     JSON.stringify(drawing) === JSON.stringify(["BindingRow.tsx", "ConfigEditor.tsx", "EntityMapRow.tsx", "GroupedDevices.tsx", "MessagesSettings.tsx", "UnavailableByDesign.tsx", "WhoGetsMessages.tsx"]), drawing);
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
    remove: { icon: "bin", label: "Delete the group Kitchen Temperature", run: () => ran.push(1) } }).type({ title: "Kitchen Temperature",
    onOpen: () => opened.push(1), remove: { icon: "bin", label: "Delete the group Kitchen Temperature", run: () => ran.push(1) } }));
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
  const giving = walk(new URL("../../src/", import.meta.url)).filter((u) => { const t = readFileSync(u, "utf8"); return /<RecordCard\b/.test(t) && /^\s*remove=\{/m.test(t); })
    .map((u) => u.pathname.split("/src/")[1]).sort();
  ck("  ...the files giving a card its remove are Settings' alone, never a Cockpit card",
     JSON.stringify(giving) === JSON.stringify(["components/settings/BindingRow.tsx", "components/settings/EntityMapRow.tsx", "components/settings/GroupedDevices.tsx",
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
    ["Auto-detected entity settings", drawIn(h(ConfigEditor)), "Search by id, label or room…"],
    ["Bound 3D objects", bindings("bound"), "Search objects, or a device to prepare…"],
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
     JSON.stringify(names(kitchen).filter((n) => !n.includes("+"))) === JSON.stringify(["Kitchen Temperature"])
     && JSON.stringify(offers(kitchen)) === JSON.stringify(["Kitchen Humidity / sensor.example_kitchen_humidity / In group Kitchen Temperature",
       "Kitchen Temperature / sensor.example_kitchen_temperature / In group Kitchen Temperature"]), [names(kitchen), offers(kitchen)]);
  const pool = groups("pool");
  ck("  ...one in no group \"Create a group\"; no group left: \"No group has '…'\" with the create offer",
     offers(pool).every((o) => o.endsWith(" / Create a group")) && offers(pool).length === 2
     && !names(pool).includes("Kitchen Temperature") && /No group has “pool”\./.test(text(pool))
     && /<button type="button" class="btn ghost">Create a group with Pool Pump Power<\/button>/.test(inside(pool, "search-empty")), [offers(pool), text(inside(pool, "search-empty"))]);
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
  const auto = typed("", h(ConfigEditor, { initialSearch: "pool" }));
  ck("Auto-detected entity settings: the same field, narrowing only (no suggestions)",
     JSON.stringify(names(auto)) === JSON.stringify(["Pool Pump", "Pool Pump Power"]) && !/picker-dropdown/.test(field(auto)), [names(auto), field(auto).slice(0, 200)]);
  globalThis.__view = "bound";
  const bound = typed("terrace", h(BindingsTable, { title: "Bound 3D objects" }));
  const ahead = typed("light.example_new_lamp", h(BindingsTable, { title: "Bound 3D objects" }));
  ck("Bound 3D objects: the same — a device \"Already in Devices\" or \"Prepare it\", an id not there yet prepared ahead; the list narrowed",
     JSON.stringify(offers(bound)) === JSON.stringify(["Terrace Lamp / light.example_terrace_lamp / Already in Devices"]) && JSON.stringify(names(bound)) === JSON.stringify(["Terrace Lamp"])
     && offers(ahead)[0] === "! Prepare “light.example_new_lamp” / not there yet, will activate when it appears"
     && offers(typed("fan", h(BindingsTable, { title: "Bound 3D objects" }))).includes("Ceiling Fan / fan.example_ceiling_fan / Prepare it"),
     [offers(bound), names(bound), offers(ahead)]);
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../src/components/settings/", import.meta.url);
  const using = readdirSync(dir).filter((f) => /<SearchOrAdd\b/.test(readFileSync(new URL(f, dir), "utf8"))).sort();
  ck("  ...the four lists draw the one SearchOrAdd, none its own search box",
     JSON.stringify(using) === JSON.stringify(["BindingsTable.tsx", "ConfigEditor.tsx", "GroupedDevices.tsx", "UnavailableByDesign.tsx"])
     && readdirSync(dir).every((f) => !/<input\s+type="search"/.test(readFileSync(new URL(f, dir), "utf8"))), using);
}

console.log("\n  Bound 3D objects: its title's counts open its lists:");
{
  const head = (html) => inside(html, "cockpit-issues-head");
  // what each list holds: the object bound, the one bound to nothing, the entities no object shows
  const LISTS = { bound: ["Terrace Lamp"], unbound: ["Mesh_Unnamed_042"], unshown: ["Back Door", "Ceiling Fan"] };
  const views = (html) => [...head(html).matchAll(/<button type="button" class="section-view( shown)?" aria-pressed="(true|false)">([^<]*)<\/button>/g)].map((m) => [m[3], m[2] === "true"]);
  ck("its three counts are buttons after its title, the list shown marked (bound first)",
     JSON.stringify(views(bindings("bound"))) === JSON.stringify([["1 bound", true], ["1 unbound", false], ["2 not shown", false]]), views(bindings("bound")));
  ck("  ...each count shows its own list, one at a time",
     Object.entries(LISTS).every(([v, names], i) => { const html = bindings(v); const shown = views(html).map(([, s]) => s);
       return shown.filter(Boolean).length === 1 && shown[i] && JSON.stringify(cards(html).map((c) => c.name)) === JSON.stringify(names); }),
     ["bound", "unbound", "unshown"].map((v) => [views(bindings(v)), cards(bindings(v)).map((c) => c.name)]));
  const body = inside(bindings("bound"), "fold-body");
  ck("  ...and the line of three toggles under the title is gone (no \"bound object\" fold, no summary line)",
     !/fold-toggle|bound object|section-summary">/.test(body.replace(/Show all[^<]*/g, "")) && !/class="section-summary">/.test(head(bindings("bound"))), body.slice(0, 400));
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
  const drawn = cards(bindings("bound"))[0]?.card ?? "";
  ck("  ...drawn: a Settings card is that frame", /^<div class="fm-record-card">/.test(drawn), drawn.slice(0, 80));
}

console.log("\n  a device of Devices: never folded, no room line, its toggle under its id on a phone:");
{
  const html = drawIn(h(ConfigEditor));
  const card = cards(html).find((c) => c.name === "Pool Pump")?.card ?? "";
  // owner, 2026-11-06: what the chevron opened is always shown; its room under its name said nothing more
  ck("its fields always shown (Type, Category, Label…), no chevron, nothing to expand",
     /card-field-label">Type</.test(card) && /card-field-label">Label</.test(card) && !/lucide-chevron|aria-expanded|role="button"/.test(inside(card, "device-first-line")), inside(card, "device-first-line"));
  ck("  ...no quiet line (its room)", card !== "" && !/fm-record-meta/.test(card), card);
  ck("  ...its id line: the box, the id, the pencil, its Confirm before toggling (a switch, which a tap turns)",
     /type="checkbox"[\s\S]*entity-id-text[\s\S]*entity-id-tools[\s\S]*lucide-pencil[\s\S]*entity-id-confirm/.test(card)
     && /Confirm before toggling/.test(inside(card, "entity-id-confirm")), card);
}

console.log("\n  Bound 3D objects: a bound object's card is its entity's:");
{
  const card = cards(bindings("bound"))[0]?.card ?? "";
  // owner, 2026-11-06 (later): "more like" a device's card: its name, its line, then "Bound to" and the search on one line
  const field = (html) => [...html.matchAll(/<div class="card-field"><span class="card-field-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  ck("its strip its entity's name with the list's icon, its quiet line room · id · its 3D object, as a device card says it",
     /fm-record-lead"><svg[^>]*lucide-link2?/.test(inside(card, "fm-record-strip")) && text(inside(card, "fm-record-name")) === "|Terrace Lamp|"
     && text(inside(card, "fm-record-meta")).replace(/\|/g, "") === "Otherlight.example_terrace_lamp3D object: Lamp_Kitchen", [text(inside(card, "fm-record-strip")), text(inside(card, "fm-record-meta"))]);
  ck("  ...then one field, \"Bound to\" and the search that changes it (no sentence), its ✕ unbinding it",
     JSON.stringify(field(card)) === '["Bound to"]' && /card-field-label">Bound to<\/span><div class="picker/.test(card) && !/is bound to/.test(card)
     && cards(bindings("bound"))[0].remove?.label === "Unbind Lamp_Kitchen from Terrace Lamp", text(inside(card, "fm-record-main")));
  const loose = cards(bindings("unbound"))[0]?.card ?? "";
  ck("  ...an object bound to nothing: its name, its field \"Bind to\", Bind; no quiet line",
     text(inside(loose, "fm-record-name")).replace(/\|/g, "") === "Mesh_Unnamed_042" && !/fm-record-meta/.test(loose) && JSON.stringify(field(loose)) === '["Bind to"]', loose);
  const unshown = cards(bindings("unshown")).find((c) => c.name === "Ceiling Fan")?.card ?? "";
  ck("  ...an entity no object shows: its name, room · id, its field \"3D object\"",
     /fan\.example_ceiling_fan/.test(text(inside(unshown, "fm-record-meta")).replace(/\|/g, "")) && JSON.stringify(field(unshown)) === '["3D object"]', unshown);
}

console.log("\n  every card's field: its name in the one column, its control beside it, as a device's Linked entity:");
{
  const named = (html, name) => [...(cards(html).find((c) => c.name === name)?.card ?? "").matchAll(/<div class="card-field"><span class="card-field-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  const FIELDS = [
    ["a device group", drawIn(h(GroupedDevices, { title: "Grouped devices" })), "Kitchen Temperature", ["Members"]],
    ["a bound 3D object", bindings("bound"), "Terrace Lamp", ["Bound to"]],
    ["an object bound to nothing", bindings("unbound"), "Mesh_Unnamed_042", ["Bind to"]],
    ["an entity no object shows", bindings("unshown"), "Ceiling Fan", ["3D object"]],
    ["a full-screen announcement", drawIn(h(FullScreenAnnouncements, { value: config.fullScreen, onChange: noop })), "Front gate doorbell", ["On screen"]],
    ["a chat that gets the messages", drawIn(h(WhoGetsMessages)), "Example House FM group", ["Language"]],
  ];
  for (const [kind, html, name, want] of FIELDS)
    ck(`${kind}: ${want.map((w) => `"${w}"`).join(", ")}`, JSON.stringify(named(html, name)) === JSON.stringify(want), named(html, name));
  const group = cards(drawIn(h(GroupedDevices, { title: "Grouped devices" }))).find((c) => c.name === "Kitchen Temperature")?.card ?? "";
  ck("  ...a group's members and its \"Add another entity…\" inside its Members field", /card-field-label">Members<\/span><div class="group-members">/.test(group), group);
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

done("✅ Settings' records are the Cockpit's card, each remove an icon at its strip's right; the telemetry a log in time order; Bound 3D objects' counts open its lists");
