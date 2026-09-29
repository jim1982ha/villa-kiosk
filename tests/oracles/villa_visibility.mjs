// "Which devices is this" (config/villaVisibility.ts), driven by value — the
// three sets the villa model hands every Dashboard surface.
//
// Before 2.496.226 the Dashboard derived the on-map set inline, the summary
// bar rebuilt the visible entities the villa model already held, and the
// Cockpit's attention hook wrote its own "may this profile see it".
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const V = await import("@/config/villaVisibility");

const entityMap = {
  "camera.gate": { type: "camera", motionEntityId: "binary_sensor.gate_motion" },
  "light.lamp": { type: "light", linkedEntityId: "switch.lamp_relay" },
  "light.gone": { type: "light", linkedEntityId: "switch.gone_relay" },
  "camera.old": { type: "camera", motionEntityId: "binary_sensor.old_motion" },
};
const scene = new Set(["camera.gate", "light.lamp", "light.gone"]);
const dismissed = new Set(["light.gone", "switch.gone_relay", "binary_sensor.old_motion"]);

console.log("  on the map:");
{
  const m = V.effectiveMapped(scene, entityMap, dismissed);
  ck("the model's objects, plus each mapping's linked and motion entity",
     m.has("camera.gate") && m.has("light.lamp") && m.has("switch.lamp_relay") && m.has("binary_sensor.gate_motion"));
  ck("  ...a dismissed one is out — object, linked or motion entity alike",
     !m.has("light.gone") && !m.has("switch.gone_relay") && !m.has("binary_sensor.old_motion"));
}

console.log("\n  what a profile can see at all:");
{
  const entities = { "light.a": {}, "sensor.diag": {} };
  const none = new Set();
  ck("nothing suppressed: the same object back (no rebuild on every push)", V.visibleEntitiesOf(entities, none) === entities);
  const v = V.visibleEntitiesOf(entities, new Set(["sensor.diag"]));
  ck("a hidden or diagnostic entity is left out", "light.a" in v && !("sensor.diag" in v));
}

console.log("\n  what a profile's lists may name:");
{
  const mapped = V.effectiveMapped(scene, entityMap, dismissed);
  const entities = { "camera.gate": { attributes: {} }, "light.lamp": { attributes: {} }, "switch.offmap": { attributes: {} } };
  const ctx = { mapped, entityMap, entities };
  const guest = V.visibleTo("guest", ctx), owner = V.visibleTo("owner", ctx);
  ck("no profile: nothing", !V.visibleTo(null, ctx).has("light.lamp"));
  ck("the owner: on the map or not", owner.has("light.lamp") && owner.has("camera.gate") && owner.has("switch.offmap"));
  ck("a guest: not a device off the map", !guest.has("switch.offmap"));
  ck("  ...nor a type their profile denies (a camera), even on the map", !guest.has("camera.gate"));
  ck("  ...but a light on the map, yes", guest.has("light.lamp"));
}

console.log("\n  the surfaces ask the villa model:");
{
  const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
  ck("the Dashboard derives no on-map set itself", !/linkedEntityId && !dismissedIds/.test(src("pages/Dashboard.tsx")) && /useVillaSets\(/.test(src("pages/Dashboard.tsx")));
  ck("the summary bar builds no visible-entities copy", !/suppressedEntityIds\.has\(id\)/.test(src("components/hud/SummaryBar.tsx")));
  ck("the attention hook asks visibleTo, and holds no rule of its own",
     /visibleTo\(role\)/.test(src("components/cockpit/useVillaAttention.ts")) && !/isMappingAllowed|listedDevices/.test(src("components/cockpit/useVillaAttention.ts").replace(/\/\/.*$/gm, "")));
}

done("✅ on the map, visible, and visible to a profile — decided once");
