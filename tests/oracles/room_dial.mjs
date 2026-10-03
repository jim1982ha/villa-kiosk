// The room dial a floor button opens (src/components/hud/roomDial.ts,
// 2.496.268), driven by value at real screen sizes. It lived inside HUD.tsx,
// reading window.innerHeight/innerWidth, so "arc or one column" — adjusted by
// the owner twice — was only ever checked by a regex over the component.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { openRoomDial, roomDialItems, roomsOnFloor } = await import("@/components/hud/roomDial");

const PHONE = { width: 476, height: 672 }, IPHONE = { width: 390, height: 664 }, UNFOLDED = { width: 705, height: 894 }, TABLET = { width: 1280, height: 800 };
const button = { right: 72, top: 400, height: 44 };
const rooms = (n, floor = 1) => Array.from({ length: n }, (_, i) => ({ name: `Room ${String.fromCharCode(90 - i)}`, floor, position: { x: 0, y: 0, z: 0 } }));
const gaps = (items) => items.slice(1).map((it, i) => Math.hypot(it.x - items[i].x, it.y - items[i].y));

console.log("  which rooms:");
const pts = [{ name: "b", floor: 2 }, { name: "Zed" }, { name: "alpha", floor: 1 }, { name: "Mid", floor: 1 }];
ck("a floor's rooms, alphabetical; a room with no floor is on floor 1",
   roomsOnFloor(pts, 1).map((p) => p.name).join() === "alpha,Mid,Zed" && roomsOnFloor(pts, 2).map((p) => p.name).join() === "b");

console.log("\n  arc or column:");
ck("a few rooms on a phone held upright: the arc", !openRoomDial(1, 5, button, PHONE).list);
ck("17 rooms on a narrow phone (390 px): one column (the arc would run off the screen)", openRoomDial(1, 17, button, IPHONE).list);
ck("  ...the owner's phone (476 px) has room for that arc at the safe spacing", !openRoomDial(1, 17, button, PHONE).list);
ck("17 rooms on the wall tablet: the arc", !openRoomDial(1, 17, button, TABLET).list);
ck("  ...the same 17 on an unfolded phone: whatever fits — never an arc that overlaps",
   (() => { const d = openRoomDial(1, 17, button, UNFOLDED); return d.list || Math.min(...gaps(roomDialItems(rooms(17), d, UNFOLDED))) >= 47; })());

console.log("\n  on the arc:");
for (const [name, vp, n] of [["tablet", TABLET, 17], ["phone", PHONE, 17], ["phone", PHONE, 5], ["unfolded", UNFOLDED, 9]]) {
  const d = openRoomDial(1, n, button, vp);
  const items = roomDialItems(rooms(n), d, vp);
  ck(`${name}, ${n} rooms: every label at least the safe 48 px from the next`, d.list || Math.min(...gaps(items)) >= 47.9, gaps(items).map((g) => g.toFixed(1)));
  ck(`  ...and every chip inside the screen top to bottom`, d.list || items.every((it) => it.y >= 0 && it.y <= vp.height), items.map((it) => it.y.toFixed(0)));
}
ck("the dial sits just right of the button it opened from", openRoomDial(1, 5, button, TABLET).cx === button.right + 16);
const top = openRoomDial(1, 5, { right: 72, top: 0, height: 44 }, TABLET);
ck("a button near the top: the centre is pushed down so the arc is not clipped",
   roomDialItems(rooms(5), top, TABLET).every((it) => it.y >= 0), top.cy);
const tiny = { width: 1280, height: 200 };
const forced = roomDialItems(rooms(3), { cx: 100, cy: 100, floor: 1, list: false }, tiny);
ck("on a very short screen the radius never collapses below 90 px (the floor wins over the screen cap)",
   forced.every((it) => Math.abs(Math.hypot(it.x - 100, it.y - 100) - 90) < 1e-6), forced);
ck("in the column the rooms keep the alphabetical order", roomDialItems(roomsOnFloor(rooms(3), 1), { cx: 0, cy: 0, floor: 1, list: true }, PHONE).map((i) => i.label).join() === "Room X,Room Y,Room Z");

console.log("\n  the caller:");
const hud = readFileSync(new URL("../../src/components/hud/HUD.tsx", import.meta.url), "utf8");
ck("HUD asks roomDial for where the dial sits and its chips — no arc maths of its own",
   /openRoomDial\(f, roomsOnFloor\(config\.teleportPoints, f\)\.length, b, viewport\(\)\)/.test(hud)
   && /roomDialItems\(roomsOnFloor\(config\.teleportPoints, radial\.floor\), radial, viewport\(\)\)/.test(hud)
   && !/ROOM_R|Math\.cos|innerHeight \//.test(hud));
done("✅ the room dial is a layout, driven at real screen sizes");
