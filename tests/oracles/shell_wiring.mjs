// tests/oracles/shell_wiring.mjs
//
// The app shell's wiring, pinned as text.
//
// ⚠️ WHY TEXT AND NOT BEHAVIOUR. Every defect below lived inside a React
// component, a hook dependency array or a class's lifecycle — none of it
// reachable from a plain `node` import, and all of it type-correct. 7 of 194
// source files were importable by an oracle when these were found, and none of
// the five files here was one of them. A static pin is what is available; the
// alternative was nothing, which is what there was.
//
// Each assertion names the defect it prevents, so a future reader deleting one
// knows exactly what comes back.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, "utf8");
/** Source with comments removed.
 *
 *  ⚠️ USE THIS FOR ANY "X NO LONGER APPEARS" ASSERTION. Two of the pins below
 *  first failed against correct code because the fix's own docstring QUOTES the
 *  literal it removed — the instrument was reading prose and calling it code. A
 *  comment is not evidence of what a module does, in either direction. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
let fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

// ── the villa decides its own shape ──────────────────────────────────────
const HUD = read("src/components/hud/HUD.tsx");
console.log("  the model decides how many storeys there are:");
eq("HUD holds no floor-number literal",
   /const floors\s*=\s*\[\s*\d/.test(HUD), false);
eq("...and the button list comes from floorsAvailable",
   /availFloors\s*=[\s\S]{0,200}floorsAvailable/.test(HUD), true);
// A 3-storey GLB reported floor 3, Dashboard.onFloorChange switched to it, and
// the HUD rendered no button because `[1, 2].filter(...)` intersected the
// model's answer with a literal. First hard rule: no villa dimension ships.

// ── a memo that watches its own input ────────────────────────────────────
const SB = read("src/components/hud/SummaryBar.tsx");
const memoDeps = /const deviceTiles = useMemo\([\s\S]*?\n\s*\[([^\]]*)\]/.exec(SB)?.[1] ?? "";
console.log("\n  the tiles can see the villa's devices arrive:");
eq("the deviceTiles memo depends on villaDeviceSet",
   /\bvillaDeviceSet\b/.test(memoDeps), true);
eq("...and NOT on the imported function, which never changes",
   /\bvillaDevices\b(?!Set)/.test(memoDeps), false);
// mappedEntityIds arrives when the GLB finishes loading. Depending on the
// module-scope function instead of the memoised value meant the tile counts
// could not move at the one moment they must.

// ── one gate on the one thing that writes ────────────────────────────────
const DCS = read("src/config/DeviceConfigSync.tsx");
console.log("\n  only an owner writes shared config:");
eq("the gate is the document's own write gate (judged when a push RUNS, on every path)",
   /canWrite: \(\) => roleRef\.current === "owner"/.test(DCS) && !/fetchSharedConfig\(\)[\s\S]{0,200}saveSharedConfig\(/.test(DCS), true);
// It used to be only on the push effect, so the pull's abort branch — which
// retries a stuck edit — ran the whole fetch-rebase-write loop for every role,
// forever, against a server that 403s.

// ── a socket whose two halves match ──────────────────────────────────────
const WS = read("src/ha/HAWebSocket.ts");
console.log("\n  the wake listeners survive a reconnect:");
eq("connect() arms them", /this\.manuallyClosed = false;[\s\S]{0,200}armWakeListeners\(\)/.test(WS), true);
eq("disconnect() disarms them", /disconnect\(\)[\s\S]{0,700}?disarmWakeListeners\(\)/.test(WS), true);
eq("nothing else touches the listeners directly",
   (WS.match(/(?:add|remove)EventListener\("(?:visibilitychange|online)"/g) ?? []).length, 4);
// The constructor armed them and disconnect() removed them; connect() did not
// put them back. One disconnect/connect cycle on an instance — which React
// StrictMode performs on every mount — dropped the wake path for the life of
// the page, leaving a wall tablet on backoff-only recovery.

// ── both read paths get the same migrations ──────────────────────────────
const AC = read("src/config/AppConfig.ts");
// ⚠️ code(), AND WITH THE IMPORT LINE DROPPED. Asserting that the string
// "normaliseConfig" appears in this file passed a mutation that deleted BOTH
// call sites, because the import still carried the name. A pin that a deletion
// cannot move is not pinning the deletion.
const CC = code("src/config/ConfigContext.tsx").replace(/^import .*$/gm, "");
console.log("\n  config is normalised however it arrives:");
eq("AppConfig exports the normalisation", /export function normaliseConfig\(/.test(AC), true);
eq("loadConfig uses it", /return normaliseConfig\(\{/.test(AC), true);
// The window must STOP at the next declaration. Unbounded, it ran on into
// replace() and found that call instead, so deleting update()'s stayed green.
const updateBody = /const update = useCallback([\s\S]*?)(?=const replace = useCallback)/.exec(CC)?.[1] ?? "";
eq("...the update() the server pull arrives through wraps its setConfig",
   /normaliseConfig\(\{ \.\.\.prev, \.\.\.patch \}, \{ maps \}\)/.test(updateBody), true);
eq("...and replace() does too",
   /const replace = useCallback[\s\S]{0,300}?setConfig\(normaliseConfig\(/.test(CC), true);
eq("the migrations have no other caller",
   (AC.match(/migrateMotionEntityId\(|stripStaleVariantEntities\(/g) ?? []).length, 4);
// entityMap and meshBindings arrive from the shared store too, and that path
// touched neither migration: one device pushed stale `__variant` keys, every
// other pulled them in, the local read stripped them, the next pull restored
// them. The resurrection bug, arriving over the network.

// ── the cap has one owner ────────────────────────────────────────────────
console.log("\n  no screen reaches past the engine for the cap:");
const screens = ["src/components/fm/SpendTab.tsx", "src/components/fm/TodayTab.tsx"];
for (const f of screens) {
  eq(`${f.split("/").pop()} reads budgetStatus().capIdr`,
     /MINOR_MAINTENANCE_CAP_IDR/.test(code(f)), false);
}
// ⚠️ THE WHOLE OF src/fm/, NOT THE ONE FILE THE LAST DEFECT WAS IN. This read
// only fmEngine.ts and matched only `toLocaleString(` — so fmReport.ts's
// `toLocaleDateString("en-GB")` and `toLocaleString("en-GB")`, in the file that
// writes the owner's report, were outside the ban on both counts. hard-rules.py
// names this exact failure in its own header: "a guard scoped to where the last
// defect was found, rather than to everything the rule applies to".
const FM = execFileSync("git", ["ls-files", "src/fm", "src/components/fm"],
                        { encoding: "utf8", cwd: ROOT })
  .split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
eq("the fm scan found files", FM.length > 5, true);
const baked = FM.filter((f) => {
  const c = code(f);
  return /`IDR \$\{/.test(c) || /toLocale(?:Date|Time)?String\(\s*"[a-z]{2}-[A-Z]{2}"/.test(c);
});
eq("no currency or locale is baked into any money or date the owner reads",
   baked.length ? baked : "none", "none");
// SpendTab printed "of IDR 0" on an unconfigured install: it read the raw
// constant where every neighbouring line reads b.capIdr and gates on > 0.

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the shell is wired as described"}`);
process.exit(fail ? 1 : 0);
