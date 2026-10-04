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
ck("7 tabs: Overview, then Facility's six in the operator's order",
   /const OVERVIEW_TAB: ModalTab<CockpitTab> = \{ id: "overview", label: "Overview"/.test(cockpit)
   && ids.join() === "Today,Readiness,Faults,Spend,Schedule,Recap", ids);
ck("  ...a profile without the Facility door sees the Cockpit's own view, with no strip",
   /doors\.facility \? \[OVERVIEW_TAB, \.\.\.FACILITY_TABS\] : \[OVERVIEW_TAB\]/.test(cockpit)
   && /\{tabs\.length > 1 && <ModalTabs/.test(cockpit) && /const shownTab: CockpitTab = doors\.facility \? tab : "overview";/.test(cockpit));
ck("the Facility window is gone, and nothing opens it",
   !existsSync(new URL("../../src/components/fm/FacilityModal.tsx", import.meta.url))
   && !/FacilityModal|"facility"\)/.test(dash) && !/onOpenFacility|ClipboardList/.test(hud));
ck("a device's 'report a fault' opens the Cockpit on Faults with the device filled in",
   /setFaultForEntity\(activePanel\.entityId\);\s*setCockpitTab\("faults"\);\s*openSurface\("cockpit"\);/.test(dash)
   && /reportFaultFor=\{faultForEntity \?\? undefined\}/.test(dash));
ck("the top bar opens it on Overview; Back from a device returns to the tab it left (the tab is held by the page)",
   /onOpenCockpit=\{\(\) => \{ setCockpitTab\("overview"\); openSurface\("cockpit"\); \}\}/.test(dash)
   && /tab=\{cockpitTab\}\s*onTab=\{setCockpitTab\}/.test(dash));
ck("Readiness's 'devices offline' switches to Overview (it opened a second Cockpit over Facility)",
   /onOpenOverview=\{\(\) => onTab\("overview"\)\}/.test(cockpit) && /onOpenUnavailableDevices=\{onOpenOverview\}/.test(fm)
   && !/CockpitModal/.test(fm));
done("✅ one Cockpit: its view and Facility's six tabs");
