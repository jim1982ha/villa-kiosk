// Every time the Kiosk shows is on the VILLA'S clock (owner, 2026-10-28: "cards match Telegram wherever the phone is"):
// the villa system's own time zone (its configuration's time_zone, utils/villaClock), never the reading device's, and
// the device's only until that configuration is known. Driven with this process on ANOTHER zone than the villa's (it
// re-runs itself under TZ=America/Los_Angeles), fixed instants through every formatter and every day cut, then the
// tree audited: nothing else reads a Date's own clock.
// ⚠️ Dates are locale-shaped (CI is en-US): a locale-formatted text is compared with the same formatter given the
// villa's zone, never with a written-out string; only the fixed forms (momentText, docDate) are spelled.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const DEVICE = "America/Los_Angeles";
if (process.env.TZ !== DEVICE) {
  const r = spawnSync(process.execPath, ["--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, TZ: DEVICE } });
  process.exit(r.status ?? 1);
}
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ck, done, tsFiles } from "../consistency/check.mjs";
const Z = await import("@/utils/villaClock");
const T = await import("@/utils/dateText");
const L = await import("@/utils/localDay");
const { monthKey, monthBounds } = await import("@/fm/fmEngine");
const { momentText } = T;
const { nextCheckAt } = await import("@/fm/faultTiming");
const { fmtChartStamp } = await import("@/components/panels/chartUtils");
const { firstCellStart } = await import("@/utils/timelineCells");
const { weekdayShort } = await import("@/components/panels/energyRanges");

const at = Date.parse("2026-10-27T17:30:00Z");            // 10:30 on the 27th on the device, 02:30 on the 28th in Tokyo
const nightly = [{ check: "nightly" }], cadence = { checkMinutes: 5, nightlyAt: "02:00" };
const evening = new Date("2026-10-27T12:00:00Z");          // 05:00 on the device, 21:00 in Tokyo

console.log("  until the villa's configuration is known: the device's clock");
ck("the fixed forms on the device's zone", T.momentText(at) === "27/10/2026 10:30" && T.docDate(at) === "27/10/2026", [T.momentText(at), T.docDate(at)]);
ck("  ...and the day starts at the device's midnight", L.localMidnight(at) === Date.parse("2026-10-27T07:00:00Z"), new Date(L.localMidnight(at)).toISOString());

console.log("\n  the villa's zone set (as the connection's configuration sets it): every time on the villa's clock");
Z.setVillaTimeZone("Asia/Tokyo");
ck("the zone is held in one place", Z.villaTimeZone() === "Asia/Tokyo");
ck("a Telegram-shaped moment (momentText): the villa's day and time", T.momentText(at) === "28/10/2026 02:30", T.momentText(at));
ck("  ...a document's date (docDate): the villa's day, day first as Telegram writes it (owner, 2026-10-29)",
   T.docDate(at) === "28/10/2026", T.docDate(at));
const fmt = (fn, opts) => new Date(at)[fn]([], { ...opts, timeZone: "Asia/Tokyo" });
const device = (fn, opts) => new Date(at)[fn]([], opts);
const forms = [
  ["clockTime", T.clockTime(at), fmt("toLocaleTimeString", { hour: "2-digit", minute: "2-digit" }), device("toLocaleTimeString", { hour: "2-digit", minute: "2-digit" })],
  ["dayMonth", T.dayMonth(at), fmt("toLocaleDateString", { day: "numeric", month: "short" }), device("toLocaleDateString", { day: "numeric", month: "short" })],
  ["dayTime", T.dayTime(at), fmt("toLocaleString", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), device("toLocaleString", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })],
  ["fullDate", T.fullDate(at), fmt("toLocaleDateString", { day: "2-digit", month: "short", year: "numeric" }), device("toLocaleDateString", { day: "2-digit", month: "short", year: "numeric" })],
  ["stampText", T.stampText(at), fmt("toLocaleString", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), device("toLocaleString", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })],
  ["weekday (Energy)", weekdayShort(at), fmt("toLocaleDateString", { weekday: "short" }), device("toLocaleDateString", { weekday: "short" })],
];
for (const [name, got, villa, dev] of forms)
  ck(`  ...${name}: the villa's, not the device's`, got === villa && got !== dev, { got, villa, dev });
const end = Date.parse("2026-10-31T16:00:00Z");             // 1 Nov, 01:00 in Tokyo; still 31 Oct on the device
const mon = Z.villaTime(2026, 10, 1), mon2 = Z.villaTime(2026, 11, 1);
ck("  ...the month a figure is filed under, and its bounds", monthKey(end) === "2026-11"
   && monthBounds("2026-11").start === Date.parse("2026-10-31T15:00:00Z") && mon === Date.parse("2026-09-30T15:00:00Z") && mon2 === Date.parse("2026-10-31T15:00:00Z"),
   [monthKey(end), monthBounds("2026-11")]);
ck("the villa's day: its midnight, the day before, the month's first", L.localMidnight(at) === Date.parse("2026-10-27T15:00:00Z")
   && L.localMidnight(at, -1) === Date.parse("2026-10-26T15:00:00Z") && L.localMonthStart(at) === Date.parse("2026-09-30T15:00:00Z"),
   [L.localMidnight(at), L.localMidnight(at, -1), L.localMonthStart(at)].map((t) => new Date(t).toISOString()));
ck("  ...a week's cells start on the villa's Monday", firstCellStart(at, 7 * 86_400_000) === Date.parse("2026-10-25T15:00:00Z"),
   new Date(firstCellStart(at, 7 * 86_400_000)).toISOString());
ck("the card's next nightly check: 02:00 at the villa, as Telegram says it", nextCheckAt(nightly, cadence, evening)?.toISOString() === "2026-10-27T17:00:00.000Z",
   nextCheckAt(nightly, cadence, evening)?.toISOString());
{
  const RealNow = Date.now;
  Date.now = () => Date.parse("2026-10-28T00:00:00Z");      // 09:00 on the 28th in Tokyo, 17:00 on the 27th on the device
  const tip = fmtChartStamp(Date.parse("2026-10-27T16:00:00Z"), 24);   // 01:00 on the 28th in Tokyo: today there
  Date.now = RealNow;
  ck("a chart's tooltip: \"today\" is the villa's (the time alone)", tip === T.clockTime(Date.parse("2026-10-27T16:00:00Z")), tip);
}

console.log("\n  a zone with summer time (the villa's days are 23 or 25 hours on its own change):");
Z.setVillaTimeZone("Europe/Paris");
ck("the day the clocks go back: its midnight is the summer one", L.localMidnight(Date.parse("2026-10-25T12:00:00Z")) === Date.parse("2026-10-24T22:00:00Z"));
ck("  ...and 09:00 a day later is still 09:00", L.addLocalDays(Date.parse("2026-10-24T07:00:00Z"), 1) === Date.parse("2026-10-25T08:00:00Z"),
   new Date(L.addLocalDays(Date.parse("2026-10-24T07:00:00Z"), 1)).toISOString());
ck("  ...a time on either side of the change", Z.villaTime(2026, 10, 25, 1, 30) === Date.parse("2026-10-24T23:30:00Z")
   && Z.villaTime(2026, 10, 25, 12) === Date.parse("2026-10-25T11:00:00Z"));
{
  // an older engine (an older iPhone) writes midnight as "24" under hour12: false: still hour 0
  const Real = Intl.DateTimeFormat;
  Intl.DateTimeFormat = class extends Real {
    formatToParts(d) { return super.formatToParts(d).map((x) => (x.type === "hour" && x.value === "00" ? { ...x, value: "24" } : x)); }
  };
  Z.setVillaTimeZone("Asia/Tokyo");
  const w = Z.wallClock(Date.parse("2026-10-27T15:10:00Z"));
  Intl.DateTimeFormat = Real;
  Z.setVillaTimeZone("Europe/Paris");
  ck("  ...midnight written \"24\" by an older engine is hour 0 of the new day", w.hour === 0 && w.day === 28 && w.minute === 10, w);
}
Z.setVillaTimeZone("Not/AZone");
ck("a zone the device does not know leaves the zone as it was", Z.villaTimeZone() === "Europe/Paris");

console.log("\n  the one place, and who sets it:");
const SRC = new URL("../../src/", import.meta.url).pathname;
const store = readFileSync(`${SRC}ha/entityStore.ts`, "utf8");
ck("the connection's configuration sets the zone before it is shown (entityStore)",
   /setVillaTimeZone\(haConfig\?\.time_zone\);\s*this\.set\(\{ haConfig \}\)/.test(store));
// A Date's own clock: its getters and setters, its multi-number constructor, a locale format without the villa's zone.
const OWN = new Set(["getHours", "getMinutes", "getSeconds", "getDate", "getDay", "getMonth", "getFullYear",
  "setHours", "setMinutes", "setDate", "setFullYear"]);
const hits = [];
for (const f of tsFiles(SRC)) {
  const rel = f.slice(SRC.length);
  if (rel === "utils/villaClock.ts") continue;
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text, line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      if (OWN.has(name)) hits.push(`${rel}:${line} ${name}`);
      const opts = n.arguments[1];
      const dated = name === "toLocaleTimeString" || name === "toLocaleDateString"
        || (name === "toLocaleString" && (!opts || /\b(hour|minute|day|month|year|weekday)\b/.test(opts.getText())) && /Date|\bd\b/.test(n.expression.expression.getText()));
      if (dated && !(opts && ts.isCallExpression(opts) && opts.expression.getText() === "inVillaZone")) hits.push(`${rel}:${line} ${name}`);
    }
    if (ts.isNewExpression(n) && n.expression.getText() === "Date" && (n.arguments?.length ?? 0) > 1)
      hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} new Date(y, m, …)`);
    if (ts.isPropertyAccessExpression(n) && n.expression.getText() === "Intl" && n.name.text === "DateTimeFormat")
      hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} Intl.DateTimeFormat`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
ck("nothing outside villaClock reads a Date's own clock or formats a date without the villa's zone", hits.length === 0, hits);

done("✅ every time shown is the villa's, wherever the device is");
