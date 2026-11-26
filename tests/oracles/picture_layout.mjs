// tests/oracles/picture_layout.mjs
// Where the villa pictures put things (components/canvas/pictureLayout), as a person sees them: 2F over 1F, a badge
// on its spot, badges that would touch drawn as one group badge, a remote's arrow going the way it points. Owner, 2026-11-24: a
// device too weak for the 3D villa shows a picture of each floor, 2F stacked over 1F, with live badges over it.
import { ck, done } from "../consistency/check.mjs";
const { floorBands, containRect, groupBadges, groupMark, badgeToward, roomAt, pictureSky, moonPath } = await import("@/components/canvas/pictureLayout");

const floor = (n) => ({ floor: n, label: `${n}F`, day: `f${n}-day.webp`, night: `f${n}-night.webp`, width: 1600, height: 1000 });

console.log("\n  the floors:");
{
  const tv = floorBands({ x: 0, y: 60, w: 960, h: 400 }, [floor(2), floor(1)], 10);
  ck("on a wide TV the floors sit side by side, 1F on the left", tv[0].floor.floor === 1 && tv[1].floor.floor === 2
     && tv[0].band.x + tv[0].band.w <= tv[1].band.x && tv[0].band.y === tv[1].band.y, tv.map((b) => [b.floor.label, b.band]));
  const stackedH = (400 - 10) / 2;   // what each picture would get stacked
  ck("  ...and each picture is larger than it would be stacked", tv[0].band.w / 1.6 > stackedH, tv.map((b) => b.band));
  const phone = floorBands({ x: 0, y: 60, w: 390, h: 700 }, [floor(1), floor(2)], 10);
  ck("on an upright phone 2F is stacked above 1F", phone[0].floor.floor === 2 && phone[1].floor.floor === 1
     && phone[0].band.y + phone[0].band.h <= phone[1].band.y, phone.map((b) => [b.floor.label, b.band]));
  const gap = phone[1].band.y - (phone[0].band.y + phone[0].band.h);
  ck("  ...the two floors sit together, not each alone in its half", Math.abs(gap - 10) < 1e-9, phone.map((b) => b.band));
  const r = containRect({ x: 0, y: 0, w: 1000, h: 300 }, 1600, 1000);
  ck("a picture keeps its shape, whole and centred in its band", Math.abs(r.w / r.h - 1.6) < 1e-9 && r.h === 300 && r.x > 0, r);
}

console.log("\n  the badges (owner's rule: nothing on the map overlaps; badges group only when they touch):");
{
  const frame = { x: 0, y: 0, w: 800, h: 500 };
  const spot = (id, x, y, rank = 0, room = "<room-a>") => ({ id, x, y, rank, room });
  const alone = groupBadges([spot("c", 400, 100), spot("d", 600, 300)], 30, frame);
  ck("a badge with room around it stays exactly on its spot, alone", alone.length === 2
     && alone.every((i) => i.ids.length === 1) && alone.find((i) => i.key === "c").x === 400 && alone.find((i) => i.key === "c").y === 100, alone);
  const two = groupBadges([spot("a", 200, 200), spot("b", 220, 210)], 30, frame);
  ck("two badges that would touch are one group badge, at their centre", two.length === 1
     && two[0].ids.join() === "a,b" && two[0].x === 210 && two[0].y === 205, two);
  ck("  ...named by their room when they share one", two[0].room === "<room-a>");
  const mixed = groupBadges([spot("a", 200, 200), spot("b", 220, 210, 0, "<room-b>")], 30, frame);
  ck("  ...and by none when they do not", mixed[0].room === null, mixed);
  const urgent = groupBadges([spot("calm", 300, 300), spot("alarm", 305, 300, 2)], 30, frame);
  ck("an alarm in a group keeps the group urgent (it pulses)", urgent.length === 1 && urgent[0].rank === 2, urgent);
  ck("  ...and the group wears its members' most urgent mark",
     groupMark([{ mark: "lost", linkPill: null }, { mark: null, linkPill: "alarm" }, { mark: "active", linkPill: "on" }]) === "alarm"
     && groupMark([{ mark: "active", linkPill: "on" }, { mark: null, linkPill: null }]) === null);
  const edge = groupBadges([spot("e", 2, 498)], 30, frame)[0];
  ck("a badge on its picture's edge is kept inside the picture (never over the next floor's)", edge.x === 15 && edge.y === 485, edge);

  // the real thing: a hundred badges crowded on one floor, at a TV's size, a laptop's and a phone's
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const crowd = Array.from({ length: 109 }, (_, i) => spot(`light.n${i}`, 60 + rnd() * 300, 40 + rnd() * 160, i % 9 === 0 ? 2 : 0,
    i % 3 ? "<room-a>" : "<room-b>"));
  const pic = { x: 40, y: 20, w: 340, h: 200 };
  let bad = [];
  for (const size of [18, 22, 26, 28, 33, 40, 56, 72]) {
    const items = groupBadges(crowd, size, pic);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (Math.abs(items[i].x - items[j].x) < size && Math.abs(items[i].y - items[j].y) < size) bad.push([size, items[i].key, items[j].key]);
    }
    const all = items.flatMap((i) => i.ids).sort();
    if (all.length !== crowd.length || new Set(all).size !== crowd.length) bad.push([size, "a badge drawn twice or lost", all.length]);
    for (const it of items) {
      const want = Math.max(...it.ids.map((id) => crowd.find((c) => c.id === id).rank));
      if (it.rank !== want) bad.push([size, "an alarm hidden in", it.key]);
    }
  }
  ck("109 crowded badges at every size from a phone's to the largest label size: no two drawn badges overlap, every badge "
     + "is in exactly one drawn item, every group as urgent as its most urgent member", bad.length === 0, bad.slice(0, 4));
  const tv = groupBadges(crowd, 28, pic).length, laptop = groupBadges(crowd, 18, pic).length;
  ck("  ...and a smaller badge groups less (the grouping follows the size)", laptop > tv, { tv, laptop });
}

console.log("\n  a remote's arrows:");
{
  const at = [{ id: "left", x: 100, y: 200 }, { id: "right", x: 500, y: 210 }, { id: "below", x: 300, y: 400 }];
  ck("Right goes to the badge on the right, Down to the one below, Up from the top row goes nowhere",
     badgeToward({ x: 300, y: 200 }, at, "ArrowRight") === "right" && badgeToward({ x: 300, y: 200 }, at, "ArrowDown") === "below"
     && badgeToward({ x: 300, y: 200 }, at, "ArrowUp") === null);
}

console.log("\n  a device's room from the pictures:");
{
  const rooms = [{ name: "<room-a>", floor: 1, pts: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { name: "<room-b>", floor: 2, pts: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] }];
  ck("a device drawn inside a room's outline on its own floor is in that room, and in none elsewhere",
     roomAt(rooms, 1, 0.2, 0.5) === "<room-a>" && roomAt(rooms, 2, 0.2, 0.5) === "<room-b>" && roomAt(rooms, 1, 0.8, 0.5) === null);
}

console.log("\n  the sky:");
{
  // a tropical villa (8°S), its model facing true north: noon there is 04:00 UTC
  const place = { latitude: -8.6, longitude: 115.1, northOffsetDeg: 180 };
  const noon = pictureSky(new Date("2026-11-25T04:00:00Z"), place, "auto", null);
  const night = pictureSky(new Date("2026-11-25T16:00:00Z"), place, "auto", null);
  const lum = (hex) => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0);
  ck("at noon the sun is in a light sky, inside the view", noon.body?.kind === "sun" && lum(noon.top) > lum(night.top)
     && noon.body.x > 0 && noon.body.x < 1 && noon.body.y > 0 && noon.body.y < 1, noon);
  ck("  ...at night no sun: the moon when it is up, or nothing", night.body === null || night.body.kind === "moon", night);
  ck("  ...Settings' Night preview darkens the sky at noon without moving the sun out",
     lum(pictureSky(new Date("2026-11-25T04:00:00Z"), place, "night", null).top) < lum(noon.top));
  ck("  ...no place known: the villa's day or night colours it, no body",
     pictureSky(new Date(), { latitude: 0, longitude: 0, northOffsetDeg: 0 }, "auto", false).body === null);
  ck("a full moon is the whole disc, a new one a sliver of nothing", moonPath(1, 1, true).includes("A1,1 0 0 1 0,-1")
     && moonPath(1, 0, true).includes("A1,1 0 0 0 0,-1"));
}

done("The villa pictures' layout: 2F over 1F, badges on their spots, touching ones grouped, none overlapping, arrows go where they point");
