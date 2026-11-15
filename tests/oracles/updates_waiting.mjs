// The Cockpit's updates count (config/updatesWaiting): an update counts only when someone can install it. Placeholder
// entities; the feature bits as the villa's system reports them (1 install, 16 release notes).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { updatesWaiting } = await import("@/config/updatesWaiting");

const upd = (id, state, features, title) => ({ entity_id: `update.${id}`, state,
  attributes: { supported_features: features, ...(title ? { title } : {}) } });
const entities = Object.fromEntries([
  upd("<room>_light_firmware", "on", 1 | 4 | 16, "Light firmware"),
  upd("<media>_server_update", "on", 16, "Media server"),
  upd("<app>_update", "on", 1 | 16, "Some app"),
  upd("<sensor>_firmware", "off", 1, "Sensor firmware"),
].map((e) => [e.entity_id, e]));

ck("an update that can be installed is counted; one that only reports a newer version is not",
   JSON.stringify(updatesWaiting(entities, new Set(), {})) === JSON.stringify(["Light firmware", "Some app"]),
   updatesWaiting(entities, new Set(), {}));
ck("one hidden in the villa's system is still left out",
   JSON.stringify(updatesWaiting(entities, new Set(["update.<app>_update"]), {})) === JSON.stringify(["Light firmware"]));

done("✅ the Cockpit counts only the updates someone can install");
