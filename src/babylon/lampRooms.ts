// src/babylon/lampRooms.ts
// WHICH ROOMS EACH LAMP LIGHTS — one owner: the plan, the room map
// (roomLightMask.ts), the device's stored wall answers, and each lamp's room.
//
// ⚠️ IT WAS A PROTOCOL, KEPT BY COMMENTS. The plan sat in BulbSet, the map in
// the glow's per-scene state, the lamps' rooms in the pools, the store's key
// came in on its own; a config sync clears every lamp and builds them again,
// and the rooms came back only if the load path remembered to hand the plan
// back at its very end. When it did not, every lamp had no room and its glow
// lit the next room through the wall (owner's phone, 2.496.829, and four
// releases after). Now anything that changes the lamps or the plan only says
// so (`lampsChanged`, `setPlan`), in any order, and `settle` — run before any
// lamp is read — places the lamps under the plan and draws the map once.
//
// Pure: where the lamps stand (`place`), the model's walls (`walls`) and the
// shader's texture (`draw`) are ports. tests/oracles/lamp_rooms.mjs.

import type { Storeys } from "./storeys";
import { buildRoomLightMask, type LampRoomBits, type RoomLightKnown, type RoomLightMask,
  type TriangleVisitor } from "./roomLightMask";
import { ModelKeyedStore } from "./modelStore";
import type { Pt2 } from "@/utils/geometry";

type LampRoom = { name: string; pts: Pt2[]; floorY: number; storey?: number };

export interface LampRoomsPorts<R extends LampRoom> {
  /** Every lamp takes its place, its room among it, under the plan
   *  (LightPoolSet.setRooms); `openTo`: the rooms open to a room, the map's
   *  answer (none without a map). */
  place(plan: Storeys<R>, openTo: (room: R) => readonly R[]): void;
  /** The model's opaque walls, read only when no stored answer exists; null
   *  where there is no glow to hold (an unlightmapped villa): no map. */
  walls(): TriangleVisitor | null;
  /** The map the shader reads (LampGlowState.setMask); null clears it. */
  draw(mask: RoomLightMask<R> | null): void;
  log?(line: string): void;
}

export class LampRooms<R extends LampRoom> {
  private plan: Storeys<R> | null = null;
  private mask: RoomLightMask<R> | null = null;
  /** Something the lamps' rooms depend on changed since the last settle. */
  private stale = true;
  /** The walls and which rooms are open to each other, per model and plan:
   *  reading the walls off the model is the one slow step of the room map. */
  private readonly store = new ModelKeyedStore<RoomLightKnown>("vk.roomlight2.", /^vk\.roomlight\d*\./);
  private readonly ports: LampRoomsPorts<R>;

  constructor(ports: LampRoomsPorts<R>) { this.ports = ports; }

  /** The calibrated plan. Kept until the next one, whatever the lamps do. */
  setPlan(plan: Storeys<R>): void { this.plan = plan; this.stale = true; }

  /** The versioned model URL the wall answers are kept under; null keeps
   *  nothing. */
  setCacheKey(key: string | null): void { this.store.setModel(key); this.stale = true; }

  /** A lamp was added, the lamps were cleared, or the glow came or went. */
  lampsChanged(): void { this.stale = true; }

  /**
   * Bring every lamp's room up to date: a no-op unless something changed.
   * Run before the lamps are read — never from inside a read, as placing
   * them reshapes the pools.
   */
  settle(): void {
    if (!this.stale) return;
    this.stale = false;
    const plan = this.plan?.rooms.length ? this.plan : null;
    // The map first: which rooms are open to each other is the lamps'
    // answer too (a floor pool continues across an open border).
    const walls = plan ? this.ports.walls() : null;
    this.mask = plan && walls ? this.drawMap(plan, walls) : null;
    const mask = this.mask;
    if (plan) this.ports.place(plan, (room) => mask?.openTo(room) ?? []);
    this.ports.draw(this.mask);
  }

  /** The rooms a lamp of `room` lights (its own and those open to it), as
   *  last settled; undefined: not held to any (no room, or no map). */
  bitsOf(room: R | null | undefined): LampRoomBits | undefined { return this.mask?.bitsOf(room); }

  /** Whether a room map is drawn. */
  get hasMap(): boolean { return this.mask !== null; }

  /**
   * Each lamp lights its own room and the rooms open to it. The walls are
   * read off the model once per model and plan on this device; after that, a
   * load draws the map from the stored answer in a few milliseconds.
   */
  private drawMap(plan: Storeys<R>, walls: TriangleVisitor): RoomLightMask<R> | null {
    const t0 = performance.now();
    const sig = plan.rooms.map((r) => `${r.name}@${r.storey ?? ""}:${r.pts.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(" ")}`).join("/");
    const known = this.store.load().get(sig);
    const mask = buildRoomLightMask(plan, known ? null : walls, known);
    if (mask && !known) this.store.save(new Map([[sig, mask.known]]));
    this.ports.log?.(`room light: ${mask ? `${mask.width}x${mask.rows}x${mask.bands}` : "none"} open=[${mask?.open.join(", ") ?? ""}]`
      + ` ${known ? "stored" : "walls read"} ${(performance.now() - t0).toFixed(0)}ms`);
    return mask;
  }
}
