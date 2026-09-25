// A focused room, and how long each half of the focus lasts
// (src/babylon/roomFocus.ts).
//
// ⚠️ BOTH RULES ARE REPORTED BUGS: `z !== stamp` where `z < stamp` belonged —
// zoom IN one rung on the Swimming Pool and it collapsed back to the chip just
// tapped — and a suppression of the other rooms that lived as long as the
// exemption, so a room panned to afterwards "never declutters into entity
// icons" (2.368.0). Replayed, with the old rule run first to show it lies.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { RoomFocus } = await import("@/babylon/roomFocus");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  zooming in keeps what you asked for:");
{
  // The OLD rule: any change of zoom drops the focus.
  let keys = new Set(["pool"]), stamp = 0;
  const old = (z) => { if (stamp === 0) stamp = z; else if (z !== stamp) { keys.clear(); stamp = 0; } };
  old(10); old(12);
  ck("the OLD rule (z !== stamp) drops the pool's focus one rung in", keys.size === 0);
  const f = new RoomFocus();
  f.grant(["pool"]);
  ck("the first pass after the tap stamps the ARRIVAL zoom; the others are held at their chips", f.step(10) === true && f.rooms.has("pool"));
  ck("one rung IN: the pool stays exempt", (f.step(12), f.rooms.has("pool")));
  ck("  ...but the other rooms are no longer held (2.368.0: they declutter by zoom again)", f.step(12) === false);
  ck("back at the granted zoom: held again", f.step(10) === true);
  ck("one rung OUT: the focus ends, and nothing is held", f.step(9) === false && f.size === 0);
  ck("  ...and stays ended", f.step(10) === false && f.size === 0);
}

console.log("\n  granting:");
{
  const f = new RoomFocus();
  ck("no focus: nothing held, nothing exempt", f.step(10) === false && f.size === 0);
  ck("a grant is a change; the same rooms again are not (no re-stamp)", f.grant(["a", "b"]) === true && f.grant(["b", "a"]) === false);
  f.step(10);
  f.grant(["c"]);
  ck("a new room re-stamps on its first pass — a wider arrival does not end it", f.step(6) === true && f.rooms.has("c"));
  ck("dropping the focus", f.grant([]) === true && f.step(6) === false);
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("cullLabels asks once, before grouping, with the zoom in CSS px",
     /const suppressOthers = this\.focus\.size > 0\s*&& this\.focus\.step\(this\.quantisedPixelsPerWorldUnit\(shown, true\)\);/.test(ev));
  ck("  ...and keeps no lifetime rule of its own", !/focusedAtZoom|focusedRooms/.test(ev));
  ck("a tap grants through it", /if \(!this\.focus\.grant\(/.test(ev));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the focus lasts as long as it should");
process.exit(fail ? 1 : 0);
