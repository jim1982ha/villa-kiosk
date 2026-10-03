// The villa's room data (src/config/roomData.ts, 2.496.254) — one rule for
// what a valid document is and what adopting one wipes, for the upload and
// the load alike. Before it there were four, and they disagreed:
//   * an upload's deliberate reset `{rooms: []}` was refused by every device
//     that loaded it ("No named rooms found"), so they kept the OLD rooms;
//   * a device opening with a stale or empty copy of the plan wiped the
//     shared, hand-added rooms of every device.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { readRoomData, roomDataPatch, fetchRoomData, EMPTY_ROOM_DATA } = await import("@/config/roomData");

const sq = (x) => [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 1 }];
const doc = (rooms, entities = []) => JSON.stringify({ schema: 1, rooms, entities });
const A = { name: "Room A", points: sq(0), floor: 1 }, B = { name: "Room B", points: sq(5), floor: 2 };
const throwsWith = (text, re) => { try { readRoomData(text); return false; } catch (e) { return re.test(e.message); } };

console.log("  what valid room data is:");
{
  const r = readRoomData(doc([A, { name: "", points: sq(1) }, { name: "Two points", points: sq(2).slice(0, 2) }],
    [{ entityId: "light.a", x: 1, y: 2 }, { entityId: "Not An Id", x: 1, y: 2 }, { entityId: "light.b", x: "?", y: 0 }]));
  ck("a usable room is kept; a nameless one or one with under three points is dropped", r.rooms.length === 1 && r.rooms[0].name === "Room A", r.rooms);
  ck("  ...a device with a bad id or position is dropped, angle and pitch default to 0",
     r.entities.length === 1 && r.entities[0].angle === 0 && r.entities[0].pitch === 0, r.entities);
  const reset = readRoomData(EMPTY_ROOM_DATA);
  ck("THE RESET IS VALID: an explicitly empty rooms list reads as no rooms (it threw for every loading device)",
     reset.rooms.length === 0 && reset.entities.length === 0);
  ck("not JSON is refused", throwsWith("{nope", /Not valid room-data JSON/));
  ck("JSON with no rooms list is refused — the wrong file, e.g. {\"foo\":1}", throwsWith('{"foo":1}', /no "rooms" list/) && throwsWith("[]", /no "rooms" list/));
  ck("a rooms list of which NOTHING is usable is refused (not mistaken for the reset)", throwsWith(doc([{ name: "x" }]), /No named rooms/));
}

console.log("\n  what adopting it changes:");
{
  const added = { name: "Pool deck", floor: 1, position: { x: 0, y: 0, z: 0 } };
  const fitted = { name: "Room A", floor: 1, position: { x: 1, y: 0, z: 1 }, fitted: true };
  const cur = { sh3dRooms: [A], sh3dEntities: [], teleportPoints: [added, fitted] };
  const same = readRoomData(doc([A]));
  ck("the same plan again changes nothing (by content: the arrays are fresh)", roomDataPatch(cur, same, "load") === null);
  const moved = readRoomData(doc([{ ...A, points: sq(9) }]));
  const pm = roomDataPatch(cur, moved, "load");
  ck("same room names, new shapes: the plan is adopted, every room kept", pm && !("teleportPoints" in pm) && pm.sh3dRooms[0].points[0].x === 9, pm);
  const other = readRoomData(doc([B]));
  const pl = roomDataPatch(cur, other, "load");
  ck("A LOAD NEVER WIPES THE HAND-ADDED ROOMS: new names drop only this device's fitted rooms",
     pl && pl.teleportPoints.length === 1 && pl.teleportPoints[0] === added && pl.sh3dRooms[0].name === "Room B", pl);
  const fresh = { sh3dRooms: [], sh3dEntities: [], teleportPoints: [added] };
  const pf = roomDataPatch(fresh, readRoomData(doc([A])), "load");
  ck("  ...even on a fresh browser whose own copy of the plan is empty", pf && pf.teleportPoints.length === 1 && pf.teleportPoints[0] === added, pf);
  const pu = roomDataPatch(cur, same, "upload");
  ck("an UPLOAD replaces the plan wholesale: every room goes, the hand-added ones too", pu && pu.teleportPoints.length === 0 && pu.sh3dRooms.length === 1, pu);
  const pr = roomDataPatch(cur, readRoomData(EMPTY_ROOM_DATA), "load");
  ck("a device loading the reset drops the previous plan's rooms (it kept them before)", pr && pr.sh3dRooms.length === 0 && pr.teleportPoints.length === 1, pr);
}

console.log("\n  reading the central copy:");
{
  const resp = (status, body = "") => async () => new Response(body, { status });
  const ok = await fetchRoomData("u", resp(200, EMPTY_ROOM_DATA));
  ck("the reset arrives as data, not an error", ok.ok && ok.data.rooms.length === 0, ok);
  const nf = await fetchRoomData("u", resp(404));
  ck("a status is returned as the answer", !nf.ok && nf.status === 404);
  const bad = await fetchRoomData("u", resp(200, '{"foo":1}'));
  ck("an invalid document is an error, never thrown", !bad.ok && /no "rooms" list/.test(bad.error.message));
  const net = await fetchRoomData("u", async () => { throw new TypeError("Failed to fetch"); });
  ck("a network failure is an error, never thrown", !net.ok && net.error instanceof TypeError);
}

done("✅ one rule for the villa's room data");
