#!/usr/bin/env node
// Replay a device's placement report through the REAL placement pass and self-check, offline.
//
//   node tools/placement-probe.mjs <report.json> [--focus roomKey,...] [--no-focus] [--suppress|--no-suppress] [--json]
//
// <report.json> is what `?debug=place` gives: "Copy placement report" in the debug box, or the `placement` field of
// a telemetry row (Settings › Advanced › Device telemetry, Copy). Keep it under .scratch/: it names the villa's
// devices. The replay runs babylon/placementPass and babylon/placementCheck on the report's own values (its frame,
// its badges with their boxes, its camera), so its findings are the device's unless the code changed since:
//   * "agrees" — the replay found what the device found: the code is where the overlap comes from;
//   * --focus / --no-focus / --suppress: the same pose with another tapped room, to test a cause.
//
// No 3D model is loaded, deliberately: the report carries each badge's world anchor and screen point as the device
// resolved them, which the model alone cannot give (the device positions live in the Kiosk's stored config).
// rules/kiosk-code.md#measure-on-the-real-model-offline says when to reach for it.

import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../tests/consistency/alias-hook.mjs", import.meta.url);
const { replayPlacement } = await import("@/babylon/placementReport");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node tools/placement-probe.mjs <report.json> [--focus roomKey,...] [--no-focus] [--suppress|--no-suppress] [--json]");
  process.exit(2);
}
const flag = (name) => args.includes(name);
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

let rep = JSON.parse(readFileSync(file, "utf8"));
// A telemetry row wraps the report: { kind: "placement", placement: {...}, whole }.
if (rep.kind === "placement" && rep.placement) {
  if (rep.whole === false) { console.error("this telemetry row holds the findings only (the report was too big): no replay"); process.exit(2); }
  rep = rep.placement;
}
if (rep.kind !== "vesta-placement" || rep.v !== 1) { console.error(`not a placement report (kind ${rep.kind}, v ${rep.v})`); process.exit(2); }

const opt = {};
if (flag("--no-focus")) opt.focus = [];
else if (valueOf("--focus")) opt.focus = valueOf("--focus").split(",").filter(Boolean);
if (flag("--suppress")) opt.suppressOthers = true;
if (flag("--no-suppress")) opt.suppressOthers = false;

const { found } = replayPlacement(rep, opt);
const counts = (f) => Object.fromEntries(Object.entries(f.counts ?? f).filter(([k, n]) => typeof n === "number" && n > 0
  && !["failures", "chipWidthErr"].includes(k)));
const replay = { failures: found.failures, counts: counts(found), pairs: found.pairs, lines: found.lines };
const changed = opt.focus !== undefined || opt.suppressOthers !== undefined;
const agrees = !changed && JSON.stringify(rep.found.pairs) === JSON.stringify(found.pairs) && rep.found.failures === found.failures;

if (flag("--json")) {
  console.log(JSON.stringify({ app: rep.app, device: rep.found, replay, agrees: changed ? null : agrees }, null, 2));
} else {
  console.log(`report: app ${rep.app ?? "?"}, viewport ${rep.viewport.width}x${rep.viewport.height}, ${rep.shown.length} badges,`
    + ` focus [${rep.frame.focus.join(", ")}], others held at chips: ${rep.suppressOthers}`);
  console.log(`device: ${rep.found.failures} failure(s) ${JSON.stringify(rep.found.counts)}`);
  for (const p of rep.found.pairs) console.log(`  ${p.kind}: ${p.a} / ${p.b}`);
  const how = changed ? ` (with ${JSON.stringify(opt)})` : "";
  console.log(`replay${how}: ${replay.failures} failure(s) ${JSON.stringify(replay.counts)}`);
  for (const p of replay.pairs) console.log(`  ${p.kind}: ${p.a} / ${p.b}`);
  for (const l of replay.lines) console.log(`  ${l}`);
  if (!changed) console.log(agrees ? "agrees with the device" : "DIFFERS from the device: the code changed since, or the report is partial");
}
process.exit(0);
