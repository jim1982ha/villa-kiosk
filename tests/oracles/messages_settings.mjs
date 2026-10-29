// The Messages settings (ticket 16 of "One inbox", owner 2026-10-28): "Full screen for" and "Ring shown for" are the
// villa's (every tablet, empty / 60s by default), "Rings full screen on this tablet" each tablet's; Advanced Settings
// gains a Messages tab between Devices and System, owner only; Settings a strip General · Messages, reached
// from the profile button's Settings (the Cockpit's gear that opened it there was removed, owner 2026-10-29).
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const dc = await import("@/config/deviceConfig");
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const { ADVANCED_SETTINGS_KEYS } = await import("@/config/configSlice");
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");

console.log("  whose each setting is:");
ck("\"Full screen for\" and \"Ring shown for\" are the villa's: shared with every tablet, in Advanced Settings' draft",
   ["fullScreenFor", "ringShownForS"].every((k) => dc.SHARED_CONFIG_KEYS.includes(k) && ADVANCED_SETTINGS_KEYS.includes(k)));
ck("  ...\"Rings full screen on this tablet\" this tablet's alone", !dc.SHARED_CONFIG_KEYS.includes("ringsFullScreen"));
ck("an empty default: nothing takes the screen until the owner picks; 60s; a tablet allows it",
   JSON.stringify(DEFAULT_CONFIG.fullScreenFor) === "[]" && DEFAULT_CONFIG.ringShownForS === 60 && DEFAULT_CONFIG.ringsFullScreen === true
   && JSON.stringify(dc.baselineFromServer({}).fullScreenFor) === "[]" && dc.baselineFromServer({}).ringShownForS === 60);
const cfg = normaliseConfig({ entityMap: {}, meshBindings: {} });
ck("  ...a config stored before them reads the defaults", JSON.stringify(cfg.fullScreenFor) === "[]" && cfg.ringShownForS === 60
   && cfg.ringsFullScreen === true, cfg);
const parsed = dc.parseSharedConfig({ fullScreenFor: ["🔔 Visitor", 3], ringShownForS: 45 });
ck("the villa's stored values are read: the titles (anything else dropped), the seconds",
   JSON.stringify(parsed.fullScreenFor) === JSON.stringify(["🔔 Visitor"]) && parsed.ringShownForS === 45, parsed);
ck("  ...a time that is not a whole number of seconds from 1 is not taken",
   [0, -5, 1.5, "60", 100000].every((v) => dc.parseSharedConfig({ ringShownForS: v }).ringShownForS === undefined));

console.log("\n  where they are:");
const adv = src("components/settings/ConfigEditorModal.tsx");
const order = [...adv.matchAll(/\{ id: "(\w+)", label: "(\w+)", icon: \w+(, owner: true)? \}/g)].map((m) => `${m[2]}${m[3] ? "*" : ""}`);
ck("Advanced Settings: a Messages tab between Devices and System, owner only (*)",
   JSON.stringify(order) === JSON.stringify(["Villa", "Devices", "Messages*", "System*"]), order);
ck("  ...holding \"Full screen for\" and \"Ring shown for\"",
   /tab === "messages" && roleCan\(role, "editConfig"\)[\s\S]*?<FullScreenFor \/>\s*<RingShownFor \/>/.test(adv));
const set = src("components/settings/SettingsModal.tsx");
ck("Settings: a strip General · Messages; Messages holds this tablet's switch, in the dialog's draft",
   /\{ id: "general", label: "General"[^}]*\},\s*\{ id: "messages", label: "Messages"/.test(set)
   && /tab === "messages"[\s\S]*?ariaLabel="Rings full screen on this tablet"/.test(set) && /"walkSpeed", "ringsFullScreen",/.test(set));
const dash = src("pages/Dashboard.tsx");
// ⚠️ NO GEAR IN THE COCKPIT (owner, 2026-10-29: "it doesn't make sense to see it here"): Settings › Messages is reached
// from the profile button's Settings, its strip
ck("the Cockpit's header has no Settings gear any more (the top bar's own Settings stays)",
   !/onOpenSettings|Messages settings/.test(src("components/cockpit/CockpitModal.tsx"))
   && !/<CockpitModal[^>]*onOpenSettings/.test(dash));
ck("  ...and Settings opens on the tab the screen holds", /tab=\{screen\.settingsTab\}/.test(dash));

done("✅ the Messages settings: the villa's in Advanced Settings, each tablet's in Settings");
