// A Facility write says what happened (round 13, 2.496.184). Every mutator
// returned nothing: a guest was told "that's been reported" whatever the
// add-on did, and a write the add-on REFUSED was filed as a dropped
// connection — kept, marked unsaved, and re-pushed on every refresh for
// good, while that device stopped accepting anyone else's changes.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
globalThis.window ??= globalThis;
globalThis.location ??= { pathname: "/", href: "http://localhost/" };
const { SyncedDocument } = await import("@/utils/syncedDocument");


function store(answer) {
  const s = { doc: { a: 1 }, rev: 1, saves: 0 };
  s.fetch = async () => ({ doc: { ...s.doc }, rev: String(s.rev), raw: {} });
  s.save = async (next, rev) => {
    s.saves++;
    if (answer === "refuse") return { ok: false, conflict: false, refused: true, message: "A guest may only add a fault report." };
    if (answer === "down") return { ok: false, conflict: false };
    if (rev !== String(s.rev)) return { ok: false, conflict: true };
    s.doc = { ...next }; s.rev++; return { ok: true, rev: String(s.rev) };
  };
  return s;
}
const spec = (s) => ({ fetch: s.fetch, save: s.save,
  diff: (b, l) => Object.fromEntries(Object.entries(l).filter(([k, v]) => b[k] !== v)),
  isEmpty: (d) => Object.keys(d).length === 0, apply: (t, d) => ({ ...t, ...d }), rebase: (_b, f) => f, empty: {} });

{
  const s = store("refuse"); const d = new SyncedDocument(spec(s), null);
  await d.pull(() => ({ a: 1 }), () => false);
  const out = await d.push({ a: 1, b: 2 });
  ck("a refused write comes back as REFUSED, with the add-on's reason", !out.ok && out.reason === "refused" && /guest/.test(out.message), out);
  ck("  ...is not kept as unsaved work", d.hasUnsaved === false);
  s.doc = { a: 1, c: 3 }; s.rev = 5;
  const next = await d.pull(() => ({ a: 1 }), (f) => JSON.stringify(f.doc) !== JSON.stringify({ a: 1 }));
  ck("  ...so the next refresh APPLIES a newer copy instead of re-pushing the refusal forever",
     next.action === "apply" && s.saves === 1, { action: next.action, saves: s.saves });
}
{
  const s = store("down"); const d = new SyncedDocument(spec(s), null);
  await d.pull(() => ({ a: 1 }), () => false);
  const out = await d.push({ a: 1, b: 2 });
  ck("a dropped connection is still transport — kept and re-sent on the next refresh",
     !out.ok && out.reason === "transport" && d.hasUnsaved === true && (await d.pull(() => ({ a: 1, b: 2 }), () => false)).action === "repush");
}

// fmApi: the add-on's status → refused / transport.
const { saveFmData } = await import("@/fm/fmApi");
const reply = (status, body) => { globalThis.fetch = async () => ({ ok: status < 300, status, json: async () => body, headers: new Map() }); };
reply(403, { error: "A guest may only add a fault report." });
const r403 = await saveFmData({ tickets: [] }, "1");
ck("a 403 is REFUSED with the server's reason (it was 'transport')", r403.ok === false && r403.refused === true && /guest/.test(r403.message), r403);
reply(413, { error: "data payload too large" });
ck("  ...so is a 413", (await saveFmData({}, "1")).refused === true);
reply(401, { error: "unauthorized" });
ck("  ...a 401 (sign-in expired) is NOT a refusal — the change is re-sent after sign-in", !(await saveFmData({}, "1")).refused);
reply(502, {});
const r502 = await saveFmData({}, "1");
ck("  ...a 502 is a blip (transport), not a refusal", r502.ok === false && !r502.refused && r502.conflict === false, r502);

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const ctx = src("fm/FmDataContext.tsx");
ck("mutate returns saved / refused / offline / unchanged, and undoes a refusal",
   /Promise<FmWriteResult>/.test(ctx) && /return "saved";/.test(ctx) && /if \(outcome\.reason === "refused"\) \{\s*setData\(before\);/.test(ctx) && /return "offline";/.test(ctx));
// ── What a screen DOES with the result: fmSaveOutcome, one decision (2.496.252) ──
// Offline is DONE (the write is queued on this device and re-sent on its own):
// the old "nothing was sent… try again" made a guest file the same report twice.
// Refused is the ONLY result that keeps the form — four forms emptied
// themselves whatever happened, throwing away what was typed.
const { fmSaveOutcome } = await import("@/fm/fmSave");
const o = Object.fromEntries(["saved", "unchanged", "offline", "refused"].map((r) => [r, fmSaveOutcome(r)]));
ck("saved / unchanged: done, nothing to say", o.saved.done && o.saved.note === null && o.unchanged.done && o.unchanged.note === null);
ck("offline: DONE (queued), and the person is told it will be sent — never 'try again'",
   o.offline.done === true && /sent automatically/.test(o.offline.note) && !/try again/i.test(o.offline.note), o.offline);
ck("refused: NOT done — the form keeps what was typed, and says so", o.refused.done === false && /still here/.test(o.refused.note), o.refused);

const SAVES = ["components/fm/GuestReportModal.tsx", "components/fm/FaultStageModal.tsx", "components/fm/FaultsTab.tsx",
  "components/fm/SpendTab.tsx", "components/fm/ScheduleEditor.tsx", "components/fm/TodayTab.tsx", "components/cockpit/CockpitModal.tsx"];
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("every Facility save asks fmSaveOutcome; the old wording is gone",
   SAVES.every((f) => /fmSaveOutcome\(/.test(src(f))) && !SAVES.some((f) => /fmWriteProblem/.test(src(f))) && !/fmWriteProblem/.test(ctx + src("fm/fmSave.ts")),
   SAVES.filter((f) => !/fmSaveOutcome\(/.test(src(f))));
// The defect's shape: a mutator awaited as a statement, then the form emptied regardless.
const blind = SAVES.filter((f) => /await (add|update|log|advance|close)[A-Za-z]*\([^;]*\);\s*(resetForm|cancel|setOpenId\(null\))/.test(strip(src(f))));
ck("  ...and no form empties itself after a save it did not look at", blind.length === 0, blind);
ck("the guest's thank-you says when the report is only queued on this tablet",
   /queued\s*\?\s*"This tablet will send it on its own/.test(src("components/fm/GuestReportModal.tsx")));
ck("the fault step, the Spend tab and logging a completion all ask for a cost with ONE CostFields (one cap line) — 2.496.263",
   ["components/fm/FaultStageModal.tsx", "components/fm/SpendTab.tsx", "components/fm/TodayTab.tsx"].every((f) => /<CostFields amount=\{amount\} onAmount=\{setAmount\}/.test(src(f)))
   && /projectedSpend\(data\.costs, \{ amount: value, category, replacing \}, terms\)/.test(src("components/fm/CostFields.tsx")));
ck("the three 'Saved' labels still show only when saved (not when queued)",
   /if \(result !== "saved"\) return;/.test(src("components/fm/ReadinessTab.tsx"))
   && /=== "saved"\) setSaved\(true\);/.test(src("components/fm/ReportTab.tsx"))
   && /=== "saved"\) setStatementSaved\(true\);/.test(src("components/fm/SpendTab.tsx")));

done("✅ a Facility write says what happened");
