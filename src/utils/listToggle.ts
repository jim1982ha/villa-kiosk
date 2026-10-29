// src/utils/listToggle.ts
// A settings list edited one item at a time (the devices asleep between reports, the announcements that take the
// whole screen): the item added once, or taken off.

/** The list with `item` added (once) or removed. */
export function withItem(list: readonly string[], item: string, on: boolean): string[] {
  return on ? (list.includes(item) ? [...list] : [...list, item]) : list.filter((x) => x !== item);
}
