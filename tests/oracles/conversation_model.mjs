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
const { parseTurn, askVesta, vestaRuns, NEW_CONVERSATION, SPOKEN_WAITING } = await import("@/messages/conversation");
const { mergeTurns, threadView, unanswered, arrivedSpeech, playsAloud, followOf } = await import("@/messages/conversationModel");
const { START, screenReducer } = await import("@/pages/screen");
const { TurnLine } = await import("@/components/messages/VestaThread");
const AGENT_CONTRACT = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));

const turn = (seq, extra = {}) => ({ seq, key: `k${seq}`, from: "vesta", at: `2026-10-29T10:0${seq % 10}:00Z`, text: `T${seq}`,
  photos: [], page: null, gone: false, buttons: [], answers: null, typing: false, voice: false, speech: null, ...extra });
const J = JSON.stringify;

console.log("  a turn as the add-on sends it:");
ck("read whole: who said it, when, its words, its pictures and page",
   J(parseTurn({ seq: 3, key: "turn:9", from: "vesta", at: "2026-10-29T10:00:00Z", text: "On.", photos: ["a.jpg", 4],
                 page: "p1", buttons: [{ label: "Continue", kind: "c", id: "k1" }, { label: "x" }], answers: 7 }))
   === J({ seq: 3, key: "turn:9", from: "vesta", at: "2026-10-29T10:00:00Z", text: "On.", photos: ["a.jpg"], page: "p1",
           gone: false, buttons: [{ label: "Continue", command: "c:k1", acts: false }], answers: 7, typing: false,
           voice: false, speech: null }));
ck("  ...an answer said aloud names its sound (ticket 24); anything else is none",
   parseTurn({ seq: 5, key: "turn:5", from: "vesta", text: "On.", speech: "ab.mp3" })?.speech === "ab.mp3"
   && [3, "", null].every((v) => parseTurn({ seq: 5, key: "turn:5", from: "vesta", speech: v })?.speech === null));
ck("  ...a spoken question says so (hold to talk), with no words until VESTA heard them",
   parseTurn({ seq: 4, key: "ask:4", from: "person", voice: true })?.voice === true
   && parseTurn({ seq: 4, key: "ask:4", from: "person", voice: true })?.text === "");
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
console.log("\n  VESTA's buttons on the tablet (ticket 22 of \"One inbox\"; owner, 2026-10-29: \"consistently\", \"DRY\"):");
const { vestaButtons, offeredButtons, pressOf, parseVestaMessage } = await import("@/messages/announcements");
const { answersOf } = await import("@/messages/conversationModel");
const approval = parseVestaMessage({ seq: 4, key: "thread:ap1", title: "Approval request", body: "Turn on the pool light?",
  buttons: [{ label: "Approve", kind: "a", id: "ap1:y" }, { label: "Refuse", kind: "a", id: "ap1:n" }] });
ck("a VESTA message carries its buttons, each with its kind's rules from the agreement (an approval acts, and asks first)",
   J(approval.buttons.map((b) => [b.label, b.command, b.acts, !!b.confirm])) === J([["Approve", "a:ap1:y", true, true],
     ["Refuse", "a:ap1:n", true, true]]));
ck("  ...one that acts is never offered to a guest; one that does not (Continue), and the villa's own (Unlock), to all",
   offeredButtons(approval.buttons, false).length === 0 && offeredButtons(approval.buttons, true).length === 2
   && offeredButtons(vestaButtons([{ label: "Continue", kind: "c", id: "k" }]), false).length === 1
   && offeredButtons([{ label: "Unlock", command: "/unlock" }], false).length === 1);
const alertCard = vestaButtons([{ label: "Done", kind: "i", id: "9:done" }, { label: "Need help", kind: "i", id: "9:need_help" }]);
ck("  ...an alert's Done · Need help, both offered to who may act (owner, 2026-10-29: the same wherever it shows)",
   J(offeredButtons(alertCard, true).map((b) => b.label)) === J(["Done", "Need help"]));
ck("  ...a kind the agreement does not know acts (never offered to a guest)", vestaButtons([{ label: "X", kind: "z", id: "1" }])[0].acts === true);
const doors = [];
const knock = async (url, init) => { doors.push([url, JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ press: 12 }) }; };
const vestaPress = await pressOf(approval, "a:ap1:y", knock);
await pressOf({ seq: 1, key: "run-1", buttons: [] }, "/unlock", knock);
await pressOf({ seq: 2, key: "turn:9", buttons: [], feed: "turn" }, "c:k1", knock);
ck("one door per kind of record: VESTA's messages and turns to VESTA, the villa's own to its press event",
   J(doors.map(([u, b]) => [u.split("/").pop(), b.key])) === J([["vesta-press", "thread:ap1"], ["announcement-press", "run-1"],
     ["vesta-press", "turn:9"]]) && vestaPress.outcome === "sent" && vestaPress.press === 12, doors);
// owner, 2026-10-29: the approval's notice "replaced by the other notifications about a sensor being triggered"; after
// Refuse, its notice still read "Approval request · Turn on Indoor Top?"
const { noticeStep, NO_NOTICE } = await import("@/messages/noticeModel");
const { announcementWords } = await import("@/messages/messagesModel");
const { AnnouncementNoticeView } = await import("@/components/hud/AnnouncementNotice");
const SHOW = { fullScreenFor: [], ringsFullScreen: false, ringShownForS: 60 };
const motion = { seq: 50, at: "2026-10-29T10:00:00Z", title: "Motion detected", to: "", text: "Outdoor 2F", status: "",
  photo: null, key: null, buttons: [] };
const refused = { ...approval, seq: 5, buttons: [], status: "Refused on 29/10/2026 13:50 (JM). Nothing was done." };
let shown = [{ type: "arrived", announcement: approval, rewrite: false, settings: SHOW },
  { type: "arrived", announcement: motion, rewrite: false, settings: SHOW }].reduce(noticeStep, NO_NOTICE);
ck("an approval's notice is NOT replaced by a sensor's coming after it: both show, each its own time",
   shown.shown.length === 2 && shown.shown[0].announcement === approval && shown.shown[1].announcement === motion);
shown = noticeStep(shown, { type: "arrived", announcement: refused, rewrite: true, settings: SHOW });
ck("  ...decided, its rewrite takes its place and says the decision, not the request again",
   shown.shown.length === 2 && shown.shown[1].announcement === refused && shown.steps.length === 1
   && draw(h(AnnouncementNoticeView, { announcement: refused, step: true })).includes("Approval request · Refused on 29/10/2026 13:50 (JM)")
   && announcementWords(refused).line === "Turn on the pool light?");
const { pressOrAsk } = await import("@/components/messages/AnnouncementContent");
const asked = [], sentNow = [];
pressOrAsk(approval.buttons[0], (q) => asked.push(q), (c) => sentNow.push(c));
pressOrAsk({ label: "Continue", command: "c:k1" }, (q) => asked.push(q), (c) => sentNow.push(c));
ck("an approval asks first in the one confirmation box (owner, 2026-10-28), sent only once confirmed; Continue at once",
   asked.length === 1 && asked[0].confirmLabel === "Approve" && J(sentNow) === J(["c:k1"])
   && (asked[0].run(), J(sentNow) === J(["c:k1", "a:ap1:y"])));
const answered = [turn(5, { key: "press:12", text: "Approved.", answers: 12 }), turn(6)];
ck("VESTA's short answer to a press is shown under its button, never as a line of the conversation",
   answersOf(answered).get(12) === "Approved." && J(threadView(answered, true).lines.map((t) => t.seq)) === J([6]));

console.log("\n  VESTA answering (owner, 2026-10-29: \"a running indicator in the chat response bubble\"):");
const { vestaWorking } = await import("@/messages/conversationModel");
const { WorkingBubble } = await import("@/components/messages/VestaThread");
const T0 = Date.parse("2026-10-29T10:01:00Z");
const asking = [turn(1, { from: "person" })];
const saying = [...asking, turn(2, { key: "typing:owner", typing: true, at: "2026-10-29T10:01:00Z" })];
const answeredNow = [...asking, turn(3, { text: "Done." }), turn(4, { key: "typing:owner", typing: true, gone: true })];
ck("the dots show from the moment a question is sent (before VESTA read it), and while VESTA says it is answering",
   vestaWorking(threadView(asking, true), T0 + 5_000) && vestaWorking(threadView(saying, true), T0 + 60_000)
   && threadView(saying, true).lines.length === 1);
ck("  ...and go once it answered and stopped, or when it stopped saying so for too long (a VESTA that stopped)",
   !vestaWorking(threadView(answeredNow, true), T0 + 5_000)
   && !vestaWorking(threadView([turn(3), turn(4, { key: "typing:owner", typing: true, at: "2026-10-29T10:01:00Z" })], true),
     T0 + 10 * 60_000));
const bubble = draw(h(WorkingBubble));
ck("  ...three dots in VESTA's bubble, said to a screen reader", (bubble.match(/vesta-working-dot/g) || []).length === 3
   && bubble.includes('aria-label="VESTA is answering"') && bubble.includes("vesta-turn answered"), bubble);
ck("  ...drawn by the conversation exactly when the rule says", elements(parseTsx("components/messages/VestaThread.tsx"),
   "WorkingBubble").some((e) => guardsOf(e).includes("vestaWorking(thread, Date.now())")));

console.log("\n  a question asked:");
const sent = [];
const answering = (status) => async (url, init) => {
  sent.push({ url, type: init.headers["Content-Type"], measure: init.headers["X-Recording"], body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
  return { ok: status === 200, status };
};
ck("sent as WORDS ONLY: no profile, no role (the add-on stamps who asks)",
   (await askVesta("Is the pump on?", answering(200))) === "sent" && J(sent[0].body) === J({ text: "Is the pump on?" })
   && sent[0].url.endsWith("vesta-ask"), sent);
ck("  ...VESTA not running, too many at once, anything else: each its own outcome",
   (await askVesta("x", answering(503))) === "offline" && (await askVesta("x", answering(429))) === "busy"
   && (await askVesta("x", answering(500))) === "failed"
   && (await askVesta("x", async () => { throw new Error("offline"); })) === "failed");
const wav = new Blob([new Uint8Array(44)], { type: "audio/wav" });
sent.length = 0;
ck("a spoken question goes to the same door as its recording, as audio/wav, nothing else with it",
   (await askVesta(wav, answering(200))) === "sent" && sent[0].url.endsWith("vesta-ask") && sent[0].type === "audio/wav"
   && sent[0].body === wav, sent);
sent.length = 0;
const m = { heldMs: 1500, openMs: 1400, rate: 48000, micRate: 48000, blocks: 40, missing: 0, peakDb: -20 };
await askVesta(wav, answering(200), m);
await askVesta("typed", answering(200), m);
ck("  ...with what the page measured of it (X-Recording, the add-on's log line); a typed one never",
   sent[0].measure === "heldMs=1500;openMs=1400;rate=48000;micRate=48000;blocks=40;missing=0;peakDb=-20"
   && sent[1].measure === undefined, sent);
ck("  ...and its outcomes are a typed question's", (await askVesta(wav, answering(503))) === "offline"
   && (await askVesta(wav, answering(429))) === "busy");
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
ck("an answer said aloud offers Listen, given the page's speaker; one in words only does not",
   draw(h(TurnLine, { turn: turn(4, { speech: "ab.mp3" }), canOpenPage: false, onListen: () => {} })).includes("Listen")
   && !draw(h(TurnLine, { turn: turn(4), canOpenPage: false, onListen: () => {} })).includes("Listen"));
// owner, 2026-10-30: after a spoken question "the chat section is not scrolling automatically where the typing dots
// are appearing", and an answer should get the focus: the conversation follows each step, an answer from its start
{
  const asked = turn(7, { from: "person", key: "ask:7", voice: true, text: "" });
  const heard = { ...asked, text: "Is the pump on?" };
  const view = (lines) => ({ lines, typingAt: null, online: true });
  const k = (lines, w) => followOf(view(lines), w).key;
  ck("the conversation follows a spoken question's words coming in, and the dots appearing",
     k([asked], false) !== k([heard], false) && k([heard], false) !== k([heard], true)
     && followOf(view([heard]), true).to === "end", [k([asked], false), k([heard], false), k([heard], true)]);
  const answer = turn(8, { key: "turn:8", text: "Yes, it is on." });
  const f = followOf(view([heard, answer]), false);
  ck("  ...and brings VESTA's answer into view from its start", f.to === "answer" && f.answer === "turn:8"
     && f.key !== k([heard], true), f);
  ck("  ...the component scrolls to that answer's line by its key (data-turn), else to the end",
     /data-turn=\{turn\.key\}/.test(readFileSync(new URL("../../src/components/messages/VestaThread.tsx", import.meta.url), "utf8"))
     && /block: follow\.to === "answer" \? "start" : "end"/.test(readFileSync(new URL("../../src/components/messages/VestaThread.tsx", import.meta.url), "utf8")));
}
// owner, 2026-10-30: "make sure the user can stop the voice streaming / replay, by showing a stop button instead of
// the Play button": the line whose sound is being said shows Stop, never Listen beside it; any other shows Listen
{
  let stopped = 0;
  const saying = draw(h(TurnLine, { turn: turn(4, { speech: "ab.mp3" }), canOpenPage: false, onListen: () => {},
    playing: true, onStop: () => { stopped += 1; } }));
  ck("an answer being said shows Stop in Listen's place", saying.includes('aria-label="Stop"') && !saying.includes('aria-label="Listen"'), saying);
  const stopButton = elements(parseTsx("components/messages/VestaThread.tsx"), "button")
    .find((b) => (propText(b, "aria-label") || "").includes("Stop"));
  ck("  ...Stop stops the page's one speaker (messages/speaker.stop, the provider's stopListening)",
     !!stopButton && /onClick=\{onStop\}/.test(stopButton.getText())
     && /playing=\{!!t\.speech && t\.speech === playing\} onStop=\{stopListening\}/.test(
       readFileSync(new URL("../../src/components/messages/VestaThread.tsx", import.meta.url), "utf8")), stopped);
}
const listen = elements(parseTsx("components/messages/VestaThread.tsx"), "button")
  .find((b) => (propText(b, "className") || "").includes("vesta-turn-listen") && (propText(b, "aria-label") || "").includes("Listen"));
ck("  ...Listen hands the turn's own sound to the page's speaker (messages/speaker: played from the press, tests/oracles/speaker.mjs)",
   (propText(listen, "onClick") || "").includes("onListen(turn.speech)"), propText(listen, "onClick"));
const provider = readFileSync(new URL("../../src/messages/ConversationContext.tsx", import.meta.url), "utf8");
ck("  ...the provider tells the one speaker what happened: a spoken question sent, each read, a profile gone",
   /new Speaker\(\{ play: playSpeech, stop: stopSpeech, sound: fetchSpeech/.test(provider)
   && /if \(out === "sent" && typeof question !== "string"\) speaker\.asked\(\);/.test(provider)
   && /speaker\.read\(state\.turns\)/.test(provider) && /\(\) => speaker\.close\(\), \[role, speaker\]/.test(provider));
// architecture review, 2026-10-30: a spoken question's words come as a rewrite (a new number) after a typed question
const spokenQ = turn(10, { key: "ask:10", from: "person", voice: true, text: "", at: "2026-10-29T10:00:00Z" });
const typedQ = turn(11, { key: "ask:11", from: "person", text: "And the lights?", at: "2026-10-29T10:00:05Z" });
const heardQ = { ...spokenQ, seq: 12, text: "Is the pump on?" };
const ordered = mergeTurns(mergeTurns([spokenQ, typedQ], [heardQ], false), [], false);
ck("a spoken question's words keep its place: the thread is ordered by when each line came, then its number",
   J(ordered.map((t) => [t.key, t.text])) === J([["ask:10", "Is the pump on?"], ["ask:11", "And the lights?"]]), ordered);
const fresh = threadView([turn(1, { from: "person", text: "Is the pump on?" }), turn(2), turn(3, { from: "person", text: "/new" }),
  turn(4, { text: "New conversation." }), turn(5, { from: "person", text: "And the lights?" })], true);
ck("\"New conversation\" empties the thread: only what came after the last /new shows (owner, 2026-10-29)",
   J(fresh.lines.map((t) => t.text)) === J(["New conversation.", "And the lights?"]), fresh.lines);
const words = turn(5, { key: "turn:5" }), aloud = turn(6, { key: "turn:5", speech: "s1.mp3" });
ck("the sound that just arrived: the answer rewritten with its sound, once (ticket 24)",
   arrivedSpeech([words], [aloud]) === "s1.mp3" && arrivedSpeech([aloud], [aloud]) === null
   && arrivedSpeech([], [words]) === null);
ck("  ...played as it comes only on the tablet that asked, while the add-on would keep its question",
   playsAloud(1000, 2000) && !playsAloud(null, 2000)
   && !playsAloud(0, AGENT_CONTRACT.conversation.askKeptSeconds * 1000 + 1));
ck("  ...never the person's line, nor an answer withdrawn",
   arrivedSpeech([], [turn(7, { from: "person", speech: "s2.mp3" })]) === null
   && arrivedSpeech([], [turn(8, { gone: true, speech: "s3.mp3" })]) === null);
const waiting = draw(h(TurnLine, { turn: turn(2, { from: "person", voice: true, text: "" }), canOpenPage: false }));
const heard = draw(h(TurnLine, { turn: turn(2, { from: "person", voice: true, text: "Is the pump on?" }), canOpenPage: false }));
ck("a spoken question waiting for its words says it was spoken, as a line of its own",
   waiting.includes(SPOKEN_WAITING) && waiting.includes("vesta-turn-text") && waiting.includes("vesta-turn-spoken"), waiting);
ck("  ...then the words VESTA heard, still marked as spoken",
   heard.includes("Is the pump on?") && !heard.includes(SPOKEN_WAITING) && heard.includes("vesta-turn-spoken"), heard);
ck("  ...a typed one carries no such mark",
   !draw(h(TurnLine, { turn: turn(3, { from: "person", text: "typed" }), canOpenPage: false })).includes("vesta-turn-spoken"));

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
const askButton = elements(hud, "TalkButton").find((b) => propText(b, "onOpen") === "onAskVesta");
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
const askRow = elements(hud, "TalkButton").find((b) => propText(b, "place") === '"menu"');
ck("the phone's \"Ask VESTA\" row only while VESTA runs, the top bar's talk button itself (held: VESTA listens)",
   !!askRow && guardsOf(askRow).includes("thread.shown") && (propText(askRow, "onTap") || "").includes("onAskVesta")
   && (propText(askRow, "onOpen") || "").includes("onAskVesta"));
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
