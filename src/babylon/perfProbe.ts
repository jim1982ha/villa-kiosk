// src/babylon/perfProbe.ts
// An A/B experiment that runs ON THE DEVICE and answers where the frame time
// actually goes — by removing one thing at a time and re-measuring.
//
// ── Why an experiment and not another counter ──────────────────────────────
// The field data settled what the cost is NOT, and in doing so falsified the
// theory that replaced all the earlier ones. Across 57 records at one fixed
// resolution, with the draw count ranging from 79 to 662:
//
//     renderMs = 4.58ms + 5.81us x drawCalls        (n=57, r=0.51)
//
// 79 draws cost 6.5ms; 662 draws cost 7.9ms. So a draw call is worth about
// 5.8us, not the 14.9us that "renderMs / drawCalls" suggested — that ratio is
// an AVERAGE, and it divides a large fixed cost by the draw count, so it falls
// as draws rise whether or not draws cost anything. Removing every draw call
// in the villa would save 2.8ms of a 7.2ms frame.
//
// Which means roughly two thirds of every frame is a FIXED cost that does not
// care how much is on screen, and on Safari that fixed part is ~20ms against
// Chrome's ~4.6ms at four times the pixels. Nothing already reported can say
// what it is made of.
//
// The candidates are all plausible and that is exactly the problem — six
// hypotheses in this app's history have been argued from plausibility and
// disproved by measurement, three of them mine, and one of those was the
// draw-call theory this file exists to replace. So: no more reasoning about
// which candidate it is. Turn each one off and read the number.
//
// ── What it does ──────────────────────────────────────────────────────────
// Suspends the app's own render loop, then for each condition: applies it,
// discards a warm-up, times `scene.render()` over a fixed number of frames,
// restores. Reports the median and the delta from baseline.
//
// Timing `scene.render()` rather than the frame gap is deliberate — the gap
// includes compositing and rAF scheduling, which no condition here can move,
// and mixing them would blur every result.
//
// ?debug only, driven from the console, never on a normal boot: it deliberately
// renders as fast as it can and briefly makes the villa look wrong.

import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";

/** Frames timed per condition. Enough for a stable median at 60fps without the
 *  whole run outlasting the user's patience — six conditions at 60 frames is
 *  roughly six seconds. */
const PROBE_FRAMES = 60;
/** Discarded before timing. The first frames after a change pay for shader
 *  recompilation and cache misses that are not the steady-state cost. */
const WARMUP_FRAMES = 12;

export interface ProbeRow {
  name: string;
  /** Median scene.render() cost, ms. */
  renderMs: number;
  /** Difference from baseline, ms. Negative means this condition was cheaper,
   *  i.e. the thing removed was costing that much. */
  deltaMs: number;
  /** Draw calls in the last frame of the condition — the control that says
   *  whether a condition changed what it was supposed to change. */
  draws: number;
}

interface Condition {
  name: string;
  /** Apply the change; return the function that undoes it. Returning null
   *  skips the condition (nothing to test on this villa). */
  apply: () => (() => void) | null;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** One rAF tick. The probe must yield to the browser between frames or it
 *  measures a tight loop rather than a render loop. */
const nextFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => r()));

async function timeCondition(scene: Scene): Promise<{ renderMs: number; draws: number }> {
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    scene.render();
    await nextFrame();
  }
  const samples: number[] = [];
  for (let i = 0; i < PROBE_FRAMES; i++) {
    const t0 = performance.now();
    scene.render();
    samples.push(performance.now() - t0);
    await nextFrame();
  }
  const engine = scene.getEngine() as unknown as { _drawCalls?: { current: number } };
  return { renderMs: median(samples), draws: engine._drawCalls?.current ?? 0 };
}

/**
 * Build the experiment from what this villa actually has.
 *
 * Every condition must be reversible and must restore EXACTLY what it changed
 * — the probe runs on a live kiosk, and a condition that leaks leaves the user
 * with a broken villa and no idea why.
 */
function buildConditions(scene: Scene, guiLayers: readonly { rootContainer: { isVisible: boolean } }[]): Condition[] {
  return [
    {
      // The badge/label GUI. A fullscreen AdvancedDynamicTexture is composited
      // every frame whether or not anything on it changed, and its cost is
      // per-PIXEL — which is the shape the Safari numbers have.
      name: "no GUI layer",
      apply: () => {
        if (guiLayers.length === 0) return null;
        const prev = guiLayers.map((l) => l.rootContainer.isVisible);
        for (const l of guiLayers) l.rootContainer.isVisible = false;
        return () => guiLayers.forEach((l, i) => { l.rootContainer.isVisible = prev[i]; });
      },
    },
    {
      // 98 light objects with 3 enabled. A disabled light still participates in
      // material shader selection, and the villa reports far more of them than
      // MAX_SIMULTANEOUS_LIGHTS could ever use at once.
      name: "no lights at all",
      apply: () => {
        const on = scene.lights.filter((l) => l.isEnabled());
        if (on.length === 0) return null;
        for (const l of on) l.setEnabled(false);
        return () => { for (const l of on) l.setEnabled(true); };
      },
    },
    {
      // Image-based lighting: an environment texture sampled per fragment by
      // every PBR material. Per-pixel, and on by default.
      name: "no IBL",
      apply: () => {
        const env: BaseTexture | null = scene.environmentTexture;
        if (!env) return null;
        scene.environmentTexture = null;
        return () => { scene.environmentTexture = env; };
      },
    },
    {
      // The control. If halving the drawn geometry moves renderMs by about
      // half of what removing ALL of it does, the cost is proportional to what
      // is drawn after all and the fixed-cost reading is wrong.
      name: "half the meshes hidden",
      apply: () => hideMeshes(scene, 0.5),
    },
    {
      // The floor: an empty scene, still clearing and still compositing. What
      // remains here is what no amount of scene work can reduce.
      name: "all meshes hidden",
      apply: () => hideMeshes(scene, 1),
    },
  ];
}

/** Hide `fraction` of the currently-visible meshes, deterministically (every
 *  Nth), so the two mesh conditions are subsets of one another rather than two
 *  unrelated samples. */
function hideMeshes(scene: Scene, fraction: number): (() => void) | null {
  const visible: AbstractMesh[] = scene.meshes.filter((m) => m.isVisible && m.isEnabled(false));
  if (visible.length === 0) return null;
  const step = fraction >= 1 ? 1 : Math.max(2, Math.round(1 / fraction));
  const hidden: AbstractMesh[] = [];
  for (let i = 0; i < visible.length; i++) {
    if (fraction >= 1 || i % step === 0) {
      visible[i].isVisible = false;
      hidden.push(visible[i]);
    }
  }
  if (hidden.length === 0) return null;
  return () => { for (const m of hidden) m.isVisible = true; };
}

/**
 * Run the whole experiment. The caller owns the render loop and must have
 * stopped it — see SceneManager.runRenderProbe, which is the only caller.
 */
export async function runPerfProbe(
  scene: Scene,
  guiLayers: readonly { rootContainer: { isVisible: boolean } }[],
): Promise<ProbeRow[]> {
  const rows: ProbeRow[] = [];
  const base = await timeCondition(scene);
  rows.push({ name: "baseline", renderMs: base.renderMs, deltaMs: 0, draws: base.draws });

  for (const c of buildConditions(scene, guiLayers)) {
    let undo: (() => void) | null = null;
    try {
      undo = c.apply();
      if (!undo) continue;
      const r = await timeCondition(scene);
      rows.push({
        name: c.name,
        renderMs: r.renderMs,
        deltaMs: r.renderMs - base.renderMs,
        draws: r.draws,
      });
    } finally {
      // ALWAYS, including if timing threw. A half-applied condition on a live
      // kiosk is a broken villa the user cannot explain.
      undo?.();
    }
  }
  return rows;
}

/** Format the result the way it needs to be read: what each thing COST, which
 *  is the negative of the delta from removing it. */
export function formatProbe(rows: ProbeRow[]): string {
  const base = rows[0]?.renderMs ?? 0;
  const lines = [
    `baseline scene.render(): ${base.toFixed(2)}ms  (${rows[0]?.draws ?? "?"} draws)`,
    "",
    "removing…                    render    cost of the thing removed",
  ];
  for (const r of rows.slice(1)) {
    const cost = -r.deltaMs;
    const pct = base > 0 ? ` (${((cost / base) * 100).toFixed(0)}% of the frame)` : "";
    lines.push(
      `  ${r.name.padEnd(26)} ${r.renderMs.toFixed(2).padStart(6)}ms   ${cost >= 0 ? "" : "+"}${cost.toFixed(2)}ms${pct}`,
    );
  }
  return lines.join("\n");
}
