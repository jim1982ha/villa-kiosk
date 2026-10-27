// A placement report (src/babylon/placementReport.ts) and its replay (tools/placement-probe.mjs).
//
// ⚠️ TWO OVERLAP ROUNDS WERE FIXED BLIND (2.496.552-553): the self-check printed only on the phone. A report carries
// the pass's whole input so an agent can replay it; these cases hold that promise: a pass reported and replayed
// finds the same pairs, a changed focus changes the answer, the telemetry ring hears a failing pass once a minute at
// most, and the probe runs on a report as a file.
import { register } from "node:module";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { Matrix } = await import("@babylonjs/core/Maths/math.vector");
const { Viewport } = await import("@babylonjs/core/Maths/math.viewport");
const { PlacementPass, placementItems, glassScratch } = await import("@/babylon/placementPass");
const { PlacementCheck } = await import("@/babylon/placementCheck");
const { RoomFocus } = await import("@/babylon/roomFocus");
const { MAX_GRID_CHIPS } = await import("@/babylon/badgeCard");
const { drawnThisPass } = await import("@/babylon/badgeFrame");
const R = await import("@/babylon/placementReport");

const metrics = { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 };
const basis = { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: -1, cosPhi: 0, mode: "plane" };
const clearance = { pxPerWorld: 1, allow: 1, refDepth: 0, gap: metrics.minGapPx, basis };
const tm = Matrix.Identity();
const vp = new Viewport(0, 0, 1000, 800);

/** A live pass on made-up badges: a and b far apart in the world (the solver keeps both) but drawn on the same
 *  pixels (x/y), so the check finds them; c alone. Rooms: a and c in Living, b in Kitchen. */
function live(focusKeys = [], offsetX) {
  const rooms = { a: "Living", b: "Kitchen", c: "Living" };
  const at = { a: [0, 100, 100], b: [400, 110, 100], c: [800, 600, 500] };
  const shown = Object.entries(at).map(([id, [w, x, y]]) => ({
    id, lbl: { type: "sensor", category: "comfort", valueWrap: { isVisible: false } },
    x, y, wx: w, wy: 0, wz: 0, sx: 0, sy: 0, sz: 0, inFront: true, occluded: false,
  }));
  const boxes = shown.map(() => ({ halfW: 20, halfH: 20, cy: 0 }));
  const focus = new RoomFocus();
  focus.grant(focusKeys);
  const frame = {
    metrics, summary: { size: 40, font: 16, countSize: 16, countFont: 10 }, perCardCap: MAX_GRID_CHIPS,
    rooms, focus, exempt: new Set(focusKeys), scale: 1, cardBudget: 10_000, cellCap: 6,
    chips: { members: shown.map((s) => ({ id: s.id, room: rooms[s.id].toLowerCase(), pos: { x: s.wx, y: 0, z: 0 } })),
             view: { tm, vp }, text: { charPx: 7, padPx: 20 }, budget: 0 },
  };
  const pass = new PlacementPass();
  const result = pass.run(frame, shown, boxes, clearance, false);
  const snapshot = R.passSnapshot({
    shown, boxes, groups: result.pending, chips: result.chips, pass, frame,
    drawn: (k) => drawnThisPass(shown[k], pass), offsetX, tm, vp, chipDrawnWidth: () => undefined, overlapAllow: 0,
    solve: { items: placementItems(shown, boxes, clearance, rooms, focus.rooms, [], glassScratch()), gap: 2, mode: "priority", drawableMax: 6 },
  });
  const found = new PlacementCheck().check(snapshot);
  const report = R.placementReport({ app: "test", frame, shown, boxes, clearance, suppressOthers: false, snapshot, found, tm, chipKeys: [] });
  return { found, report };
}

console.log("  report and replay:");
const { found, report } = live();
ck("the live pass finds the pair drawn on the same pixels, by id", found.failures === 1 && found.overlaps === 1
   && JSON.stringify(found.pairs) === JSON.stringify([{ kind: "overlaps", a: "a", b: "b" }]), found.pairs);
const back = JSON.parse(JSON.stringify(report));
ck("the report is plain JSON: kind, version, the camera, every shown badge", back.kind === "vesta-placement" && back.v === 1
   && back.tm.length === 16 && back.shown.map((s) => s.id).join() === "a,b,c" && back.found.counts.overlaps === 1, back.found);
const again = R.replayPlacement(back);
ck("replayed from the JSON, the real pass and check find the same pairs and failures",
   again.found.failures === found.failures && JSON.stringify(again.found.pairs) === JSON.stringify(found.pairs), again.found.pairs);
const tapped = R.replayPlacement(back, { focus: ["kitchen"], suppressOthers: true });
ck("  ...and another tapped room changes the answer (Living held at its chip: nothing left to overlap)",
   tapped.found.overlaps === 0 && tapped.pass.roomClustered.get("living") === true
   && tapped.snapshot.badges.find((b) => b.id === "b")?.exempt === true, tapped.found.pairs);

ck("the snapshot reads each badge's drawn X offset (a badge never moves)", live([], (k) => (k === 2 ? 12 : 0)).found.moved === 1);

console.log("\n  the telemetry ring:");
{
  const sent = [];
  const t = new R.PlacementTelemetry((e) => sent.push(e));
  const clean = { ...report, found: { ...report.found, failures: 0, pairs: [], counts: {} } };
  ck("a clean pass is never sent", !t.offer(clean, 0) && sent.length === 0);
  ck("a failing pass is sent, whole (replayable)", t.offer(report, 0) && sent.length === 1 && sent[0].whole === true && sent[0].placement.shown.length === 3);
  const other = { ...report, found: { ...report.found, pairs: [{ kind: "overlaps", a: "a", b: "c" }] } };
  ck("  ...a new failure within the minute waits", !t.offer(other, R.PLACEMENT_TELEMETRY_MS / 2) && sent.length === 1);
  ck("  ...the same failure later is not sent again", !t.offer(report, R.PLACEMENT_TELEMETRY_MS * 5) && sent.length === 1);
  ck("  ...a new one is, once the minute has passed", t.offer(other, R.PLACEMENT_TELEMETRY_MS * 6) && sent.length === 2);
  const big = { ...other, found: { ...other.found, pairs: [] }, shown: Array.from({ length: 2000 }, (_, i) => ({ ...report.shown[0], id: `sensor.x${i}` })) };
  t.offer(big, R.PLACEMENT_TELEMETRY_MS * 9);
  ck("a report past the ring's size goes as its findings only, and says so",
     sent.length === 3 && sent[2].whole === false && sent[2].placement.shown.length === 0
     && new TextEncoder().encode(JSON.stringify(sent[2])).length < R.PLACEMENT_TELEMETRY_BYTES, sent.length);
}

console.log("\n  the probe, on a report as a file:");
{
  const dir = mkdtempSync(path.join(tmpdir(), "placement-"));
  const file = path.join(dir, "report.json");
  writeFileSync(file, JSON.stringify({ kind: "placement", placement: back, whole: true }));
  const tool = new URL("../../tools/placement-probe.mjs", import.meta.url).pathname;
  const out = JSON.parse(execFileSync(process.execPath, [tool, file, "--json"], { encoding: "utf8" }));
  ck("tools/placement-probe.mjs replays a telemetry row and agrees with the device", out.agrees === true
     && out.replay.failures === 1 && out.replay.pairs[0]?.a === "a", out);
  const moved = JSON.parse(execFileSync(process.execPath, [tool, file, "--json", "--focus", "kitchen", "--suppress"], { encoding: "utf8" }));
  ck("  ...and with --focus answers for another tapped room", moved.agrees === null && moved.replay.failures === 0, moved.replay);
}

console.log("\n  the caller:");
{
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  const assertBody = ev.slice(ev.indexOf("  private assertPlacementInvariants("), ev.indexOf("this.placementTelemetry.offer(report, performance.now());"));
  ck("EntityVisuals checks the shared snapshot, keeps the report and offers it to the ring",
     /const snapshot = passSnapshot\(\{/.test(assertBody) && /const found = this\.placementCheck\.check\(snapshot\);/.test(assertBody)
     && /this\.lastPlacementReport = report;/.test(assertBody)
     && /new PlacementTelemetry\(\(e\) => reportTelemetry\("placement", \{ \.\.\.e \}\)\)/.test(ev));
  ck("  ...and `?debug=place` puts its Copy button in the debug box",
     /if \(channelEnabled\("place"\)\) \{\s*debugCopyButton\("Copy placement report",\s*\(\) => this\.lastPlacementReport && JSON\.stringify\(this\.lastPlacementReport\)\);/.test(ev));
}

done("a placement report replays to the device's findings");
