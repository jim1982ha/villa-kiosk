// tests/oracles/device_verdict.mjs
// Which view a device is given (utils/deviceVerdict), decided for invented devices: a TV, a laptop, a phone whose 3D
// opening was slow. Owner, 2026-11-24: a TV took 74s to open the 3D villa; "test the device and automatically switch to
// the picture view... I don't want to wait for the kiosk to fully load and fail before switching".
import { ck, done } from "../consistency/check.mjs";
const { judgeDevice, VIEW_KEY, RECORD_KEY, SLOW_LOAD_MS } = await import("@/utils/deviceVerdict");

const LAPTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const TV_UA = "Mozilla/5.0 (Linux; Android 11; TV-MODEL Build/XYZ; wv) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 Android TV";
const LAPTOP_GPU = { webgl: "webgl2", gpu: "ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL 4.6)", maxTexture: 16384 };
const MALI = { webgl: "webgl2", gpu: "ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)", maxTexture: 8192 };

/** A device: its storage, its browser, its GPU. */
function device({ search = "", stored = {}, crashed = false, ua = LAPTOP_UA, gpu = LAPTOP_GPU, mem = 8 } = {}) {
  const kept = new Map(Object.entries(stored));
  const inputs = {
    search, crashed, ua, deviceMemory: mem, cores: 8,
    store: { get: (k) => kept.get(k) ?? null, set: (k, v) => kept.set(k, v), remove: (k) => kept.delete(k) },
    probe: () => gpu,
  };
  return { verdict: () => judgeDevice(inputs), kept, inputs };
}

console.log("\n  what a device is judged by:");
{
  const v = device().verdict();
  ck("a laptop with its own GPU opens the 3D villa", v.view === "3d" && v.reason === "capable", v);
}
{
  const v = device({ ua: TV_UA, gpu: MALI }).verdict();
  ck("a TV's browser is given the villa pictures, before any 3D work", v.view === "pictures" && v.tv, v);
}
{
  const v = device({ ua: "Mozilla/5.0 (Linux; Smart TV) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" }).verdict();
  ck("  ...also one that writes \"Smart TV\" with a space", v.view === "pictures" && v.tv, v);
}
{
  const v = device({ gpu: MALI }).verdict();
  ck("a weak GPU (a Mali-G52) is given the pictures, whatever its browser says", v.view === "pictures" && v.reason === "weak-gpu", v);
}
{
  const v = device({ gpu: { webgl: "webgl2", gpu: "Google SwiftShader", maxTexture: 8192 } }).verdict();
  ck("a GPU drawn by the processor (SwiftShader) is given the pictures", v.view === "pictures", v);
  const none = device({ gpu: { webgl: "none", gpu: "", maxTexture: null } }).verdict();
  ck("  ...and so is a browser with no WebGL2", none.view === "pictures", none);
}
{
  const v = device({ mem: 2 }).verdict();
  ck("a device that reports 2 GB of memory is given the pictures", v.view === "pictures", v);
}

console.log("\n  this device's own record of the 3D villa:");
{
  const slow = JSON.stringify({ kind: "ready", ms: 74_000, at: 1 });
  const v = device({ stored: { [RECORD_KEY]: slow } }).verdict();
  ck(`a laptop whose last 3D opening took 74s (over ${SLOW_LOAD_MS / 1000}s) is given the pictures the next time`,
     v.view === "pictures" && v.reason === "slow-load", v);
  const quick = device({ stored: { [RECORD_KEY]: JSON.stringify({ kind: "ready", ms: 6_000, at: 1 }) } }).verdict();
  ck("  ...one whose last opening took 6s opens the 3D villa", quick.view === "3d", quick);
}
{
  const v = device({ stored: { [RECORD_KEY]: JSON.stringify({ kind: "slow", at: 1 }) } }).verdict();
  ck("a device that reached the 3-minute slow screen is given the pictures", v.view === "pictures", v);
}
{
  const d = device({ crashed: true });
  const v = d.verdict();
  ck("a device whose last 3D opening was killed mid-way (a crash) is given the pictures", v.view === "pictures", v);
  d.inputs.crashed = false; // the attempt's window forgot it, hours later
  ck("  ...and still is once the crash's attempt is forgotten: the record keeps it", d.verdict().view === "pictures");
}

console.log("\n  the override (?view=), kept by the device:");
{
  const d = device({ ua: TV_UA, gpu: MALI, search: "?view=3d" });
  ck("?view=3d opens the 3D villa even on a TV", d.verdict().view === "3d");
  d.inputs.search = "";
  ck("  ...and keeps doing so without the URL saying it again", d.verdict().view === "3d" && d.kept.get(VIEW_KEY) === "3d");
  d.inputs.search = "?view=auto";
  ck("  ...until ?view=auto: the device is judged again", d.verdict().view === "pictures" && !d.kept.has(VIEW_KEY));
}
{
  const v = device({ search: "?view=pictures", stored: { [RECORD_KEY]: JSON.stringify({ kind: "ready", ms: 4_000, at: 1 }) } }).verdict();
  ck("?view=pictures shows the pictures on a laptop that opens the 3D villa in 4s", v.view === "pictures" && v.reason === "override", v);
}
{
  const d = device({ crashed: true, search: "?view=3d" });
  ck("the override wins over a crash: the 3D view's own crash screen then shows", d.verdict().view === "3d");
}

done("The device verdict: TVs, weak GPUs and slow or crashed openings get the villa pictures; ?view= overrides and is kept");
