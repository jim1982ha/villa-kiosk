// "Back" from a panel opened from another window (2.496.270). A device's
// reading opened from "Also on this device" replaced the device's panel with
// no way back but Close, which dropped the person on the map (owner,
// 2026-10-04). Every opener that comes from another window records where it
// came from; the panel draws Back at its header's top right, and Escape / the
// phone's back gesture take it. Node cannot import .tsx, so the wiring is pinned.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { SURFACE_LABEL } = await import("@/pages/surfaces");
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const dash = rd("pages/Dashboard.tsx"), base = rd("components/panels/BasePanel.tsx"), cam = rd("components/panels/CameraPanel.tsx");

console.log("  the panels:");
ck("the panel frame draws Back at the header's right, from the panel actions' `back`",
   /const \{[^}]*\bback \} = usePanelActions\(\);/.test(base)
   && /\{back && \(\s*<button type="button" className="btn panel-back" onClick=\{back\.go\}/.test(base));
ck("  ...and Escape / the phone's back gesture go back (one step), not close",
   /useModalA11y\(back \? back\.go : onClose\)/.test(base));
ck("the camera panel (its own frame) does the same",
   /const \{ linked, back \} = usePanelActions\(\);/.test(cam) && /useModalA11y\(back \? back\.go : onClose\)/.test(cam)
   && /\{back && \(\s*<button className="icon-btn" onClick=\{back\.go\}/.test(cam));

console.log("\n  every opener from another window says where it came from:");
ck("a reading opened from its device: Back reopens the device (and pops one step)",
   /onOpenReading: openReading,/.test(dash) && /const parent = activePanel;/.test(dash)
   && /go: \(\) => \{ setCameFrom\(\(s2\) => s2\.slice\(0, -1\)\); setActivePanel\(parent\); \}/.test(dash));
ck("a device from the Cockpit, the VESTA Agent or Facility: Back reopens that window",
   /setCameFrom\(\[\{ label: SURFACE_LABEL\[from\], go: \(\) => \{ closePanel\(\); openSurface\(from\); \} \}\]\);/.test(dash)
   && ["cockpit", "agent", "facility"].every((w) => dash.includes(`onOpenEntity={(id) => handOver("${w}", id)}`)));
ck("a device from a room list or a category list: Back reopens the list",
   /openFromList\(id, g\.room, \(\) => setClusterGroup\(g\)\)/.test(dash)
   && /openFromList\(id, CATEGORY_LABELS\[c\], \(\) => setCategoryGroup\(c\)\)/.test(dash));
ck("the panel is handed the innermost step", /back: cameFrom\.length > 0 \? cameFrom\[cameFrom\.length - 1\] : undefined,/.test(dash));

console.log("\n  nothing to go back to:");
ck("opened from the map (tap, long-press) or the bottom bar: no Back",
   (dash.match(/setCameFrom\(\[\]\);\s*setActivePanel\(\{ entityId, mapping/g) ?? []).length === 2
   && /onOpenEntity=\{\(id\) => \{ setCameFrom\(\[\]\); openDevicePanel\(id\); \}\}/.test(dash));
ck("Close (and Edit / Report a fault, which leave the panel) empties it — no bare setActivePanel(null)",
   (dash.match(/setActivePanel\(null\)/g) ?? []).length === 1 && /onClose=\{closePanel\}/.test(dash));
ck("every window a device can be handed from has words for its Back",
   ["cockpit", "agent", "facility"].every((w) => typeof SURFACE_LABEL[w] === "string" && SURFACE_LABEL[w].length > 0));
done("✅ a panel opened from another window can go back to it");
