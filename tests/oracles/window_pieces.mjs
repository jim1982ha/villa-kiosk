// The pieces the Weather and Energy windows share, written once (round-6
// candidate 6, 2.496.119): the figure, the observation cards, local midnight
// and live power. Each had two to four copies; the energy flow wrote the
// grid's power as "0.95 kW" beside a device's "948 W".
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
const { fmtPower, powerKw } = await import("@/config/energyModel");
const { localMidnight, localMonthStart } = await import("@/utils/localDay");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  the rules:");
ck("power under 1 kW is in watts; the grid's 0.948 kW reads '948 W', like a device's", fmtPower(0.948) === "948 W" && fmtPower(3.084) === "3.08 kW" && fmtPower(1) === "1.00 kW");
const t = new Date(2026, 8, 26, 15, 30).getTime();
ck("local midnight is the day's 00:00 in the villa's own clock", new Date(localMidnight(t)).getHours() === 0 && new Date(localMidnight(t)).getDate() === 26);
ck("  ...moved by whole days, across a month's end", new Date(localMidnight(t, 5)).getDate() === 1 && new Date(localMidnight(t, 5)).getMonth() === 9);
ck("a month's start is the 1st at 00:00, moved by whole months", new Date(localMonthStart(t, -9)).getMonth() === 11 && new Date(localMonthStart(t, -9)).getFullYear() === 2025);

ck("live power through the app's unit table: W, kW, and a milliwatt is NOT a megawatt",
   powerKw("948", "W") === 0.948 && powerKw("3.08", "kW") === 3.08 && powerKw("500", "mW") === 0.0005 && powerKw("2", "MW") === 2000);
ck("  ...an ambiguous or unknown unit, or a non-number, cannot be said (undefined), never a guess",
   powerKw("5", "mw") === undefined && powerKw("5", "lux") === undefined && powerKw("unavailable", "W") === undefined);
ck("  ...no unit: watts, as HA's power sensors default", powerKw("1200", undefined) === 1.2);

console.log("\n  one copy of each:");
const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
const files = walk(SRC).map((f) => [f.slice(SRC.length), readFileSync(f, "utf8")]);
const having = (re) => files.filter(([, s]) => re.test(s)).map(([f]) => f);
ck("local midnight: localDay.ts only", having(/setHours\(0, 0, 0, 0\)/).join() === "utils/localDay.ts", having(/setHours\(0, 0, 0, 0\)/));
ck("no unit fold of its own in the Energy window (toBaseUnit is the table)", !/toLowerCase\(\);\s*return u === "kw"/.test(readFileSync(new URL("../../src/components/panels/EnergyPanel.tsx", import.meta.url), "utf8")));
ck("the W / kW rule: fmtPower only", having(/Math\.round\(kw \* 1000\)/).join() === "config/energyModel.ts", having(/Math\.round\(kw \* 1000\)/));
ck("the observation cards' markup: WindowPieces only", having(/className="weather-advice"/).join() === "components/panels/WindowPieces.tsx", having(/className="weather-advice"/));
ck("the figure: WindowPieces only", having(/function Figure\(/).join() === "components/panels/WindowPieces.tsx", having(/function Figure\(/));
ck("both windows use them", ["components/panels/WeatherPanel.tsx", "components/panels/EnergyPanel.tsx"].every((f) => having(/<ObservationCards cards=/).includes(f) && having(/<Figure\b[^>]*\blabel=/).includes(f)));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ the windows' shared pieces, once each");
