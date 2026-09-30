// A control that follows the device until it is held, and the sending of it
// (utils/liveDraft.draftStep, hooks/useLiveDraft), plus the one panel frame
// (panels/ControlFrame) — 2.496.231.
//
// Brightness, colour temperature and blind position were sent only on a
// finger LIFT: the keyboard moved them and sent nothing, a cancelled touch
// left them stuck, and a refused command left the new value showing. And an
// offline device looked three ways in three kinds of panel.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { draftStep } = await import("@/utils/liveDraft");

// Run a list of events; collect the effects.
const run = (events, start = { value: 50, live: 50, held: false }) => {
  let s = start; const effects = [];
  for (const e of events) { const r = draftStep(s, e); s = r.state; if (r.effect) effects.push(`${r.effect}:${s.value}`); }
  return { s, effects };
};

console.log("  following the device:");
ck("not held: the control follows each report", run([{ type: "live", value: 70 }]).s.value === 70);
ck("held: a report does not move it (a mid-drag event would snap it back)",
   run([{ type: "press" }, { type: "move", value: 90 }, { type: "live", value: 70 }]).s.value === 90);

console.log("\n  sending:");
{
  const drag = run([{ type: "press" }, { type: "move", value: 80 }, { type: "move", value: 85 }, { type: "release" }]);
  ck("a drag sends ONCE, the final value, on release", drag.effects.join() === "send-now:85", drag.effects.join());
  const keys = run([{ type: "move", value: 51 }, { type: "move", value: 52 }]);
  ck("the KEYBOARD sends too (it used to send nothing) — once the keys settle", keys.effects.length > 0 && keys.effects.every((e) => e.startsWith("send-soon")) && keys.s.value === 52, keys.effects.join());
  const cancel = run([{ type: "press" }, { type: "move", value: 90 }, { type: "cancel" }, { type: "live", value: 60 }]);
  ck("a cancelled touch sends nothing, lets go, and follows the device again (it stayed stuck)",
     cancel.effects.length === 0 && !cancel.s.held && cancel.s.value === 60, JSON.stringify(cancel));
  const step = run([{ type: "set", value: 24.5 }]);
  ck("a stepper press sends at once", step.effects.join() === "send-now:24.5");
}

console.log("\n  a refused command:");
{
  const r = run([{ type: "press" }, { type: "move", value: 90 }, { type: "release" }, { type: "refused" }]);
  ck("goes back to the device's value (it kept the refused one showing)", r.s.value === 50, r.s.value);
  const held = run([{ type: "press" }, { type: "move", value: 90 }, { type: "refused" }]);
  ck("  ...but not under a finger that is moving it again", held.s.value === 90);
}

console.log("\n  the panels use it, and one frame:");
{
  const src = (f) => readFileSync(new URL(`../../src/components/panels/${f}`, import.meta.url), "utf8");
  const controls = ["LightPanel.tsx", "CoverPanel.tsx", "ACPanel.tsx", "FanPanel.tsx", "SwitchPanel.tsx", "MediaPanel.tsx", "LockPanel.tsx"];
  const noFrame = controls.filter((f) => !/<ControlFrame /.test(src(f)));
  ck("every control panel draws the shared frame", noFrame.length === 0, noFrame.join());
  const own = controls.filter((f) => /UnavailableNotice|!unavailable &&|is-unavailable|disabled=\{unavailable\}/.test(src(f)));
  ck("  ...and none draws its own offline look (notice, greyed or hidden controls)", own.length === 0, own.join());
  const hand = controls.filter((f) => /onPointerUp=/.test(src(f)));
  ck("no panel sends on its own finger-lift handler (the draft sends)", hand.length === 0, hand.join());
  ck("the A/C stepper sends through the draft (a refusal puts the set-point back)", /target\.commit\(/.test(src("ACPanel.tsx")));
}

done("✅ a dragged value sends on any release and goes back when refused; one offline look");
