// A linked sensor's band covers exactly the device band's period (2.496.497). Owner, 2026-10-21: the linked band sits
// under the device's "taking the same width … so that it's easy to compare states of both devices over the same
// scale". Each band asked for its own window and moved back on its own when ITS device was silent: a dead door sensor
// showed the day before it died under a lock band showing today, and the reverse. Now one request reads the device
// and the entities that follow it over the device's window (historySource stateWindow `follow`), shared by the window
// (historyRange HistoryRangeShare / useDeviceBand / useFollowerBand).
//
// And a moved window ends on the step edge after the last report, never AT it (owner, 2026-10-22: "Last hour before
// 21 Oct, 14:57" ended on Closed while the pill said Open: the report that set Open had no width).
//
// Driven by value through the real history source with a fake port, and the real cells a band is drawn from.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { loadOne, historyTitle } = await import("@/ha/historySource");
const { timelineCells } = await import("@/utils/timelineCells");

const M = 60_000, H = 60 * M, FIVE = 5 * M;
const now = Date.UTC(2026, 9, 22, 12, 0, 0);
const port = (rows) => ({
  stateRows: async (id, from, to) => {
    const pts = (rows[id] ?? []).slice().sort((a, b) => a.t - b.t);
    // as the villa's system answers: the state in force at `from`, then every change up to `to`
    const before = pts.filter((p) => p.t < from).pop();
    return [...(before ? [{ ...before, t: from }] : []), ...pts.filter((p) => p.t >= from && p.t <= to)]
      .map((p) => ({ state: p.state, last_changed: new Date(p.t).toISOString() }));
  },
  getStatisticsDuringPeriod: async () => ({}),
});
const LOCK = "lock.front", DOOR = "binary_sensor.front_door";
const band = (rows, hours = 24) => loadOne(port(rows), { kind: "stateWindow", id: LOCK, hours, follow: [DOOR] }, now);
const alone = (rows, id, hours = 24) => loadOne(port(rows), { kind: "stateWindow", id, hours }, now);
const lastCell = (data, end, hours) => { const c = timelineCells(data, end, hours, FIVE); return c[c.length - 1]; };

console.log("  the device silent, its door sensor alive:");
{
  const seen = now - 50 * H + 7 * M + 51_000;
  const rows = {
    [LOCK]: [{ t: now - 60 * H, state: "unlocked" }, { t: seen, state: "locked" }, { t: seen + 2 * H, state: "unavailable" }],
    [DOOR]: [{ t: now - 100 * H, state: "off" }, { t: seen - 3 * H, state: "on" }, { t: now - 2 * H, state: "off" }],
  };
  const w = await band(rows);
  ck("the device's band moved back to its last report", w.lastSeen === seen && w.end > seen && w.end <= seen + FIVE, { lastSeen: w.lastSeen, end: w.end });
  const door = w.followers?.[DOOR] ?? [];
  ck("the door's band is read over the SAME window: nothing after its end, nothing from today",
     door.length > 0 && door.every((p) => p.t <= w.end) && door[0].t <= w.end - 24 * H && !door.some((p) => p.t === now - 2 * H), door);
  ck("  ...showing what the door did then (open, from three hours before the lock's last report)",
     lastCell(door, w.end, 24).states.includes("on"));
  const own = await alone(rows, DOOR);
  ck("asked alone, the door's window stayed on today (the old two-window look)", own.lastSeen === undefined && own.data.some((p) => p.t === now - 2 * H));
}

console.log("\n  the device alive, its door sensor silent:");
{
  const rows = {
    [LOCK]: [{ t: now - 30 * H, state: "locked" }, { t: now - 3 * H, state: "unlocked" }],
    [DOOR]: [{ t: now - 61 * H, state: "on" }, { t: now - 60 * H, state: "unavailable" }],
  };
  const w = await band(rows);
  const door = w.followers?.[DOOR] ?? [];
  ck("the device's window is not moved", w.lastSeen === undefined && w.end === undefined);
  ck("the door's band shows its outage over that window, not the day it last reported",
     door.length > 0 && door.every((p) => p.state === "unavailable") && door[0].t >= now - 24 * H, door);
  const own = await alone(rows, DOOR);
  ck("  ...(asked alone, it moved back on its own)", own.lastSeen === now - 61 * H);
}

console.log("\n  a moved window shows the state its last report set:");
{
  const seen = Date.UTC(2026, 9, 21, 6, 57, 51);   // a report mid-step, then silence
  const rows = { [LOCK]: [{ t: seen - 30 * M, state: "off" }, { t: seen, state: "on" }, { t: seen + 4 * H, state: "unavailable" }],
    [DOOR]: [{ t: seen - 40 * M, state: "off" }] };
  const w = await band(rows, 1);
  ck("its window ends on the step edge after the report", w.end === Math.ceil((seen + 1) / FIVE) * FIVE, { end: w.end, seen });
  ck("the band's last cell carries the reported state (it ended on the one before)",
     lastCell(w.data, w.end, 1).states.includes("on"), lastCell(w.data, w.end, 1));
  ck("the door's band ends at the same edge", lastCell(w.followers[DOOR], w.end, 1).to === lastCell(w.data, w.end, 1).to);
  ck("the title says the last report, not \"before\" it", historyTitle("Last hour", w.lastSeen).startsWith("Last hour, last report "));
}

console.log("\n  the wiring:");
{
  const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
  const row = src("components/panels/LinkedSensorRow.tsx"), day = src("components/panels/LastDayTimeline.tsx");
  const share = src("components/panels/historyRange.tsx"), base = src("components/panels/BasePanel.tsx");
  ck("the linked band reads the window's answer and asks for nothing itself",
     /useFollowerBand\(entityId\)/.test(row) && !/useStateHistory|useHistorySource/.test(row) && /end=\{end\}/.test(row));
  ck("the device's band is the window's one answer when bands follow it",
     /const band = useDeviceBand\(entityId\);\s*const own = useStateHistory\(band \? null : entityId, range\.hours\);/.test(day));
  ck("the window asks once, for the device and what follows it",
     /useStateHistory\(lead \? device : null, historyRange\(pair\[0\]\)\.hours, follow\)/.test(share)
     && /<HistoryRangeShare device=\{entityId\}\s*follow=\{\[linkedSensor\?\.entityId, motion\?\.entityId\]/.test(base));
}

done("✅ a linked sensor's band covers the device band's period; a moved band shows its last report");
