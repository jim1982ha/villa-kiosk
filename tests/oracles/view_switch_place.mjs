// The first-person / bird's-eye switch sits under 1F/2F on a roomy screen,
// drawn like them, and stays in the phone's overflow menu (2.496.248).
//
// It had moved to the top bar's right-hand icons; the owner asked for it back
// in the floor section "with the same and consistent style as the 1F/2F
// icons", and for the phone not to change. Checked on the stylesheets' own
// rules and the HUD's markup, not on comments.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const hud = src("components/hud/HUD.tsx");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const code = strip(hud);
const left = code.slice(code.indexOf('<div className="hud-left-col">'), code.indexOf('<div className="bottom-bar">'));
const stack = left.slice(left.indexOf('<div className="hud-stack">'));
const inline = code.slice(code.indexOf('className="hud-right-inline'), code.indexOf('className="hud-group hud-overflow"'));
const menu = code.slice(code.indexOf('className="hud-menu"'));

ck("the switch is in the floor section, after 1F/2F",
   /<ViewControls className="hud-view-btn"/.test(stack) && stack.indexOf("{f}F") < stack.indexOf("<ViewControls"));
ck("  ...and no longer among the top bar's right-hand icons", !/<ViewControls/.test(inline));
ck("  ...drawn like 1F/2F: a plain .icon-btn inside the same .hud-stack, no wrapper of its own",
   /className=\{`icon-btn \$\{className\}`\}/.test(src("components/hud/ViewControls.tsx")) && !/<div/.test(strip(src("components/hud/ViewControls.tsx"))));

// The phone: hidden exactly where the inline controls are, shown again where they come back.
const layout = src("styles/05-layout.css");
const block = (q) => { const i = layout.indexOf(q); let d = 0, j = layout.indexOf("{", i); for (let k = j; k < layout.length; k++) { if (layout[k] === "{") d++; else if (layout[k] === "}" && --d === 0) return layout.slice(j, k); } return ""; };
const compact = block("@media (max-width: 640px), (max-height: 560px)");
const landscape = block("@media (min-width: 641px) and (max-height: 560px)");
ck("on a phone it is hidden with the inline controls (same media block as .hud-right-inline)",
   /\.hud-right-inline \{ display: none; \}/.test(compact) && /\.hud-left-col \.hud-view-btn \{ display: none; \}/.test(compact));
ck("  ...and back where they come back (a wide, short screen)",
   /\.hud-right-inline \{ display: flex; \}/.test(landscape) && /\.hud-left-col \.hud-view-btn\.icon-btn \{ display: flex; \}/.test(landscape));
ck("  ...while the phone menu keeps its own row, unchanged",
   /onToggleViewMode\(\); \}\}/.test(menu) && /"First-person view" : "Bird's-eye view"/.test(menu));

done("✅ the view switch sits under 1F/2F; the phone keeps it in its menu");
