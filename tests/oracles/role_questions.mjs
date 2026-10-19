// Every role question through the permission table, and every count from the
// set its list shows (auth/permissions.ts, config/attention.attentionFor).
//
// Before 2.496.191 five files compared role NAMES (`role === "owner"`), and a
// guest's counts disagreed with their lists: the attention badge counted
// devices the guest could not open, and a summary tile counted off-map
// devices the list it opened left out.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done, tsFiles } from "../consistency/check.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const { roleCan, listedDevices, hasCapability } = await import("@/auth/permissions");
const { attentionFor } = await import("@/config/attention");


console.log("  the table:");
ck("no profile chosen: no rights", !roleCan(null, "controlEntities") && !roleCan(undefined, "reportFault"));
ck("the update count is the owner's", roleCan("owner", "seeUpdates") && !roleCan("ops", "seeUpdates") && !roleCan("guest", "seeUpdates"));
ck("off-map devices are listed for owner and facility manager, not a guest",
   hasCapability("owner", "listUnmappedDevices") && hasCapability("ops", "listUnmappedDevices") && !hasCapability("guest", "listUnmappedDevices"));

console.log("\n  what a profile's lists and counts cover:");
{
  const devices = new Set(["a", "b", "c"]), mapped = new Set(["a", "c", "z"]);
  const pick = (r) => ["a", "b", "c", "z"].filter((id) => listedDevices(r, devices, mapped).has(id)).join();
  ck("owner: every villa device", pick("owner") === "a,b,c", pick("owner"));
  ck("guest: the villa devices on the map", pick("guest") === "a,c", pick("guest"));
  ck("no profile: nothing", pick(null) === "", pick(null));
}

console.log("\n  the attention a profile is shown:");
{
  const { devicesOf } = await import("../consistency/devices.mjs");
  const att = {
    devices: devicesOf({ ids: ["cam", "lamp", "fan"], unavailable: ["cam", "lamp"] }),
    attentionItems: [
      { id: "unavailable:cam", kind: "unavailable", title: "Cam", detail: "Unavailable", entityId: "cam" },
      { id: "unavailable:lamp", kind: "unavailable", title: "Lamp", detail: "Unavailable", entityId: "lamp" },
      { id: "schedule:s", kind: "schedule", title: "Filter", detail: "Overdue" },
    ],
    health: { level: "danger", summary: "x" },
  };
  const g = attentionFor(att, (id) => id !== "cam");
  ck("an item about a device the profile may not open is left out; one with no device stays",
     g.attentionItems.map((i) => i.id).join() === "unavailable:lamp,schedule:s", g.attentionItems.map((i) => i.id));
  ck("  ...and the devices the Cockpit groups by follow", g.devices.unavailable.join() === "lamp" && g.devices.ids.join() === "lamp,fan"
     && !g.devices.has("cam") && g.devices.has("fan"));
  const none = attentionFor(att, () => false);
  ck("  ...and the health line is re-read from what remains", none.attentionItems.length === 1 && none.health.level !== "ok" && g.health !== att.health);
  const clean = attentionFor({ ...att, attentionItems: att.attentionItems.slice(0, 1) }, () => false);
  ck("nothing left: 'Everything looks fine.'", clean.health.level === "ok", clean.health);
}

console.log("\n  who asks:");
{
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const walk = tsFiles;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const offenders = walk(SRC).filter((f) => !/\/src\/auth\//.test(f))
    .filter((f) => /\brole(Ref\.current)?\s*[!=]==\s*"(owner|guest|ops)"/.test(strip(readFileSync(f, "utf8")))).map((f) => f.slice(SRC.length));
  ck("no file outside auth/ compares a role NAME", offenders.length === 0, offenders);
  const src = (p) => readFileSync(new URL(p, new URL("../../src/", import.meta.url)), "utf8");
  ck("the summary tiles count the listed set", /listedDevices\(role, visibleDevices, mappedEntityIds\)/.test(src("components/hud/SummaryBar.tsx")));
  ck("the list a tile opens drops off-map rows by the same capability", /mayListUnmapped: roleCan\(role, "listUnmappedDevices"\)/.test(src("components/panels/SummaryGroupPanel.tsx")));
  // The rule itself is villaVisibility.visibleTo, driven by value in
  // villa_visibility.mjs (2.496.226).
  ck("the badge and the Cockpit read the profile's attention", /return attentionFor\(attention, /.test(src("components/cockpit/useVillaAttention.ts"))
     && /visibleTo\(role\)/.test(src("components/cockpit/useVillaAttention.ts")));
}

console.log("\n  the signed-in badge:");
{
  // The top bar's round badge (2.496.242) shows the role's letters, and does
  // what the name + exit arrow did: the profile switch.
  const { ROLE_INITIALS, ROLE_ORDER } = await import("@/auth/roles");
  ck("O for the owner, FM for the facility manager, G for a guest",
     ROLE_INITIALS.owner === "O" && ROLE_INITIALS.ops === "FM" && ROLE_INITIALS.guest === "G", ROLE_INITIALS);
  ck("  ...every profile has one, and no two share it",
     ROLE_ORDER.every((r) => ROLE_INITIALS[r]) && new Set(ROLE_ORDER.map((r) => ROLE_INITIALS[r])).size === ROLE_ORDER.length);
  const hud = readFileSync(new URL("../../src/components/hud/HUD.tsx", import.meta.url), "utf8");
  // Owner, 2026-10-12: on a roomy screen the badge OPENS a menu — Settings, then "Logout (<role>)" —
  // and Settings has no icon of its own beside it. The phone's menu ends with the SAME rows, written once.
  const code = hud.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const inline = code.slice(code.indexOf('className="hud-right-inline'), code.indexOf('className="hud-group hud-overflow"'));
  ck("  ...the badge is the role's letters and opens the account menu; Settings has no icon of its own",
     /className=\{`icon-btn hud-role-badge/.test(inline) && /onClick=\{\(\) => account\.setOpen\(\(o\) => !o\)\}/.test(inline)
     && /aria-haspopup="menu"/.test(inline) && /\{ROLE_INITIALS\[role\]\}/.test(inline)
     && !/aria-label="Settings"/.test(inline) && !/hud-profile/.test(hud));
  ck("  ...the menu is the shared rows", /\{accountRows\(\(\) => account\.setOpen\(false\)\)\}/.test(inline));
  const rows = code.slice(code.indexOf("const accountRows"), code.indexOf("</>", code.indexOf("const accountRows")));
  ck("the shared rows: Settings, then 'Logout (<role>)' with the role's badge, opening the profile switch",
     rows.indexOf("<span>Settings</span>") > 0 && rows.indexOf("<span>Settings</span>") < rows.indexOf("Logout (")
     && /<span>Logout \(\{ROLE_LABELS\[role\]\}\)<\/span>/.test(rows) && /beginSwitch\(\)/.test(rows)
     && /className=\{`role-glyph\$\{ROLE_INITIALS\[role\]\.length > 1/.test(rows), rows.slice(0, 300));
  // The phone menu (2.496.246): it ends with the same rows; the colour legend is reached from "Label size (?)".
  const menu = code.slice(code.indexOf('className="hud-group hud-overflow"'));
  ck("  ...and the phone's menu ends with them — no second copy of either row",
     /\{accountRows\(\(\) => setMenuOpen\(false\)\)\}/.test(menu) && (code.match(/<span>Settings<\/span>/g) ?? []).length === 1
     && (code.match(/Logout \(/g) ?? []).length === 1 && !code.includes("<span>Log out</span>") && !menu.includes("Switch profile"));
  const logout = rows;
  const help = menu.slice(menu.indexOf('className="hud-menu-help"') - 200, menu.indexOf("<span>Label size</span>") + 80);
  ck("  ...and 'Label size (?)' opens the map-colours legend; the 'Map colours' row is gone",
     /setLegendOpen\(true\)/.test(help) && /<CircleHelp size=\{18\}/.test(help) && !menu.includes("<span>Map colours</span>"), help);
  // 2.496.247: no "Signed in as …" header — the badge says who, its dot the
  // connection; the robot's dot says the agent, as in the top bar. ONE dot.
  ck("  ...no 'Signed in as' header; the badge carries the connection as the shared status dot",
     !menu.includes("hud-menu-header") && !/Signed in as \{ROLE_LABELS/.test(menu)
     && /<span className=\{`status-dot \$\{connTone\}`\} \/>/.test(logout), logout.slice(0, 400));
  const cockpitRow = menu.slice(menu.indexOf("onOpenCockpit();"), menu.indexOf("Cockpit{"));
  ck("  ...and the menu's robot wears the top bar's own agentDot, with no 'agent online' text",
     /\{doors\.agent && agentDot\}/.test(cockpitRow) && !/agent \$\{agentOnline/.test(hud)
     && (hud.match(/className=\{`status-dot /g) || []).length === 2 && !/agent-btn-dot/.test(hud), cockpitRow);
}

done("✅ one table answers every role question; counts match their lists");

