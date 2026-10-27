// The Facility window merged into the Cockpit (2.496.273, owner 2026-10-04:
// "7 tabs in the cockpit modal (1 with the existing modal, and 6 … the
// redundant facility modal"). One top-bar button, one window, the same
// workflows. Node cannot import .tsx, so the wiring is pinned.
import { readFileSync, existsSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const cockpit = (rd("components/cockpit/CockpitModal.tsx") + rd("components/cockpit/CockpitOverview.tsx")), fm = rd("components/fm/FacilitySections.tsx");
const dash = rd("pages/Dashboard.tsx"), hud = rd("components/hud/HUD.tsx");

const ids = [...fm.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)].map((m) => m[2]);
// owner, 2026-10-14: Tickets right after the Overview; Today + Schedule one tab, Readiness + Recap one tab
ck("5 tabs: Overview, then Tickets, Schedule (today's board + the schedule), Recap (readiness + the recap), Spend",
   /const OVERVIEW_TAB: ModalTab<CockpitTab> = \{ id: "overview", label: "Overview"/.test(cockpit)
   && ids.join() === "Tickets,Schedule,Recap,Spend", ids);
ck("  ...the merged tabs show both their parts",
   /tab === "schedule" && \([\s\S]{0,40}<TodayTab[\s\S]{0,160}<ScheduleEditor \/>/.test(fm)
   // the presence line ABOVE the readiness card since 2026-10-22 (owner)
   && /tab === "recap" && \([\s\S]{0,200}recap-presence[\s\S]{0,80}<ReadinessTab[\s\S]{0,400}<RecapTab /.test(fm));
ck("  ...a profile without the Facility door sees the Cockpit's own view, with no strip",
   /doors\.facility \? \[OVERVIEW_TAB, \.\.\.FACILITY_TABS\] : \[OVERVIEW_TAB\]/.test(cockpit)
   && /\{tabs\.length > 1 && <ModalTabs/.test(cockpit) && /const shownTab: CockpitTab = doors\.facility \? tab : "overview";/.test(cockpit));
ck("the Facility window is gone, and nothing opens it",
   !existsSync(new URL("../../src/components/fm/FacilityModal.tsx", import.meta.url))
   && !/FacilityModal|"facility"\)/.test(dash) && !/onOpenFacility|ClipboardList/.test(hud));
// The moves themselves (Faults tab, device filled in, guest's report instead)
// are pages/screen's, driven by value in screen.mjs; the page only sends them.
ck("a device's 'report a fault' (shown by the profile's door, a value) opens the Overview's Raise a fault, the device filled in",
   /onReportFault: \(\) => go\(\{ type: "reportFault" \}\)/.test(rd("components/panels/useOpenPanelActions.ts"))
   && /may: \{ edit: doors\.editDevices, reportFault: doors\.reportFault \}/.test(rd("components/panels/useOpenPanelActions.ts"))
   && /if \(!may\.reportFault\) return null;/.test(rd("components/panels/DeviceWindowPieces.tsx")) && /<ReportFaultButton \/>/.test(rd("components/panels/BasePanel.tsx"))
   && /reportFaultFor=\{screen\.faultFor \?\? undefined\}/.test(dash));
ck("the top bar opens it on Overview; Back from a device returns to the tab it left (the tab is held by the page)",
   /onOpenCockpit=\{\(\) => go\(\{ type: "openWindow", window: "cockpit", tab: "overview" \}\)\}/.test(dash)
   && /tab=\{screen\.cockpitTab\}\s*onTab=\{\(tab\) => go\(\{ type: "cockpitTab", tab \}\)\}/.test(dash));
// Readiness's "View unavailable devices" opens its own list now, in Recap (readiness_checks.mjs, by value); it never
// opens a second Cockpit over the first.
ck("Facility's tabs never open a second Cockpit", !/CockpitModal/.test(fm));
done("✅ one Cockpit: its view and Facility's six tabs");
