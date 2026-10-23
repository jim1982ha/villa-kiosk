// A fault changed on two devices is merged field by field, never replaced whole (architecture review H, 2026-10-23,
// utils/keyedSync mergeItem behind fm/fmApi diffFmData / applyFmDiff / foldOthers).
//
// A fault closed on the phone, then "Started" tapped on the wall tablet whose copy predated the close: the tablet's
// push replayed its WHOLE fault onto the store, the fault came back in progress on every device, and "Closed without
// action" vanished from its history. Decided: the store's fault unmoved since this device's copy, the change is laid as
// before; moved, a field only this device changed takes its value, one only the other changed keeps theirs, the steps
// are append-only, and a field both changed keeps the other device's value (it got there first), the device saying
// "This fault was just changed on another device." The record stays one the VESTA Agent reads as a fault: its status is
// its last status step's (fmEngine ticketAt). The device-setup store does not merge.
//
// Driven by value: the real merge, the real Facility diff / apply / fold, the real commands (fmCommands) through the
// real sync machine against a fake store; then the real FmDataProvider under React (tests/consistency/fakedom.mjs).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { mergeItem } = await import("@/utils/keyedSync");
const F = await import("@/fm/fmApi");
const { applyFmCommand } = await import("@/fm/fmCommands");
const { ticketAt, statusChanges, CLOSED_WITHOUT_ACTION } = await import("@/fm/fmEngine");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { CHANGED_ON_ANOTHER_DEVICE } = await import("@/fm/fmSave");
const { SyncedDocument } = await import("@/utils/syncedDocument");
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const D = await import("@/config/deviceConfig");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("  the merge, by value:");
{
  const was = { a: 1, b: 1, list: [{ k: 1 }] };
  const r1 = mergeItem(was, { ...was, a: 2 }, { ...was, b: 3 });
  ck("a field only this side changed takes its value, one only the other changed keeps theirs",
     r1.item.a === 2 && r1.item.b === 3 && r1.clashed.length === 0, r1);
  const r2 = mergeItem(was, { ...was, a: 2 }, { ...was, a: 5 });
  ck("a field both changed keeps the other side's value, and is named", r2.item.a === 5 && r2.clashed.join() === "a", r2);
  const r3 = mergeItem(was, { ...was, a: 2 }, { ...was, a: 2 });
  ck("  ...unless both set the same value (nothing to say)", r3.item.a === 2 && r3.clashed.length === 0, r3);
  const rules = { lists: { list: { id: (e) => JSON.stringify(e) } }, groups: [["a", "b"]] };
  const r4 = mergeItem(was, { ...was, list: [{ k: 1 }, { k: "mine" }] }, { ...was, list: [{ k: 1 }, { k: "theirs" }] }, rules);
  ck("a list kept append-only holds both sides' new entries, each once, theirs first",
     JSON.stringify(r4.item.list) === '[{"k":1},{"k":"theirs"},{"k":"mine"}]' && r4.clashed.length === 0, r4.item.list);
  const r5 = mergeItem(was, { ...was, a: 2, b: 2 }, { ...was, a: 7 }, rules);
  ck("fields that go together keep the other side's values together", r5.item.a === 7 && r5.item.b === 1, r5.item);
  const r6 = mergeItem({ a: 1, gone: 1 }, { a: 1 }, { a: 1, gone: 1 });
  ck("a field this side removed is removed", !("gone" in r6.item), r6.item);
}

// ── two devices, one store ──────────────────────────────────────────────────────────────────────────────────────────
const fault = { id: "t1", title: "Pool pump not running", status: "open", openedAt: "2026-10-23T08:00:00Z", photoIds: [], updates: [] };
function villa() {
  const store = { doc: { ...structuredClone(EMPTY_FM_DATA), tickets: [fault] }, rev: 1 };
  const fetch = async () => ({ doc: structuredClone(store.doc), rev: String(store.rev), raw: {} });
  const save = async (next, rev) => {
    if (rev !== String(store.rev)) return { ok: false, conflict: true };
    store.doc = structuredClone(next); store.rev++; return { ok: true, rev: String(store.rev) };
  };
  const device = async (by) => {
    const doc = new SyncedDocument({ fetch, save, diff: F.diffFmData, isEmpty: F.fmDiffIsEmpty, apply: F.applyFmDiff,
      rebase: (_b, f) => f, empty: EMPTY_FM_DATA }, EMPTY_FM_DATA);
    const d = { doc, screen: (await doc.pull(() => EMPTY_FM_DATA, () => true)).fetched.doc, said: null };
    // FmDataContext mutate: the command on the screen, the push, the other devices' changes folded in
    d.run = async (cmd, now) => {
      d.screen = applyFmCommand(d.screen, cmd, { now, id: () => `${by}-${now}`, by });
      const o = await doc.push(d.screen);
      if (o.ok) { const f = F.foldOthers(d.screen, o); d.screen = f.doc; d.said = f.changedOnBoth.length ? CHANGED_ON_ANOTHER_DEVICE : null; }
      return o;
    };
    d.refresh = async () => {
      const before = doc.baseline;
      const p = await doc.pull(() => d.screen, (f) => JSON.stringify(f.doc) !== JSON.stringify(before));
      if (p.action === "apply") d.screen = p.fetched.doc;
      return p.action;
    };
    return d;
  };
  return { store, device };
}
const t1 = (d) => d.tickets.find((t) => t.id === "t1");
const steps = (d) => (t1(d).updates ?? []).map((u) => u.note ?? u.kind ?? u.status);
/** One fault, as the VESTA Agent and every report read it: its status is its last status step's. */
const valid = (d) => ticketAt(t1(d), Date.parse("2030-01-01")).status === t1(d).status
  && (t1(d).status === "resolved") === Boolean(t1(d).resolvedAt);

console.log("\n  the phone closes the fault; the tablet, its copy older, taps Started:");
{
  const v = villa();
  const phone = await v.device("Owner"), tablet = await v.device("Facility manager");
  await phone.run({ type: "closeTickets", ids: ["t1"] }, "2026-10-23T10:00:05Z");
  const o = await tablet.run({ type: "advanceTickets", ids: ["t1"], to: "in_progress", step: { photoIds: [] } }, "2026-10-23T10:00:09Z");
  ck("the tablet's save lands", o.ok, o.reason);
  ck("the store keeps the fault closed, 'Closed without action' in its history",
     t1(v.store.doc).status === "resolved" && steps(v.store.doc).includes(CLOSED_WITHOUT_ACTION), steps(v.store.doc));
  ck("  ...and it is still one fault: no 'Started' after the close, status = its last status step, resolved with a time",
     valid(v.store.doc) && statusChanges(t1(v.store.doc)).at(-1).status === "resolved", t1(v.store.doc));
  ck("the tablet shows it closed, and says so", t1(tablet.screen).status === "resolved" && tablet.said === CHANGED_ON_ANOTHER_DEVICE,
     { shows: t1(tablet.screen).status, said: tablet.said });
  ck("  ...and has nothing left to send on its next refresh", await tablet.refresh() !== "repush" && t1(v.store.doc).status === "resolved");
  await phone.refresh();
  ck("the phone, after its refresh, still reads it closed", t1(phone.screen).status === "resolved", t1(phone.screen).status);
}

console.log("\n  the other way round: the phone starts it, the tablet closes it:");
{
  const v = villa();
  const phone = await v.device("Owner"), tablet = await v.device("Facility manager");
  await phone.run({ type: "advanceTickets", ids: ["t1"], to: "in_progress", step: { who: "Wayan", photoIds: [] } }, "2026-10-23T10:00:05Z");
  await tablet.run({ type: "closeTickets", ids: ["t1"] }, "2026-10-23T10:00:09Z");
  ck("the store keeps it in progress, with no resolution time and no close in its history",
     t1(v.store.doc).status === "in_progress" && !t1(v.store.doc).resolvedAt && !steps(v.store.doc).includes(CLOSED_WITHOUT_ACTION),
     t1(v.store.doc));
  ck("  ...one fault still", valid(v.store.doc), t1(v.store.doc));
  ck("the tablet says so", tablet.said === CHANGED_ON_ANOTHER_DEVICE && t1(tablet.screen).status === "in_progress");
}

console.log("\n  the phone renames the fault; the tablet, its copy older, taps Started:");
{
  const v = villa();
  const phone = await v.device("Owner"), tablet = await v.device("Facility manager");
  await phone.run({ type: "updateTicket", id: "t1", patch: { title: "Pool pump bearing worn" } }, "2026-10-23T10:00:05Z");
  await tablet.run({ type: "advanceTickets", ids: ["t1"], to: "in_progress", step: { photoIds: [] } }, "2026-10-23T10:00:09Z");
  ck("both land: started, under the phone's title, both steps in the history",
     t1(v.store.doc).status === "in_progress" && t1(v.store.doc).title === "Pool pump bearing worn"
     && steps(v.store.doc).join() === "retitled,in_progress", { fault: t1(v.store.doc), steps: steps(v.store.doc) });
  ck("  ...the tablet shows the same, and says nothing (no field both changed)",
     JSON.stringify(t1(tablet.screen)) === JSON.stringify(t1(v.store.doc)) && tablet.said === null, { said: tablet.said });
  ck("  ...one fault still", valid(v.store.doc));
}

console.log("\n  the store's fault unmoved since this device's copy: laid as it always was:");
{
  const v = villa();
  const tablet = await v.device("Facility manager");
  await tablet.run({ type: "advanceTickets", ids: ["t1"], to: "in_progress", step: { photoIds: [] } }, "2026-10-23T10:00:09Z");
  ck("the store holds exactly the tablet's fault", JSON.stringify(t1(v.store.doc)) === JSON.stringify(t1(tablet.screen)) && tablet.said === null);
}

console.log("\n  the device-setup store does not merge (a device replaced whole, as before):");
{
  const m = (label, room) => ({ entityId: "light.hall", type: "light", label, room });
  const base = D.baselineFromServer(D.pickSharedConfig(normaliseConfig({ ...DEFAULT_CONFIG, entityMap: { "light.hall": m("Hall", "Hall") } }, { maps: true })));
  const mine = { ...base, entityMap: { "light.hall": m("Hall lamp", "Hall") } };
  const theirs = { ...base, entityMap: { "light.hall": m("Hall", "Lobby") } };
  const diff = D.diffSharedConfig(base, mine);
  const next = D.applySharedConfigDiff(theirs, diff);
  ck("its diff carries no copy to merge against, and this tablet's device lands whole",
     diff.entityMap.was === undefined && next.entityMap["light.hall"].label === "Hall lamp" && next.entityMap["light.hall"].room === "Hall",
     next.entityMap["light.hall"]);
}

console.log("\n  through the real Facility store under React:");
{
  const { React, act, render } = mountRoot();
  Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, screen: { width: 1024, height: 768 } });
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  globalThis.sessionStorage = globalThis.localStorage;
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible" });
  const srv = { data: { ...structuredClone(EMPTY_FM_DATA), tickets: [fault] }, rev: 1, beforeFetch: null };
  const answer = (status, body) => ({ ok: status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    await sleep(2);
    if (!String(url).endsWith("fm-data")) return answer(404, {});
    if ((init.method ?? "GET") === "GET") {
      const f = srv.beforeFetch; srv.beforeFetch = null; f?.();
      return answer(200, { data: structuredClone(srv.data), rev: String(srv.rev) });
    }
    const body = JSON.parse(init.body);
    if (body.rev !== String(srv.rev)) return answer(409, {});
    srv.data = body.data; srv.rev++;
    return answer(200, { rev: String(srv.rev) });
  };
  const { ProfileProvider } = await import("@/auth/ProfileContext");
  const { FmDataProvider, useFmData } = await import("@/fm/FmDataContext");
  let fm;
  const Probe = () => { fm = useFmData(); return null; };
  const h = React.createElement;
  await render(h(ProfileProvider, null, h(FmDataProvider, null, h(Probe))));
  await act(() => sleep(30));
  ck("the store is read", fm.ready && fm.data.tickets.length === 1);
  // the phone's close lands just before this tablet's push reads the store
  srv.beforeFetch = () => {
    srv.data = applyFmCommand(srv.data, { type: "closeTickets", ids: ["t1"] }, { now: "2026-10-23T10:00:05Z", id: () => "x", by: "Owner" });
    srv.rev++;
  };
  let saved;
  await act(async () => { saved = await fm.advanceTickets(["t1"], "in_progress", { photoIds: [] }); });
  ck("Started: saved; the screen and the store read closed, 'Closed without action' kept",
     saved.done && t1(fm.data).status === "resolved" && t1(srv.data).status === "resolved"
     && steps(srv.data).includes(CLOSED_WITHOUT_ACTION), { screen: t1(fm.data).status, store: steps(srv.data) });
  ck("  ...and the Facility screen says why", fm.saveError === CHANGED_ON_ANOTHER_DEVICE, fm.saveError);
  const rev = srv.rev;
  await act(async () => { await fm.reload(); });
  ck("  ...the next refresh sends nothing back", srv.rev === rev && t1(srv.data).status === "resolved", { rev: srv.rev - rev });
}

done("✅ a fault changed on two devices is merged field by field; a field both changed keeps the first, and is said");
