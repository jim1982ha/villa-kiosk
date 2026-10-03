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

console.log("  by value, every profile × agent configured or not:");
const wrong = [];
for (const role of ROLE_ORDER) {
  for (const agentVisible of [false, true]) {
    const d = doorsFor(role, agentVisible);
    const want = {
      settings: holds(role, "openSettings"), facility: holds(role, "manageFacility"),
      agent: holds(role, "viewAgent") && agentVisible, updates: holds(role, "seeUpdates"),
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

console.log("\n  every surface reads the one answer:");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (f) => strip(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8"));
const dash = src("pages/Dashboard.tsx"), hud = src("components/hud/HUD.tsx"), cockpit = src("components/cockpit/CockpitModal.tsx");
ck("Dashboard computes it once and mounts every window behind it",
   (dash.match(/doorsFor\(/g) ?? []).length === 1
   && ["agent", "facility", "settings", "configEditor"].every((s) => new RegExp(`\\{shown\\("${s}"\\) && \\(`).test(dash))
   && /const shown = \(surface: Surface\) => surfaceShown\(open, surface, doors\);/.test(dash));
ck("  ...and no longer re-asks those capabilities itself",
   !/roleCan\(role, "(openSettings|manageFacility|viewAgent)"\)/.test(dash) && !/agentVisible \?/.test(dash));
ck("no window's visibility is implied by a callback being passed (no `? () => … : undefined`)",
   !/onOpen(Agent|Facility)=\{[^}]*\? /.test(dash) && !/onOpen(Agent|Facility)\?:/.test(hud) && !/onOpenAgent\?:/.test(cockpit));
ck("the top bar draws Facility, Settings and the agent's robot from doors",
   (hud.match(/\{doors\.facility && \(/g) ?? []).length === 2 && (hud.match(/\{doors\.settings && \(/g) ?? []).length === 2
   && !/\{onOpenFacility && \(|\{canOpenSettings && \(/.test(hud));
ck("the Cockpit's updates count and agent footer read doors, not roleCan",
   /if \(!doors\.updates\) return null;/.test(cockpit) && !/roleCan\(role, "seeUpdates"\)/.test(cockpit) && /\{doors\.agent \? \(/.test(cockpit));

done("✅ which doors a profile has is said once");
