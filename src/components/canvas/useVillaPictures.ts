// src/components/canvas/useVillaPictures.ts
// WHEN the villa pictures are made (owner, 2026-11-24; the pictures themselves: babylon/villaPictureCapture.ts). On a
// device that shows the 3D villa (deviceVerdict), signed in as a profile that may manage the model, when the stored
// set is missing or was made from another model, other room data or another placement of the devices
// (pictureManifest.picturesStale). Never while someone uses the screen: the villa must have been on screen 30s, the
// page visible, and no touch, pointer or key for 10s; a touch mid-way stops the capture, which tries again later.
// Once a page at most, made or failed.
//
// `?debug` adds window.__villaPictures(): the set taken now, without the waits and without storing it, its files as
// data URLs (the gitignored UI harness looks at them).

import { useEffect, type MutableRefObject } from "react";
import type { SceneManager } from "@/babylon/SceneManager";
import type { AppConfig } from "@/config/AppConfig";
import { captureVillaPictures, CaptureAborted, NoWebp, type CapturedSet } from "@/babylon/villaPictureCapture";
import { configKey, picturesStale, type PictureSource } from "@/utils/pictureManifest";
import { readStoredManifest, uploadView } from "@/utils/villaPictures";
import { readAddonConfig } from "@/utils/centralModel";
import { modelLifecycle } from "@/utils/modelLifecycle";
import { deviceView } from "@/utils/deviceVerdict";
import { debugFlagEnabled } from "@/utils/devLog";
import { report as reportTelemetry } from "@/utils/telemetry";

/** How long the villa is on screen before a capture may start. */
const SHOWN_MS = 30_000;
/** How long the screen has been left alone before, and between, the pictures. */
const IDLE_MS = 10_000;
/** How often the conditions are looked at. */
const TICK_MS = 5_000;
/** The page events that mean someone is using the screen. */
const INPUT_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;

/** Made or failed on this page: not again until the next load. */
let settledThisPage = false;

/** What the pictures would be made from now, or why none are: the add-on's answer must be the model on screen. */
async function currentSource(config: AppConfig): Promise<PictureSource | { skip: string } | null> {
  const ans = await readAddonConfig();
  if (!ans.ok) return null;                                            // no answer: ask again at the next tick
  const onScreen = modelLifecycle.snapshot().addon;
  if (!ans.cfg.model_path) return { skip: "skipped-no-central-model" };
  if (!onScreen || onScreen.model_version !== ans.cfg.model_version || onScreen.rooms_version !== ans.cfg.rooms_version) {
    return { skip: "skipped-model-changed" };                          // a new model is on its way: its page makes them
  }
  const source = { model_version: ans.cfg.model_version ?? "", rooms_version: ans.cfg.rooms_version ?? "", config_key: configKey(config) };
  const stored = await readStoredManifest(ans.cfg.views_version);
  return picturesStale(stored, source) ? source : { skip: "skipped-fresh" };
}

async function store(set: CapturedSet): Promise<void> {
  // the pictures, then the manifest LAST (captureVillaPictures puts it last)
  for (const f of set.files) await uploadView(f.name, f.blob);
}

const asDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export function useVillaPictures(
  managerRef: MutableRefObject<SceneManager | null>, mayManageModel: boolean, configRef: MutableRefObject<AppConfig>,
): void {
  useEffect(() => {
    const m = managerRef.current;
    if (!m) return;
    const w = window as Window & { __villaPictures?: () => Promise<unknown> };
    if (debugFlagEnabled()) {
      w.__villaPictures = async () => {
        const addon = modelLifecycle.snapshot().addon;
        const set = await captureVillaPictures(m, {
          model_version: addon?.model_version ?? "", rooms_version: addon?.rooms_version ?? "", config_key: configKey(configRef.current),
        });
        const files: Record<string, string> = {};
        for (const f of set.files) files[f.name] = await asDataUrl(f.blob);
        return { manifest: set.manifest, bytes: set.bytes, files };
      };
    }
    const cleanupDebug = () => { delete w.__villaPictures; };
    if (!mayManageModel || deviceView() !== "3d" || settledThisPage) return cleanupDebug;

    let shownAt = 0;
    let lastInput = performance.now();
    let busy = false;
    let stopped = false;
    const onInput = () => { lastInput = performance.now(); };
    for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { capture: true, passive: true });
    const offScene = m.onScene((phase) => { if (phase === "shown" && !shownAt) shownAt = performance.now(); });
    const quiet = () => !document.hidden && performance.now() - lastInput >= IDLE_MS;

    const settle = (outcome: string, extra: Record<string, unknown> = {}) => {
      settledThisPage = true;
      stopped = true;
      reportTelemetry("pictures", { outcome, ...extra });
    };

    const tick = async () => {
      if (busy || stopped || !shownAt || performance.now() - shownAt < SHOWN_MS || !quiet()) return;
      busy = true;
      const t0 = performance.now();
      try {
        const source = await currentSource(configRef.current);
        if (stopped || !source) return;
        if ("skip" in source) {
          // the usual answer on every page of an owner's device: not worth a record
          if (source.skip === "skipped-fresh") { settledThisPage = true; stopped = true; } else settle(source.skip);
          return;
        }
        if (!quiet()) return;
        const started = performance.now();
        const set = await captureVillaPictures(m, source, () => stopped || lastInput > started || document.hidden);
        await store(set);
        settle("made", { ms: Math.round(performance.now() - t0), bytes: set.bytes, floors: set.manifest.floors.length });
      } catch (err) {
        if (err instanceof CaptureAborted) return;                     // someone touched the screen: later
        if (err instanceof NoWebp) settle("skipped-no-webp");
        else settle("failed", { ms: Math.round(performance.now() - t0), error: String((err as Error)?.message ?? err).slice(0, 200) });
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => { void tick(); }, TICK_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      offScene();
      for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput, { capture: true });
      cleanupDebug();
    };
  }, [managerRef, mayManageModel, configRef]);
}
