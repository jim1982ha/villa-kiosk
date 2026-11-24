// THE VILLA PICTURES (owner, 2026-11-24): a device too weak for the 3D villa shows a still picture of each floor with
// live badges over it. A badge must land where its device is, north up, and a set made before the device moved must be
// made again, while one made from the same placement is kept.
import { ck, done } from "../consistency/check.mjs";
const { pictureFrame, pictureSize, toUv, configKey, picturesStale, buildManifest } = await import("@/utils/pictureManifest");
const { parseManifest } = await import("@/utils/villaPictures");

const frame = pictureFrame({ x: -10, z: -4 }, { x: 30, z: 16 });
ck("the frame's north-west corner is the picture's top-left (0, 0)", JSON.stringify(toUv(frame, -10, 16)) === "[0,0]");
ck("  ...its south-east corner the bottom-right (1, 1)", JSON.stringify(toUv(frame, 30, -4)) === "[1,1]");
const [ue, ve] = toUv(frame, 25, 6), [uw] = toUv(frame, -5, 6), [, vn] = toUv(frame, 10, 14);
ck("the scene's +x is to the right and north (+z) is up (not mirrored)", ue > uw && vn < ve);
const size = pictureSize(frame);
ck("a picture keeps the villa's shape, its long side 1600 px", size.width === 1600 && size.height === 800, size);
ck("  ...a villa deeper than wide too", JSON.stringify(pictureSize(pictureFrame({ x: 0, z: 0 }, { x: 10, z: 20 }))) === '{"width":800,"height":1600}');

const config = {
  entityMap: { "light.a": { entityId: "light.a", type: "light", meshName: "lamp_a", label: "Lamp" },
               "sensor.b": { entityId: "sensor.b", type: "sensor", meshName: "sensor_b" } },
  meshBindings: { lamp_a: "light.a" },
  deviceGroups: [{ id: "g", primaryEntityId: "sensor.b", memberEntityIds: ["sensor.c", "sensor.d"] }],
  sh3dEntities: [{ entityId: "light.a", x: 120, y: 340, angle: 0, pitch: 0 }],
  sh3dRooms: [{ name: "Room", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], floor: 1 }],
};
const reordered = {
  sh3dRooms: config.sh3dRooms, sh3dEntities: config.sh3dEntities,
  deviceGroups: [{ memberEntityIds: ["sensor.d", "sensor.c"], primaryEntityId: "sensor.b", id: "g" }],
  meshBindings: { lamp_a: "light.a" },
  entityMap: { "sensor.b": config.entityMap["sensor.b"], "light.a": { label: "Lamp", meshName: "lamp_a", type: "light", entityId: "light.a" } },
};
const key = configKey(config);
ck("the same placement gives the same key, whatever order it was written in", configKey(reordered) === key);
ck("  ...and a renamed or recoloured device keeps it (drawn live, not in the picture)",
   configKey({ ...config, entityMap: { ...config.entityMap, "light.a": { ...config.entityMap["light.a"], label: "Desk", badgeColor: "#f00" } } }) === key);
const moved = { ...config, sh3dEntities: [{ entityId: "light.a", x: 180, y: 340, angle: 0, pitch: 0 }] };
ck("a device moved on the floor plan changes it", configKey(moved) !== key);
ck("  ...so does a device bound to another object", configKey({ ...config, meshBindings: { lamp_b: "light.a" } }) !== key);
ck("  ...and another device carrying a group's badge",
   configKey({ ...config, deviceGroups: [{ id: "g", primaryEntityId: "sensor.c", memberEntityIds: ["sensor.b", "sensor.d"] }] }) !== key);

const source = { model_version: "6553f100-130", rooms_version: "6553f101-d", config_key: key };
const made = buildManifest({
  source, madeAt: new Date("2026-11-24T10:00:00Z"), frame, floors: [1, 2], size,
  anchors: [{ id: "light.a", x: -10, y: 2.5, z: 16, floor: 1 }, { id: "sensor.b", x: 30, y: 5, z: -4, floor: 2 },
            { id: "sensor.top", x: 0, y: 8, z: 0, floor: 3 }],
  rooms: [{ name: "Room", floor: 2, pts: [{ x: -10, z: 16 }, { x: 30, z: 16 }, { x: 30, z: -4 }] }],
});
ck("the manifest reads back as one", parseManifest(JSON.parse(JSON.stringify(made))) !== null);
ck("  ...its badges at their device's place on their floor's picture",
   JSON.stringify(made.badges) === '[{"id":"light.a","floor":1,"u":0,"v":0},{"id":"sensor.b","floor":2,"u":1,"v":1}]', made.badges);
ck("  ...a room's outline in the same (u, v)", JSON.stringify(made.rooms[0].pts) === "[[0,0],[1,0],[1,1]]");
ck("  ...each floor names its two pictures", made.floors.map((f) => `${f.label}:${f.day},${f.night}`).join(" ")
   === "1F:f1-day.webp,f1-night.webp 2F:f2-day.webp,f2-night.webp");

ck("no stored set: make one", picturesStale(null, source));
ck("a set made from what is on screen now is kept", !picturesStale(made, source));
ck("a moved device makes it stale", picturesStale(made, { ...source, config_key: configKey(moved) }));
ck("  ...so does a new model or new room data", picturesStale(made, { ...source, model_version: "x" })
   && picturesStale(made, { ...source, rooms_version: "y" }));
done();
