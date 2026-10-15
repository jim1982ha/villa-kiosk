// src/ha/stateLens.ts
// How the Kiosk reads a device whose report is the wrong way round: a lock mounted upside down says "unlocked" when it
// is locked (owner, 2026-10-15). Its Advanced Settings switch (EntityMapping.invertLock) turns the lens on for it.
//
// ⚠️ APPLIED ONCE, WHERE THE VILLA'S SYSTEM MEETS THE APP (HAWebSocket: every state it reads or is told, every logbook
// row, every lock or unlock it sends; HAHistoryAPI: every history row). Nothing past that seam knows a lock is inverted:
// the map's badge, the Overview's cards, the counts, the readiness check, the lock panel and its buttons, the charts and
// the Recap all read "locked" when the door IS locked, and a press on Lock locks it. Inverting at any one screen instead
// would leave every other one telling the truth the wrong way round.
//
// Pure: tests/oracles/lock_inversion.mjs drives it through the real socket and store.

import type { HassEntity, HassServiceTarget, RawLogbookEntry } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";

/** The states a reversed lock reports, and what each one means. Jammed, open, opening and unavailable say the same
 *  thing whichever way the lock is mounted. */
const SWAPPED: Readonly<Record<string, string>> = {
  locked: "unlocked", unlocked: "locked", locking: "unlocking", unlocking: "locking",
};
/** The two commands that move it, each the other's opposite. */
const OPPOSITE: Readonly<Record<string, string>> = { lock: "unlock", unlock: "lock" };

export interface StateLens {
  /** The lock entities whose report and commands are reversed. */
  readonly invertedLocks: ReadonlySet<string>;
}

export const NO_LENS: StateLens = { invertedLocks: new Set() };

/** Only a lock entity can be inverted, whatever its panel type says. */
export function isLockEntity(entityId: string): boolean {
  return entityId.startsWith("lock.");
}

/** Is `entityId` a lock its Advanced Settings mark inverted? (The lens below; its badge's invert pill, badgeIcons.) */
export function isInvertedLock(entityMap: Readonly<Record<string, EntityMapping | undefined>>, entityId: string): boolean {
  return isLockEntity(entityId) && !!entityMap[entityId]?.invertLock;
}

/** The lens the villa's device settings ask for: every lock its Advanced Settings mark inverted. */
export function lensFrom(entityMap: Readonly<Record<string, EntityMapping>>): StateLens {
  const ids = Object.keys(entityMap).filter((id) => isInvertedLock(entityMap, id));
  return ids.length ? { invertedLocks: new Set(ids) } : NO_LENS;
}

/** Do two lenses invert the same locks? (A settings sync that changes nothing must not re-read every state.) */
export function sameLens(a: StateLens, b: StateLens): boolean {
  return a.invertedLocks.size === b.invertedLocks.size && [...a.invertedLocks].every((id) => b.invertedLocks.has(id));
}

/** A state of `entityId` as it really is. */
export function viewState(lens: StateLens, entityId: string, state: string): string {
  return lens.invertedLocks.has(entityId) ? SWAPPED[state] ?? state : state;
}

/** An entity as it really is — the same object when nothing changes. */
export function viewEntity<T extends HassEntity | null | undefined>(lens: StateLens, e: T): T {
  if (!e || !lens.invertedLocks.has(e.entity_id)) return e;
  const state = viewState(lens, e.entity_id, e.state);
  return state === e.state ? e : { ...e, state };
}

/** A logbook row as it really happened. */
export function viewLogbookEntry(lens: StateLens, row: RawLogbookEntry): RawLogbookEntry {
  if (!row.entity_id || row.state === undefined || !lens.invertedLocks.has(row.entity_id)) return row;
  return { ...row, state: viewState(lens, row.entity_id, row.state) };
}

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  target?: HassServiceTarget;
}

/** The calls that do what `call` means: a lock or unlock of an inverted lock is sent as its opposite; a call naming
 *  inverted and other locks together is split in two, so each lock moves the way the press meant. Anything else is
 *  sent as it is. */
export function viewServiceCall(lens: StateLens, call: ServiceCall): ServiceCall[] {
  const opposite = call.domain === "lock" ? OPPOSITE[call.service] : undefined;
  if (!opposite || !call.target || !lens.invertedLocks.size) return [call];
  const ids = Array.isArray(call.target.entity_id) ? call.target.entity_id : [call.target.entity_id];
  const turned = ids.filter((id) => lens.invertedLocks.has(id));
  if (!turned.length) return [call];
  const straight = ids.filter((id) => !lens.invertedLocks.has(id));
  const one = (service: string, list: string[]): ServiceCall =>
    ({ ...call, service, target: { entity_id: list.length === 1 ? list[0] : list } });
  return [...(straight.length ? [one(call.service, straight)] : []), one(opposite, turned)];
}
