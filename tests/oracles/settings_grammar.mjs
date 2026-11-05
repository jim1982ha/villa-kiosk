// tests/oracles/settings_grammar.mjs
// ⚠️ SETTINGS AND ADVANCED SETTINGS, ONE GRAMMAR (owner, 2026-11-06: "sanitise and homogenise the UI/UX style in the
// Settings and Advanced Settings panels, on both mobile and laptop screens, consistently"). The phone showed "Night
// dimming · / 0.5×", "Full screen on this / tablet" and "Maintenance / mode" on two lines; On | Off pills, Map look's
// Icon | Card and Villa lighting's icons at three sizes; "1.00×" beside "0.5×"; a box and a separate "s"; a chevron
// after a title in one place and an outlined button in another; Advanced Settings' header buttons filled squares beside
// Settings' pill; the telemetry's "2026-11-05 17:55:13Z"; "fan.example_house_guest_roo / m".
//
// Each fix is a shared piece, drawn here: the setting line (common/SettingRow, SettingSlider), its values
// (settingValue), the one segmented look (and the tool group sharing its track), the folded section and the one
// "this opens more" (common/FoldedList), the joined unit (common/UnitField), the id that breaks at its dots and
// underscores (common/IdText), the telemetry's moment. Node cannot lay out text, so the names' widths the browser
// draws at 360px (headless Chromium, the app's own fonts and stylesheets) are kept here per name, and the room each
// has comes from the CSS as shipped: a name whose words change has no measure, measure it again.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { h, draw, text } = await import("../consistency/screen.mjs");
const { elements, parseTsx, propText } = await import("../consistency/jsx.mjs");

const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const modals = css("04-modals.css"), layout = css("05-layout.css");
const px = (re, t = modals) => Number(re.exec(t)?.[1] ?? NaN);
const quiet = (f) => { const e = console.error; console.error = () => {}; try { return f(); } finally { console.error = e; } };

console.log("  the setting line:");
const { default: SettingRow, SettingSlider, settingValue } = await import("@/components/common/SettingRow");
const { default: OnOffToggle } = await import("@/components/common/OnOffToggle");
const slider = quiet(() => draw(h(SettingSlider, { icon: h("svg", null), label: "Night dimming", value: settingValue.times(0.5), tip: "How much.",
  min: 0, max: 1, step: 0.1, at: 0.5, onChange() {} })));
ck("a slider: its name and its (i), then its value at the end of the name's line, the track under them (never the value in the name)",
   /^<div class="setting-row setting-slider"><span class="setting-row-name"><svg><\/svg><span class="setting-row-label">Night dimming<\/span><span class="info-tip[\s\S]*?<\/span><\/span><span class="setting-row-value">0\.50×<\/span><div class="setting-row-control"><input aria-label="Night dimming" type="range"/.test(slider)
   && /\.setting-slider > \.setting-row-control \{ flex-basis: 100%;/.test(modals), slider);
ck("  ...three to a wide screen's line: the name alone on its line, the value right of the track",
   /\.setting-line > \.setting-slider \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto; grid-template-areas: "name name" "control value";/.test(modals));
ck("  ...every value of a kind written one way: \"0.50×\" and \"1.00×\", \"1.70 m\", \"137°\"",
   settingValue.times(0.5) === "0.50×" && settingValue.times(1) === "1.00×" && settingValue.times(1.05) === "1.05×"
   && settingValue.metres(1.7) === "1.70 m" && settingValue.degrees(137.4) === "137°");
const onOff = quiet(() => draw(h(OnOffToggle, { on: true, onChange() {}, ariaLabel: "Maintenance mode", label: "Maintenance mode" })));
ck("  ...an On | Off is the same line, its name alone in its label, its two options at the right",
   /^<div class="setting-row on-off"><span class="setting-row-name"><span class="setting-row-label">Maintenance mode<\/span><\/span><div class="setting-row-control"><div class="segmented on-off-switch" role="group"/.test(onOff), onOff);
// every setting of both dialogs is one of these lines, its name its words alone (no value, no "·")
const FILES = ["components/settings/SettingsModal.tsx", "components/settings/ConfigEditorModal.tsx", "components/settings/MaintenanceMode.tsx"];
const rows = FILES.flatMap((f) => { const t = parseTsx(f); return ["OnOffToggle", "SettingRow", "SettingSlider"].flatMap((tag) => elements(t, tag)
  .map((e) => ({ file: f, tag, label: (propText(e, "label") ?? "").replace(/<[^>]+>/g, "").replace(/^"|"$/g, ""),
    tip: propText(e, "tip") !== null, value: propText(e, "value"), field: /setting-field/.test(propText(e, "className") ?? "") }))); });
ck("every setting of Settings and Advanced Settings is a setting line whose name is its words alone",
   rows.length >= 15 && rows.every((r) => /^[A-Z][A-Za-z ]+[a-z]$/.test(r.label)), rows.map((r) => r.label));
ck("  ...every slider is the one SettingSlider, its value one of the setting values",
   rows.filter((r) => r.tag === "SettingSlider").every((r) => /^settingValue\.(times|metres|degrees)\(/.test(r.value ?? ""))
   && FILES.every((f) => elements(parseTsx(f), "input").every((e) => propText(e, "type") !== '"range"')));

console.log("\n  one name, one line (owner, 2026-11-06), at 360px:");
// measured 2026-11-06 at 360px (scratchpad sset/measure.mjs): each name's words, the widest value of each kind
const NAME = {
  "Clickable Glow": 111, "Room glow": 83, "Natural Scroll": 104, "Brightness": 81, "Night dimming": 110,
  "Light effect strength": 155, "Map look": 68, "Summary bar": 101, "Villa lighting": 94, "Eye height": 79,
  "Walk speed": 87, "Full screen on this tablet": 184, "Language on this tablet": 175, "Maintenance mode": 142,
  "Model north offset": 138, "Days records are kept": 162,
};
const VALUE = { times: 48, metres: 57, degrees: 42 };
const ICON = 16;
const phoneSide = px(/\.modal-body \{\s*padding: \d+px calc\((\d+)px/, layout);
const nameGap = px(/\.setting-row-name \{[^}]*gap: (\d+)px;/);
const icon = px(/\.setting-row-name > svg \{ flex: 0 0 auto; width: (\d+)px; height: \d+px; \}/);
const info = px(/\.setting-row-name > \.info-tip > \.info-btn \{ width: (\d+)px;/);
const rowGap = px(/\.setting-row \{[^}]*gap: \d+px (\d+)px;/);
const valuePad = px(/\.setting-row-value \{[^}]*padding-left: (\d+)px;/);
const phoneOnOff = px(/@media \(max-width: 640px\) \{[^@]*?\.modal \{ --on-off-width: (\d+)px; \}/);
const unitField = px(/\.modal \{ --unit-field: (\d+)px;/);
const consts = { phoneSide, nameGap, icon, info, rowGap, valuePad, phoneOnOff, unitField };
ck("every name of both dialogs is measured (a name whose words change: measure it again)",
   rows.every((r) => Number.isFinite(NAME[r.label])) && Object.values(consts).every(Number.isFinite) && icon === ICON,
   { unmeasured: rows.filter((r) => !Number.isFinite(NAME[r.label])).map((r) => r.label), consts });
ck("  ...a name never wraps and never shrinks: one line, a control that does not fit beside it goes under it",
   /\.setting-row \{ display: flex; flex-wrap: wrap;/.test(modals) && /\.setting-row-name \{[^}]*flex: 1000 0 auto;[^}]*white-space: nowrap;/.test(modals)
   && /\.setting-row-control \{ flex: 1 1 var\(--setting-control\); max-width: 100%;/.test(modals));
ck("  ...on a phone a slider and a choice of several lie under their name, an On | Off and a short field stay at its right",
   /\.setting-slider > \.setting-row-control \{ flex-basis: 100%;/.test(modals)
   && /@media \(max-width: 640px\) \{\s*\.setting-row:not\(\.on-off\):not\(\.setting-field\) > \.setting-row-control \{ flex-basis: 100%; \}/.test(modals));
const inner = 360 - 2 * phoneSide;
const width = (r) => icon + nameGap + NAME[r.label] + (r.tip ? nameGap + info : 0)
  + (r.value ? valuePad + VALUE[/settingValue\.(\w+)/.exec(r.value)[1]] : 0);
for (const r of rows) {
  const beside = r.tag === "OnOffToggle" ? phoneOnOff : r.field ? unitField : 0;
  const need = width(r) + (beside ? rowGap + beside : 0);
  ck(`  "${r.label}"${r.value ? " and its value" : ""}${beside ? (r.field ? " beside its field" : " beside its On | Off") : ""}: ${need}px of ${inner}px`,
     need <= inner, { need, inner });
}

// the laptop (the family's width): several settings to a line, each its name alone on its line, in equal shares
{
  const family = px(/--settings-width: (\d+)px;/, css("01-base.css"));
  const bodySide = px(/^\.modal-body \{[^}]*padding: \d+px (\d+)px/m);
  const lineGap = px(/\.setting-line \{ display: flex; gap: (\d+)px;/);
  const tree = parseTsx("components/settings/SettingsModal.tsx");
  const lines = elements(tree, "div").filter((d) => propText(d, "className") === '"setting-line"')
    .map((d) => rows.filter((r) => r.file.endsWith("SettingsModal.tsx") && d.getText().includes(`label="${r.label}"`)));
  for (const line of lines) {
    const share = (family - 2 * bodySide - (line.length - 1) * lineGap) / line.length;
    const widest = Math.max(...line.map((r) => icon + nameGap + NAME[r.label] + (r.tip ? nameGap + info : 0)));
    ck(`  on a laptop (${family}px): ${line.map((r) => r.label).join(", ")}: each name on its line, ${widest}px of ${Math.floor(share)}px`,
       line.length > 1 && widest <= share, { widest, share });
  }
}

console.log("\n  one segmented control, one tool group:");
const { default: SegmentedGroup } = await import("@/components/common/SegmentedGroup");
const icons = draw(h(SegmentedGroup, { ariaLabel: "Villa lighting", className: "segmented-icons", active: "a", onChange() {},
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }] }));
ck("an icon choice is the one .segmented (Villa lighting, the theme): no size of its own, its height and padding the group's",
   /^<div class="segmented segmented-icons" role="group"/.test(icons) && !/daynight/.test(modals)
   && !/\.segmented-icons \{[^}]*padding/.test(modals) && !/\.segmented-icons button \{[^}]*min-height/.test(modals)
   && FILES.every((f) => !/daynight-segmented/.test(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8"))), icons);
ck("  ...an On | Off the same width on every line, half the control column on a wide screen",
   /\.setting-row\.on-off > \.setting-row-control \{ flex: 0 0 var\(--on-off-width\);/.test(modals) && /--setting-control: 240px; --on-off-width: 120px;/.test(modals));
const { default: ToolGroup } = await import("@/components/common/ToolGroup");
const tools = draw(h(ToolGroup, { label: "Device telemetry" }, h("button", { type: "button", "aria-label": "Refresh", title: "Re-read" }, h("svg"), h("span", { className: "btn-label" }, "Refresh"))));
ck("  ...the header's buttons and the telemetry's toolbar are the one tool group, on the segmented control's track",
   tools === '<div class="tool-group" role="group" aria-label="Device telemetry"><button type="button" aria-label="Refresh" title="Re-read"><svg></svg><span class="btn-label">Refresh</span></button></div>'
   && /^\.segmented, \.tool-group \{ display: flex; gap: 4px; padding: 4px; border-radius: var\(--radius-pill\); background: var\(--bg-input\); \}/m.test(modals)
   && elements(parseTsx("components/settings/ConfigEditorModal.tsx"), "ToolGroup").length === 1
   && elements(parseTsx("components/settings/TelemetryPanel.tsx"), "ToolGroup").length === 1, tools);
const panel = parseTsx("components/settings/TelemetryPanel.tsx");
const toolButtons = elements(panel, "button").filter((b) => propText(b, "role") !== '"menuitem"').filter((b) => { for (let n = b.parent; n; n = n.parent) if (/^<ToolGroup\b/.test(n.getText?.() ?? "")) return true; return false; });
ck("  ...every telemetry tool keeps its name and its tooltip (its word hidden on a phone)",
   toolButtons.length === 5 && toolButtons.every((b) => propText(b, "aria-label") && propText(b, "title")), toolButtons.map((b) => propText(b, "aria-label")));

console.log("\n  one look for \"this opens more\":");
const { default: Fold } = await import("@/components/settings/Fold");
const fold = quiet(() => draw(h(Fold, { title: "Grouped devices", tip: "What it does.", summary: "1 group · 2 suggested" }, h("p", null, "inside"))));
ck("a folded section is the Cockpit's: its chevron, then its title, what it holds after it, its (i) right after",
   /^<section class="messages-section"><div class="cockpit-issues-head"><div class="with-tip"><button type="button" class="fold-toggle messages-section-toggle settings-section-title" aria-expanded="false"><svg[\s\S]*?lucide-chevron-right[\s\S]*?<\/svg><span class="fold-toggle-words">Grouped devices<\/span><span class="section-summary">1 group · 2 suggested<\/span><\/button><span class="info-tip/.test(fold)
   && !/inside/.test(fold), fold);
const { ShowAll } = await import("@/components/common/TruncatedList");
const more = draw(h(ShowAll, { list: { visible: [], hidden: 114, expanded: false, paged: null, toggle() {}, go() {} }, noun: "entity", plural: "entities" }));
ck("  ...a list inside a section opens by the same chevron and words, never an outlined button",
   /^<button type="button" class="fold-toggle mt" aria-expanded="false"><svg[\s\S]*?lucide-chevron-right[\s\S]*?<\/svg>Show all, 114 more entities<\/button>$/.test(more), more);
const settingsDir = ["BindingsTable", "GroupedDevices", "UnavailableByDesign", "ConfigEditor"].map((n) => readFileSync(new URL(`../../src/components/settings/${n}.tsx`, import.meta.url), "utf8"));
ck("  ...Bound 3D objects' lists and the suggested groups too: no chevron drawn by hand in Advanced Settings' sections",
   settingsDir.every((s) => !/<Chevron(?:Down|Right)\b/.test(s)) && !/fm-disclosure/.test(modals + css("07-facility.css")));

console.log("\n  the rows' parts:");
const { default: UnitField } = await import("@/components/common/UnitField");
const unit = draw(h(UnitField, { unit: "s" }, h("input", { value: "10", readOnly: true })));
ck("a time and its unit joined in one field: \"10s\"", unit === '<span class="unit-field"><input readonly="" value="10"/><span class="unit-field-unit" aria-hidden="true">s</span></span>', unit);
ck("  ...the small icon button of a row: round, borderless, one size (the announcements' ✕, a device's pencil and bin, a group's bin, an unbind)",
   /\.icon-btn-sm \{ width: var\(--row-icon\); height: var\(--row-icon\);[^}]*border: 0; border-radius: 50%; background: transparent;/.test(modals)
   && ["MessagesSettings", "EntityMapRow", "GroupedDevices", "BindingRow"].every((n) => /className="icon-btn-sm/.test(readFileSync(new URL(`../../src/components/settings/${n}.tsx`, import.meta.url), "utf8")))
   && ["EntityMapRow", "GroupedDevices", "BindingRow"].every((n) => !/className="icon-btn( |")/.test(readFileSync(new URL(`../../src/components/settings/${n}.tsx`, import.meta.url), "utf8"))));
const { default: AddOnLine } = await import("@/components/common/AddOnLine");
const add = quiet(() => draw(h(AddOnLine, { title: "Owner", label: "Add a chat or phone to Owner", words: "Add" }, () => null)));
ck("  ...a list's add: \"+ Add\" at the right of its title's line (Schedule's \"Add a task\" look), never an outlined square",
   /^<div class="add-line"><span class="add-line-title">Owner<\/span><button type="button" class="btn ghost add-line-button" aria-label="Add a chat or phone to Owner"><svg[\s\S]*?lucide-plus[\s\S]*?<\/svg> Add<\/button>/.test(add), add);
const { default: IdText, idParts } = await import("@/components/common/IdText");
const id = draw(h(IdText, { id: "fan.example_house_guest_room" }));
ck("an entity id breaks after its dots and underscores only, never mid-word (\"…_roo / m\")",
   JSON.stringify(idParts("fan.example_house_guest_room")) === JSON.stringify(["fan.", "example_", "house_", "guest_", "room"])
   && id === "fan.<wbr/>example_<wbr/>house_<wbr/>guest_<wbr/>room" && text(id).replace(/\|/g, "") === "fan.example_house_guest_room"
   && /\.entity-id-text \{[^}]*overflow-wrap: break-word;/.test(modals) && !/break-all|overflow-wrap: anywhere/.test(readFileSync(new URL("../../src/components/settings/BindingsTable.tsx", import.meta.url), "utf8")), id);

console.log("\n  the telemetry's moments, the villa's time, the app's format:");
const { telemetryTime } = await import("@/components/settings/TelemetryPanel");
const { momentText, docDate, clockTime } = await import("@/utils/dateText");
const at = "2026-11-05T09:55:13.120+00:00";
ck("an event's time is the app's moment with its seconds, \"05/11/2026 17:55:13\", never the store's \"2026-11-05 09:55:13Z\"",
   /^\d\d\/\d\d\/\d{4} \d\d:\d\d:13$/.test(telemetryTime(at)) && telemetryTime(at) === `${docDate(at)} ${clockTime(at)}:13`
   && telemetryTime(at) === momentText(at, true) && momentText(at) === `${docDate(at)} ${clockTime(at)}` && telemetryTime(undefined) === "",
   telemetryTime(at));
ck("  ...and the panel writes every event's time with it", /<span className="muted telemetry-time">\{telemetryTime\(e\.at\)\}<\/span>/.test(panel.getText()));

console.log("\n  Villa:");
const { coordinateText } = await import("@/components/settings/ConfigEditorModal");
ck("a coordinate not being typed shows 6 decimals at most (the stored number is never rounded)",
   coordinateText(-8.6478123456789) === "-8.647812" && coordinateText(115.1385987654321) === "115.138599" && coordinateText(115.1) === "115.1",
   [coordinateText(-8.6478123456789), coordinateText(115.1385987654321)]);
ck("  ...\"Set North\" a secondary button like the others (.btn ghost)", /<button className="btn ghost" disabled=\{!viewHeadingDeg\}/.test(readFileSync(new URL("../../src/components/settings/ConfigEditorModal.tsx", import.meta.url), "utf8")));

console.log("\n  the laptop:");
ck("Settings and Advanced Settings share one width, said once",
   /--settings-width: 780px;/.test(css("01-base.css")) && /^\.settings-modal \{ max-width: var\(--settings-width\); \}/m.test(modals)
   && /\.settings-modal \{ max-width: var\(--settings-width\); \}/.test(layout) && !/config-editor-modal \{ max-width/.test(modals + layout)
   && /className="settings-modal config-editor-modal"/.test(readFileSync(new URL("../../src/components/settings/ConfigEditorModal.tsx", import.meta.url), "utf8")));

done("✅ Settings and Advanced Settings: one setting line, one segmented look, one folded section, one value format");
