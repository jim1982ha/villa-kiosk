// tests/oracles/model_lifecycle.mjs
// The villa model's one lifecycle (utils/modelLifecycle), driven through its interface with an invented add-on and
// download, no browser: what each screen shows, and that "replaced" reloads once. Owner, 2026-11-16: a 125 MB model
// (geometry not compressed) left every screen on "Loading the villa…" for ever.
import { ck, done } from "../consistency/check.mjs";
const { createModelLifecycle, tooHeavyLine, tooHeavyTitle, MODEL_TOO_HEAVY_BYTES, MODEL_UNPACK_LIMIT_MS } =
  await import("@/utils/modelLifecycle");

const MB = 1_000_000;
/** An add-on answer for a model of `bytes` at time `mtime`: its version is nginx's ETag form, "<mtime hex>-<size hex>". */
const holding = (bytes, mtime = 0x6730a000) => ({
  model_path: "villa.glb", model_version: `${mtime.toString(16)}-${bytes.toString(16)}`, rooms_version: "",
});

/** An invented add-on and network. `answers`: what each ask of the add-on gets (the last one repeats). `bytes(url)`
 *  is what the download returns; `announce` the length it announces, when there is no version stamp. */
function rig({ answers, announce = null, httpStatus = null }) {
  const asks = [], downloads = [], timers = [];
  const deps = {
    readAddonConfig: async () => {
      const a = answers[Math.min(asks.length, answers.length - 1)];
      asks.push(a);
      return a;
    },
    urlFor: (cfg) => `model/${cfg.model_path}?v=${cfg.model_version ?? ""}`,
    getBytes: async (url, hooks) => {
      downloads.push(url);
      if (httpStatus) return { ok: false, status: httpStatus };
      if (announce !== null) hooks.onSize(announce);
      hooks.onProgress(0.5);
      const v = /-([0-9a-f]+)$/.exec(url);
      return { ok: true, data: new ArrayBuffer(Math.min(v ? parseInt(v[1], 16) : announce ?? 1024, 4096)), kept: false };
    },
    forgetBrowserModel: async () => {},
    wait: async () => {},
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
  };
  const life = createModelLifecycle(deps);
  const seen = [];
  life.subscribe(() => seen.push(life.snapshot().state.kind));
  return { life, asks, downloads, timers, seen };
}
const unpack = async () => ({ meshes: 3 });
const ok = (cfg) => ({ ok: true, cfg });

console.log("\n  a normal model, no model, an error:");
{
  const r = rig({ answers: [ok(holding(20 * MB))] });
  const got = await r.life.load(unpack);
  ck("the owner's normal 20 MB model: the villa is shown (ready), the unpack's result handed back",
     got.ok && got.result.meshes === 3 && r.life.snapshot().state.kind === "ready", r.life.snapshot().state);
  ck("  ...its progress was shown on the way", r.seen.includes("loading"), r.seen);
  ck("  ...and the add-on's answer is there for Settings", r.life.snapshot().addon?.model_path === "villa.glb");
}
{
  const r = rig({ answers: [ok({ model_path: "" })] });
  const got = await r.life.load(unpack);
  ck("the add-on holds no model: the \"No 3D model loaded yet\" screen (none), nothing downloaded",
     !got.ok && got.reason === "none" && r.life.snapshot().state.kind === "none" && r.downloads.length === 0);
}
{
  const r = rig({ answers: [ok(holding(20 * MB))], httpStatus: 404 });
  const got = await r.life.load(unpack);
  const s = r.life.snapshot().state;
  ck("the model file answers 404: its error screen, saying to re-upload it, never a spinner",
     !got.ok && s.kind === "error" && s.code === "MODEL_FETCH_HTTP_404" && /Re-upload/.test(s.message), s);
}
{
  const r = rig({ answers: [ok(holding(20 * MB))] });
  await r.life.load(async () => { throw new Error("the 3D view refused the file"); });
  const s = r.life.snapshot().state;
  ck("the 3D view refuses the file: its error screen with the 3D view's words", s.kind === "error" && /refused/.test(s.message), s);
}

console.log("\n  a model too heavy to load:");
{
  const r = rig({ answers: [ok(holding(125 * MB))] });
  const got = await r.life.load(unpack);
  const s = r.life.snapshot().state;
  ck("a 125 MB model: the \"too heavy\" screen with its size, known before any byte is downloaded",
     !got.ok && s.kind === "too-heavy" && s.bytes === 125 * MB && !s.slow && r.downloads.length === 0, { s, d: r.downloads });
  ck("  ...its line says \"125 MB\" and the limit", /125 MB/.test(tooHeavyLine(s)) && tooHeavyLine(s).includes(`${MODEL_TOO_HEAVY_BYTES / MB} MB`),
     tooHeavyLine(s));
  ck("  ...and it never shows loading again after that", r.seen.lastIndexOf("loading") < r.seen.indexOf("too-heavy"), r.seen);
}
{
  const r = rig({ answers: [ok({ model_path: "villa.glb" })], announce: 125 * MB });
  await r.life.load(unpack);
  const s = r.life.snapshot().state;
  ck("an add-on that gives no version: the download's announced 125 MB says too heavy, nothing unpacked",
     s.kind === "too-heavy" && s.bytes === 125 * MB, s);
}
{
  const r = rig({ answers: [ok(holding(20 * MB))] });
  let finish;
  const p = r.life.load(() => new Promise((res) => { finish = res; }));
  await new Promise((res) => setTimeout(res, 0));
  const guard = r.timers.find((t) => t.live);
  ck("the unpack's guard is long (at least two minutes): a slow 20 MB model is never \"too heavy\" for its link",
     guard && guard.ms === MODEL_UNPACK_LIMIT_MS && guard.ms >= 120_000, guard?.ms);
  guard.fn();
  const s = r.life.snapshot().state;
  ck("  ...an unpack still running past it: the \"too heavy\" screen with the size, not the spinner",
     s.kind === "too-heavy" && s.slow && s.bytes > 0 && /still unpacking/.test(tooHeavyLine(s))
     && /device is too slow/.test(tooHeavyTitle(s)), s);
  finish({ meshes: 1 });
  await p;
  ck("  ...and when it does finish after all, the villa is shown", r.life.snapshot().state.kind === "ready");
}

console.log("\n  the add-on unreachable, then answering:");
{
  const r = rig({ answers: [{ ok: false, status: 502 }, { ok: false }, ok(holding(20 * MB))] });
  const got = await r.life.load(unpack);
  ck("no answer is \"reconnecting\", never \"no model\"; then ready when the add-on answers",
     got.ok && r.seen.includes("reconnecting") && !r.seen.includes("none") && r.life.snapshot().state.kind === "ready", r.seen);
}

console.log("\n  the model replaced (an upload landed):");
{
  const r = rig({ answers: [ok(holding(20 * MB, 1)), ok(holding(21 * MB, 2))] });
  await r.life.load(unpack);
  const gen = r.life.snapshot().generation;
  await r.life.replaced();
  ck("exactly one reload (the generation goes up by one)", r.life.snapshot().generation === gen + 1, r.life.snapshot().generation);
  const again = await r.life.load(unpack);
  ck("  ...and that reload loads the NEW version", again.ok && again.url.endsWith(holding(21 * MB, 2).model_version)
     && r.downloads.at(-1) === again.url, r.downloads);
}
{
  const r = rig({ answers: [ok(holding(20 * MB))] });
  await r.life.load(unpack);
  const gen = r.life.snapshot().generation;
  await r.life.replaced();
  ck("an upload that changed nothing the add-on reports: no reload", r.life.snapshot().generation === gen);
}
{
  const r = rig({ answers: [ok(holding(125 * MB, 1)), ok(holding(20 * MB, 2))] });
  await r.life.load(unpack);
  await r.life.replaced();
  await r.life.load(unpack);
  ck("a lighter model uploaded from the \"too heavy\" screen: the villa is shown",
     r.life.snapshot().state.kind === "ready", r.life.snapshot().state);
}

console.log("\n  the background download started on the profile screen:");
{
  const r = rig({ answers: [ok(holding(20 * MB))] });
  r.life.prefetch();
  const got = await r.life.load(unpack);
  r.life.prefetch();
  ck("the load uses it (one download, not two), and a later prefetch starts none",
     got.ok && got.prefetched && r.downloads.length === 1, r.downloads);
}

done("The villa model's lifecycle: ready, none, too heavy with its size, reconnecting, one reload per replacement");
