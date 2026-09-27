// ONE list of what is open: the Back stack (hooks/useBackToClose). Every
// dismissable surface registers on it — through useModalA11y, AskDialog or
// useBackToClose itself — and "is anything open?" is its answer (overlayOpen).
//
// Before 2.496.192 the daytime auto-reload asked five hand-kept flags and
// could reload over a half-written guest report, the Rooms menu, the overflow
// menu or the Rooms dial; the last three also ignored Back.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const { overlayOpen } = await import("@/hooks/useBackToClose");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

ck("nothing registered: nothing open", overlayOpen() === false);

const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx$/.test(p) && out.push(p); } return out; };
const read = (f) => readFileSync(f, "utf8");
const REGISTERS = /useModalA11y\(|useBackToClose\(|<AskDialog\b|<BasePanel\b/;
// A surface is anything drawn as a dialog, a modal backdrop or a menu.
const surfaces = walk(SRC).filter((f) => /className="modal-backdrop|role="dialog"|role="menu"|aria-haspopup="menu"/.test(read(f)));
const unregistered = surfaces.filter((f) => !REGISTERS.test(read(f))).map((f) => f.slice(SRC.length));
ck(`every surface registers on the stack (${surfaces.length} files)`, surfaces.length >= 10 && unregistered.length === 0, unregistered);

const hud = read(join(SRC, "components/hud/HUD.tsx"));
ck("the overflow menu and the Rooms dial are on it", /useBackToClose\(\(\) => setMenuOpen\(false\), menuOpen\)/.test(hud) && /useBackToClose\(\(\) => setRadial\(null\), radial !== null\)/.test(hud));
ck("the Rooms menu is on it", /useBackToClose\(onClose\);/.test(read(join(SRC, "components/teleport/TeleportMenu.tsx"))));
const dash = read(join(SRC, "pages/Dashboard.tsx"));
ck("the auto-reload asks the stack, and keeps no list of its own",
   /installDailyAutoReload\(\(\) =>\s*!overlayOpen\(\) &&/.test(dash) && !/modalOpenRef/.test(dash));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one list of what is open");
process.exit(fail ? 1 : 0);
