// Where three Settings pieces live and how they read (owner, 2026-10-12):
//  * the model's north offset and "Set North" sit in Advanced Settings, under
//    the villa's coordinates — not in Settings;
//  * "Bound 3D objects" is ONE section in one voice — "Pre-configure a new
//    entity" was a second heading in finer print;
//  * the telemetry list is one line per event, ending in "…" when it does not fit.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const advanced = strip(src("components/settings/ConfigEditorModal.tsx"));
const settings = strip(src("components/settings/SettingsModal.tsx"));
const bindings = strip(src("components/settings/BindingsTable.tsx"));
const css = src("styles/08-shared.css");

ck("Settings no longer carries the north offset", !/northOffsetDeg|Set North/.test(settings));
const villa = advanced.slice(advanced.indexOf('tab === "villa"'));
ck("Advanced Settings shows it right under the villa's coordinates",
   /<VillaCoordinates \/>[\s\S]{0,400}<NorthOffset /.test(villa));
ck("  ...with its slider and its Set North button", /function NorthOffset[\s\S]*type="range"[\s\S]*Set North/.test(advanced)
   && /update\(\{ northOffsetDeg:/.test(advanced));
ck("  ...and the Dashboard hands it the view's heading", /viewHeadingDeg=\{manager \? \(\) => manager\.viewHeadingDeg\(\) : undefined\}/.test(src("pages/Dashboard.tsx")));

ck("Bound 3D objects has no second heading of its own", !/Pre-configure a new entity/.test(bindings));
// its explanation is its title's (i) since 2026-10-22 (owner: no visible description text)
ck("  ...and its title's ONE (i) says both what it does and how to prepare an entity — no paragraph of its own",
   /<TipTitle title="Bound 3D objects" tip=\{<>[\s\S]*?To prepare\s+an entity whose 3D object is not in the model yet/.test(advanced)
   && !/To prepare an entity/.test(bindings));

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
     && /<div className="villa-location-north">\s*<label className="with-tip">Model north offset/.test(advanced));
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
ck("its (i) is the section title's, listing everything it deletes; the field's label is the owner's words, with no (i)",
   /<TipTitle title="Maintenance records" tip=\{<>\s*Photos, repaired faults, work done, money spent and messages/.test(advanced)
   && /<label htmlFor="records-kept">How many days tickets, attachments and messages are kept<\/label>/.test(advanced)
   && !/<InfoTip/.test(advanced.slice(advanced.indexOf("function RecordsKept"), advanced.indexOf("const COORD_COMMIT_MS"))));

done("✅ north under the coordinates, one Bound 3D objects section, one line per telemetry event");
