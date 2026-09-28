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
const { agentVisible, buttonsShown, awaitingAnswer, answerLine } = await import("@/agent/agentView");
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
ck("an open message this profile may answer, agent online: offered", buttonsShown(msg(), online));
ck("agent offline: hidden (nobody would act on the answer)", !buttonsShown(msg(), offline));
ck("the server says this profile may not: hidden", !buttonsShown(msg({ can_answer: false }), online));
ck("no buttons on the message: nothing offered", !buttonsShown(msg({ buttons: [] }), online));
ck("the top-bar count is exactly the messages whose buttons are offered",
   awaitingAnswer([msg(), msg({ id: "msg_2", can_answer: false }), msg({ id: "msg_3" })], online) === 2
   && awaitingAnswer([msg()], offline) === 0);
const answered = msg({ state: "answered", can_answer: false,
  answer: { button_id: "approve", profile: "ops", at: "2026-09-29T01:00:00Z" } });
ck("an answer reads who and which button, by its label",
   answerLine(answered, (p) => (p === "ops" ? "Facility manager" : p)) === "Answered by Facility manager · Approve");

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
ck("the top-bar button exists only when the agent is visible",
   /onOpenAgent=\{agentVisible \? /.test(dash));
ck("  ...and so does the window", /\{agentOpen && agentVisible && \(/.test(dash));
const ctx = src("agent/AgentContext.tsx");
ck("a profile without viewAgent never fetches", /roleCan\(role, "viewAgent"\)/.test(ctx)
   && /const refresh = useCallback\(\(\) => \{\s*if \(!allowed\) return;/.test(ctx));
ck("rooms are shared only while the agent is visible", /\{visible && <RoomShare \/>\}/.test(ctx));
const marks = ["FaultsTab", "RecentWorkList", "SpendTab", "TodayTab", "ScheduleEditor", "SavedDocumentsList"]
  .filter((f) => !/<AgentMark record=\{/.test(src(`components/fm/${f}.tsx`)));
ck("every Facility list shows the 'by VESTA Agent' mark", marks.length === 0, marks);

done("✅ the agent is shown to the right people, with the right buttons");
