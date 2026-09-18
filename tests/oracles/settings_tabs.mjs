// Advanced Settings is a TAB STRIP, and every section it used to collapse still
// has exactly one home.
//
// Two failures are being pinned, and neither is a wrong answer a behavioural
// oracle could catch:
//   1. A section silently LOST in the regroup. Six collapsible sections became
//      three tabs of two; dropping one leaves a screen that still renders, still
//      type-checks, and is simply missing a control nobody notices until they go
//      looking for it.
//   2. A SECOND hand-rolled tab strip. Facility already had one; adding a
//      literal copy here is the shape that drops the half nobody misses
//      (`role`, `aria-selected`, scroll-into-view) — invisible to `tsc` and to
//      review. `common/ModalTabs` is the one owner.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

// Resolved from THIS FILE, not the working directory — `run-all.sh` cd's into
// this folder, and a scan that finds no files is the worst possible green.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const FILES = walk(SRC);
const modal = readFileSync(join(SRC, "components/settings/ConfigEditorModal.tsx"), "utf8");

/* ── 1. the tab strip has one owner ──────────────────────────────────── */
const strips = FILES.filter((f) => /role="tablist"/.test(readFileSync(f, "utf8")))
  .map((f) => f.slice(SRC.length + 1));

/* ── 2. every section survived, in exactly one tab ───────────────────── */
// The six sections this screen carried as collapsibles, and the tab each was
// regrouped into. Written out rather than derived: the point is to state what
// the screen MUST hold, so deleting one from the source fails here.
const SECTIONS = [
  ["Villa location", "villa"],
  ["Bound 3D objects", "villa"],
  ["Auto-detected entity settings", "devices"],
  ["Grouped devices", "devices"],
  ["Device telemetry", "system"],
  ["Session", "system"],
];

// Split the render body into one chunk per tab, by the `{tab === "x" && (`
// guards. Anything before the first guard is chrome shared by every tab.
const chunks = {};
const parts = modal.split(/\{tab === "(\w+)" &&/);
for (let i = 1; i < parts.length; i += 2) chunks[parts[i]] = (chunks[parts[i]] ?? "") + parts[i + 1];

const titleIn = (chunk, title) =>
  new RegExp(`<div className="settings-section-title">\\s*${title}\\s*</div>`).test(chunk);

const misplaced = [];
for (const [title, want] of SECTIONS) {
  const homes = Object.keys(chunks).filter((t) => titleIn(chunks[t], title));
  if (homes.length !== 1 || homes[0] !== want) {
    misplaced.push(`${title} → ${homes.length ? homes.join("+") : "NOWHERE"} (want ${want})`);
  }
}

/* ── 3. the collapse is gone, not merely unused ──────────────────────── */
const collapseRefs = FILES.filter((f) => /CollapsibleSection/.test(readFileSync(f, "utf8")))
  .map((f) => f.slice(SRC.length + 1));

/* ── 4. the owner-only tab is filtered, not rendered-and-empty ───────── */
const filtersOwner = /TABS\.filter\(\(t\) => role === "owner" \|\| !t\.owner\)/.test(modal);
const startsInStrip = /useState<SettingsTab>\(\s*focusEntityId \? "devices" : \(tabs\[0\]\?\.id \?\? "villa"\)\)/
  .test(modal.replace(/\s*\n\s*/g, " "));

console.log(`  scanned ${FILES.length} source files`);
console.log(`  files declaring a tablist: ${strips.join(", ") || "none"}`);
console.log(`  tabs found in the render: ${Object.keys(chunks).join(", ") || "none"}`);
for (const m of misplaced) console.log(`      misplaced: ${m}`);
if (collapseRefs.length) console.log(`      CollapsibleSection still referenced by: ${collapseRefs.join(", ")}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan reached the source tree", FILES.length > 100);
ck("exactly one hand-written tab strip, and it is ModalTabs",
   strips.length === 1 && strips[0] === "components/common/ModalTabs.tsx");
ck("Advanced Settings renders three tabs", Object.keys(chunks).sort().join(",") === "devices,system,villa");
ck("all six sections survive, each in exactly one tab", misplaced.length === 0);
ck("no section is behind a collapse any more", collapseRefs.length === 0);
ck("the owner-only tab is filtered out of the strip", filtersOwner);
ck("the opening tab is chosen from the FILTERED strip", startsInStrip);
process.exit(fail ? 1 : 0);
