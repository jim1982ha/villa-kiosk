// A change of profile while work is out or held (architecture review K, 2026-10-24: utils/syncedDocument switchAuthor,
// carries, heldAuthors; fm/FmDataContext carriesWorkOf; fm/fmSave heldLine).
//
//   k1  the facility manager's Started on a slow connection, the owner signed in before it answered: the owner was given
//       the copy from before that save, and the next refresh sent the old "open" back, its step gone, nobody told.
//   k3  work held for a profile not signed in was never sent by anyone else, and nothing said it waited: the owner, who
//       may do all a facility manager or a guest does, now sends it (each step keeps its own author); a guest, who may
//       not, is told it waits.
//
// Driven by value: the real providers under React (tests/consistency/fakedom.mjs) against a fake add-on.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { unsentWorkHeld } = await import("@/utils/syncedDocument");
const { heldLine } = await import("@/fm/fmSave");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const map = new Map();
const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
  get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null };
const pump = () => ({ id: "t1", title: "Pool pump noisy", status: "open", openedAt: "2026-10-20T08:00:00Z", photoIds: [],
  updates: [{ at: "2026-10-20T08:00:00Z", status: "open", photoIds: [] }] });
const srv = { data: null, rev: 1, putDelay: 1, puts: [], down: false };
const reset = () => Object.assign(srv, { data: { ...structuredClone(EMPTY_FM_DATA), tickets: [pump()] }, rev: 1, putDelay: 1, puts: [], down: false });
globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith("fm-data")) { await sleep(1); return { ok: false, status: 404, json: async () => ({}) }; }
  if (srv.down) { await sleep(1); throw new Error("offline"); }
  if (init?.method === "PUT") {
    const b = JSON.parse(init.body);
    await sleep(srv.putDelay);
    if (b.rev !== undefined && b.rev !== String(srv.rev)) return { ok: false, status: 409, json: async () => ({ data: structuredClone(srv.data), rev: String(srv.rev) }) };
    srv.puts.push(b.data.tickets.map((t) => `${t.id}:${t.status}`).join(","));
    srv.data = b.data; srv.rev++;
    return { ok: true, status: 200, json: async () => ({ rev: String(srv.rev) }) };
  }
  await sleep(1);
  return { ok: true, status: 200, json: async () => ({ data: structuredClone(srv.data), rev: String(srv.rev) }) };
};
globalThis.localStorage = storage; globalThis.sessionStorage = storage;
Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, screen: { width: 1024, height: 768 } });
const { ProfileProvider, useProfile } = await import("@/auth/ProfileContext");
const { FmDataProvider, useFmData } = await import("@/fm/FmDataContext");

let fm, prof, page;
async function mount(role) {
  if (page) await page.unmount();                       // the page before is gone, its refreshes with it
  map.clear(); reset();
  storage.setItem("villa-kiosk:profile:v1", JSON.stringify({ role, at: Date.now() }));
  page = mountRoot();
  globalThis.localStorage = storage; globalThis.sessionStorage = storage;   // after the fake DOM, which brings its own
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible" });
  const Probe = () => { fm = useFmData(); prof = useProfile(); return null; };
  const h = page.React.createElement;
  await page.render(h(ProfileProvider, null, h(FmDataProvider, null, h(Probe))));
  await turn();
}
const turn = (n = 40) => page.act(() => sleep(n));
const status = () => srv.data.tickets.find((t) => t.id === "t1").status;
const steps = () => srv.data.tickets.find((t) => t.id === "t1").updates.map((u) => u.status + (u.by ? ` by ${u.by}` : "")).join(" > ");
const kept = () => [...map.keys()].filter((k) => k.startsWith("villa-kiosk:fm-unsent"));

console.log("  k1, a sign-in while a save is out:");
await mount("ops");
srv.putDelay = 300;
const started = fm.advanceTickets(["t1"], "in_progress", { photoIds: [] });
await turn(50);
// a guest: who sends nobody's held work (k3), so only the write out itself can keep the Started
await page.act(async () => { prof.login("guest"); await sleep(5); });
await page.act(async () => { await started; }); await turn();
srv.putDelay = 1;
for (let i = 0; i < 2; i++) { await page.act(async () => { await fm.reload(); }); await turn(); }
ck("the facility manager's Started lands and stays after the next profile's refreshes", status() === "in_progress"
   && srv.puts.length === 1 && /in_progress by Facility manager/.test(steps()), { puts: srv.puts, steps: steps() });
ck("  ...and the next profile's screen shows it", fm.data.tickets.find((t) => t.id === "t1").status === "in_progress");

console.log("\n  k3, work held for another profile:");
await mount("ops");
srv.down = true;
await page.act(async () => { await fm.advanceTickets(["t1"], "in_progress", { photoIds: [] }); });
await page.act(async () => { prof.login("guest"); await sleep(5); }); await turn();
ck("a guest, who may not send the facility manager's work, is told it waits on this tablet",
   fm.heldFor.length === 1 && heldLine(fm.heldFor) === "Work by the facility manager is waiting on this tablet: it is sent as soon as someone allowed to send it signs in here.",
   fm.heldFor);
await page.act(async () => { await fm.addTicket({ title: "Shower drain blocked", photoIds: [], reportedBy: "guest" }); });
await page.act(async () => { prof.login("owner"); await sleep(5); }); await turn();
srv.down = false;
for (let i = 0; i < 3; i++) { await page.act(async () => { await fm.reload(); }); await turn(); }
const drain = srv.data.tickets.find((t) => t.title === "Shower drain blocked");
ck("the owner sends both: the facility manager's Started and the guest's report, each step under its own author",
   status() === "in_progress" && /in_progress by Facility manager/.test(steps()) && !!drain && drain.updates.every((u) => u.by === "Guest"),
   { steps: steps(), drain: drain?.updates });
ck("  ...nothing is left kept on the tablet, nothing said waiting, and the 04:00 reload no longer waits",
   kept().length === 0 && fm.heldFor.length === 0 && !unsentWorkHeld(), { kept: kept(), held: fm.heldFor });

done("✅ a change of profile loses no save, and held work is sent by whoever may send it");
process.exit(0);
