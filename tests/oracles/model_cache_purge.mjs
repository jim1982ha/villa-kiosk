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
// The session's life is auth/profileSession.ts since 2.496.233 and is driven
// by value in profile_session.mjs (logout, sign every device out, the server
// ending it, and a session found gone at start). What stays here: that ONE
// place ends it, and that the browser's "forget" is this purge.
const ps = readFileSync(new URL("../../src/auth/profileSession.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("the session module drops the role in one place, which forgets the cache",
   (ps.match(/role: null/g) ?? []).length === 1 && /private end\(\): void \{[\s\S]*?this\.io\.forget\(\);[\s\S]*?role: null/.test(ps));
ck("logout, sign-everywhere and the server-ended session all go through it",
   (ps.match(/this\.end\(\);/g) ?? []).length === 3);
ck("the browser's forget IS the model-cache purge", /forget: \(\) => \{ void purgeModelCache\(\); \}/.test(ctx));

done("✅ a signed-out device holds no floor plan");
