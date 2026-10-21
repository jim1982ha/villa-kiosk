// The VESTA Agent on the Kiosk's screen (docs/agent-integration/PLAN.md A8):
// who sees it, its presence on the Cockpit's button, the rooms it is sent, and
// its clock. (Its own window and messages were removed, 2.496.443: it sends the
// Kiosk none — people talk to it on Telegram.)
//
// Driven BY VALUE through the shipped modules (agent/agentView, agentApi,
// auth/permissions); the few source checks pin the WIRING — that the window
// and the button are only reachable through the one visibility answer, and
// that a guest's device never asks the add-on.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { roleCan } = await import("@/auth/permissions");
const { agentVisible, roomsToShare } = await import("@/agent/agentView");
const { parseAgentStatus } = await import("@/agent/agentApi");

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const online = parseAgentStatus({ state: "online", last_seen: "2026-09-29T00:00:00Z", offline_after_minutes: 5 });
const offline = parseAgentStatus({ state: "offline", last_seen: null });
const off = parseAgentStatus({ state: "not_configured" });
const { nextCheck } = await import("@/fm/faultTiming");
console.log("  who sees the agent:");
ck("owner and facility manager, never a guest",
   roleCan("owner", "viewAgent") && roleCan("ops", "viewAgent") && !roleCan("guest", "viewAgent") && !roleCan(null, "viewAgent"));
ck("nothing while the agent is not configured", !agentVisible(off));
ck("  ...nor before the first answer (no flash of 'offline')", !agentVisible(null));
ck("configured: shown, online or offline", agentVisible(online) && agentVisible(offline));
// the (i)'s Agent rows: an Agent configured, or one of its faults still open — never neither (2.496.360; one rule since
// architecture review scan 1, 2026-10-19 — it lived inside FaultTiming's JSX)
{
  const { agentSourcesShown } = await import("@/agent/agentView");
  const { agentOwned } = await import("@/fm/issueSource");
  ck("the Agent's sources are listed with an Agent, or with a fault of its still open — not with neither",
     agentSourcesShown(online, false) && agentSourcesShown(off, true) && agentSourcesShown(null, true)
     && !agentSourcesShown(off, false) && !agentSourcesShown(null, false));
  ck("  ...and \"the Agent's\" is one test of a record's stamp", agentOwned({ source: "vesta_agent" }) !== agentOwned({ source: "kiosk" }));
  ck("  ...which the (i), the mark and the fault's \"Opened by\" all ask",
     ["components/fm/FaultTiming.tsx", "components/fm/AgentMark.tsx", "fm/faultNotes.ts"].every((f) => /agentOwned\(/.test(src(f)) && !/AGENT_SOURCE/.test(src(f))));
}

console.log("\n  what the add-on sends is narrowed:");
ck("an unknown presence state reads as not configured (nothing shown)",
   parseAgentStatus({ state: "partying" }).state === "not_configured" && parseAgentStatus(null).state === "not_configured");

console.log("\n  wiring:");
const dash = src("pages/Dashboard.tsx");
// The agent's door is auth/doors' `agent` (2.496.245) — it was implied by
// whether Dashboard passed onOpenAgent. doors.mjs drives doorsFor by value.
ck("the agent's door is the one doors answer, from the role AND agentVisible",
   /const doors = useMemo\(\(\) => doorsFor\(role, agentVisible\), \[role, agentVisible\]\);/.test(dash));
ck("  ...and no window of its own any more (2.496.443)", !/AgentModal|shown\("agent"\)/.test(dash)
   && !/onOpenAgent/.test(dash + src("components/cockpit/CockpitModal.tsx")));
{
  // ONE icon for the agent (2.496.242): no robot button of its own — the
  // Cockpit's button becomes the robot, and the agent's window opens from the
  // Cockpit's footer, behind the same door (doors.agent; HUD hands both on).
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const hud = strip(src("components/hud/HUD.tsx"));
  const cockpit = strip((src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/CockpitOverview.tsx")));
  ck("the agent's presence is the Cockpit button's robot and dot only (no robot button of its own)",
     !/onOpenAgent/.test(hud));
  ck("  ...the Cockpit button shows the robot and the presence dot only with the agent's door, the ⚠ without",
     /\{doors\.agent \? <Bot size=\{24\} \/> : <TriangleAlert size=\{24\} \/>\}/.test(hud)
     && /\{doors\.agent && agentDot\}/.test(hud) && /const agentDot = <span className=\{`status-dot \$\{agentOnline/.test(hud) && !/onOpenAgent \?|onOpenAgent &&/.test(hud));
  ck("  ...and the Cockpit's footer has no 'VESTA Agent' (one footer: Close)",
     /<ModalFooter onClose=\{onClose\} \/>/.test(cockpit) && !/VESTA Agent/.test(cockpit));
}
const ctx = src("agent/AgentContext.tsx");
ck("a profile without viewAgent never fetches", /roleCan\(role, "viewAgent"\)/.test(ctx)
   && /const refresh = useCallback\(\(\) => \{\s*if \(!allowed\) return;/.test(ctx));
ck("rooms are shared only while the agent is visible", /\{visible && <RoomShare \/>\}/.test(ctx));

console.log("\n  sharing the rooms:");
const first = roomsToShare({ "light.b": "Hall", "light.a": "Living", "sensor.x": null }, null);
ck("the first time, the resolved rooms go out, empty ones dropped, in a stable order",
   first && JSON.stringify(first.rooms) === '{"light.a":"Living","light.b":"Hall"}');
ck("  ...and NOT again when nothing changed (a reload, the tablet waking)",
   roomsToShare({ "light.a": "Living", "light.b": "Hall" }, first.key) === null);
ck("  ...but again when a room moves", roomsToShare({ "light.a": "Kitchen", "light.b": "Hall" }, first.key) !== null);
ck("  ...and never an empty list", roomsToShare({ "sensor.x": null }, null) === null);
// each device's name and category as the Kiosk shows them, beside its room (architecture review scan 3, 2026-10-19:
// the add-on's villa model read the stored id-fallback label and the stored category itself)
{
  const { deviceViews } = await import("@/agent/agentView");
  const v = deviceViews({ "switch.pool_pump_switch": { label: "pool_pump_switch", type: "switch" },
                          "binary_sensor.front_door": { type: "binary_sensor" } },
                        { "switch.pool_pump_switch": { attributes: { friendly_name: "Pool pump" } },
                          "binary_sensor.front_door": { attributes: { friendly_name: "Front door", device_class: "door" } } });
  ck("a device is named and filed as the Kiosk shows it: a stored id-fallback label is no name, device_class counts",
     v["switch.pool_pump_switch"].name === "Pool pump" && v["binary_sensor.front_door"].category === "access_control", v);
  const shared = roomsToShare({ "switch.pool_pump_switch": "Pool" }, null, v);
  ck("  ...shared with its room, and again when a name changes",
     shared.names["switch.pool_pump_switch"] === "Pool pump" && shared.categories["binary_sensor.front_door"] === "access_control"
     && roomsToShare({ "switch.pool_pump_switch": "Pool" }, shared.key, v) === null
     && roomsToShare({ "switch.pool_pump_switch": "Pool" }, shared.key, { ...v, "switch.pool_pump_switch": { name: "Pump", category: "energy" } }) !== null);
}
const share = src("agent/RoomShare.tsx");
ck("RoomShare remembers what it sent in the device's storage, and asks roomsToShare",
   share.includes("roomsToShare(resolvedRooms, readString(LAST_SENT_KEY) ?? sentThisLoad, views)") && share.includes("writeString(LAST_SENT_KEY, share.key)"));
const marks = ["TicketsTab", "RecentWorkList", "SpendTab", "TodayTab", "ScheduleEditor", "SavedDocumentsList"]
  .filter((f) => !/<AgentMark record=\{/.test(src(`components/fm/${f}.tsx`)));
ck("every Facility list shows the 'by VESTA Agent' mark", marks.length === 0, marks);
// owner, 2026-10-11: the pills and when on ONE line right under the title, the same on every card — the mark, the
// room, the device are inside RecordMeta, never in the title row; a fault's history shows its notes, not
// "Open · date · VESTA Agent" lines that repeat that line
// the shared card (RecordCard, 2026-10-14) puts the `pills` it is given in RecordMeta: a card handing it its pills is fine
const cardPutsPillsInMeta = /<RecordMeta when=\{when\}>\{pills\}<\/RecordMeta>/.test(src("components/fm/RecordCard.tsx"));
const loose = ["TicketsTab", "RecentWorkList", "SpendTab", "TodayTab", "ScheduleEditor", "SavedDocumentsList"]
  .filter((f) => { const s = src(`components/fm/${f}.tsx`), m = s.indexOf("<AgentMark");
    if (cardPutsPillsInMeta && /pills=\{/.test(s) && s.lastIndexOf("pills={", m) > -1 && s.indexOf("<RecordCard") > -1) return false;
    return !(s.indexOf("<RecordMeta") > -1 && s.indexOf("<RecordMeta") < m && m < s.indexOf("</RecordMeta>")); });
ck("every Facility card: its pills and when on one line under the title (RecordMeta)", loose.length === 0, loose);
{
  // review 26: a step says what it is (agent-contract.json ticketUpdate) — the card read the agent's title changes by
  // their first words and took them for status steps. Driven through the functions, with a fixed clock.
  const { faultNoteLines, faultWhen } = await import("../../src/fm/faultNotes.ts");
  const at = (h) => `2026-10-10T${String(h).padStart(2, "0")}:00:00Z`;
  const stamp = (s) => s.slice(5, 13).replace("T", " ");
  const t = { id: "t", status: "in_progress", openedAt: at(1), title: "Motion battery at 7%", note: "Check: Replace the battery.",
    photoIds: [], updates: [
      { at: at(1), status: "open", by: "VESTA Agent", photoIds: [], title: "Motion battery at 9%" },
      { at: at(2), status: "in_progress", by: "Facility manager", who: "Fabien", note: "Battery ordered", photoIds: [] },
      { at: at(3), status: "in_progress", by: "VESTA Agent", kind: "retitled", title: "Motion battery at 8%", was: "Motion battery at 9%", photoIds: [] },
      { at: at(4), status: "in_progress", by: "VESTA Agent", kind: "retitled", title: "Motion battery at 7%", was: "Motion battery at 8%", photoIds: [] },
    ] };
  const lines = faultNoteLines(t, stamp);
  ck("a fault card: its check, each step's note with its date, and of its title changes only the latest, as \"Was: …\"",
     JSON.stringify(lines) === JSON.stringify(["Check: Replace the battery.", "Battery ordered (10-10 02)", "Was: Motion battery at 8% (renamed by VESTA Agent, 10-10 04)"]), lines);
  ck("  ...the title it has now is never repeated under it", !lines.some((l) => l.includes(t.title)), lines);
  const when = faultWhen(t, stamp);
  ck("\"in progress since\" is the person's, never the agent's title change", when === "Opened 10-10 01 by VESTA Agent · in progress since 10-10 02 by Fabien", when);
  const reading = { ...t, title: "Front door — part ordered", updates: [...t.updates,
    { at: at(5), status: "in_progress", by: "VESTA Agent", kind: "reading", title: "Front door unavailable", photoIds: [] }] };
  const renamedByHand = { ...t, title: "Motion battery — ordered", updates: [...t.updates,
    { at: at(5), status: "in_progress", by: "Facility manager", kind: "retitled", title: "Motion battery — ordered", was: "Motion battery at 7%", photoIds: [] }] };
  ck("a person's rename says what it was and who renamed it (review 29)",
     faultNoteLines(renamedByHand, stamp).at(-1) === "Was: Motion battery at 7% (renamed by Facility manager, 10-10 05)", faultNoteLines(renamedByHand, stamp));
  const reopenedRenamed = { ...t, status: "open", title: "Pump plug offline again", updates: [...t.updates,
    { at: at(6), status: "resolved", by: "VESTA Agent", note: "Cleared: the check no longer sees it.", photoIds: [] },
    { at: at(7), status: "open", by: "VESTA Agent", kind: "reopened", title: "Pump plug offline again",
      was: "Motion battery at 7%", note: "Back again.", photoIds: [] }] };
  ck("a reopening under a new title is a rename: \"Was:\" names the title it replaced (review 31)",
     faultNoteLines(reopenedRenamed, stamp).slice(-2).join(" | ") === "Back again. (10-10 07) | Was: Motion battery at 7% (renamed by VESTA Agent, 10-10 07)",
     faultNoteLines(reopenedRenamed, stamp));
  ck("a title a person wrote stays; the agent's reading shows under it as \"VESTA reads: …\"",
     faultNoteLines(reading, stamp).at(-1) === "VESTA reads: Front door unavailable (10-10 05)", faultNoteLines(reading, stamp));
  const old = { ...t, updates: [t.updates[1],
    { at: at(3), status: "in_progress", note: "Now: Motion battery at 8%", photoIds: [] },
    { at: at(4), status: "in_progress", note: "Now: Motion battery at 7%", photoIds: [] }] };
  ck("a history written before the kinds: its last \"Now: …\" is read as a title change, never as a status step",
     JSON.stringify(faultNoteLines(old, stamp).slice(1)) === JSON.stringify(["Battery ordered (10-10 02)", "Was: Motion battery at 8% (10-10 04)"])
     && faultWhen(old, stamp).endsWith("since 10-10 02 by Fabien"), [faultNoteLines(old, stamp), faultWhen(old, stamp)]);
  const reopened = { ...t, status: "open", updates: [...t.updates,
    { at: at(6), status: "resolved", by: "Facility manager", photoIds: [] },
    { at: at(7), status: "open", by: "Owner", kind: "reopened", note: "Still beeping", photoIds: [] }] };
  ck("a reopened fault says when and by whom", faultWhen(reopened, stamp) === "Opened 10-10 01 by VESTA Agent · reopened 10-10 07 by Owner", faultWhen(reopened, stamp));
  const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
  const kinds = /export type FmTicketUpdateKind = ([^;]+);/.exec(src("fm/fmTypes.ts"))?.[1].match(/"[^"]+"/g)?.map((k) => k.slice(1, -1));
  ck("the step kinds are the agreement's, the one list both sides read",
     JSON.stringify(kinds) === JSON.stringify(contract.ticketUpdate.kinds) && contract.ticketUpdate.kinds.includes("reopened"), kinds);
}
const faults = src("components/fm/TicketsTab.tsx");
ck("a fault card no longer repeats its history's status lines, and reads its notes and when through faultNotes",
   !/fm-timeline-head|fm-timeline-dot/.test(faults) && /notes=\{faultNoteLines\(t, localStamp\)\}/.test(faults)
   && /when=\{faultWhen\(t, localStamp\)\}/.test(faults) && !/startsWith\("Now: "\)/.test(faults));
{
  // what the button is: fm/deviceWork's, by value; that the Closed list draws it: the one wiring line
  const { closedActions, workRecord } = await import("@/fm/deviceWork");
  const [reopen, ...more] = closedActions(workRecord({ id: "r", status: "resolved" }));
  ck("a closed record offers \"Reopen\" (it is a fault again, on the Overview)",
     more.length === 0 && reopen?.label === "Reopen" && reopen.step.kind === "stage" && reopen.step.to === "open" && reopen.ids.join() === "r"
     && /<WorkButtons actions=\{closedActions\(workRecord\(t\)\)\}/.test(faults), reopen);
}

// a card's "Next check" with the Agent gone quiet: the proxy answers no cadence while it is offline (tests/agent-interface.py,
// architecture review 2026-10-19), and the card says who checks, never a number the Agent is no longer keeping
console.log("\n  the Agent's clock, only while it is online:");
{
  const alert = [{ source: "alert", check: "minutes" }];
  const quiet = parseAgentStatus({ state: "offline", last_seen: "2026-09-29T00:00:00Z", cadence: null });
  ck("offline: 'Next check: by the VESTA Agent' — no 'within 5 min' from a heartbeat days old",
     quiet.cadence === null && nextCheck(alert, quiet.cadence) === "Next check: by the VESTA Agent", nextCheck(alert, quiet.cadence));
  const awake = parseAgentStatus({ state: "online", last_seen: "2026-09-29T00:00:00Z", cadence: { checkMinutes: 5, nightlyAt: "02:00" } });
  ck("  ...online, its own number", nextCheck(alert, awake.cadence) === "Next check: within 5 min");
  // owner, 2026-10-20: the Agent reads every open night finding at every look and no longer says day times; an older
  // one that still does is harmless — its times are not read
  const old = parseAgentStatus({ state: "online", cadence: { checkMinutes: 5, nightlyAt: "02:00", dayChecksAt: ["08:00", "16:00"] } });
  ck("  ...an older Agent's day times are dropped: its timing is the two numbers",
     JSON.stringify(old.cadence) === '{"checkMinutes":5,"nightlyAt":"02:00"}', old.cadence);
  // owner, 2026-10-21: the Agent says when its look last started — the card's Next check counts from it
  const looked = parseAgentStatus({ state: "online", cadence: { checkMinutes: 5, nightlyAt: "02:00", lastLookAt: "2026-10-21T06:40:12+00:00" } });
  const garbled = parseAgentStatus({ state: "online", cadence: { checkMinutes: 5, nightlyAt: "02:00", lastLookAt: "soon" } });
  ck("  ...its last look is read when it is a moment, dropped otherwise",
     looked.cadence?.lastLookAt === "2026-10-21T06:40:12+00:00" && garbled.cadence && !("lastLookAt" in garbled.cadence), [looked.cadence, garbled.cadence]);
}

done("✅ the agent is shown to the right people, with its presence and its clock");
