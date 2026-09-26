// A shared document's sync state machine (src/utils/syncedDocument.ts, round
// 10, 2.496.154), driven against a fake store: the four rules the config
// store's header states, the Facility store's failed-write retry, and the race
// only one of the two used to guard — a write started DURING a pull's fetch.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { SyncedDocument } = await import("@/utils/syncedDocument");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

/** A store of {key: value} with a revision, and hooks to hold a fetch open. */
function store(initial = {}) {
  const s = { doc: { ...initial }, rev: 1, down: false, saveFails: false, holdFetch: null, fetches: 0, saves: 0 };
  s.fetch = async () => {
    s.fetches++;
    if (s.down) return null;
    const snap = { doc: { ...s.doc }, rev: String(s.rev), raw: {} };
    if (s.holdFetch) await s.holdFetch;
    return snap;
  };
  s.save = async (next, rev) => {
    s.saves++;
    if (s.saveFails || s.down) return { ok: false, conflict: false };
    if (rev !== String(s.rev)) return { ok: false, conflict: true };
    s.doc = { ...next }; s.rev++;
    return { ok: true, rev: String(s.rev) };
  };
  return s;
}
const spec = (s, extra = {}) => ({
  fetch: s.fetch, save: s.save,
  diff: (base, local) => Object.fromEntries(Object.entries(local).filter(([k, v]) => base[k] !== v)),
  isEmpty: (d) => Object.keys(d).length === 0,
  apply: (t, d) => ({ ...t, ...d }),
  rebase: (_b, fresh) => fresh,
  empty: {},
  ...extra,
});
const differs = (doc) => (f) => JSON.stringify(f.doc) !== JSON.stringify(doc);

console.log("  pull before push:");
{
  const s = store({ a: 1 });
  const d = new SyncedDocument(spec(s), null);
  const r = await d.push({ a: 1, b: 2 });
  ck("a document never pulled does not push (a freshly-detected map must not wipe the owner's)", !r.ok && r.reason === "not-pulled" && s.saves === 0);
  const p = await d.pull(() => ({}), differs({}));
  ck("the first pull applies the server's copy and makes it the baseline", p.action === "apply" && d.baseline.a === 1 && d.rev === "1");
}

console.log("\n  push only real changes; a pull never clobbers an unconfirmed edit:");
{
  const s = store({ a: 1 });
  const d = new SyncedDocument(spec(s), { a: 1 });
  let local = { a: 1 };
  ck("nothing changed: nothing sent", (await d.push(local)).reason === "nothing-to-push" && s.saves === 0);
  local = { a: 1, b: 2 };
  s.doc.c = 3; s.rev++;                                  // another device wrote meanwhile
  const p = await d.pull(() => local, differs(local));
  ck("an edit not yet pushed makes the pull stand back ('repush'), keeping the baseline", p.action === "repush" && d.baseline.c === undefined);
  const r = await d.push(local);
  ck("the push sends only this device's change, replayed onto the other device's write", r.ok && s.doc.b === 2 && s.doc.c === 3 && d.baseline.c === 3);
}

console.log("\n  a failed write is retried, never stranded:");
{
  const s = store({ a: 1 });
  const d = new SyncedDocument(spec(s), { a: 1 });
  s.saveFails = true;
  const r = await d.push({ a: 2 });
  ck("a failed save leaves the work flagged unsaved", !r.ok && d.hasUnsaved && d.isAhead({ a: 2 }));
  const fetchesBefore = s.fetches;
  const p = await d.pull(() => ({ a: 2 }), differs({ a: 2 }));
  ck("the next pull does not fetch over it — it asks for a re-push, without a fetch", p.action === "repush" && s.fetches === fetchesBefore);
  s.saveFails = false;
  ck("  ...which then lands and clears the flag", (await d.push({ a: 2 })).ok && !d.hasUnsaved && s.doc.a === 2);
}

console.log("\n  a write started DURING a pull's fetch (the config store's open hole):");
{
  const s = store({ a: 1 });
  const d = new SyncedDocument(spec(s), { a: 1 });
  let release; s.holdFetch = new Promise((res) => { release = res; });
  let local = { a: 1 };
  const pulling = d.pull(() => local, differs(local));     // fetch snapshot taken: a=1
  s.holdFetch = null;
  local = { a: 2 };
  const pushed = await d.push(local);                       // lands first: a=2
  release();
  const p = await pulling;
  ck("the push lands while the pull's fetch is out", pushed.ok && s.doc.a === 2);
  ck("  ...and the older fetched copy is NOT applied over it", p.action !== "apply" && d.baseline.a === 2, { action: p.action, baseline: d.baseline });
}

console.log("\n  the rest of the decision:");
{
  const s = store({});
  const d = new SyncedDocument(spec(s, { serverEmpty: (f) => Object.keys(f.doc).length === 0, empty: { seeded: true } }), null);
  const p = await d.pull(() => ({ x: 1 }), () => true);
  ck("an empty store is SEEDED: the baseline is the empty document, so the local copy is then pushed", p.action === "seed" && d.baseline.seeded === true);
  s.down = true;
  ck("unreachable: nothing changes", (await d.pull(() => ({}), () => true)).action === "unreachable");
  const g = new SyncedDocument(spec(store({ a: 1 }), { canWrite: () => false }), { a: 1 });
  ck("a device that may not write never sends (checked when the push runs)", (await g.push({ a: 9 })).reason === "not-allowed");
  const seen = [];
  const t = new SyncedDocument(spec(store({ a: 1 }), { onBaseline: (b) => seen.push(b) }), null);
  await t.pull(() => ({}), () => true);
  ck("every baseline move is reported (the config store persists it)", seen.length === 1 && seen[0].a === 1);
}

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one sync machine for every shared store");
