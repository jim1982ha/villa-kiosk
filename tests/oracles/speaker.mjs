// VESTA's answer said aloud (ticket 24 of "One inbox"; architecture review 2026-10-30: one speaker for the page), driven
// with a player and a clock of the check's own: when an answer's sound plays as it comes, what is said when it cannot,
// Listen's press, and the stop when a profile goes. Placeholder words.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { Speaker } = await import("@/messages/speaker");
const { LISTEN_SAID, LISTEN_FAILED } = await import("@/messages/conversation");

const turn = (seq, extra = {}) => ({ seq, key: `turn:${seq}`, from: "vesta", at: "", text: `T${seq}`, photos: [],
  page: null, gone: false, buttons: [], answers: null, typing: false, voice: false, speech: null, ...extra });

function bench({ plays = true } = {}) {
  const log = [];
  let clock = 1_000_000;
  const s = new Speaker({
    play: async (sound, atTheTouch) => { const got = await sound(); log.push(`play ${got} ${atTheTouch ? "touch" : "came"}`); return plays && got !== null; },
    stop: () => log.push("stop"),
    sound: async (name) => (name === "gone.mp3" ? null : name),
    tell: (line) => log.push(`tell ${line}`),
    now: () => clock,
  });
  return { s, log, later: (ms) => { clock += ms; } };
}
const words = turn(1), aloud = turn(2, { key: "turn:1", speech: "s1.mp3" });

console.log("  an answer said aloud as it comes:");
{
  const b = bench();
  b.s.asked();
  await b.s.read([words]);
  await b.s.read([aloud]);
  ck("on the tablet that asked, once its sound arrives: played, once", b.log.join() === "play s1.mp3 came", b.log);
  await b.s.read([aloud]);
  ck("  ...never again for the same sound", b.log.length === 1, b.log);
}
{
  const b = bench();
  await b.s.read([words]);
  await b.s.read([aloud]);
  ck("never on a tablet that did not ask (every tablet of the profile reads the answer)", b.log.length === 0, b.log);
}
{
  const b = bench();
  b.s.asked();
  b.later(11 * 60 * 1000);
  await b.s.read([aloud]);
  ck("  ...nor once the add-on would no longer keep the question (askKeptSeconds)", b.log.length === 0, b.log);
}
{
  const b = bench({ plays: false });
  b.s.asked();
  await b.s.read([aloud]);
  ck("an answer the tablet will not start says to tap Listen", b.log.includes(`tell ${LISTEN_SAID}`), b.log);
}

console.log("\n  Listen:");
{
  const b = bench();
  await b.s.listen("s1.mp3");
  ck("plays the sound from the press itself", b.log.join() === "play s1.mp3 touch,tell null", b.log);
  await b.s.listen("gone.mp3");
  ck("  ...and one that cannot be played says so, never nothing", b.log.at(-1) === `tell ${LISTEN_FAILED}`, b.log);
}

console.log("\n  a profile that goes:");
{
  const b = bench();
  b.s.asked();
  b.s.close();
  await b.s.read([aloud]);
  ck("its question's answer never speaks for the next profile; the sound playing stops",
     b.log.join() === "stop", b.log);
}

console.log("  an answer being said can be stopped (owner, 2026-10-30):");
{
  const ends = [];
  const told = [];
  const s = new Speaker({
    play: async (sound, _touch, ended) => { await sound(); ends.push(ended); return true; },
    stop: () => told.push("stop"), sound: async (n) => n, tell: () => undefined, now: () => 0,
  });
  s.watch((n) => told.push(`playing ${n}`));
  await s.listen("a.mp3");
  ck("Listen pressed: its sound is the one being said (its line shows Stop)", s.playing === "a.mp3", s.playing);
  s.stop();
  ck("  ...Stop: the speaker stops and nothing is being said (Listen again)", s.playing === null
     && told.join() === "playing a.mp3,stop,playing null", told);
  await s.listen("a.mp3");
  await s.listen("b.mp3");
  ends[1]();                                             // the first replay's end arrives after the second began
  ck("  ...the end of a sound another replaced never clears the one being said", s.playing === "b.mp3", s.playing);
  ends[2]();
  ck("  ...said to its end: Listen again", s.playing === null, s.playing);
}

done("✅ VESTA's answer said aloud: played where it was asked, said when it cannot");
