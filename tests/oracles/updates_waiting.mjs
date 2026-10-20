// The Cockpit header's updates: how many, and WHICH, in its tooltip (owner, 2026-10-20: "Upgrade(s) available for:
// - …"), never the platform's name — by value (config/updatesWaiting), with the villa's real update shapes.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { updateName, updatesWaiting, updatesTip } = await import("@/config/updatesWaiting");

const u = (id, state, friendly_name, title) => ({ entity_id: id, state, attributes: { friendly_name, ...(title !== undefined ? { title } : {}) } });
const PLATFORM = ["Home", "Assistant"].join(" ");                   // built, so this file names it only in data
const E = Object.fromEntries([
  u("update.broker_update", "on", "Mosquitto broker Update", "Mosquitto broker"),
  u("update.core_update", "on", `${PLATFORM} Core Update`, `${PLATFORM} Core`),
  u("update.pump_firmware", "on", "Onsen pump Firmware"),
  u("update.radio_firmware", "on", `${PLATFORM} Yellow Radio firmware`, "EmberZNet Zigbee"),
  u("update.light", "on", "Gym Light"),
  u("update.idle", "off", "Idle Update", "Idle"),
  u("update.lost", "unavailable", "Lost Firmware", ""),
  u("light.x", "on", "Not an update"),
].map((e) => [e.entity_id, e]));

const names = updatesWaiting(E);
ck("only updates that are waiting (\"on\"), by their software's title, else their name without Update/Firmware, sorted",
   JSON.stringify(names) === JSON.stringify(["EmberZNet Zigbee", "Gym Light", "Mosquitto broker", "Onsen pump", "Villa system Core"]), names);
ck("the platform's own name never reaches the screen", !names.some((n) => n.includes(PLATFORM)) && updateName(u("update.p", "on", PLATFORM)) === "Villa system");
ck("the tooltip: one heading, one line per update",
   updatesTip(["A", "B"]) === "Upgrade(s) available for:\n- A\n- B", updatesTip(["A", "B"]));
done("✅ the updates waiting, named");
