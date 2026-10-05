// A device shows the SAME icon on its map badge and in its panels (2.496.252).
//
// The badge's icon keys (babylon/badgeIconKeys.ts) "mirror" the panels' Lucide
// tables (config/BinarySensorClasses.ts, config/SensorClasses.ts) by comment
// only, and the badge's drawing data (badgeIconNodes.ts) is copied by hand —
// a key without drawing data falls back to a gauge SILENTLY. This compares the
// two sides by COMPONENT IDENTITY (a Lucide alias such as AlertTriangle is the
// same object as TriangleAlert, so old and new names agree), and checks every
// key can be drawn. All agreed when it was written; it fails the day one drifts.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const L = await import("lucide-react");
const { BADGE_ICON_TABLES: T, iconKeyFor } = await import("@/babylon/badgeIconKeys");
const { ICON_NODES } = await import("@/babylon/badgeIconNodes");
const { binarySensorClassInfo } = await import("@/config/BinarySensorClasses");
const { SENSOR_CLASS_ICON } = await import("@/config/SensorClasses");
const { SWITCH_PURPOSE_HINTS } = await import("@/config/EntityCategories");

const pascal = (k) => k.charAt(0).toUpperCase() + k.slice(1).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const allKeys = new Set([...Object.values(T.type), ...Object.values(T.binarySensor), ...Object.values(T.sensor),
  ...Object.values(T.switch), ...SWITCH_PURPOSE_HINTS.map(([, , k]) => k), "gauge"]);

const undrawable = [...allKeys].filter((k) => !ICON_NODES[k]);
ck(`every icon a badge can ask for has drawing data (${allKeys.size} keys) — no silent gauge`, undrawable.length === 0, undrawable);

const binaryOff = Object.entries(T.binarySensor).filter(([dc, k]) => L[pascal(k)] !== binarySensorClassInfo(dc).icon)
  .map(([dc, k]) => `${dc}: badge ${k}, panel ${binarySensorClassInfo(dc).icon?.displayName}`);
ck("a binary sensor's badge glyph is its panel's glyph, class by class", binaryOff.length === 0, binaryOff);

const sensorOff = Object.entries(T.sensor).filter(([c, k]) => L[pascal(k)] !== SENSOR_CLASS_ICON[c])
  .map(([c, k]) => `${c}: badge ${k}, panel ${SENSOR_CLASS_ICON[c]?.displayName}`);
ck("a sensor's badge glyph is its panel's glyph, class by class", sensorOff.length === 0, sensorOff);
const panelOnly = Object.keys(SENSOR_CLASS_ICON).filter((c) => !(c in T.sensor));
ck("  ...and no sensor class has a panel icon but no badge icon", panelOnly.length === 0, panelOnly);

ck("iconKeyFor resolves through these tables (a leak sensor → its panel's droplets)",
   L[pascal(iconKeyFor("binary_sensor", { entity_id: "binary_sensor.x", state: "off", attributes: { device_class: "moisture" } }))]
     === binarySensorClassInfo("moisture").icon);

done("✅ one device, one icon: badge and panel agree, and every badge icon can be drawn");
