// The villa's maintenance mode (owner, 2026-10-29: "Put it on the tablet, for the Owner only, in Advanced Settings, as a
// 'Maintenance mode' switch … It should also show while it's on, a small 'Maintenance' mark in the top bar, so nobody
// forgets it"): one switch of the villa's, stored centrally (off by default, a stored config without it reads off),
// drafted by Advanced Settings like its other keys, drawn in its System tab for the profiles that edit the villa, and
// marked in the top bar while it is on, on a phone too. The proxy's answer to the Agent is tests/agent-interface.py's.
// Driven by value through the shared store's row, then the markup read through the compiler's tree.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { elements, guardsOf, parseTsx, propText } from "../consistency/jsx.mjs";
const { DEFAULT_CONFIG } = await import("@/config/AppConfig");
const { fromSharedItems, parseSharedConfig, pickSharedConfig, SHARED_CONFIG_KEYS } = await import("@/config/deviceConfig");
const { ADVANCED_SETTINGS_KEYS } = await import("@/config/configSlice");

console.log("  the villa's switch:");
ck("off by default, and one of the villa's shared settings (every tablet the same)",
   DEFAULT_CONFIG.maintenanceMode === false && SHARED_CONFIG_KEYS.includes("maintenanceMode")
   && pickSharedConfig({ ...DEFAULT_CONFIG, maintenanceMode: true }).maintenanceMode === true);
ck("  ...a stored config reads it as stored; one without it, or of another shape, leaves it unset (off)",
   parseSharedConfig({ maintenanceMode: true }).maintenanceMode === true
   && parseSharedConfig({ maintenanceMode: false }).maintenanceMode === false
   && parseSharedConfig({}).maintenanceMode === undefined && parseSharedConfig({ maintenanceMode: "on" }).maintenanceMode === undefined);
ck("  ...the store with nothing said of it reads OFF (never on by a missing key)",
   fromSharedItems("maintenanceMode", {}) === false && fromSharedItems("maintenanceMode", { value: true }) === true);
ck("  ...Advanced Settings drafts it like its other keys (Cancel puts it back)", ADVANCED_SETTINGS_KEYS.includes("maintenanceMode"));

console.log("\n  where it is switched and seen:");
const modal = parseTsx("components/settings/ConfigEditorModal.tsx");
const sw = elements(modal, "MaintenanceMode");
ck("the switch is in Advanced Settings › System, for the profiles that edit the villa only",
   sw.length === 1 && guardsOf(sw[0]).includes('tab === "system"') && guardsOf(sw[0]).includes('roleCan(role, "editConfig")'),
   sw.map(guardsOf));
const hud = parseTsx("components/hud/HUD.tsx");
const mark = elements(hud, "span").find((e) => propText(e, "className") === '"maintenance-mark"');
ck("the top bar marks it while it is on, for the profiles shown VESTA",
   !!mark && guardsOf(mark).includes("config.maintenanceMode") && guardsOf(mark).includes("doors.agent"), mark && guardsOf(mark));
// the first <div> around it: the bar's right side itself, not the inline group a phone hides (05-layout)
let up = mark?.parent;
while (up && !/^<div className=/.test(up.getText())) up = up.parent;
ck("  ...outside the inline group a phone hides: a phone shows it too",
   !!up && /^<div className="hud-right">/.test(up.getText()), up?.getText().slice(0, 40));
console.log("\n  what it does, said once:");
const { h, draw } = await import("../consistency/screen.mjs");
const { MaintenanceModeExplained } = await import("@/components/settings/MaintenanceMode");
const said = draw(h(MaintenanceModeExplained, null));
ck("the explanation says what VESTA does meanwhile: P1 still chased, any other new alert not taken up, open ones carry on, "
   + "nothing sent afterwards, where to turn it off",
   /urgent \(P1\) alerts still reach/.test(said) && /not taken up by VESTA: no number, no reminder, no ticket/.test(said)
   && /already open carry on/.test(said) && /not sent afterwards/.test(said) && /Advanced Settings › System/.test(said), said);
const tips = elements(modal, "TipTitle").filter((e) => propText(e, "title") === '"Maintenance mode"');
ck("  ...the switch's (i) and the top bar mark's (i) show that same one (no second wording)",
   tips.length === 1 && propText(tips[0], "tip") === "<MaintenanceModeExplained />"
   && !!mark && elements(mark, "InfoTip").length === 1 && elements(mark, "MaintenanceModeExplained").length === 1);
done("✅ the villa's maintenance mode: one switch, off by default, seen in the top bar while on");
