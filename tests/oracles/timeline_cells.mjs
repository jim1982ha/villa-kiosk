// What a state timeline draws, driven by value (utils/timelineCells).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { timelineCells, timelineRuns, cellBackground } = await import("@/utils/timelineCells");


const B = 300_000, now = 1_000 * B;             // bucket-aligned "now"
const at = (k) => now - k * B;                  // k buckets ago
const colour = (s) => ({ on: "red", off: "grey", unavailable: "amber", online: "green" })[s] ?? "x";

{
  const cells = timelineCells([{ t: at(3), state: "off" }, { t: at(2) + 1000, state: "on" }, { t: at(1), state: "off" }], now, 1, B);
  ck("five-minute slices, only where something was in force (from 15 min ago)", cells.length === 3 && cells[0].from === at(3) && Math.abs(cells[0].width - 100 / 12) < 1e-9, cells.length);
  const slice = cells.find((c) => c.from === at(2));
  ck("a slice that saw two states holds both, in order", slice.states.join() === "off,on", slice.states);
  ck("  ...and the transition is filed under the slice it fell in", slice.events.map((e) => e.state).join() === "on");
  ck("  ...and is painted striped", cellBackground(slice.states, colour).startsWith("repeating-linear-gradient"));
  ck("the last state holds until now", cells[cells.length - 1].states.join() === "off");
  const runs = timelineRuns(cells, colour);
  ck("each run is its slices' paint, contiguous", runs.length === 3 && Math.abs(runs.reduce((s, r) => s + r.width, 0) - 25) < 1e-9, runs.map((r) => r.bg));
  const merged = timelineRuns(timelineCells([{ t: at(6), state: "off" }], now, 1, B), colour);
  ck("same-paint neighbours merge into ONE run", merged.length === 1 && Math.abs(merged[0].width - 50) < 1e-9, merged);
}
{
  const cells = timelineCells([{ t: at(12), state: "online" }, { t: at(4), state: "on" }, { t: at(4) + 10_000, state: "on" }, { t: at(3), state: "online" }], now, 1, B, ["online"]);
  const quiet = cells.find((c) => c.from === at(8));
  ck("the resting state paints, but is not a state and never an event", quiet.states.length === 0 && quiet.baseline === "online" && quiet.events.length === 0);
  const back = cells.find((c) => c.from === at(3));
  ck("  ...not even the transition BACK to it", back.events.length === 0 && back.baseline === "online", back.events);
  const busy = cells.find((c) => c.from === at(4));
  ck("two trips in one minute are one tooltip line", busy.events.length === 1, busy.events.length);
}
ck("no history, no cells", timelineCells([], now, 24, B).length === 0);
ck("a window that ended at a sighting is drawn up to it, not to now",
   timelineCells([{ t: at(30), state: "on" }], at(20), 1, B).every((c) => c.to <= at(20)));
const st = readFileSync(new URL("../../src/components/panels/StateTimeline.tsx", import.meta.url), "utf8");
ck("StateTimeline draws exactly these", /timelineCells\(data, end \?\? timeKey, hours, bucketMs,/.test(st) && /const timeKey = bandEnd\(Date\.now\(\), bucketMs\)/.test(st) && /timelineRuns\(cells, colorFor\)/.test(st));

// ── a day's and a week's slice (owner, 2026-10-20: the tooltip follows the chart's step) ──
{
  const { firstCellStart, bandEnd } = await import("@/utils/timelineCells");
  const { DAY_MS } = await import("@/utils/localDay");
  const { cellSummary, fmtCellSpan } = await import("@/components/panels/chartUtils");
  const t = new Date(2026, 9, 15, 14, 30).getTime();             // a Thursday afternoon, the machine's own time zone
  ck("a week's band ends within five minutes of now, never days ahead", bandEnd(t, 7 * DAY_MS) - t <= B && bandEnd(t, 7 * DAY_MS) > t);
  ck("  ...a five-minute band at the next five minutes, as before", bandEnd(t + 1, B) === (Math.floor((t + 1) / B) + 1) * B);
  const d0 = new Date(firstCellStart(t, DAY_MS));
  ck("a day's slice starts at LOCAL midnight", d0.getHours() === 0 && d0.getMinutes() === 0 && d0.getDate() === 15, d0);
  const w0 = new Date(firstCellStart(t, 7 * DAY_MS));
  ck("a week's slice starts on a Monday, at local midnight", w0.getDay() === 1 && w0.getHours() === 0 && w0.getDate() === 12, w0);
  ck("five minutes keep the clock's own edges", firstCellStart(t, B) === Math.floor(t / B) * B);
  const day = new Date(2026, 9, 14).getTime(), end = day + DAY_MS;
  const cells = timelineCells([{ t: day - 3_600_000, state: "off" }, { t: day + 3_600_000, state: "unavailable" },
    { t: day + 3_600_000 + 600_000, state: "off" }, { t: day + 7_200_000, state: "unavailable" },
    { t: day + 7_200_000 + 300_000, state: "off" }], end, 24, DAY_MS);
  const c = cells.find((x) => x.from === day);
  ck("a day's slice adds up the time of each state", c && c.spent.unavailable === 900_000 && c.spent.off === DAY_MS - 900_000, c && c.spent);
  ck("  ...and how many times each began in it", c && c.entered.unavailable === 2 && c.entered.off === 2, c && c.entered);
  const rows = cellSummary(c.spent, c.entered, (s) => s);
  ck("its tooltip: one line a state, the longest first, with its count", rows.length === 2 && rows[0].text === "off · 23 h 45 min · 2 times"
     && rows[1].text === "unavailable · 15 min · 2 times", rows.map((r) => r.text));
  ck("a five-minute slice still says its times", fmtCellSpan(t, t + B, B, 1).includes("–"));
  const wk = fmtCellSpan(w0.getTime(), w0.getTime() + 7 * DAY_MS, 7 * DAY_MS, 8760);
  ck("a week's slice says its first and last day, never a clock time", wk.includes(" – ") && !/\d\d:\d\d/.test(wk), wk);
  ck("a day's slice says its day, never a clock time", !/\d\d:\d\d/.test(fmtCellSpan(day, end, DAY_MS, 720)));
  const stt = readFileSync(new URL("../../src/components/panels/StateTimeline.tsx", import.meta.url), "utf8");
  ck("StateTimeline's tooltip says a day's or a week's slice as time per state",
     /bucketMs >= DAY_MS\s*\? cellSummary\(hover\.cell\.spent, hover\.cell\.entered, wordsFor\)/.test(stt));
}

// owner, 2026-10-21: "how come I see a legend in some bar chart and not in other … consistent everywhere": a band
// lists what it paints — every state, its colour, its words — and the band itself decides, never its caller
{
  const { timelineLegend } = await import("@/utils/timelineCells");
  const H = 3600_000, now = Date.UTC(2026, 9, 21, 12);
  const data = [{ state: "off", t: now - 20 * H }, { state: "on", t: now - 10 * H }, { state: "off", t: now - 9 * H },
    { state: "unavailable", t: now - 2 * H }, { state: "off", t: now - H }];
  const cells = timelineCells(data, now, 24, 5 * 60_000, []);
  const colour = (st) => ({ off: "green", on: "red", unavailable: "amber" })[st] ?? "grey";
  const words = (st) => ({ off: "Clear", on: "Detected", unavailable: "Unavailable" })[st] ?? st;
  const key = timelineLegend(cells, colour, words);
  ck("a band's legend: every state it paints, first seen first, in its colour and its words",
     JSON.stringify(key) === JSON.stringify([{ state: "off", color: "green", label: "Clear" },
       { state: "on", color: "red", label: "Detected" }, { state: "unavailable", color: "amber", label: "Unavailable" }]), key);
  const quiet = timelineCells([{ state: "online", t: now - 30 * H }], now, 24, 5 * 60_000, ["online"]);
  ck("  ...a resting state it paints is listed too", timelineLegend(quiet, () => "g", (x) => x).map((l) => l.state).join() === "online");

  const { React, h, draw } = await import("../consistency/screen.mjs");
  const { default: StateTimeline } = await import("@/components/panels/StateTimeline");
  const live = [{ state: "off", t: Date.now() - 20 * H }, { state: "on", t: Date.now() - 10 * H }, { state: "off", t: Date.now() - 9 * H }];
  const band = (extra = {}) => draw(h(StateTimeline, { data: live, hours: 24, status: "ok", colorFor: colour, labelFor: words, ...extra }));
  ck("  ...drawn under EVERY band, whatever its caller passes (an occupancy sensor as a camera)",
     /state-timeline-legend[\s\S]*Clear[\s\S]*Detected/.test(band()), band().slice(-400));
  ck("  ...except a band that says no (legend={false}: a linked sensor's thin row, the camera's overlay)",
     !/state-timeline-legend/.test(band({ legend: false })));
  void React;
}

done("✅ the timeline's cells, by value");

