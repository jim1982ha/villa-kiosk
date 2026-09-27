// What a profile excludes, it does not see anywhere (2.496.210).
// The guest profile excludes the energy category and motion sensors
// (binary_sensor), but four surfaces that are not an entity's own panel
// showed them anyway: the Energy tile (and the Energy window it opens), the
// Cockpit's "Energy today", the motion toast and the motion room glow / beam.
// Each now asks the permission matrix. Components are .tsx (Node cannot import
// them), so the rule is driven by value and each surface is pinned by source.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";

const { isTypeAllowed, isCategoryAllowed } = await import("@/auth/permissions");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("  the matrix:");
ck("a guest may not see motion sensors or energy", !isTypeAllowed("guest", "binary_sensor") && !isCategoryAllowed("guest", "energy"));
ck("  ...the owner and ops may see both", ["owner", "ops"].every((r) => isTypeAllowed(r, "binary_sensor") && isCategoryAllowed(r, "energy")));
ck("  ...and a guest still sees lights", isTypeAllowed("guest", "light") && isCategoryAllowed("guest", "light"));

console.log("\n  every surface asks:");
ck("the Energy tile (and so the Energy window) exists only when the profile may see energy",
   /if \(facts\.power && can\("energy"\)\) \{/.test(src("components/hud/SummaryBar.tsx")));
const cockpit = src("components/cockpit/CockpitModal.tsx");
ck("the Cockpit does not even fetch Energy today for such a profile",
   /const seesEnergy = role != null && isCategoryAllowed\(role, "energy"\);/.test(cockpit)
   && /if \(!seesEnergy\) \{ setEnergy\(null\); return; \}\s*let cancelled = false;\s*fetchEnergyToday\(ws\)/.test(cockpit)
   && /\}, \[ws, seesEnergy\]\);/.test(cockpit));
ck("the motion toast is skipped for a profile denied motion sensors",
   /const who = roleRef\.current;\s*if \(!who \|\| !isTypeAllowed\(who, "binary_sensor"\)\) return;/.test(src("pages/Dashboard.tsx")));
ck("the 3D motion glow / beam is skipped under the role-filtered config",
   /private applyMotionRouting\(entity: HassEntity\): void \{\s*if \(this\.config\.deniedTypes\?\.includes\("binary_sensor"\)\) return;/.test(src("babylon/EntityVisuals.ts")));

done("✅ a guest sees no energy and no motion, anywhere");
