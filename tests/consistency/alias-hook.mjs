// tests/consistency/alias-hook.mjs
// Make this repo's TypeScript importable by plain `node`, for the consistency
// harness. Two jobs, both purely mechanical:
//
//   1. `@/foo` → `<repo>/src/foo`         (the tsconfig path alias)
//   2. extensionless → `.ts` / `.tsx`     (bundler-style module resolution)
//   3. `@babylonjs/core/X` → `X.js`       (the app's deep imports, same reason)
//
// ⚠️ THIS EXISTS SO THE HARNESS CAN RUN THE KIOSK'S REAL CODE. Its whole value
// is that both runtimes derive their answers from the SHIPPED rule; a copy
// transcribed for testing would agree with itself forever while the app moved,
// which is the failure being guarded against. `node --experimental-strip-types`
// runs TypeScript directly — every oracle here relies on that — but it
// applies neither of the two conventions above, because both are Vite's.
//
// ⚠️ NO DEPENDENCY, DELIBERATELY. There is no JS test runner configured in this
// repo and adding one to compare two JSON documents would be a large change for
// a small check. Twenty lines of resolver is the cheaper half of that trade.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "..", "src") + "/").href;

/** `.ts`/`.tsx`/`/index.ts` — the order Vite would try, first hit wins. */
function withExtension(url) {
  if (/\.[cm]?[jt]sx?$/.test(url)) return url;
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx", ".js"]) {
    const candidate = url + suffix;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return url;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(withExtension(SRC + specifier.slice(2)), context);
  }
  // Babylon ships ESM with explicit `.js` files; Vite adds the extension to
  // `@babylonjs/core/Meshes/mesh`, Node does not.
  if (specifier.startsWith("@babylonjs/") && !/\.[cm]?js$/.test(specifier)) {
    // A file (`Meshes/mesh`) or a directory with an index (`loaders/glTF`).
    try { return await next(specifier + ".js", context); }
    catch { return next(specifier + "/index.js", context); }
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const resolved = new URL(specifier, context.parentURL).href;
    const withExt = withExtension(resolved);
    if (withExt !== resolved) return next(withExt, context);
  }
  return next(specifier, context);
}
