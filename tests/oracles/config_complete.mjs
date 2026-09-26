// Every setting present and valid, applied in ONE place (src/config/AppConfig
// normaliseConfig, round 10, 2.496.155).
//
// ⚠️ A DEFAULT WAS APPLIED WHEREVER A READER REMEMBERED. Stored config spread
// over DEFAULT_CONFIG keeps a stored null, so readers wrote `?? default` at a
// dozen sites, each with its own copy of the default (the camera beam's 180°
// and 30° lived only at the read site); the badge size was clamped by the top
// bar and not by Settings, which printed a stored 0 as "0.00×".
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
const A = await import("@/config/AppConfig");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

const stored = { ...A.DEFAULT_CONFIG, walkSpeed: null, naturalScrolling: null, badgeStyle: undefined, showSummaryBar: undefined,
  cameraBeamPitchDeg: undefined, entityIconScale: 0, northOffsetDeg: null };
const n = A.normaliseConfig(stored);
ck("a missing or null setting takes its default", n.walkSpeed === 1 && n.naturalScrolling === true && n.badgeStyle === "card" && n.showSummaryBar === true && n.northOffsetDeg === 0);
ck("  ...the camera beam's angles are defaults in the table, not at the read site", n.cameraBeamPitchDeg === 30 && A.DEFAULT_CONFIG.cameraBeamOffsetDeg === 180);
ck("the badge size is clamped once — a stored 0 reads as the minimum everywhere", n.entityIconScale === A.clampIconScale(0) && n.entityIconScale > 0);
ck("a value that was set is kept", A.normaliseConfig({ ...A.DEFAULT_CONFIG, walkSpeed: 2.5, badgeStyle: "classic" }).walkSpeed === 2.5);
ck("the seeds stay EMPTY (CLAUDE.md: a seeded table resurrects deleted entries)",
   Object.keys(A.DEFAULT_CONFIG.entityMap).length === 0 && Object.keys(A.DEFAULT_CONFIG.meshBindings).length === 0);
const withVariant = { ...A.DEFAULT_CONFIG, entityMap: { "cover.x__open": { type: "cover" } } };
ck("the map migrations run by default (a variant key is stripped)", !("cover.x__open" in A.normaliseConfig(withVariant).entityMap));
ck("  ...and are skipped for a patch that carries no map ({ maps: false }) — completion still runs",
   "cover.x__open" in A.normaliseConfig({ ...withVariant, walkSpeed: null }, { maps: false }).entityMap
   && A.normaliseConfig({ ...withVariant, walkSpeed: null }, { maps: false }).walkSpeed === 1);

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("EVERY patch is completed, maps migrated only when carried", /setConfig\(\(prev\) => normaliseConfig\(\{ \.\.\.prev, \.\.\.patch \}, \{ maps \}\)\);/.test(src("config/ConfigContext.tsx")));
const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
const keys = Object.keys(A.DEFAULT_CONFIG).join("|");
const fallbacks = walk(SRC).flatMap((f) => [...readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").matchAll(new RegExp(`config\\.(${keys})\\s*\\?\\?`, "g"))].map((m) => `${f.slice(SRC.length)}: ${m[1]}`));
ck("no reader re-defaults a setting normaliseConfig already guarantees", fallbacks.length === 0, fallbacks);

// 2.496.163: loadConfig takes the user's own slices as stored — nothing is
// spread under them, so a seeded entry can never resurrect a deleted one.
const ac = src("config/AppConfig.ts");
ck("loadConfig spreads no seed under the user's maps, thresholds or rooms",
   /entityMap: stored\.entityMap \?\? \{\},/.test(ac) && /meshBindings: stored\.meshBindings \?\? \{\},/.test(ac)
   && /alertThresholds: stored\.alertThresholds \?\? \{\},/.test(ac) && /teleportPoints: stored\.teleportPoints \?\? \[\],/.test(ac)
   && !/\.\.\.DEFAULT_CONFIG\.(entityMap|meshBindings|alertThresholds)/.test(ac));
ck("no per-entity category exception table (its only content could be one villa's devices)", !/CATEGORY_EXCEPTIONS/.test(src("config/EntityCategories.ts")));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ every setting present and valid, decided once");
