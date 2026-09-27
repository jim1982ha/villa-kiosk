// The history section of a device panel (LastDayTimeline + useStateHistory):
// one look-back rule, and "failed" carried all the way to the chart.
//
// Before 2.496.188 five panels hand-wired range + fetch + status + chart and
// had drifted apart:
//   * GenericPanel drew an offline device's look-back window against "now" —
//     its data fell off the chart;
//   * the binary/text Sensor panels had no look-back at all;
//   * StateTimeline took a `loading` flag, so a FAILED request read "Not
//     enough history yet";
//   * a device group's charts were never told they were loading, and said
//     "Not enough history yet" until the data landed;
//   * a failed Energy setup showed its skeleton forever.
globalThis.window = { location: { origin: "", pathname: "/" } };
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync, readdirSync } from "node:fs";
const { loadStateWindow, historyTitle } = await import("@/hooks/useStateHistory");
const { emptyHistoryText } = await import("@/utils/statisticsSeries");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  what an empty chart says:");
ck("loading draws the skeleton (no text)", emptyHistoryText("loading") === null);
ck("a failed request and an empty answer are two different sentences",
   emptyHistoryText("failed") === "Couldn't load this history." && emptyHistoryText("ready") === "Not enough history yet.");

console.log("\n  the look-back:");
{
  const H = 3_600_000, now = 1_000 * H;
  const rows = (pts) => async (_id, hours) => pts.filter((p) => p.t >= now - hours * H);
  const live = [{ t: now - 2 * H, state: "on" }, { t: now - H, state: "off" }];
  const a = await loadStateWindow("x.y", 24, rows(live));
  ck("a live window is charted as it is, no 'before'", a.lastSeen === undefined && a.data.length === 2, a);
  const dead = [{ t: now - 50 * H, state: "on" }, { t: now - 40 * H, state: "unavailable" }];
  const b = await loadStateWindow("x.y", 24, rows(dead));
  ck("a window dead from end to end moves back to END at the last real reading", b.lastSeen === now - 50 * H, b.lastSeen);
  ck("  ...and charts nothing after it", b.data.length > 0 && b.data.every((p) => p.t <= b.lastSeen), b.data);
  const never = [{ t: now - 5 * H, state: "unavailable" }];
  const c = await loadStateWindow("x.y", 24, rows(never));
  ck("a device never seen in the look-back: the asked-for window, no 'before'", c.lastSeen === undefined && c.data.length === 1, c);
  ck("the header says when a moved window ends", historyTitle("Last 24 hours", b.lastSeen).startsWith("Last 24 hours before ")
     && historyTitle("Last 24 hours", undefined) === "Last 24 hours");
}

console.log("\n  who charts states, and how:");
{
  const DIR = new URL("../../src/components/panels/", import.meta.url);
  const src = (f) => readFileSync(new URL(f, DIR), "utf8");
  const importers = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && f !== "StateTimeline.tsx" && /from "\.\/StateTimeline"/.test(src(f)));
  ck("only the history section and the camera's two-series rail draw a StateTimeline themselves",
     importers.sort().join() === "CameraPanel.tsx,LastDayTimeline.tsx", importers);
  const day = src("LastDayTimeline.tsx");
  ck("the section charts the moved window where it ENDS and titles it", /end=\{lastSeen\}/.test(day) && /title=\{historyTitle\(range\.title, lastSeen\)\}/.test(day));
  ck("  ...and hands the chart the fetch's status whole", /status=\{status\}/.test(day));
  ck("Generic and Sensor (binary and text) use the section", /<LastDayTimeline entityId=\{mapping\.entityId\} legend \/>/.test(src("GenericPanel.tsx"))
     && (src("SensorPanel.tsx").match(/<LastDayTimeline /g) ?? []).length === 2);
  const tl = src("StateTimeline.tsx");
  ck("an empty timeline says what an empty line chart says", /return <ChartEmpty status=\{status\} height=\{height\} bar \/>;/.test(tl));
  ck("a failed Energy setup says so instead of a skeleton forever",
     /<ChartEmpty status=\{status === "failed" \? "failed" : "loading"\} \/>/.test(src("EnergyPanel.tsx")));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one history section: one look-back, three honest empty states");
process.exit(fail ? 1 : 0);
