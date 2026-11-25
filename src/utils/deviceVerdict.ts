// src/utils/deviceVerdict.ts
// Whether THIS device shows the 3D villa or the villa pictures (villaPictures.ts), decided once, as the page opens,
// before any 3D work: the model's download (modelLifecycle.prefetch), the 3D engine's chunk (Dashboard's lazy canvas)
// and the scene all wait on it.
//
// ⚠️ DECIDED BEFORE THE 3D VIEW TRIES, NOT AFTER IT FAILS (owner, 2026-11-24): a TV (Mali-G52, Chrome WebView) took
// 74s to open the 28 MB villa and was barely usable once open; "as soon as the kiosk UI loads, test the device and
// automatically switch to the picture view when the host device is judged incapable of opening the 3D view; I don't
// want to wait for the kiosk to fully load and fail before switching". What it reads, the first that applies wins:
//   1. this device's override: `?view=pictures` / `?view=3d`, kept (a TV app's URL need not carry it every time);
//      `?view=auto` forgets it;
//   2. this device's own record of the 3D villa: a crash (a load attempt left standing, diagnostics), the slow
//      screen, or a load that took over SLOW_LOAD_MS. Written by the 3D view (BabylonCanvas), so the second opening is
//      right even when the probes below missed;
//   3. a TV or set-top box's browser (TV_UA);
//   4. a throwaway WebGL probe: no WebGL2, a software renderer, or a GPU family too weak for the villa;
//   5. a device that reports 2 GB of memory or less;
//   else the 3D villa.
// Synchronous and cheap (one tiny canvas, released at once), cached for the page. Every input is passed to
// judgeDevice, so tests/oracles/device_verdict.mjs decides devices that are not here.

import { isCrashLooping } from "./diagnostics";
import { report } from "./telemetry";
import { readString, removeStored, writeJson, writeString } from "./storedJson";
import { whenAllClosed } from "@/hooks/useBackToClose";

export type DeviceView = "3d" | "pictures";

/** Why a device got its view, as its telemetry says it. */
export type VerdictReason =
  | "override" | "crashed" | "slow-screen" | "slow-load" | "tv" | "no-webgl2" | "software-gpu" | "weak-gpu"
  | "low-memory" | "capable";

export interface Verdict {
  view: DeviceView;
  reason: VerdictReason;
  /** The GPU the probe read ("" when it read none). */
  gpu: string;
  webgl: "webgl2" | "webgl" | "none";
  cores: number | null;
  devMemGb: number | null;
  tv: boolean;
}

/** The override this device keeps ("pictures" or "3d"), set by `?view=` or the 3D view's own button. */
export const VIEW_KEY = "villa-kiosk:view";
/** This device's last outcome with the 3D villa (Record3d). */
export const RECORD_KEY = "villa-kiosk:3d-record";

/** A 3D load that took longer than this (bytes in hand to the first frame drawn, hidden time out) reads as a device
 *  too slow for it. Measured: laptops 4-7s, phones up to about 15s, the TV 74s. */
export const SLOW_LOAD_MS = 40_000;

/** A TV or set-top box's browser: Android TV, Samsung (Tizen), LG (webOS), Sony, HbbTV, Chromecast, Fire TV. */
export const TV_UA = /Android TV|Smart[- ]?TV|Tizen|Web0S|webOS|BRAVIA|HbbTV|CrKey|AFT[A-Z]/i;
/** A renderer drawn by the processor, not a GPU. */
export const SOFTWARE_GPU = /SwiftShader|llvmpipe|Software|Microsoft Basic Render/i;
/** GPU families too weak for the villa's model: entry Mali (G31/G51/G52, every T and 400 series), PowerVR GE8xxx,
 *  Adreno 3xx/4xx, a Raspberry Pi's VideoCore. */
export const WEAK_GPU = /Mali-(G3\d|G5[0-2]|T\d+|4\d\d)\b|PowerVR (Rogue )?GE8\d+|Adreno \(TM\) [34]\d\d|VideoCore/i;

/** This device's last outcome with the 3D villa: it opened (in `ms`), it showed the slow screen, or a load of it was
 *  killed mid-way (a crash). A new outcome replaces the last. */
export type Record3d = { kind: "ready"; ms: number; at: number } | { kind: "slow" | "crashed"; at: number };

export interface GpuProbe { webgl: Verdict["webgl"]; gpu: string; maxTexture: number | null }

/** What the verdict reads, every one of them passed in (tests decide devices that are not here). */
export interface VerdictInputs {
  /** The page's query string (location.search). */
  search: string;
  /** This device's storage: the override and the record. */
  store: { get(key: string): string | null; set(key: string, v: string): void; remove(key: string): void };
  /** A 3D load attempt was left standing (diagnostics.isCrashLooping): the page was killed while opening it. */
  crashed: boolean;
  ua: string;
  probe(): GpuProbe;
  deviceMemory: number | null;
  cores: number | null;
}

const isView = (v: string | null): v is DeviceView => v === "3d" || v === "pictures";

function readRecord(raw: string | null): Record3d | null {
  try {
    const r = raw ? JSON.parse(raw) as Partial<Record3d> & { ms?: unknown } : null;
    if (!r || typeof r !== "object" || typeof r.at !== "number") return null;
    if (r.kind === "ready") return typeof r.ms === "number" ? r as Record3d : null;
    return r.kind === "slow" || r.kind === "crashed" ? r as Record3d : null;
  } catch { return null; }
}

/** The verdict for one device. Writes only what the device itself said: `?view=` kept or forgotten, and a crash read
 *  from a standing attempt kept in the record (the attempt's own window forgets it after hours, the record does not). */
export function judgeDevice(i: VerdictInputs): Verdict {
  const asked = new URLSearchParams(i.search).get("view");
  if (isView(asked)) i.store.set(VIEW_KEY, asked);
  else if (asked === "auto") i.store.remove(VIEW_KEY);
  const tv = TV_UA.test(i.ua);
  const probe = i.probe();
  const base = { gpu: probe.gpu, webgl: probe.webgl, cores: i.cores, devMemGb: i.deviceMemory, tv };
  const say = (view: DeviceView, reason: VerdictReason): Verdict => ({ view, reason, ...base });

  const override = i.store.get(VIEW_KEY);
  if (isView(override)) return say(override, "override");

  if (i.crashed) {
    i.store.set(RECORD_KEY, JSON.stringify({ kind: "crashed", at: Date.now() } satisfies Record3d));
    return say("pictures", "crashed");
  }
  const record = readRecord(i.store.get(RECORD_KEY));
  if (record?.kind === "crashed") return say("pictures", "crashed");
  if (record?.kind === "slow") return say("pictures", "slow-screen");
  if (record?.kind === "ready" && record.ms > SLOW_LOAD_MS) return say("pictures", "slow-load");

  if (tv) return say("pictures", "tv");
  if (probe.webgl !== "webgl2") return say("pictures", "no-webgl2");
  if (SOFTWARE_GPU.test(probe.gpu)) return say("pictures", "software-gpu");
  if (WEAK_GPU.test(probe.gpu)) return say("pictures", "weak-gpu");
  if (i.deviceMemory !== null && i.deviceMemory <= 2) return say("pictures", "low-memory");
  return say("3d", "capable");
}

// ── This page's device ───────────────────────────────────────────────────────

/** One throwaway context: its renderer and limits read, then released at once (WEBGL_lose_context), so the 3D view's
 *  own context is never one too many. */
function probeGpu(): GpuProbe {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const gl2 = c.getContext("webgl2") as WebGL2RenderingContext | null;
    const gl = gl2 ?? (c.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return { webgl: "none", gpu: "", maxTexture: null };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = String((dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? "");
    const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { webgl: gl2 ? "webgl2" : "webgl", gpu: gpu.slice(0, 120), maxTexture };
  } catch {
    return { webgl: "none", gpu: "", maxTexture: null };
  }
}

let verdict: Verdict | null = null;

/** This page's verdict, decided on the first ask. */
export function deviceVerdict(): Verdict {
  if (verdict) return verdict;
  const nav = navigator as Navigator & { deviceMemory?: number };
  verdict = judgeDevice({
    search: location.search,
    store: { get: readString, set: (k, v) => { writeString(k, v); }, remove: removeStored },
    crashed: isCrashLooping(),
    ua: navigator.userAgent,
    probe: probeGpu,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
  });
  return verdict;
}

/** This device's view. */
export function deviceView(): DeviceView {
  return deviceVerdict().view;
}

let reported = false;
/** The verdict to the add-on's telemetry, once per page. Sent from the signed-in villa view, not at the first ask:
 *  the add-on keeps telemetry only from a session it knows. */
export function reportDeviceView(): void {
  if (reported) return;
  reported = true;
  const { view, reason, gpu, webgl, cores, devMemGb, tv } = deviceVerdict();
  report("device-view", { view, reason, gpu, webgl, cores, devMemGb, tv });
}

/** `href` without the `?view=` that asks for a view (judgeDevice keeps the one it asks for, on every opening). */
export function withoutViewAsked(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("view");
  return u.toString();
}

/** Show `view` on this device from now on (Advanced Settings' switch, the slow screen's way out): kept as its override, and the page opened again.
 *  ⚠️ OPENED AGAIN WITHOUT `?view=` (owner, 2026-11-25: "when i click on it: nothing happens"): an address carrying
 *  `?view=3d` set the 3D villa back on every reload, so the switch to the pictures did nothing. */
export function switchDeviceView(view: DeviceView): void {
  if (view === "3d") forget3dRecord();
  writeString(VIEW_KEY, view);
  // ⚠️ OPENED AGAIN ONCE THE WINDOWS ARE CLOSED (owner, 2026-11-25: the pictures came only after a refresh): Save
  // closes Settings, whose step back in history cancelled a reload asked before it. A replace to the same address
  // with a `#` in it would move within the page and open nothing, so the same address is reloaded.
  whenAllClosed(() => {
    const next = withoutViewAsked(location.href);
    if (next === location.href) location.reload();
    else location.replace(next);
  });
}

/** How the 3D villa went on this device (BabylonCanvas): the next opening reads it. */
export function note3dOutcome(o: { kind: "ready"; ms: number } | { kind: "slow" }): void {
  writeJson(RECORD_KEY, o.kind === "ready" ? { kind: "ready", ms: Math.round(o.ms), at: Date.now() } : { kind: "slow", at: Date.now() });
}

/** "Try once more" on the crash screen: the record of that crash is forgotten with its attempt. */
export function forget3dRecord(): void {
  removeStored(RECORD_KEY);
}
