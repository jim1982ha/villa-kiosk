// Two pieces the panels wrote out by hand (round 11, 2.496.173): the inline
// two-step confirm (five copies) and the linked entity's switch semantics
// (two copies). The switch props are driven by value; the confirm is pinned
// by its sites.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { linkedSwitchProps } = await import("@/components/panels/PanelActionsContext");

const toggle = () => {};
const on = linkedSwitchProps({ label: "Gate", isOn: true, known: true, toggle });
const lost = linkedSwitchProps({ label: "Gate", isOn: false, known: false, toggle });
ck("a known linked entity: a switch that throws, its state said aloud",
   on.onClick === toggle && !on.disabled && on.role === "switch" && on["aria-checked"] === true && on["aria-label"] === "Gate: on");
ck("an UNKNOWN one cannot be thrown, and says 'unavailable' (not 'off')",
   lost.onClick === undefined && lost.disabled && lost["aria-label"] === "Gate: unavailable", lost);

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("both linked switches spread linkedSwitchProps, neither writes its own",
   ["components/panels/BasePanel.tsx", "components/panels/CameraPanel.tsx"].every((f) => /\{\.\.\.linkedSwitchProps\(linked\)\}/.test(src(f)) && !/linked\.known \? linked\.toggle/.test(src(f))));

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });
const root = new URL("../../src/", import.meta.url).pathname;
const copies = walk(root).filter((f) => !f.endsWith("InlineConfirm.tsx")
  && /className="modal-actions"[^>]*>\s*(<span[\s\S]{0,200}?<\/span>\s*)?<button className="btn ghost"[^>]*>Cancel<\/button>\s*<button\s+className="btn danger"/.test(readFileSync(f, "utf8")));
ck("no two-step confirm is written out by hand (InlineConfirm is the one)", copies.length === 0, copies.map((f) => f.slice(root.length)));
const users = walk(root).filter((f) => /<InlineConfirm\b/.test(readFileSync(f, "utf8")));
ck("  ...and the five that were use it", users.length >= 5, users.length);

done("✅ the panels' shared pieces, once each");
