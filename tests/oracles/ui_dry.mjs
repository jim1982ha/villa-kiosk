// The shared UI pieces (2.496.199): SegmentedGroup and SaveButton rendered by
// value, and the hooks that replaced hand-rolled copies — useOutsideClose
// (4 popovers, two of which used mousedown so a touch outside did not close
// them), useInterval (5 tickers) — pinned at their callers.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done, tsFiles } from "../consistency/check.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// ⚠️ Node strips types, not JSX, so a .tsx component cannot be imported here;
// the two components are pinned by SOURCE (what they render), the hooks by
// their callers (no hand-rolled copy left).
const srcOf = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

console.log("  the segmented group:");
{
  const c = srcOf("components/common/SegmentedGroup.tsx");
  ck("a group: role, name, one button per option, pressed = active", /role="group" aria-label=\{ariaLabel\}/.test(c) && /options\.map\(\(o\) =>/.test(c) && /aria-pressed=\{o\.key === active\}/.test(c) && /className=\{o\.key === active \? "active" : ""\}/.test(c));
  ck("  ...its title is the accessible name for an icon-only option", /title=\{o\.title\} aria-label=\{o\.title\}/.test(c));
  ck("  ...and `active: null` is a toggle that is off", /active: K \| null;/.test(c));
}
console.log("\n  the save button:");
{
  const c = srcOf("components/common/SaveButton.tsx");
  ck("disabled once saved, reads 'Saved' then", /disabled=\{disabled \|\| saved\}/.test(c) && /\{saved \? "Saved" : label\}/.test(c));
}
console.log("\n  no copies left:");
{
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const walk = tsFiles;
  const files = walk(join(SRC, "components")).concat(walk(join(SRC, "pages")));
  const rel = (f) => f.slice(SRC.length);
  // Dashboard marks "someone touched the kiosk"; CameraPanel routes taps on
  // its own chrome. Neither is an outside-close.
  const NOT_POPOVERS = new Set(["pages/Dashboard.tsx", "components/panels/CameraPanel.tsx"]);
  const outside = files.filter((f) => /addEventListener\("(pointerdown|mousedown)", /.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !NOT_POPOVERS.has(f));
  ck("no component listens for an outside pointerdown/mousedown itself", outside.length === 0, outside);
  const tickers = files.filter((f) => /setInterval\(/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !/panels\/cameraTiers\.ts$/.test(f));
  ck("no component (bar the camera snapshot poller) owns a setInterval", tickers.length === 0, tickers);
  const seg = files.filter((f) => /className=\{?[`"]segmented[ "`]/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => f !== "components/common/SegmentedGroup.tsx");
  ck("no component hand-rolls `.segmented` markup", seg.length === 0, seg);
  // Every date/time DISPLAY format lives in utils/dateText (2.496.263) — the
  // HH:MM clock was pinned to chartUtils alone and "3 Oct, 14:05" had three
  // copies elsewhere. Over ALL of src, not a list of files. Reviewed and kept
  // apart: the energy charts' weekday buckets (a day of the week, not a
  // moment) and the sky debug line's own clock (seconds, debug only).
  const KEEP_DATES = new Set(["components/panels/EnergyPanel.tsx", "components/panels/energyRanges.ts", "config/energyObservations.ts", "utils/skyClock.ts", "utils/dateText.ts"]);
  const dated = walk(SRC).map(rel).filter((f) => !KEEP_DATES.has(f)
    && /toLocale(Date|Time)String\(|toLocaleString\((\[\], \{|\))/.test(readFileSync(join(SRC, f), "utf8")));
  ck("every date/time display format is utils/dateText's (none written elsewhere in src)", dated.length === 0, dated);
  const saves = files.filter((f) => /\? "Saved" : "Save /.test(readFileSync(f, "utf8"))).map(rel);
  ck("no component writes the Save…/Saved ternary itself", saves.length === 0, saves);
  const css = ["03-panels", "07-facility"].map((n) => readFileSync(join(SRC, `styles/${n}.css`), "utf8")).join("\n");
  ck("chip scrims over media are tokens, not literals", !/background: rgba\(0, ?0, ?0, ?(0?\.45|0?\.5|0?\.6|0?\.65|0?\.7|0?\.88)\)/.test(css) && (css.match(/var\(--chip-scrim/g) ?? []).length === 9);
}
{
  // ⚠️ A HOVER LOOK STICKS ON A TOUCHSCREEN. After a tap, Android (and iOS)
  // keep a pretend pointer where the finger lifted, and whatever opens under
  // it wears :hover until the next tap: the "Which room?" sheet opened with
  // its first row green as if chosen (owner screenshot, 2026-10-04). Every
  // :hover lives inside @media (hover: hover) — a real pointer only.
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const files = ["styles.css", ...readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css")).map((f) => `styles/${f}`)];
  const loose = [];
  for (const f of files) {
    const text = readFileSync(join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    const stack = [];
    let head = "", line = 1;
    for (const ch of text) {
      if (ch === "\n") line++;
      if (ch === "{") { stack.push(head.trim()); if (head.includes(":hover") && !stack.slice(0, -1).some((h) => /^@media[^{]*\(hover:\s*hover\)/.test(h))) loose.push(`${f}:${line} ${head.trim().slice(0, 60)}`); head = ""; }
      else if (ch === "}") { stack.pop(); head = ""; }
      else if (ch === ";") head = "";
      else head += ch;
    }
  }
  ck(":hover only for a real pointer — every hover look inside @media (hover: hover), so none sticks after a tap", loose.length === 0, loose);
}
console.log("\n  the on/off setting (owner, 2026-11-03: \"a toggle where user can toggle either ON or OFF\", Map look's style):");
{
  const { elements, parseTsx, propText } = await import("../consistency/jsx.mjs");
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const files = tsFiles(SRC).filter((f) => f.endsWith(".tsx")).map((f) => f.slice(SRC.length));
  const single = [], toggles = [];
  for (const f of files) {
    const tree = parseTsx(f);
    for (const el of elements(tree, "SegmentedGroup")) {
      const opts = propText(el, "options");
      // an options list written out with one entry: an on/off drawn as one pressed button
      if (typeof opts === "string" && opts.startsWith("[") && (opts.match(/\{ ?key: /g) ?? []).length === 1) single.push(`${f}: ${propText(el, "ariaLabel")}`);
    }
    for (const el of elements(tree, "OnOffToggle")) toggles.push(`${f}: ${propText(el, "ariaLabel")}`);
  }
  ck("no SegmentedGroup of one option is left anywhere in src (an on/off is On | Off)", single.length === 0, single);
  ck("  ...every on/off setting draws the one OnOffToggle", ["Maintenance mode", "Confirm before toggling", "Full screen on this tablet",
    "Blue glow for clickable devices", "Natural scrolling", "Summary bar", "Room glow and camera cones"]
    .every((n) => toggles.some((t) => t.endsWith(`"${n}"`))), toggles);
  const c = srcOf("components/common/OnOffToggle.tsx");
  ck("  ...which IS a SegmentedGroup of two options, On and Off, nothing drawn of its own",
     /<SegmentedGroup<OnOff>/.test(c) && /\{ key: "on", label: "On"/.test(c) && /\{ key: "off", label: "Off"/.test(c)
     && /active=\{on \? "on" : "off"\}/.test(c) && !/className="segmented/.test(c));
  // owner, 2026-11-03: a choice standing as its section's own line spans the modal, its segments equal and centred
  const css = readFileSync(join(SRC, "styles/04-modals.css"), "utf8");
  ck("a segmented choice alone on its line fills it, in equal centred segments that wrap on a phone",
     /\.settings-modal \.row > \.segmented:only-child \{ flex: 1 1 100%; flex-wrap: wrap; \}/.test(css)
     && /\.settings-modal \.row > \.segmented:only-child button \{ flex: 1 1 0; min-width: \d+px; justify-content: center; \}/.test(css));
  // owner, 2026-11-03 ("very poorly rendered"): ten languages were one pill stretched over three lines
  const sg = srcOf("components/common/SegmentedGroup.tsx");
  ck("  ...more than four choices draw as a grid of equal cells, not a pill over several lines",
     /options\.length > 4 \? " segmented-grid"/.test(sg)
     && /\.settings-modal \.row > \.segmented\.segmented-grid:only-child \{\s*display: grid; grid-template-columns: repeat\(auto-fill, minmax\(\d+px, 1fr\)\)/.test(css));
  // owner, 2026-11-03: a chat's name stood one letter per line beside a language menu as wide as the line
  ck("a chat's name keeps its line and its language menu its own short width",
     /\.recipients-chat \.fm-entity-chip \{ white-space: nowrap; \}/.test(css)
     && /\.recipients-chat > \.dropdown\.recipients-language \{\s*flex: 0 0 auto; width: \d+px;/.test(css));
  // owner, 2026-11-03: a device's id was cut every few letters beside "Confirm before toggling" on a phone. Owner,
  // 2026-11-05: the pencil and the chevron on the id's own line, at its right; the id never more than 2 lines (a long
  // id with its "· 3D object: …" pushed the toggle and the pencil down a line of their own)
  const row = srcOf("components/settings/EntityMapRow.tsx");
  const tools = row.match(/<span className="entity-id-tools">([\s\S]*?)\n {12}<\/span>/)?.[1] ?? "";
  ck("a device's id: pencil and chevron on its first line at the right, the toggle under it, the id at most 2 lines",
     /<Pencil /.test(tools) && /<ChevronDown /.test(tools) && /<ChevronRight /.test(tools) && !/ConfirmToggle/.test(tools)
     && /<span className="entity-id-confirm" onClick=\{[^}]*\} onKeyDown=\{[^}]*\}>\s*<ConfirmToggle /.test(row)
     && /\.entity-id-display \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;\s*grid-template-areas: "name tools" "confirm confirm";/.test(css)
     && /\.entity-id-text \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;[^}]*overflow-wrap: anywhere;/.test(css)
     && /title=\{\[m\.entityId, \.\.\.\(objects \?\? \[\]\)\]\.join/.test(row)
     && !/\.entity-id-text \{[^}]*break-all/.test(css), tools);
}
done("✅ one segmented group, one on/off, one save button, one outside-close, one ticker");

