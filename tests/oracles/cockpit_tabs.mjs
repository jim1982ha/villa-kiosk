// The Facility window merged into the Cockpit (2.496.273, owner 2026-10-04:
// "7 tabs in the cockpit modal (1 with the existing modal, and 6 … the
// redundant facility modal"). One top-bar button, one window, the same
// workflows. Node cannot import .tsx, so the wiring is pinned.
import { readFileSync, existsSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const cockpit = (rd("components/cockpit/CockpitModal.tsx") + rd("components/cockpit/MessagesTab.tsx") + rd("components/cockpit/IssueCard.tsx")), fm = rd("components/fm/FacilitySections.tsx");
const dash = rd("pages/Dashboard.tsx"), hud = rd("components/hud/HUD.tsx");

const ids = [...fm.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)].map((m) => m[2]);
// owner, 2026-10-14: Tickets right after the Overview; Today + Schedule one tab, Readiness + Recap one tab; the
// Overview became Messages (ticket 17 of "One inbox", owner 2026-10-28)
// ...named Inbox (owner, 2026-10-29: one word beside the others)
ck("5 tabs: Inbox, then Tickets, Schedule (today's board + the schedule), Recap (readiness), Spend (spend + the recap)",
   /const MESSAGES_TAB: ModalTab<CockpitTab> = \{ id: "messages", label: "Inbox"/.test(cockpit) && !/"overview"/.test(cockpit)
   && ids.join() === "Tickets,Schedule,Recap,Spend", ids);
ck("  ...the merged tabs show both their parts",
   /tab === "schedule" && \([\s\S]{0,40}<TodayTab[\s\S]{0,400}<ScheduleEditor \/>/.test(fm)
   // owner, 2026-11-05: the Maintenance schedule folded at first, as Recent work, its buttons inside it
   && /<ListSection title="Maintenance schedule"[^>]*open=\{scheduleOpen\}[\s\S]{0,120}<ScheduleEditor \/>\s*<\/ListSection>/.test(fm)
   && /\[scheduleOpen, setScheduleOpen\] = useState\(false\)/.test(fm)
   // owner, 2026-11-05: the Recap tab is the readiness alone, no "Villa occupied since …"; the monthly recap and the
   // spend statement are one document, the Spend tab's
   && /tab === "recap" && \(\s*<ReadinessTab [^\n]*\/>\s*\)\}/.test(fm) && !/recap-presence|usePresence|RecapTab/.test(fm)
   && /useMonthlyDocument\("recap", inputs\)/.test(readFileSync(new URL("../../src/components/fm/SpendTab.tsx", import.meta.url), "utf8")));
ck("  ...a profile without the Facility door (a guest) sees Messages alone, with no strip",
   /doors\.facility \? \[MESSAGES_TAB, \.\.\.FACILITY_TABS\] : \[MESSAGES_TAB\]/.test(cockpit)
   && /\{tabs\.length > 1 && <ModalTabs/.test(cockpit) && /const shownTab: CockpitTab = doors\.facility \? tab : "messages";/.test(cockpit));
ck("the Facility window is gone, and nothing opens it",
   !existsSync(new URL("../../src/components/fm/FacilityModal.tsx", import.meta.url))
   && !/FacilityModal|"facility"\)/.test(dash) && !/onOpenFacility|ClipboardList/.test(hud));
// The moves themselves (Faults tab, device filled in, guest's report instead)
// are pages/screen's, driven by value in screen.mjs; the page only sends them.
ck("a device's 'report a fault' (shown by the profile's door, a value) opens the Tickets tab's Open a ticket, the device filled in",
   /onReportFault: \(\) => go\(\{ type: "reportFault" \}\)/.test(rd("components/panels/useOpenPanelActions.ts"))
   && /may: \{ edit: doors\.editDevices, reportFault: doors\.reportFault \}/.test(rd("components/panels/useOpenPanelActions.ts"))
   && /if \(!may\.reportFault\) return null;/.test(rd("components/panels/DeviceWindowPieces.tsx")) && /<ReportFaultButton \/>/.test(rd("components/panels/BasePanel.tsx"))
   && /reportFaultFor=\{screen\.faultFor \?\? undefined\}/.test(dash));
ck("the top bar opens it on Messages; Back from a device returns to the tab it left (the tab is held by the page)",
   /onOpenCockpit=\{\(\) => go\(\{ type: "openWindow", window: "cockpit", tab: "messages" \}\)\}/.test(dash)
   && /tab=\{screen\.cockpitTab\}\s*onTab=\{\(tab\) => go\(\{ type: "cockpitTab", tab \}\)\}/.test(dash));
// The devices not reporting's linked word opens its own list, in Recap (readiness_checks.mjs, by value); it never
// opens a second Cockpit over the first.
ck("Facility's tabs never open a second Cockpit", !/CockpitModal/.test(fm));
ck("  ...a check's linked word for its devices opens their list there (owner, 2026-11-05: a word, not a button)",
   /to\.place === "devices" \? setCheckList\(to\.list\)/.test(fm));
// owner, 2026-11-05: a person is on a ticket; when VESTA looks again is its fault's Inbox card's
ck("a ticket's card says no next check", !/check=|checkPill/.test(rd("components/fm/TicketsTab.tsx")));
done("✅ one Cockpit: its view and Facility's six tabs");
