// The shared UI pieces (2.496.199): SegmentedGroup and SaveButton rendered by
// value, and the hooks that replaced hand-rolled copies — useOutsideClose
// (4 popovers, two of which used mousedown so a touch outside did not close
// them), useInterval (5 tickers) — pinned at their callers.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// ⚠️ Node strips types, not JSX, so a .tsx component cannot be imported here;
// the two components are pinned by SOURCE (what they render), the hooks by
// their callers (no hand-rolled copy left).
const srcOf = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  the segmented group:");
{
  const c = srcOf("components/common/SegmentedGroup.tsx");
  ck("a group: role, name, one button per option, pressed = active", /role="group" aria-label=\{ariaLabel\}/.test(c) && /options\.map\(\(o\) =>/.test(c) && /aria-pressed=\{o\.key === active\}/.test(c) && /className=\{o\.key === active \? "active" : ""\}/.test(c));
  ck("  ...its title is the accessible name for an icon-only option", /title=\{o\.title\} aria-label=\{o\.title\}/.test(c));
  ck("  ...and `active: null` is a toggle that is off", /active: K \| null;/.test(c));
}
console.log("\n  the save button:");
{
  const c = srcOf("components/common/SaveButton.tsx");
  ck("disabled once saved, reads 'Saved' then", /disabled=\{disabled \|\| saved\}/.test(c) && /\{saved \? "Saved" : label\}/.test(c));
}
console.log("\n  no copies left:");
{
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
  const files = walk(join(SRC, "components")).concat(walk(join(SRC, "pages")));
  const rel = (f) => f.slice(SRC.length);
  // Dashboard marks "someone touched the kiosk"; CameraPanel routes taps on
  // its own chrome. Neither is an outside-close.
  const NOT_POPOVERS = new Set(["pages/Dashboard.tsx", "components/panels/CameraPanel.tsx"]);
  const outside = files.filter((f) => /addEventListener\("(pointerdown|mousedown)", /.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !NOT_POPOVERS.has(f));
  ck("no component listens for an outside pointerdown/mousedown itself", outside.length === 0, outside);
  const tickers = files.filter((f) => /setInterval\(/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !/panels\/cameraTiers\.ts$/.test(f));
  ck("no component (bar the camera snapshot poller) owns a setInterval", tickers.length === 0, tickers);
  const seg = files.filter((f) => /className=\{?[`"]segmented[ "`]/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => f !== "components/common/SegmentedGroup.tsx");
  ck("no component hand-rolls `.segmented` markup", seg.length === 0, seg);
  const clocks = files.filter((f) => /toLocaleTimeString\(\[\], \{ hour: "2-digit", minute: "2-digit" \}\)/.test(readFileSync(f, "utf8"))).map(rel);
  ck("the HH:MM clock is fmtChartTime, once", clocks.join() === "components/panels/chartUtils.ts", clocks);
  const saves = files.filter((f) => /\? "Saved" : "Save /.test(readFileSync(f, "utf8"))).map(rel);
  ck("no component writes the Save…/Saved ternary itself", saves.length === 0, saves);
  const css = ["03-panels", "07-facility"].map((n) => readFileSync(join(SRC, `styles/${n}.css`), "utf8")).join("\n");
  ck("chip scrims over media are tokens, not literals", !/background: rgba\(0, ?0, ?0, ?(0?\.45|0?\.5|0?\.6|0?\.65|0?\.7|0?\.88)\)/.test(css) && (css.match(/var\(--chip-scrim/g) ?? []).length === 7);
}
console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one segmented group, one save button, one outside-close, one ticker");
process.exit(fail ? 1 : 0);
