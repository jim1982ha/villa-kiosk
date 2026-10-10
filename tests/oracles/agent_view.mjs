// The VESTA Agent on the Kiosk's screen (docs/agent-integration/PLAN.md A8):
// who sees it, when its buttons are offered, what the top-bar count counts,
// and that what the add-on sends is narrowed before it is rendered.
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
const { agentVisible, buttonsShown, awaitingAnswer, answerLine, roomsToShare, clearNeedsConfirm, settledIds } = await import("@/agent/agentView");
const { parseAgentMessages, parseAgentStatus } = await import("@/agent/agentApi");

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const online = parseAgentStatus({ state: "online", last_seen: "2026-09-29T00:00:00Z", offline_after_minutes: 5 });
const offline = parseAgentStatus({ state: "offline", last_seen: null });
const off = parseAgentStatus({ state: "not_configured" });
const msg = (over = {}) => parseAgentMessages({ messages: [{
  id: "msg_1", title: "Pump", kind: "recommendation", severity: "warning", state: "open",
  buttons: [{ id: "approve", label: "Approve" }], can_answer: true, created_at: "2026-09-29T00:00:00Z", ...over,
}] })[0];

console.log("  who sees the agent:");
ck("owner and facility manager, never a guest",
   roleCan("owner", "viewAgent") && roleCan("ops", "viewAgent") && !roleCan("guest", "viewAgent") && !roleCan(null, "viewAgent"));
ck("nothing while the agent is not configured", !agentVisible(off));
ck("  ...nor before the first answer (no flash of 'offline')", !agentVisible(null));
ck("configured: shown, online or offline", agentVisible(online) && agentVisible(offline));

console.log("\n  buttons:");
ck("the server says answerable (open, allowed, agent online): offered", buttonsShown(msg()));
ck("the server says not (e.g. the agent is offline): hidden — the page adds no rule of its own",
   !buttonsShown(msg({ can_answer: false })));
ck("no buttons on the message: nothing offered", !buttonsShown(msg({ buttons: [] })));
ck("  ...buttonsShown takes the message alone (2.496.251: presence is the proxy's half, tests/agent-interface.py)",
   buttonsShown.length === 1 && awaitingAnswer.length === 1);
ck("the top-bar count is exactly the messages whose buttons are offered",
   awaitingAnswer([msg(), msg({ id: "msg_2", can_answer: false }), msg({ id: "msg_3" })]) === 2);

console.log("\n  one poll (readAgent):");
{
  const { readAgent } = await import("@/agent/agentApi");
  const calls = [];
  const io = (status, messages) => ({
    status: async () => { calls.push("status"); return status; },
    messages: async () => { calls.push("messages"); return messages; },
  });
  const m1 = parseAgentMessages({ messages: [{ id: "msg_1", title: "t", state: "open", can_answer: true, buttons: [] }] });
  calls.length = 0; let r = await readAgent(io(null, m1));
  ck("unreachable: keep the last status AND messages, and do not ask for messages",
     r.status === null && r.messages === null && calls.join() === "status");
  calls.length = 0; r = await readAgent(io(off, m1));
  ck("not configured: messages emptied, never asked for", r.status === off && Array.isArray(r.messages) && r.messages.length === 0 && calls.join() === "status");
  calls.length = 0; r = await readAgent(io(online, m1));
  ck("configured: status, then messages", r.status === online && r.messages === m1 && calls.join() === "status,messages");
  calls.length = 0; r = await readAgent(io(offline, null));
  ck("  ...a failed messages read keeps the panel as it was", r.status === offline && r.messages === null);
}
const answered = msg({ state: "answered", can_answer: false,
  answer: { button_id: "approve", profile: "ops", at: "2026-09-29T01:00:00Z" } });
ck("an answer reads who and which button, by its label",
   answerLine(answered, (p) => (p === "ops" ? "Facility manager" : p)) === "Answered by Facility manager · Approve");

console.log("\n  clearing messages (2.496.239):");
const expired = msg({ id: "msg_4", state: "expired", can_answer: false });
const plain = msg({ id: "msg_5", buttons: [] });
ck("an open question (buttons) asks before it is cleared — the agent would never get its answer",
   clearNeedsConfirm(msg()) && clearNeedsConfirm(msg({ can_answer: false })));
ck("  ...answered, expired or plain messages clear at once",
   !clearNeedsConfirm(answered) && !clearNeedsConfirm(expired) && !clearNeedsConfirm(plain));
ck("'Clear answered' takes exactly the answered and expired ones, never an open one",
   settledIds([msg(), answered, expired, plain]).join() === [answered.id, expired.id].join());
ck("the modal offers it only when there is something to clear, and asks through clearNeedsConfirm",
   /settled\.length > 0/.test(src("components/agent/AgentModal.tsx")) && /clearNeedsConfirm\(m\)/.test(src("components/agent/AgentModal.tsx")));

console.log("\n  what the add-on sends is narrowed:");
const odd = parseAgentMessages({ messages: [
  { id: "a", title: "ok", severity: "apocalyptic", kind: "spam", buttons: [{ label: "no id" }, { id: "b", label: "B" }], entities: ["light.x", 3] },
  { id: "", title: "no id" }, null, "text",
] });
ck("a message without an id, or not an object, is dropped", odd.length === 1, odd.length);
ck("unknown severity and kind fall back to info / message", odd[0].severity === "info" && odd[0].kind === "message");
ck("a button without an id and a non-string entity are dropped",
   odd[0].buttons.length === 1 && odd[0].entities.length === 1);
ck("can_answer is true only when the server says exactly true",
   odd[0].canAnswer === false && msg({ can_answer: "true" }).canAnswer === false && msg({ can_answer: 1 }).canAnswer === false);
ck("an unknown presence state reads as not configured (nothing shown)",
   parseAgentStatus({ state: "partying" }).state === "not_configured" && parseAgentStatus(null).state === "not_configured");

console.log("\n  wiring:");
const dash = src("pages/Dashboard.tsx");
// The agent's door is auth/doors' `agent` (2.496.245) — it was implied by
// whether Dashboard passed onOpenAgent. doors.mjs drives doorsFor by value.
ck("the agent's door is the one doors answer, from the role AND agentVisible",
   /const doors = useMemo\(\(\) => doorsFor\(role, agentVisible\), \[role, agentVisible\]\);/.test(dash));
ck("  ...and so is the window (shown: open AND allowed, pages/surfaces)", /\{shown\("agent"\) && \(/.test(dash));
{
  // ONE icon for the agent (2.496.242): no robot button of its own — the
  // Cockpit's button becomes the robot, and the agent's window opens from the
  // Cockpit's footer, behind the same door (doors.agent; HUD hands both on).
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const hud = strip(src("components/hud/HUD.tsx"));
  const cockpit = strip((src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/CockpitOverview.tsx")));
  ck("the top bar opens the agent from nowhere but the Cockpit (no robot button of its own)",
     !/onOpenAgent/.test(hud)
     && /doors=\{doors\}\s*onOpenAgent=\{\(\) => openSurface\("agent"\)\}/.test(src("pages/Dashboard.tsx")));
  ck("  ...the Cockpit button shows the robot and the presence dot only with the agent's door, the ⚠ without",
     /\{doors\.agent \? <Bot size=\{24\} \/> : <TriangleAlert size=\{24\} \/>\}/.test(hud)
     && /\{doors\.agent && agentDot\}/.test(hud) && /const agentDot = <span className=\{`status-dot \$\{agentOnline/.test(hud) && !/onOpenAgent \?|onOpenAgent &&/.test(hud));
  ck("  ...and the Cockpit's footer offers 'VESTA Agent' only with that door",
     /leading=\{shownTab === "overview" && doors\.agent \? \(\s*<button className="btn ghost" onClick=\{\(\) => \{ onClose\(\); onOpenAgent\(\); \}\}/.test(cockpit)
     && /VESTA Agent\{agentWaiting > 0/.test(cockpit) && /\) : undefined\} \/>/.test(cockpit));
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
const share = src("agent/RoomShare.tsx");
ck("RoomShare remembers what it sent in the device's storage, and asks roomsToShare",
   share.includes("roomsToShare(resolvedRooms, readString(LAST_SENT_KEY)") && share.includes("writeString(LAST_SENT_KEY, share.key)"));
const marks = ["FaultsTab", "RecentWorkList", "SpendTab", "TodayTab", "ScheduleEditor", "SavedDocumentsList"]
  .filter((f) => !/<AgentMark record=\{/.test(src(`components/fm/${f}.tsx`)));
ck("every Facility list shows the 'by VESTA Agent' mark", marks.length === 0, marks);
// owner, 2026-10-11: the pills and when on ONE line right under the title, the same on every card — the mark, the
// room, the device are inside RecordMeta, never in the title row; a fault's history shows its notes, not
// "Open · date · VESTA Agent" lines that repeat that line
const loose = ["FaultsTab", "RecentWorkList", "SpendTab", "TodayTab", "ScheduleEditor", "SavedDocumentsList"]
  .filter((f) => { const s = src(`components/fm/${f}.tsx`), m = s.indexOf("<AgentMark");
    return !(s.indexOf("<RecordMeta") > -1 && s.indexOf("<RecordMeta") < m && m < s.indexOf("</RecordMeta>")); });
ck("every Facility card: its pills and when on one line under the title (RecordMeta)", loose.length === 0, loose);
ck("a fault card no longer repeats its history's status lines",
   !/fm-timeline-head|fm-timeline-dot/.test(src("components/fm/FaultsTab.tsx")) && /RecordNotes notes=\{\[t\.note, \.\.\.\(t\.updates/.test(src("components/fm/FaultsTab.tsx")));

console.log("\n  the agreement's sample, as the app reads it (2.496.234):");
{
  // tests/agent-interface.py proves the proxy produces exactly this shape;
  // here the app must read every field of it — none falling back to a default.
  const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
  const want = contract.samples.messagesView.messages[0];
  const [m] = parseAgentMessages(contract.samples.messagesView);
  ck("the sample view parses to one message", !!m);
  ck("  ...every field the proxy sends arrives", m && m.kind === want.kind && m.severity === want.severity && m.state === want.state
     && m.title === want.title && m.body === want.body && m.buttons.length === want.buttons.length && m.canAnswer === want.can_answer
     && m.createdAt === want.created_at, JSON.stringify(m));
  ck("  ...every kind, severity and state in the agreement is one the app keeps (not folded to a default)",
     contract.message.kinds.every((k) => parseAgentMessages({ messages: [{ ...want, kind: k }] })[0].kind === k)
     && contract.message.severities.every((v) => parseAgentMessages({ messages: [{ ...want, severity: v }] })[0].severity === v)
     && contract.message.states.every((v) => parseAgentMessages({ messages: [{ ...want, state: v }] })[0].state === v));
}

done("✅ the agent is shown to the right people, with the right buttons");
