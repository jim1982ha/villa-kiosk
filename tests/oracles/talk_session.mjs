// Hold to talk, press by press (architecture review R, 2026-10-29): the page's one session (messages/talk) driven with a
// recorder and a clock of the check's own. Owner, 2026-10-29: the microphone starts at the touch once allowed (the
// first words were lost); a hold from the top bar shows the big orb until the finger lifts, then the conversation; a
// hold in the conversation lights its own button; a touch the tablet cuts short says so, never vanishes.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { TalkSession, TALK_IDLE } = await import("@/messages/talk");
const { TALK_SAID } = await import("@/messages/conversation");
const { elements, guardsOf, parseTsx, propText } = await import("../consistency/jsx.mjs");

/** A session with a fake microphone and a hand-turned clock; what it did, in order. */
function bench({ allowed = true, listening = "listening", wav = "WAV" } = {}) {
  const log = [];
  const timers = new Map();
  let next = 0;
  let level;
  const rec = () => ({
    listen: async () => { log.push("listen"); return listening; },
    stop: async () => { log.push("stop"); return wav; },
    cancel: () => log.push("cancel"),
    measure: () => "MEASURE",
  });
  const s = new TalkSession({
    record: (onLevel) => { level = onLevel; log.push("record"); return rec(); },
    allowed: () => allowed,
    send: async (w, m) => { log.push(`send ${w}`); if (m) log.push(`measured ${m}`); },
    tell: (line) => log.push(`tell ${line}`),
    after: (ms, fn) => { const id = ++next; timers.set(id, { ms, fn }); return id; },
    cancel: (id) => timers.delete(id),
    holdMs: 480, capMs: 30000,
  });
  const views = [];
  s.watch((v) => views.push(`${v.phase}${v.place ? `@${v.place}` : ""}`));
  const fire = async (ms) => {
    for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); }
    await new Promise((r) => setTimeout(r, 0));
  };
  const opened = [];
  const open = (place) => () => { opened.push(place); log.push(`open ${place}`); };
  return { s, log, views, fire, opened, open, timers, level: (v) => level(v) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

console.log("  a tap:");
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  ck("the microphone starts at the touch once allowed (nothing said is lost)", b.log.join() === "record,listen", b.log);
  ck("  ...a tap gives it back and records nothing; the click opens the conversation, not the session",
     b.s.up() === "tap" && b.log.join() === "record,listen,cancel" && b.opened.length === 0, b.log);
  ck("  ...no orb", b.views.join() === "idle", b.views);
}
{
  const b = bench({ allowed: false });
  b.s.down("bar", b.open("bar"));
  b.s.up();
  ck("before the person allowed it, a tap never asks for the microphone", !b.log.includes("listen"), b.log);
}

console.log("\n  a hold from the top bar:");
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  ck("the hold shows the big orb (listening, from the top bar)", b.views.at(-1) === "listening@bar", b.views);
  const heard = [];
  b.s.hear((v) => heard.push(v));
  b.level(0.4);
  ck("  ...the voice's level reaches the orb", heard.join() === "0.4", heard);
  ck("  ...the conversation is not open yet", b.opened.length === 0);
  ck("let go: \"held\"", b.s.up() === "held");
  await settle();
  ck("  ...the orb goes and the conversation shows BEFORE the sound is sent",
     b.log.indexOf("open bar") < b.log.indexOf("send WAV") && b.views.includes("sending@bar"), b.log);
  ck("  ...the recording is sent, and the session rests", b.log.includes("send WAV") && b.s.now === TALK_IDLE, b.log);
  ck("  ...with what the page measured of it (the add-on's log line)", b.log.includes("measured MEASURE"), b.log);
}
{
  const b = bench({ allowed: false });
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  ck("before the person allowed it, the microphone is asked for at the hold", b.log.join() === "record,listen", b.log);
}

console.log("\n  a hold in the open conversation:");
{
  const b = bench();
  b.s.down("thread", b.open("thread"));
  await b.fire(480);
  ck("its own button listens (never the big orb again)", b.views.at(-1) === "listening@thread", b.views);
  b.s.up();
  await settle();
  ck("  ...and sends", b.log.includes("send WAV"), b.log);
}

console.log("\n  what is said instead of a question:");
{
  const b = bench({ listening: "refused" });
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  ck("the microphone refused: said, the conversation shown, the orb gone",
     b.log.includes(`tell ${TALK_SAID.refused}`) && b.opened.join() === "bar" && b.s.now === TALK_IDLE, b.log);
}
{
  const b = bench({ wav: null });
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  b.s.up();
  await settle();
  ck("nothing recorded: said, nothing sent", b.log.includes(`tell ${TALK_SAID.silent}`)
     && !b.log.some((l) => l.startsWith("send")), b.log);
}
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  b.s.interrupted();
  ck("a hold the tablet cut short says so, sends nothing, shows the conversation",
     b.log.includes(`tell ${TALK_SAID.cut}`) && b.log.includes("cancel") && !b.log.some((l) => l.startsWith("send"))
     && b.opened.join() === "bar" && b.s.now === TALK_IDLE, b.log);
}
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  b.s.interrupted();
  ck("  ...a tap cut short says nothing", !b.log.some((l) => l.startsWith("tell")), b.log);
}

console.log("\n  limits:");
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  await b.fire(30000);
  ck("the longest question sends by itself", b.log.includes("send WAV") && b.s.up() === null, b.log);
}
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  ck("one press at a time", b.s.down("thread", b.open("thread")) === false);
}

console.log("\n  the click that follows a press:");
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  b.s.up();
  ck("a tap's click acts (the top bar opens the conversation)", b.s.clicked() === true);
  ck("  ...a key press, with no finger at all, acts too", b.s.clicked() === true);
}
{
  const b = bench();
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  b.s.up();
  ck("a hold's click does not (no second opening, no advice)", b.s.clicked() === false);
  await settle();
}
{
  const b = bench({ wav: "WAV" });
  b.s.down("bar", b.open("bar"));
  await b.fire(480);
  let release;
  b.s.deps.send = () => new Promise((r) => { release = r; });
  b.s.up();
  await settle();
  ck("a press refused while a question sends: its click is no tap (never \"Hold the microphone…\")",
     b.s.now.phase === "sending" && b.s.down("thread", b.open("thread")) === false && b.s.up() === null
     && b.s.clicked() === false, b.s.now);
  release();
}
const btnSrc = (await import("node:fs")).readFileSync(new URL("../../src/components/messages/TalkButton.tsx", import.meta.url), "utf8");
ck("the button asks the session whether a click is a tap, and keeps no rule of its own",
   /talker\.clicked\(\)/.test(btnSrc) && !/heldClick/.test(btnSrc));

console.log("\n  drawn where it is held:");
const btn = parseTsx("components/messages/TalkButton.tsx");
const orbs = elements(btn, "VoiceOrb");
const over = elements(btn, "ListeningOverScreen");
ck("the big orb only for a hold from the top bar, while it listens",
   over.length === 1 && guardsOf(over[0]).includes('place === "bar"') && guardsOf(over[0]).includes('phase === "listening"')
   && orbs.filter((e) => propText(e, "size") === '"full"').length === 1, over.map(guardsOf));
ck("  ...the small one only in the conversation, while it listens",
   orbs.filter((e) => propText(e, "size") === '"small"').every((e) => guardsOf(e).includes('place === "thread"')
     && guardsOf(e).includes('phase === "listening"')) && orbs.length === 2, orbs.map(guardsOf));
const thread = parseTsx("components/messages/VestaThread.tsx");
ck("the conversation's talk button holds in the conversation, only where the page can record",
   elements(thread, "TalkButton").length === 1 && propText(elements(thread, "TalkButton")[0], "place") === '"thread"'
   && guardsOf(elements(thread, "TalkButton")[0]).includes("talker"));

done("✅ a hold to talk does what the owner expects, press by press");
