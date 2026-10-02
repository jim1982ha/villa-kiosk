// The Back stack, driven through a fake browser (hooks/backStack.ts, 2.496.251).
//
// The logic behind Android's Back button took twelve commits, five of them
// field fixes that failed (2.330 → 2.339, reverted in 2.340), and every
// behaviour was verified by hand on a device: it wrote `history` and `window`
// directly. The browser is now a port, so this scripts what a phone does —
// history depth, a `go()` whose popstate arrives LATER, React's passive-effect
// flush between the microtask and the next task — and asserts what Back,
// Escape, nesting and a swap leave behind.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { createBackStack } = await import("@/hooks/backStack");

/** A browser + React, in queues: micro → react (passive effects) → task. */
function world() {
  const q = { micro: [], react: [], task: [] };
  const w = { depth: 0, pushes: 0, gos: [], exited: false, pop: null };
  const port = {
    push: () => { w.depth += 1; w.pushes += 1; },
    go: (d) => { w.gos.push(d); w.depth += d; q.task.push(() => w.pop()); },   // ONE popstate, later
    onPop: (fn) => { w.pop = fn; },
    microtask: (fn) => q.micro.push(fn),
    task: (fn) => q.task.push(fn),
  };
  const drain = (name) => { while (q[name].length) q[name].shift()(); };
  w.settle = () => {
    for (let guard = 0; guard < 100; guard++) {
      drain("micro"); drain("react");
      if (!q.task.length) return;
      q.task.shift()();
    }
    throw new Error("never settled");
  };
  /** The phone's Back: spends one entry and fires popstate — or leaves the app. */
  w.back = () => { if (w.depth === 0) { w.exited = true; return; } w.depth -= 1; w.pop?.(); w.settle(); };
  w.react = (fn) => q.react.push(fn);
  w.stack = createBackStack(port);
  /** A surface as React mounts one: registered on mount; its close unmounts it in the NEXT effect flush. */
  w.open = (name, log) => {
    const s = { name, closed: 0, off: null };
    s.off = w.stack.register(() => { s.closed += 1; log?.push(name); w.react(() => s.off()); });
    return s;
  };
  return w;
}

console.log("  open and Back:");
{
  const w = world(); const a = w.open("A"); w.settle();
  ck("one surface open: one history entry", w.depth === 1 && w.stack.overlayOpen());
  w.back();
  ck("Back closes it once; history ends at the villa", a.closed === 1 && w.depth === 0 && !w.stack.overlayOpen());
  // ⚠️ FOUND BY THIS ORACLE (2.496.251), PINNED, NOT CHANGED: the first pass
  // (the microtask) runs before React unmounts the closing surface, so it
  // RE-PUSHES an entry for it and the second pass drops it again with go(-1).
  // Every Back press costs a push and a traversal the comment above
  // scheduleSync calls "a comparison". It works on the device; changing this
  // timing (five failed field fixes, 2.330–2.339) needs a measurement on the
  // phone first. If it is changed, this check says what changed.
  ck("  ...(today: one re-push and one go(-1) per Back press — see the note)", w.pushes === 2 && w.gos.join() === "-1", { pushes: w.pushes, gos: w.gos });
  w.back();
  ck("Back with nothing open is the platform's: the press leaves the app, nothing is closed", w.exited && a.closed === 1);
}

console.log("\n  nesting:");
{
  const w = world(); const log = [];
  const a = w.open("A", log); w.settle(); const b = w.open("B", log); w.settle();
  ck("two surfaces, two entries", w.depth === 2);
  w.back();
  ck("Back closes the TOP one only", log.join() === "B" && a.closed === 0 && w.depth === 1);
  w.back();
  ck("  ...and the next Back the one beneath", log.join() === "B,A" && w.depth === 0 && !w.exited);
}

console.log("\n  a swap (Settings → Advanced Settings in one commit):");
{
  const w = world(); const log = [];
  const settings = w.open("Settings", log); w.settle();
  const pushesBefore = w.pushes;
  w.react(() => { settings.off(); w.open("Advanced", log); });   // one commit: one leaves, one arrives
  w.settle();
  ck("the depth never changed: no push, no go", w.pushes === pushesBefore && w.gos.length === 0 && w.depth === 1);
  w.back();
  ck("Back inside the new one closes it and stays in the app (the 2.332 defect)", log.join() === "Advanced" && w.depth === 0 && !w.exited);
}

console.log("\n  Escape (dismissTop) with two open:");
{
  const w = world(); const log = [];
  const a = w.open("A", log); w.settle(); w.open("B", log); w.settle();
  ck("dismissTop closes the top one", w.stack.dismissTop() === true);
  w.settle();
  ck("  ...its entry is dropped with go(-1), and that traversal's popstate closes NOTHING else",
     log.join() === "B" && a.closed === 0 && w.gos.join() === "-1" && w.depth === 1 && w.stack.overlayOpen());
  w.back();
  ck("  ...the next real Back still closes A", log.join() === "B,A" && w.depth === 0);
  const empty = world();
  ck("dismissTop with nothing open says so (a caller falls through)", empty.stack.dismissTop() === false);
}

console.log("\n  a surface re-mounted by the close (the second pass's case):");
{
  const w = world(); const log = [];
  let replacement = null;
  const a = { closed: 0 };
  a.off = w.stack.register(() => {
    a.closed += 1; log.push("A");
    w.react(() => { a.off(); replacement = w.open("A2", log); });   // closing A mounts A2 in the same commit
  });
  w.settle();
  w.back();
  ck("after Back, the replacement has its OWN entry, so the next Back reaches it", replacement && w.depth === 1);
  w.back();
  ck("  ...and closes it rather than leaving the app", log.join() === "A,A2" && !w.exited && w.depth === 0);
}

done("✅ Back, Escape, nesting and a swap, through a fake browser");
