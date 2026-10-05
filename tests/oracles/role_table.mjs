// The one role table (rootfs/usr/share/vesta/roles.json), as the APP reads it.
// The proxy reads the same file (tests/proxy-rules.py, "the one role table").
//
// Before 2.496.223 the rights were written twice — PERMISSION_MATRIX here and
// ROLE_CAPABILITIES in the proxy — and kept equal by a test that scraped the
// TypeScript as text. These drive VALUES through the app's own resolvers.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { CAPABILITIES, hasCapability, isCategoryAllowed, isTypeAllowed } = await import("@/auth/permissions");
const { ROLE_ORDER, isRole } = await import("@/auth/roles");
const { CATEGORY_ORDER } = await import("@/config/EntityCategories");

const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/roles.json", import.meta.url), "utf8"));
const profiles = Object.keys(table.profiles);

console.log("  the table's names are the app's:");
ck("its profiles are exactly the app's profiles",
   profiles.length === ROLE_ORDER.length && profiles.every(isRole), profiles.join());
const unknown = Object.values(table.profiles).flatMap((row) => row.capabilities)
  .filter((c) => !CAPABILITIES.includes(c));
ck("every capability it names is one the app declares", unknown.length === 0, unknown.join());
const badCats = Object.values(table.profiles)
  .flatMap((row) => row.allowedCategories === "all" ? [] : row.allowedCategories)
  .filter((c) => !CATEGORY_ORDER.includes(c));
ck("every category it names is a map category", badCats.length === 0, badCats.join());

console.log("\n  the app answers from it:");
const wrongCap = profiles.flatMap((r) => CAPABILITIES
  .filter((c) => hasCapability(r, c) !== table.profiles[r].capabilities.includes(c)).map((c) => `${r}.${c}`));
ck("hasCapability is the table, for every profile and capability", wrongCap.length === 0, wrongCap.join());
const wrongCat = profiles.flatMap((r) => CATEGORY_ORDER.filter((c) => isCategoryAllowed(r, c) !==
  (table.profiles[r].allowedCategories === "all" || table.profiles[r].allowedCategories.includes(c))).map((c) => `${r}.${c}`));
ck("isCategoryAllowed is the table", wrongCat.length === 0, wrongCat.join());
ck("isTypeAllowed is the table (a guest is shown no camera, ops is)",
   !isTypeAllowed("guest", "camera") && isTypeAllowed("ops", "camera") && isTypeAllowed("owner", "camera"));

done("✅ the app reads its rights from the one role table");
