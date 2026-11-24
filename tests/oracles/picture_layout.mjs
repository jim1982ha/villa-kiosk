// tests/oracles/picture_layout.mjs
// Where the villa pictures put things (components/canvas/pictureLayout), as a person sees them: 2F over 1F, a badge
// on its spot, badges that would touch drawn as one group badge, a remote's arrow going the way it points. Owner, 2026-11-24: a
// device too weak for the 3D villa shows a picture of each floor, 2F stacked over 1F, with live badges over it.
import { ck, done } from "../consistency/check.mjs";
const { floorBands, containRect, groupBadges, groupMark, badgeToward, roomAt } = await import("@/components/canvas/pictureLayout");

const floor = (n) => ({ floor: n, label: `${n}F`, day: `f${n}-day.webp`, night: `f${n}-night.webp`, width: 1600, height: 1000 });

console.log("\n  the floors:");
{
  const bands = floorBands({ x: 0, y: 60, w: 1366, h: 700 }, [floor(1), floor(2)], 10);
  ck("2F is drawn above 1F, 1F at the bottom", bands[0].floor.floor === 2 && bands[1].floor.floor === 1
     && bands[0].band.y + bands[0].band.h <= bands[1].band.y, bands.map((b) => [b.floor.label, b.band]));
  const phone = floorBands({ x: 0, y: 60, w: 390, h: 700 }, [floor(1), floor(2)], 10);
  const gap = phone[1].band.y - (phone[0].band.y + phone[0].band.h);
  ck("on an upright phone the two floors sit together, not each alone in its half", gap === 10, phone.map((b) => b.band));
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

done("The villa pictures' layout: 2F over 1F, badges on their spots, touching ones grouped, none overlapping, arrows go where they point");
