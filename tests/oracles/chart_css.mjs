// The chart styles, measured as the BROWSER resolves them: every stylesheet in
// styles.css's @import order, and for an element's own classes the winning
// declaration by specificity, then source order. A regex on one rule's text
// passed over both defects this guards (2.496.190):
//   * the tooltip carries `spark-tip chart-tip`; `.spark-tip { z-index: 5 }`
//     in a LATER file beat `.chart-tip { z-index: 300 }`, putting every chart
//     tooltip behind its modal (the backdrop is z-index 70);
//   * the line-chart skeleton carries `state-timeline-skeleton weather-chart`;
//     the timeline's 78 px beat the chart's 150 px from a later file.
import { readFileSync } from "node:fs";

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

const ROOT = new URL("../../src/", import.meta.url);
const index = readFileSync(new URL("styles.css", ROOT), "utf8");
const files = [...index.matchAll(/@import "\.\/(styles\/[^"]+)";/g)].map((m) => m[1]);
// Top-level rules only (media blocks are skipped: none of these rules is
// media-scoped, and a guard that pretended otherwise would be lying).
const rules = [];
for (const f of files) {
  let css = readFileSync(new URL(f, ROOT), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0, sel = "", body = "";
  for (const ch of css) {
    if (ch === "{") { depth++; if (depth === 1) { body = ""; continue; } }
    if (ch === "}") { depth--; if (depth === 0) { if (!/^\s*@/.test(sel)) rules.push({ f, sel: sel.trim(), body }); sel = ""; continue; } }
    if (depth === 0) sel += ch; else if (depth === 1) body += ch; else body += "";
  }
}
/** The value `prop` resolves to on an element carrying exactly `classes`. */
function resolve(classes, prop) {
  let best = null;
  rules.forEach((r, order) => {
    for (const s of r.sel.split(",").map((x) => x.trim())) {
      if (!/^(\.[\w-]+)+$/.test(s)) continue;            // simple compound class selectors only
      const need = s.slice(1).split(".");
      if (!need.every((c) => classes.includes(c))) continue;
      const m = r.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (!m) continue;
      const spec = need.length;
      if (!best || spec > best.spec || (spec === best.spec && order >= best.order)) best = { spec, order, v: m[1].trim(), f: r.f };
    }
  });
  return best;
}
ck(`read the cascade (${files.length} stylesheets, ${rules.length} rules)`, files.length >= 8 && rules.length > 500);

const modalZ = Math.max(...["modal-backdrop", "fm-lightbox"].map((c) => Number(resolve([c], "z-index")?.v)));
const tipZ = Number(resolve(["spark-tip", "chart-tip"], "z-index")?.v);
ck("a chart's tooltip stacks ABOVE the modal it belongs to", tipZ > modalZ, { tipZ, modalZ });
ck("the line-chart skeleton is the chart's height, not the timeline strip's",
   resolve(["state-timeline-skeleton", "weather-chart"], "height")?.v === resolve(["weather-chart"], "height")?.v,
   resolve(["state-timeline-skeleton", "weather-chart"], "height"));
ck("  ...and the timeline strip keeps its own", resolve(["state-timeline-skeleton"], "height")?.v === resolve(["state-timeline"], "height")?.v);
const owners = new Set(rules.filter((r) => /\.(spark-|state-timeline|chart-tip)/.test(r.sel)).map((r) => r.f));
owners.delete("styles/08-shared.css");   // reduced-motion / forced-colours overrides, by design
ck("the shared chart rules live in ONE stylesheet", owners.size === 1, [...owners]);
const dead = ["sparkline", "spark-grid", "spark-axis"].filter((c) => rules.some((r) => new RegExp(`\\.${c}\\b`).test(r.sel)));
ck("no rule for a class nothing renders (Sparkline was deleted in 2.496.144)", dead.length === 0, dead);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ chart styles resolve as intended");
process.exit(fail ? 1 : 0);
