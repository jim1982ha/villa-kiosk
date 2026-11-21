// Every screen width at which a layout changes is one of the named set (config/breakpoints.ts).
//
// Until 2026-11-21 the stylesheets switched layouts at ten widths (480, 560, 640, 720, 860, 1000, 1024, 1180 and their
// min-width twins), each chosen where its rule was written, so a screen 500 wide got the phone's weather tiles but not
// its sliders. CSS has no named media queries: the literal values are checked against the one table instead.
import { readdirSync, readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const { BREAKPOINTS } = await import("@/config/breakpoints");
const { PHONE_MAX_CSS_WIDTH } = await import("@/babylon/badgeMetrics");

const tiers = Object.values(BREAKPOINTS);
const maxOk = new Set([...tiers.filter((v) => v !== BREAKPOINTS.desktop), BREAKPOINTS.desktop - 1]);
const minOk = new Set([...tiers.filter((v) => v !== BREAKPOINTS.desktop).map((v) => v + 1), BREAKPOINTS.desktop]);

const dir = new URL("../../src/styles/", import.meta.url);
const stray = [];
let seen = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
  const css = readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const q of css.matchAll(/@media[^{]*/g)) {
    for (const m of q[0].matchAll(/\((max|min)-width:\s*(\d+)px\)/g)) {
      seen++;
      if (!(m[1] === "max" ? maxOk : minOk).has(Number(m[2]))) stray.push(`${f}: ${m[0]}`);
    }
  }
}
ck(`the stylesheets' ${seen} width queries all use the named widths`, seen > 0 && stray.length === 0, stray);
ck("the badges' phone is the stylesheets' phone held sideways", PHONE_MAX_CSS_WIDTH === BREAKPOINTS.largePhone);

done("✅ one set of screen widths");
