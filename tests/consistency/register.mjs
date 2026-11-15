// tests/consistency/register.mjs
// The alias hook (alias-hook.mjs: `@/` imports, .tsx screens, stylesheets emptied), registered ONCE for a whole run,
// before any test file loads, so no oracle carries its own two lines of setup. Every run names it:
//   npm test                                                                    (every oracle)
//   node --no-warnings --import ./tests/consistency/register.mjs --test tests/oracles/<file>.mjs   (one file)
import { register } from "node:module";
register("./alias-hook.mjs", import.meta.url);
