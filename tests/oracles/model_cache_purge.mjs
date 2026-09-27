// The floor plan must not outlive the session it was fetched under (2.496.206).
// public/sw.js answers a model request from its cache BEFORE nginx's /model/
// gate is asked, so on a shared tablet a signed-out device still held the
// villa. Every way a session ends now purges that cache — through ONE
// endSession in the profile context, named for the worker's own cache.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";

const { MODEL_CACHE_NAME, purgeModelCache } = await import("@/utils/modelCache");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const ctx = readFileSync(new URL("../../src/auth/ProfileContext.tsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("  the name:");
ck("the page names the worker's model cache exactly", /const MODEL_CACHE = "([^"]+)"/.exec(sw)?.[1] === MODEL_CACHE_NAME, MODEL_CACHE_NAME);

console.log("\n  the purge:");
const deleted = [];
globalThis.caches = { delete: async (n) => { deleted.push(n); return true; } };
ck("deletes that cache and says so", await purgeModelCache() === true && deleted.join() === MODEL_CACHE_NAME, deleted);
globalThis.caches = { delete: async () => { throw new Error("SecurityError"); } };
ck("a blocked Cache API is false, never a throw", await purgeModelCache() === false);
delete globalThis.caches;
ck("no Cache API at all (insecure context) is false too", await purgeModelCache() === false);

console.log("\n  every end of a session:");
const end = /const endSession = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/.exec(ctx)?.[1] ?? "";
ck("endSession purges the model cache and drops the role", /void purgeModelCache\(\);/.test(end) && /setRole\(null\);/.test(end));
ck("it is the ONLY place the role is dropped", (ctx.match(/setRole\(null\)/g) ?? []).length === 1);
for (const name of ["logout", "logoutAll"]) {
  const body = new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\}, \\[endSession\\]\\);`).exec(ctx)?.[1] ?? "";
  ck(`${name} ends the session through it`, /endSession\(\);/.test(body));
}
ck("so does the server-ended session (sessionLost)", /sessionLostDecision\(role, server\)[\s\S]*?endSession\(\);/.test(ctx));

done("✅ a signed-out device holds no floor plan");
