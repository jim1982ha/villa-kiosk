// src/utils/countOf.ts
// "1 device" / "3 devices" — a count with its noun, written out by hand at some twenty sites
// (`${n} device${n === 1 ? "" : "s"}`) and as two private plural() helpers. Import-free, so any module may use it.
// An irregular noun passes its plural ("entity", "entities").

export function countOf(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}
