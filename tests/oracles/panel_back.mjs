// "Back" from a panel opened from another window (2.496.270). A device's
// reading opened from "Also on this device" replaced the device's panel with
// no way back but Close, which dropped the person on the map (owner,
// 2026-10-04). Every opener that comes from another window records where it
// came from; the panel draws Back at its header's top right, and Escape / the
// phone's back gesture take it. The frames are .tsx (pinned by text); where Back goes is pages/panelNav, by value.
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

console.log("\n  where Back goes is panelNav's, driven by value:");
const { panelNavReducer: R, NO_PANEL, reopenOf } = await import("@/pages/panelNav");
const P = (id) => ({ entityId: id, mapping: { type: "light" } });
const run = (...acts) => acts.reduce(R, NO_PANEL);
const dev = run({ type: "open", panel: P("device") });
ck("opened from the map or the bottom bar: no Back", dev.back.length === 0 && dev.panel.entityId === "device");
const rd1 = R(dev, { type: "drill", panel: P("reading") });
ck("a reading opened from its device: Back reopens the device, one step",
   rd1.panel.entityId === "reading" && R(rd1, { type: "back" }).panel.entityId === "device"
   && R(rd1, { type: "back" }).back.length === 0 && reopenOf(rd1) === null);
const fromCockpit = run({ type: "openFrom", panel: P("pump"), from: { kind: "surface", surface: "cockpit" } });
ck("a device handed over by the Cockpit or the VESTA Agent: Back closes it and names the window to reopen",
   reopenOf(fromCockpit)?.surface === "cockpit" && R(fromCockpit, { type: "back" }).panel === null
   && ["cockpit", "agent"].every((w) => dash.includes(`onOpenEntity={(id) => handOver("${w}", id)}`)));
const room = { kind: "list", list: { kind: "room", room: "Kitchen", entityIds: ["a"] } };
ck("a device from a room or category list: Back names the list to reopen",
   reopenOf(run({ type: "openFrom", panel: P("a"), from: room }))?.list.room === "Kitchen");
const side = R(fromCockpit, { type: "switch", panel: P("cam2") });
ck("a camera's next/previous is a sideways move: the same Back", side.back === fromCockpit.back && side.panel.entityId === "cam2");
ck("Close empties it", R(rd1, { type: "close" }) === NO_PANEL || R(rd1, { type: "close" }).panel === null && R(rd1, { type: "close" }).back.length === 0);

console.log("\n  ⚠️ a device this profile may not see opens NOTHING (2.496.274):");
ck("no Back step is recorded and the open panel stays",
   ["open", "drill", "switch"].every((t) => R(rd1, { type: t, panel: null }) === rd1)
   && R(dev, { type: "openFrom", panel: null, from: room }) === dev);
ck("the hand-over closes its window only after a panel was found",
   /const panel = panelFor\(identity\.deviceOf\(entityId\)\);\s*if \(!panel\) return;\s*closeSurface\(from\);/.test(dash));
ck("every window a device can be handed from has words for its Back",
   ["cockpit", "agent"].every((w) => typeof SURFACE_LABEL[w] === "string" && SURFACE_LABEL[w].length > 0));
done("✅ a panel opened from another window can go back to it");
