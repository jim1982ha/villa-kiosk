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
ck("  ...and one paragraph in the section's own style says both what it does and how to prepare an entity",
   (bindings.match(/<p className="muted body-text">/g) ?? []).length >= 1 && /To prepare an entity whose 3D object is not in the model yet/.test(bindings));

const rule = css.match(/\.telemetry-row > \.telemetry-summary \{([^}]*)\}/)?.[1] ?? "";
ck("a telemetry row is one line: the summary does not wrap and ends in …",
   /white-space:\s*nowrap/.test(rule) && /text-overflow:\s*ellipsis/.test(rule) && /overflow:\s*hidden/.test(rule) && !/overflow-wrap/.test(rule), rule);
ck("  ...its full text is the summary's tooltip", /className="telemetry-summary" title=\{summarise\(e\)\}/.test(src("components/settings/TelemetryPanel.tsx")));

done("✅ north under the coordinates, one Bound 3D objects section, one line per telemetry event");
