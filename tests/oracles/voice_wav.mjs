// Hold to talk (ticket 23 of "One inbox"): what the page uploads is the agreement's one shape of WAV (16 kHz, 16-bit,
// mono, at most voice.seconds), whatever rate the tablet's microphone runs at (an iPad 48 kHz, many Androids 44.1 kHz).
// Driven through the pure encoder: sound in, the bytes read back as a WAV reader reads them.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { encodeWav, VOICE, canRecord } = await import("@/messages/voice");
const { elements, guardsOf, parseTsx } = await import("../consistency/jsx.mjs");

/** The WAV read back: its header fields and its samples. */
function read(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const n = v.getUint32(40, true) / 2;
  return {
    riff: tag(0), size: v.getUint32(4, true), wave: tag(8), fmt: tag(12), fmtSize: v.getUint32(16, true),
    pcm: v.getUint16(20, true), channels: v.getUint16(22, true), rate: v.getUint32(24, true),
    byteRate: v.getUint32(28, true), align: v.getUint16(32, true), bits: v.getUint16(34, true), data: tag(36),
    length: bytes.byteLength, samples: Array.from({ length: n }, (_, i) => v.getInt16(44 + i * 2, true)),
  };
}
const tone = (rate, seconds, hz, level = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => level * Math.sin((2 * Math.PI * hz * i) / rate));
/** How many times a sound crosses zero going up: its pitch, in a second of it. */
const upCrossings = (s) => s.reduce((n, x, i) => n + (i > 0 && s[i - 1] < 0 && x >= 0 ? 1 : 0), 0);

console.log("  the header a WAV reader reads:");
const one = read(encodeWav(tone(48000, 1, 440), 48000));
ck("RIFF/WAVE, a 16-byte PCM fmt, then data", one.riff === "RIFF" && one.wave === "WAVE" && one.fmt === "fmt "
   && one.fmtSize === 16 && one.pcm === 1 && one.data === "data", one);
ck("  ...16 kHz, one channel, 16-bit: 32000 bytes a second, 2 a sample",
   one.rate === 16000 && one.channels === 1 && one.bits === 16 && one.byteRate === 32000 && one.align === 2, one);
ck("  ...its sizes add up: the file is the header and the sound, nothing else",
   one.size === one.length - 8 && one.length === 44 + one.samples.length * 2, one);
ck("the agreement's rate is the one written (conversation.voice.rate)", VOICE.rate === 16000 && one.rate === VOICE.rate);

console.log("\n  the tablet's rate made 16 kHz:");
ck("a second at 48 kHz (an iPad) is 16000 samples", one.samples.length === 16000, one.samples.length);
const android = read(encodeWav(tone(44100, 1, 440), 44100));
ck("  ...and at 44.1 kHz (many Androids)", android.samples.length === 16000, android.samples.length);
ck("  ...and at 16 kHz already: every sample kept", read(encodeWav(tone(16000, 1, 440), 16000)).samples.length === 16000);
ck("a 1 kHz voice stays 1 kHz (1000 rises a second, ±2), from 48 kHz and 44.1 kHz",
   Math.abs(upCrossings(read(encodeWav(tone(48000, 1, 1000), 48000)).samples) - 1000) <= 2
   && Math.abs(upCrossings(read(encodeWav(tone(44100, 1, 1000), 44100)).samples) - 1000) <= 2);
const loud = Math.max(...one.samples);
ck("  ...at its level: half scale stays half scale (within 2%)", Math.abs(loud - 16384) < 330, loud);
ck("a sound above what 16 kHz can carry (12 kHz recorded at 48 kHz) is not folded back as a 4 kHz whine (under 5%)",
   Math.max(...read(encodeWav(tone(48000, 1, 12000), 48000)).samples.slice(100, -100).map(Math.abs)) < 0.05 * 16384);

console.log("\n  what never reaches the add-on:");
const clip = read(encodeWav(Float32Array.from([2, -2, 1, -1, 0]), 16000)).samples;
ck("a sample past full scale is clipped, never wrapped round", clip.join() === "32767,-32768,32767,-32768,0", clip);
const long = read(encodeWav(tone(16000, VOICE.seconds + 2, 440), 16000));
ck(`a recording past ${VOICE.seconds}s is cut there (the add-on refuses a longer one)`,
   long.samples.length === VOICE.seconds * 16000, long.samples.length);
ck("no sound is an empty WAV, still a WAV", read(encodeWav(new Float32Array(0), 48000)).length === 44);

console.log("\n  the microphone only where the page can record (spec story 49):");
const page = (secure, mic, audio) => {
  Object.defineProperty(globalThis, "window", { value: { isSecureContext: secure }, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: mic ? { mediaDevices: { getUserMedia: async () => ({}) } } : {},
    configurable: true });
  Object.defineProperty(globalThis, "AudioContext", { value: audio ? class {} : undefined, configurable: true });
  return canRecord();
};
ck("an https page with a microphone and Web Audio records", page(true, true, true) === true);
ck("  ...an http page never does (a browser gives it no microphone)", page(false, true, true) === false);
ck("  ...nor one with no microphone, nor one with no Web Audio", page(true, false, true) === false
   && page(true, true, false) === false);
const talk = parseTsx("components/messages/TalkButton.tsx");
ck("the button is the microphone only then (the page's talk session exists), else the speech bubble (tap only)",
   elements(talk, "Mic").every((e) => guardsOf(e).includes("talker"))
   && elements(talk, "MessageCircle").every((e) => guardsOf(e).includes("!talker")) && elements(talk, "Mic").length === 1,
   elements(talk, "Mic").map(guardsOf));
const context = (await import("node:fs")).readFileSync(new URL("../../src/messages/ConversationContext.tsx", import.meta.url), "utf8");
ck("  ...and the session exists only where canRecord says the page can record",
   /useState\(\(\) => canRecord\(\) \? new TalkSession\(/.test(context));

done("✅ the tablet's recording is the agreement's WAV");
