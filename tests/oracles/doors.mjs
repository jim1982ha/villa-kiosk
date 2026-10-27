// Which windows a profile may open, said once (src/auth/doors.ts, 2.496.245).
//
// It was implied: Dashboard passed `onOpenFacility` / `onOpenAgent` only when
// the profile could open them, HUD and CockpitModal tested whether the callback
// existed, CockpitModal asked roleCan for the updates count itself, and the
// Dashboard re-asked each capability beside each window it mounts. This drives
// doorsFor by value over every profile in the ONE role table (roles.json) and
// both agent states, then checks every surface reads the answer.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { doorsFor } = await import("@/auth/doors");
const { ROLE_ORDER } = await import("@/auth/roles");

const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/roles.json", import.meta.url), "utf8"));
const holds = (role, cap) => table.profiles[role].capabilities.includes(cap);

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (f) => strip(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8"));
console.log("  by value, every profile × agent configured or not:");
const wrong = [];
for (const role of ROLE_ORDER) {
  for (const agentVisible of [false, true]) {
    const d = doorsFor(role, agentVisible);
    const want = {
      settings: holds(role, "openSettings"), facility: holds(role, "manageFacility"),
      agent: holds(role, "viewAgent") && agentVisible, updates: holds(role, "seeUpdates"),
      reportFault: holds(role, "reportFault"), editDevices: holds(role, "editConfig"),
    };
    for (const k of Object.keys(want)) if (d[k] !== want[k]) wrong.push(`${role}/${agentVisible}: ${k}=${d[k]}`);
  }
}
ck("each door is exactly the role table's capability (the agent's also needs an agent configured)", wrong.length === 0, wrong);
ck("no profile chosen yet: no doors", Object.values(doorsFor(null, true)).every((v) => v === false));
{
  const g = doorsFor("guest", true);
  ck("a guest has no Facility, no agent and no updates count, even with an agent configured", !g.facility && !g.agent && !g.updates, g);
}
ck("the agent's door needs BOTH the right and an agent: never open with no agent configured",
   ROLE_ORDER.every((r) => doorsFor(r, false).agent === false));
ck("every door is said (none left undefined for a screen to guess)",
   ROLE_ORDER.every((r) => Object.values(doorsFor(r, true)).every((v) => typeof v === "boolean")) && Object.keys(doorsFor("owner", true)).length === 6);
{
  // what a device panel may show is a VALUE from these doors, never whether a callback exists (doors.ts' history):
  // the wrench, Edit and the badge colour are drawn from `may`
  const panel = src("components/panels/BasePanel.tsx"), acts = src("components/panels/useOpenPanelActions.ts");
  const pieces = src("components/panels/DeviceWindowPieces.tsx");
  ck("a device panel's wrench, Edit and badge colour read `may` (the doors), and its callbacks are always there",
     /if \(!may\.reportFault\) return null;/.test(pieces) && /if \(!may\.edit\) return null;/.test(pieces) && /const canRecolor = badge && may\.edit;/.test(panel)
     && !/\? \(\) => go\(\{ type: "(reportFault|editDevice)" \}\) : undefined/.test(acts) && !/roleCan\(role, "(reportFault|editConfig)"\)/.test(acts));
}

console.log("\n  every surface reads the one answer:");
const dash = src("pages/Dashboard.tsx"), hud = src("components/hud/HUD.tsx"), cockpit = (src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/CockpitOverview.tsx"));
ck("Dashboard computes it once and mounts every window behind it",
   (dash.match(/doorsFor\(/g) ?? []).length === 1
   && ["settings", "configEditor"].every((s) => new RegExp(`\\{shown\\("${s}"\\) && \\(`).test(dash))
   // 2.496.273: Facility is the Cockpit's tabs, behind the same door
   && /const tabs: ModalTab<CockpitTab>\[\] = doors\.facility \? \[OVERVIEW_TAB, \.\.\.FACILITY_TABS\] : \[OVERVIEW_TAB\];/.test(cockpit)
   && /const shown = \(surface: Surface\) => surfaceShown\(screen\.windows, surface, doors\);/.test(dash));
ck("  ...and no longer re-asks those capabilities itself",
   !/roleCan\(role, "(openSettings|manageFacility|viewAgent)"\)/.test(dash) && !/agentVisible \?/.test(dash));
ck("no window's visibility is implied by a callback being passed (no `? () => … : undefined`)",
   !/onOpen(Agent|Facility)=\{[^}]*\? /.test(dash) && !/onOpen(Agent|Facility)\?:/.test(hud) && !/onOpenAgent\?:/.test(cockpit));
ck("the top bar draws Settings and the agent's robot from doors — and no Facility button (its tabs are the Cockpit's)",
   (hud.match(/\{doors\.facility && \(/g) ?? []).length === 0 && (hud.match(/\{doors\.settings && \(/g) ?? []).length === 1   // ONE Settings row, shared by both menus (accountRows, 2.496.335)
   && !/\{onOpenFacility && \(|\{canOpenSettings && \(/.test(hud));
ck("the Cockpit's updates count reads doors, not roleCan — and names them in its tooltip (config/updatesWaiting)",
   /doors\.updates \? updatesWaiting\(entities, hiddenInHaEntityIds, config\.entityMap\) : \[\]/.test(cockpit) && !/roleCan\(role, "seeUpdates"\)/.test(cockpit)
   && /<Tip text=\{updatesTip\(updates\)\}>/.test(cockpit));

done("✅ which doors a profile has is said once");
