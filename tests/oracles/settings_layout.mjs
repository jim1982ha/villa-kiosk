// Where three Settings pieces live and how they read (owner, 2026-10-12):
//  * the model's north offset and "Set North" sit in Advanced Settings, under
//    the villa's coordinates — not in Settings;
//  * preparing an entity is the device list's own search, in one voice — "Pre-configure a new
//    entity" was a second heading in finer print (in Villa's "Bound 3D objects", whose job is
//    Devices' since 2026-11-06);
//  * the telemetry list is one line per event, ending in "…" when it does not fit.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const advanced = strip(src("components/settings/ConfigEditorModal.tsx"));
const settings = strip(src("components/settings/SettingsModal.tsx"));
const devices = strip(src("components/settings/ConfigEditor.tsx"));
const css = src("styles/08-shared.css");

ck("Settings no longer carries the north offset", !/northOffsetDeg|Set North/.test(settings));
const villa = advanced.slice(advanced.indexOf('tab === "villa"'));
ck("Advanced Settings shows it right under the villa's coordinates",
   /<VillaCoordinates \/>[\s\S]{0,400}<NorthOffset /.test(villa));
// owner, 2026-11-03: Set North BEFORE the slider, both under the one title that names their group
// owner, 2026-11-06: the one slider line (common/SettingSlider), Set North a secondary button at its track's left
ck("  ...Set North, then its slider", /function NorthOffset[\s\S]*<SettingSlider label="Model north offset" value=\{settingValue\.degrees\(deg\)\}[\s\S]*before=\{[\s\S]*<button className="btn ghost"[\s\S]*Set North/.test(advanced)
   && /update\(\{ northOffsetDeg: northOffsetFacing\(h\) \}\)/.test(advanced) && /onChange=\{\(northOffsetDeg\) => update\(\{ northOffsetDeg \}\)\}/.test(advanced));
ck("  ...and the Dashboard hands it the view's heading", /viewHeadingDeg=\{manager \? \(\) => manager\.viewHeadingDeg\(\) : undefined\}/.test(src("pages/Dashboard.tsx")));

ck("Devices has no second heading to prepare an entity", !/Pre-configure a new entity/.test(devices) && (devices.match(/<TipTitle\b/g) ?? []).length === 1);
// its explanation is its title's (i) since 2026-10-22 (owner: no visible description text)
// owner, 2026-11-06: the (i) ran to nine lines ("entity ID", "the add-on"): two short sentences, said at a glance
ck("  ...and its title's ONE (i), two short sentences: what the list is, and that its search finds or prepares a device",
   /<ConfigEditor initialSearch=\{focusEntityId\} title="Auto-detected entity settings" tip=\{<>\s*Every device the 3D villa can show, with its settings\. Pick a list above; type in the search to find a\s+device, or to prepare one whose 3D object is not in the model yet\.\s*<\/>\} \/>/.test(advanced)
   && !/To prepare an entity/.test(devices));
// ...and every (i) of Settings and Advanced Settings the same: at most two sentences, no "entity ID", no "add-on", never
// the platform's name. Read from the source: each `tip=` (a string or a fragment), its expressions left as words.
{
  const tipsOf = (t) => [...t.matchAll(/\btip=(?:"([^"]*)"|\{<>([\s\S]*?)<\/>\})/g)].map((m) => (m[1] ?? m[2]).replace(/\{[^{}]*\}/g, "N").replace(/\s+/g, " ").trim())
    .concat([...t.matchAll(/<InfoTip label="[^"]*">([\s\S]*?)<\/InfoTip>/g)].map((m) => m[1].replace(/<[^>]+>|\{[^{}]*\}|\{?\w+ && \(?|\)?\}/g, " ").replace(/\s+/g, " ").trim()));
  const files = { advanced, settings, model: strip(src("components/settings/CentralModelInfo.tsx")).replace(/[\s\S]*marginTop: 8[^>]*>/, 'tip={<>').replace(/<\/div>\s*<\/>[\s\S]*/, "</>}") };
  const tips = Object.values(files).flatMap(tipsOf).filter((t) => t !== "");
  const sentences = (t) => t.split(/[.!?](?:\s|$)/).filter((x) => x.trim() !== "").length;
  const long = tips.filter((t) => sentences(t) > 2 || /entity ID|add-on|Home Assistant/i.test(t));
  ck("  ...every (i) of Settings and Advanced Settings at most two sentences, in the owner's words", tips.length >= 12 && long.length === 0, [tips.length, long]);
}

const rule = css.match(/\.telemetry-row > \.telemetry-summary \{([^}]*)\}/)?.[1] ?? "";
ck("a telemetry row is one line: the summary does not wrap and ends in …",
   /white-space:\s*nowrap/.test(rule) && /text-overflow:\s*ellipsis/.test(rule) && /overflow:\s*hidden/.test(rule) && !/overflow-wrap/.test(rule), rule);
ck("  ...its full text is the summary's tooltip", /className="telemetry-summary" title=\{summarise\(e\)\}/.test(src("components/settings/TelemetryPanel.tsx")));

// ── owner, 2026-10-22 ─────────────────────────────────────────────────────────────────────────────────────────
console.log("\n  Villa location on one line where there is room:");
{
  const modals = src("styles/04-modals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const basis = (cls) => Number(new RegExp(`\\.${cls} \\{ flex: \\d+ 1 (\\d+)px;`).exec(modals)?.[1]);
  const gap = Number(/\.villa-location-row \{ display: flex; flex-wrap: wrap; align-items: flex-end; gap: (\d+)px; \}/.exec(modals)?.[1]);
  const coord = basis("villa-location-coord"), north = basis("villa-location-north");
  const line = (w) => 2 * coord + north + 2 * gap <= w;          // all three on one line in a body `w` wide
  ck("Latitude, Longitude and the north offset share one line in the desktop dialog (724 px of body)", line(724), { coord, north, gap });
  ck("  ...on a phone (324 px) the two coordinates share a line and the offset wraps under them",
     !line(324) && 2 * coord + gap <= 324 && north <= 324, { coord, north, gap });
  ck("  ...the three in that one row, each label above its field",
     /<div className="villa-location-row">\s*<VillaCoordinates \/>\s*<NorthOffset viewHeadingDeg=\{viewHeadingDeg\} \/>\s*<\/div>/.test(advanced)
     && /<div className="villa-location-coord">\s*<label htmlFor=\{id\}>/.test(advanced)
     && /<div className="villa-location-north">\s*<SettingSlider label="Model north offset"/.test(advanced));
  // owner, 2026-11-03: the slider half as wide, the width it gave up to the coordinates (their values were cut)
  ck("  ...the offset's group takes no more of the line than the two coordinates together",
     north <= 2 * coord && /\.villa-location-north \{ flex: 1 1/.test(modals), { coord, north });
}

console.log("\n  one line per setting, its name left and its control right (owner, 2026-11-03: \"the same layout\"):");
{
  const modals = src("styles/04-modals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const { elements, parseTsx, propText } = await import("../consistency/jsx.mjs");
  const tree = parseTsx("components/settings/SettingsModal.tsx");
  // every slider and every segmented choice of the dialog's body sits directly in a SettingRow (Interface, the header's
  // theme, is not a setting line; the Messages tab's chat grid stands as its section's own line)
  const inRow = (e) => { for (let n = e.parent; n; n = n.parent) { if (/^<SettingRow\b/.test(n.getText?.() ?? "")) return true; } return false; };
  // every slider is the one slider line (common/SettingSlider: a SettingRow, its value at the end of its name's line)
  const sliders = elements(tree, "SettingSlider");
  const names = sliders.map((e) => propText(e, "label"));
  ck("every slider is a setting line: the one SettingSlider, its name its words alone, its value beside it",
     JSON.stringify(names) === JSON.stringify(['"Brightness"', '"Night dimming"', '"Light effect strength"', '"Eye height"', '"Walk speed"'])
     && sliders.every((e) => /^settingValue\.(times|metres)\(/.test(propText(e, "value") ?? ""))
     && elements(tree, "input").every((e) => propText(e, "type") !== '"range"'), names);
  const choices = elements(tree, "SegmentedGroup").map((e) => [propText(e, "ariaLabel"), inRow(e)]);
  ck("  ...and Villa lighting, Map look's Icon | Card and the tablet's language, each with a name of its own",
     ['"Villa lighting"', '"Floating badge style"', '"Language on this tablet"'].every((n) => choices.some(([c, r]) => c === n && r))
     && /label="Map look"/.test(src("components/settings/SettingsModal.tsx")), choices);
  ck("  ...no pair or third of a line is left", !/settings-third|settings-row-half/.test(modals + src("components/settings/SettingsModal.tsx")));
  // owner, 2026-11-03: on a wide screen several to a line, each its name over its control; a phone one per line
  const lines = elements(tree, "div").filter((d) => propText(d, "className") === '"setting-line"')
    .map((d) => [...d.getText().matchAll(/(?<![-\w])label=\{?[`"]([^`"$]+?)(?: · |[`"])/g)].map((m) => m[1].trim()));
  ck("on a wide screen: Clickable Glow, Room glow, Natural Scroll; Brightness, Night dimming, Light effect strength; Map "
     + "look, Summary bar, Villa lighting; Eye height, Walk speed, each set on one line",
     JSON.stringify(lines.map((l) => l.filter((n) => ["Clickable Glow", "Room glow", "Natural Scroll", "Brightness",
       "Night dimming", "Light effect strength", "Villa lighting", "Map look", "Summary bar", "Eye height", "Walk speed"].includes(n))))
     === JSON.stringify([["Clickable Glow", "Room glow", "Natural Scroll"], ["Brightness", "Night dimming", "Light effect strength"],
       ["Map look", "Summary bar", "Villa lighting"], ["Eye height", "Walk speed"]]), lines);
  const wide = /@media \(min-width: (\d+)px\) \{\s*\.setting-line \{ display: flex;/.exec(modals);
  ck("  ...only on a wide screen (a phone keeps one per line), each its name over its control, in equal shares",
     !!wide && Number(wide[1]) > 560 && /\.setting-line > \.setting-row \{ flex: 1 1 0; flex-direction: column;/.test(modals)
     && !/^\.setting-line \{/m.test(modals), wide?.[1]);
  // owner, 2026-11-06: the name never shrinks below its words; the control takes the column, under the name when it
  // does not fit beside it (measured: settings_grammar.mjs)
  ck("  ...its control in a column of one width on every line, the name one line taking what is left",
     /\.setting-row-control \{ flex: 1 1 var\(--setting-control\);/.test(modals) && /\.setting-row-name \{[^}]*flex: 1000 0 auto;[^}]*white-space: nowrap;/.test(modals));
  const toggle = src("components/common/OnOffToggle.tsx");
  const onOff = Number(/--on-off-width: (\d+)px/.exec(modals)?.[1]), column = Number(/--setting-control: (\d+)px/.exec(modals)?.[1]);
  ck("an On | Off is that line too, half the control column wide (owner: \"50% less wide\")",
     /<SettingRow className=\{`on-off/.test(toggle) && onOff * 2 === column
     && /\.setting-row-control > \.segmented\.on-off-switch \{ flex: 0 0 var\(--on-off-width\); width: var\(--on-off-width\); \}/.test(modals),
     { onOff, column });
}

console.log("\n  every field's text, one size:");
{
  const all = ["styles/04-modals.css", "styles/07-facility.css"].map((f) => src(f).replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  ck("the dialog fields, the Cockpit's form fields and the search pickers read ONE size (--field-text)",
     /\.modal input, \.modal select \{[^}]*font-size: var\(--field-text\);/.test(all)
     && /\.fm-field > input, \.fm-field > select, \.fm-field > textarea \{[^}]*font-size: var\(--field-text\);/.test(all)
     && /\.config-search input \{[^}]*font-size: var\(--field-text\);/.test(all)
     && /--field-text: var\(--text-base\);/.test(src("styles/01-base.css")));
  const { readdirSync, statSync } = await import("node:fs");
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p); } };
  walk(new URL("../../src/components", import.meta.url).pathname);
  const styled = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/<input\b[^>]*inputMode="(?:numeric|decimal)"[^>]*>/g)]
    .filter((m) => /style=/.test(m[0])).map(() => f.split("/src/")[1]));
  ck("  ...no number field carries a style of its own", styled.length === 0, styled);
}

console.log("\n  Maintenance records:");
// owner, 2026-11-06: a setting line like every other, its name one line ("Days records are kept"); the owner's sentence
// (2026-10-22) leads the section title's (i)
ck("its (i) is the section title's, the owner's words then everything it deletes; the field's label is one short line, with no (i)",
   /<TipTitle title="Maintenance records" tip=\{<>\s*How many days faults, tickets, attachments and messages are kept: photos, repaired faults, work done, money\s+spent and messages/.test(advanced)
   && /<SettingRow className="setting-field" icon=\{<CalendarClock size=\{16\} \/>\} label=\{<label htmlFor="records-kept">Days records are kept<\/label>\}>/.test(advanced)
   && !/<InfoTip/.test(advanced.slice(advanced.indexOf("function RecordsKept"), advanced.indexOf("function LogoutAll"))));

done("✅ north under the coordinates, preparing an entity in Devices' one field, one line per telemetry event");
