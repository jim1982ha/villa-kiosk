// Talking to VESTA on the tablet (ticket 21 of "One inbox", owner 2026-10-28): the profile's conversation as the page
// holds it (a rewrite in place of the turn it rewrites, a withdrawn answer gone), the pinned thread and "Ask VESTA" only
// while VESTA runs, a question sent as words only (the add-on stamps who asks), and the window that opens it.
// Driven by value; placeholder words.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { h, draw } from "../consistency/screen.mjs";
import { elements, guardsOf, parseTsx, propText } from "../consistency/jsx.mjs";
import ts from "typescript";
import { readFileSync } from "node:fs";
const { parseTurn, askVesta, vestaRuns, NEW_CONVERSATION } = await import("@/messages/conversation");
const { mergeTurns, threadView, unanswered } = await import("@/messages/conversationModel");
const { START, screenReducer } = await import("@/pages/screen");
const { TurnLine } = await import("@/components/messages/VestaThread");

const turn = (seq, extra = {}) => ({ seq, key: `k${seq}`, from: "vesta", at: `2026-10-29T10:0${seq % 10}:00Z`, text: `T${seq}`,
  photos: [], page: null, gone: false, ...extra });
const J = JSON.stringify;

console.log("  a turn as the add-on sends it:");
ck("read whole: who said it, when, its words, its pictures and page",
   J(parseTurn({ seq: 3, key: "turn:9", from: "vesta", at: "2026-10-29T10:00:00Z", text: "On.", photos: ["a.jpg", 4],
                 page: "p1" })) === J({ seq: 3, key: "turn:9", from: "vesta", at: "2026-10-29T10:00:00Z", text: "On.",
                                         photos: ["a.jpg"], page: "p1", gone: false }));
ck("  ...a withdrawn one says so; one with no number, key or speaker is no turn",
   parseTurn({ seq: 1, key: "k", from: "vesta", gone: true })?.gone === true
   && [{ key: "k", from: "vesta" }, { seq: 1, from: "vesta" }, { seq: 1, key: "k", from: "admin" }, null, "x"]
     .every((r) => parseTurn(r) === null));

console.log("\n  what the page holds after a read:");
const held = [turn(1, { key: "ask:1", from: "person" }), turn(2, { key: "turn:5", text: "Being prepared" })];
const after = mergeTurns(held, [turn(3, { key: "turn:5", text: "The report" })], false);
ck("a rewrite REPLACES the turn of its key, in its new place (the \"being prepared\" answer becomes its result)",
   J(after.map((t) => [t.key, t.text])) === J([["ask:1", "T1"], ["turn:5", "The report"]]), after);
ck("  ...an older copy never comes back over a newer one",
   mergeTurns(after, [turn(2, { key: "turn:5", text: "Being prepared" })], false).at(-1).text === "The report");
ck("  ...a full read is everything kept: nothing held before stays",
   J(mergeTurns(held, [turn(7)], true).map((t) => t.seq)) === J([7]));
ck("  ...what the add-on no longer keeps (below its first, or not among its numbers) goes",
   J(mergeTurns(held, [], false, 2).map((t) => t.seq)) === J([2]) && J(mergeTurns(held, [], false, 0, [1]).map((t) => t.seq)) === J([1]));

console.log("\n  what the conversation shows:");
ck("offered only while VESTA runs (owner: nothing dead on screen)",
   threadView(held, true).shown === true && threadView(held, false).shown === false);
ck("a withdrawn answer is not a line",
   J(threadView([...held, turn(4, { gone: true })], true).lines.map((t) => t.seq)) === J([1, 2]));
const AT = Date.parse("2026-10-29T10:01:00Z");
const q = [turn(1, { from: "person" })];
ck("a question VESTA never collected says so, once the add-on no longer keeps it; never before, never once answered",
   unanswered(q, AT + 11 * 60_000) && !unanswered(q, AT + 60_000)
   && !unanswered([...q, turn(2)], AT + 60 * 60_000) && !unanswered([], AT));
ck("a read says VESTA runs only when the add-on says online",
   vestaRuns({ said: { vesta: "online" } }) && !vestaRuns({ said: { vesta: "offline" } }) && !vestaRuns({ said: {} }));

globalThis.window = globalThis.window ?? { location: { pathname: "/" } };   // the add-on's own address (no Ingress prefix)
console.log("\n  a question asked:");
const sent = [];
const answering = (status) => async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: status === 200, status }; };
ck("sent as WORDS ONLY: no profile, no role (the add-on stamps who asks)",
   (await askVesta("Is the pump on?", answering(200))) === "sent" && J(sent[0].body) === J({ text: "Is the pump on?" })
   && sent[0].url.endsWith("vesta-ask"), sent);
ck("  ...VESTA not running, too many at once, anything else: each its own outcome",
   (await askVesta("x", answering(503))) === "offline" && (await askVesta("x", answering(429))) === "busy"
   && (await askVesta("x", answering(500))) === "failed"
   && (await askVesta("x", async () => { throw new Error("offline"); })) === "failed");
ck("\"New conversation\" is Telegram's /new, read by the Agent's own gate", NEW_CONVERSATION === "/new");

console.log("\n  drawn:");
const answer = turn(6, { text: "The pump is on.", photos: ["a.jpg"], page: "p1" });
const owner = draw(h(TurnLine, { turn: answer, canOpenPage: true }));
const guest = draw(h(TurnLine, { turn: answer, canOpenPage: false }));
ck("an answer: VESTA's words, its picture and its page for a profile served pages",
   owner.includes("The pump is on.") && owner.includes("announcement-photo/a.jpg") && owner.includes("Open the page"), owner);
ck("  ...no page offered to a profile the add-on serves none (a guest)", !guest.includes("Open the page"));
ck("  ...the person's own question reads as theirs",
   draw(h(TurnLine, { turn: turn(1, { from: "person" }), canOpenPage: false })).includes("You"));

// architecture review 2026-10-29 #4: ONE drawing of a VESTA message's page, wherever it shows
const { execSync } = await import("node:child_process");
const pageLinks = execSync("grep -rl '/> Open the page' src --include=*.tsx", { cwd: new URL("../..", import.meta.url).pathname })
  .toString().trim().split("\n");
ck("\"Open the page\" is drawn in ONE place (PageLink), the conversation's answers and the Inbox's reports alike",
   pageLinks.length === 1 && pageLinks[0].endsWith("AnnouncementContent.tsx"), pageLinks);

console.log("\n  hidden without VESTA, wherever it shows:");
const hud = parseTsx("components/hud/HUD.tsx");
const dash = parseTsx("pages/Dashboard.tsx");
// owner, 2026-10-29: "a dedicated icon in the top bar, next to the robot … the same graphical components as any other modal"
const askButton = elements(hud, "button").find((b) => propText(b, "onClick") === "onAskVesta");
ck("the top bar's VESTA button only while VESTA runs, every profile (no door asked)",
   !!askButton && guardsOf(askButton).includes("thread.shown") && !guardsOf(askButton).some((g) => g.includes("doors")),
   askButton && guardsOf(askButton));
const win = elements(dash, "VestaWindow");
ck("  ...it opens VESTA's own window, mounted as every window is (shown)",
   win.length === 1 && guardsOf(win[0]).includes('shown("vesta")'), win[0] && guardsOf(win[0]));
const vesta = parseTsx("components/messages/VestaThread.tsx");
ck("  ...drawn in the windows' own frame: Window, its header and Close",
   elements(vesta, "Window").length === 1 && elements(vesta, "ModalFooter").length === 1);
ck("  ...and no longer pinned in the Cockpit's Messages",
   !/VestaThread|VestaWindow|useConversation/.test(
     readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8")));
const askRow = elements(hud, "button").find((b) => (propText(b, "onClick") || "").includes("onAskVesta"));
ck("the phone's \"Ask VESTA\" row only while VESTA runs", !!askRow && guardsOf(askRow).includes("thread.shown"));
// the robot's one decision, read through the compiler's tree (whatever its layout), and every robot drawn by it
const declared = (tree, name) => {
  let found = null;
  const visit = (n) => { if (ts.isVariableDeclaration(n) && n.name.getText() === name) found = n.initializer.getText().replace(/\s+/g, " "); ts.forEachChild(n, visit); };
  visit(tree);
  return found;
};
const robotIcons = elements(hud, "Bot").map((b) => b.parent?.parent?.getText?.() ?? "");
// one reading of "VESTA runs" for the robot and the VESTA button (architecture review 2026-10-29 #5)
ck("the robot only while VESTA runs, by the VESTA button's own reading (robot = doors.agent && thread.shown)",
   declared(hud, "robot") === "doors.agent && thread.shown" && robotIcons.length >= 2
   && robotIcons.every((t) => t.startsWith("{robot ?")), [declared(hud, "robot"), robotIcons]);

console.log("\n  \"Ask VESTA\" on screen:");
const GUEST = { settings: false, facility: false, agent: false, updates: false };
const opened = screenReducer(START, { type: "openWindow", window: "vesta" }, GUEST);
ck("VESTA's window starts closed, opens for a guest too, and closes", START.windows.vesta === false && opened.windows.vesta === true
   && screenReducer(opened, { type: "closeWindow", window: "vesta" }, GUEST).windows.vesta === false);
done("✅ talking to VESTA on the tablet: its thread, its question, hidden without VESTA, by value");
