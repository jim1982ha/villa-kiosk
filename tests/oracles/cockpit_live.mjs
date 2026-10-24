// The Overview's "Open issues" is read LIVE while the Cockpit is open (architecture review, 2026-10-19). The (i) beside
// "Open a ticket" promises the list is "read again every 15s while it is open" (fm/faultTiming, from
// useStoreRefresh's own numbers); the store speeds up only while a watcher is registered (FmDataContext
// useFacilityLiveView) — and the watcher was the Facility tabs' alone (FacilitySections), so the Overview was read every
// three minutes until someone opened Tickets. The registration is the WINDOW's now (CockpitModal), once, whichever tab.
//
// WIRING, pinned in the source: react-dom/server runs no effect, so a watcher count cannot be read from a drawing; the
// cadence words themselves are driven by value (info_tip.mjs says the whole sentence).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done, tsFiles } from "../consistency/check.mjs";
const { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } = await import("@/hooks/useStoreRefresh");
const { faultTiming } = await import("@/fm/faultTiming");
const { fmtDuration } = await import("@/components/panels/chartUtils");

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const modal = src("components/cockpit/CockpitModal.tsx");
const body = modal.slice(modal.indexOf("export default function CockpitModal("));
const branch = body.indexOf('shownTab !== "overview" ?');
ck("the Cockpit window registers the live view itself — once, at the top of its body, before the tab branch: whichever tab shows",
   /\n  useFacilityLiveView\(\);\n/.test(body) && branch > 0 && body.indexOf("useFacilityLiveView();") < branch, body.slice(0, 160));
const callers = tsFiles(fileURLToPath(new URL("../../src", import.meta.url)))
  .filter((f) => /\buseFacilityLiveView\(\);/.test(readFileSync(f, "utf8")));
ck("  ...and it is the ONE registrant: no tab registers a second one", callers.length === 1 && /CockpitModal\.tsx$/.test(callers[0]), callers);
ck("  ...so the (i)'s promise holds on the Overview: its sentence names the window's open cadence, the faster one",
   STORE_ACTIVE_MS < STORE_HEARTBEAT_MS && faultTiming(false).note.includes(`every ${fmtDuration(STORE_ACTIVE_MS)} while it is open`),
   faultTiming(false).note);
done("✅ the Cockpit's Open issues are read live while the window is open, whichever tab");
