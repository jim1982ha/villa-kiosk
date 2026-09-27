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
ck("StateTimeline draws exactly these", /timelineCells\(data, end \?\? \(timeKey \+ 1\) \* bucketMs, hours, bucketMs,/.test(st) && /timelineRuns\(cells, colorFor\)/.test(st));

done("✅ the timeline's cells, by value");

