// src/messages/voice.ts
// Hold to talk (ticket 23 of "One inbox", owner 2026-10-28): a question spoken to VESTA, recorded on the tablet and
// uploaded as the agreement's ONE shape of WAV (16 kHz, 16-bit, mono, at most conversation.voice.seconds), which the
// villa's own Whisper reads as it comes. ⚠️ NEVER MediaRecorder, NEVER the browser's dictation: MediaRecorder gives an
// iPad MP4 and an Android WebM, neither of which the VESTA Agent's voice path reads, and dictation sends the voice to
// Apple or Google. Web Audio gives raw samples on both, so the same code runs on iPad and Android.

import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

/** The spoken question's shape, as the add-on accepts it (agent-contract.json conversation.voice). */
export const VOICE: { rate: number; seconds: number } = AGENT_CONTRACT.conversation.voice;

/** Taps on each side of a resampled sample, per input sample the output spans: a sharp enough low-pass that a sound
 *  above 8 kHz (which 16 kHz cannot carry) is removed, not folded back as a whine in the words. */
const TAPS_PER_STEP = 16;

/** `x` at `from` Hz made `to` Hz: a windowed-sinc low-pass (Blackman) under the new half-rate, read at each new sample's
 *  place. Unity gain: a level stays the level. */
function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const step = from / to;
  // the cut, as a fraction of the input's half-rate: 90% of the output's, so the edge of the filter stays under it
  const cut = 0.9 * Math.min(1, 1 / step);
  const half = Math.ceil(TAPS_PER_STEP * Math.max(1, step));
  const out = new Float32Array(Math.floor(x.length / step));
  for (let i = 0; i < out.length; i++) {
    const at = i * step;
    const base = Math.floor(at);
    let sum = 0;
    let gain = 0;
    for (let k = Math.max(0, base - half + 1); k <= Math.min(x.length - 1, base + half); k++) {
      const d = k - at;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * cut * d) / (Math.PI * cut * d);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half);
      sum += x[k] * sinc * w;
      gain += sinc * w;
    }
    out[i] = gain ? sum / gain : 0;
  }
  return out;
}

/** One channel of sound at `rate` Hz (samples −1…1) as the WAV the add-on keeps: VOICE.rate, 16-bit, mono, cut at
 *  VOICE.seconds. Pure: tests/oracles/voice_wav.mjs reads it back. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const pcm = resample(samples.subarray(0, Math.round(rate * VOICE.seconds)), rate, VOICE.rate);
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, VOICE.rate, true); v.setUint32(28, VOICE.rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));         // clipped: a loud voice never wraps round to its opposite
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}

type AudioContextClass = typeof AudioContext;
/** The page's Web Audio, under its older iPad name too. */
const audioContextClass = (): AudioContextClass | undefined => {
  const w = globalThis as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext;
};

/** Whether this page can record (spec story 49: the button is hidden where it cannot): a secure page (https: a
 *  browser gives the microphone to no other), with the microphone and Web Audio there. */
export const canRecord = (): boolean =>
  typeof window !== "undefined" && window.isSecureContext === true
  && typeof navigator.mediaDevices?.getUserMedia === "function" && audioContextClass() !== undefined;

// ⚠️ THE MICROPHONE STARTS AT THE TOUCH ONCE IT IS ALLOWED (owner, 2026-10-29, after two spoken questions came out
// as "Ténez le like et le ménagez" and Whisper's filler: it opened only once the hold was a hold, half a second, and
// then took its time to start, so the first words were never recorded; Telegram records from the touch). Until the
// person has allowed it, a tap must never ask: then it is asked for at the hold, as before.
let allowed = false;
/** Whether the microphone may be opened at the touch: the person allowed it (this page, or the browser remembers). */
export const microphoneAllowed = (): boolean => allowed;
/** Read what the browser remembers of the microphone, and follow it (where the browser says: not every one does). */
export function watchMicrophone(): void {
  try {
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((p) => {
      allowed = p.state === "granted";
      p.onchange = () => { allowed = p.state === "granted"; };
    }).catch(() => undefined);
  } catch { /* no Permissions API: allowed once the person allows it here */ }
}

/** ONE audio context for the page, resumed inside each press: an iPad lets a page's sound start only inside the
 *  person's gesture, and a page that makes a context per question soon meets the browser's limit on them. */
let pageAudio: AudioContext | null = null;
function audioAtTheTouch(): AudioContext {
  const Ctx = audioContextClass();
  if (!Ctx) throw new Error("no Web Audio");
  if (!pageAudio || pageAudio.state === "closed") pageAudio = new Ctx();
  void pageAudio.resume().catch(() => undefined);
  return pageAudio;
}

// ⚠️ VESTA'S ANSWER SAID ALOUD (ticket 24 of "One inbox", owner 2026-10-28: "use piper path only first"): the villa's own
// voice, the sound the add-on keeps with the answer, played through the SAME audio context — resumed at the touch that
// asked (an iPad plays a page's sound only from a context started inside the person's gesture, and the answer comes
// seconds after the finger lifted). Never the device's own voices (speechSynthesis): they differ per tablet.
let speaking: AudioBufferSourceNode | null = null;

/** VESTA stops speaking (a new question is held to talk, a profile signs out). */
export function stopSpeech(): void {
  try { speaking?.stop(); } catch { /* already ended */ }
  speaking = null;
}

/** Play an answer's sound. `atTheTouch`: called from the person's press (its own context resumed there, before the sound
 *  is fetched); otherwise only the context a press already started, and nothing when there is none (the page then
 *  offers Listen). Whether it plays. */
export async function playSpeech(sound: () => Promise<ArrayBuffer | null>, atTheTouch: boolean): Promise<boolean> {
  let ctx: AudioContext | null;
  try {
    ctx = atTheTouch ? audioAtTheTouch() : pageAudio;
  } catch {
    return false;
  }
  if (!ctx || ctx.state === "closed") return false;
  const data = await sound();
  if (!data) return false;
  try {
    // the callback form: an older iPad's context has no promise one
    const buffer = await new Promise<AudioBuffer>((ok, no) => { void ctx.decodeAudioData(data, ok, no); });
    stopSpeech();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => { if (speaking === source) speaking = null; };
    source.start(0);
    speaking = source;
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/** What became of asking for the microphone: recording; the person or the browser refused it; there is none. */
export type Listening = "listening" | "refused" | "none";

// ⚠️ WHAT THE PAGE RECORDED, MEASURED (owner, 2026-10-29: "my speech is badly understood, while I am saying the exact
// thing as in Telegram", from the same MacBook): the villa's Whisper was unsure of the language of every tablet question
// (26%) and heard the same words well from Telegram's own recorder. Two suspects lie in this recorder: the sound read at
// a rate it is not (the page's audio started before the microphone opened: some machines change the rate under it), or
// blocks of sound lost while the page's thread was busy (the 3D villa, the orb). Each question says which, in the
// add-on's log, before anything is changed.
/** A recording's measure: how long the button was held and the microphone open, the page's and the microphone's rates,
 *  how many blocks of sound came and how many were missing between them, and the loudest sample (dB below full). */
export interface RecordingMeasure { heldMs: number; openMs: number; rate: number; micRate: number; blocks: number;
  missing: number; peakDb: number }

/** Blocks missing between those that came: each block says when it plays (`times`, seconds), `step` apart when none is
 *  lost. Pure: tests/oracles/voice_wav.mjs. */
export function missingBlocks(times: readonly number[], step: number): number {
  let lost = 0;
  for (let i = 1; i < times.length; i++) lost += Math.max(0, Math.round((times[i] - times[i - 1]) / step) - 1);
  return lost;
}

/** The measure as the add-on reads it (its X-Recording header: key=value, `;` apart, whole numbers only). Pure. */
export const measureHeader = (m: RecordingMeasure): string =>
  (["heldMs", "openMs", "rate", "micRate", "blocks", "missing", "peakDb"] as const)
    .map((k) => `${k}=${Math.round(m[k])}`).join(";");

/** One spoken question being recorded. */
export interface Recording {
  /** Ask for the microphone and record from it (once: a second call answers the first's outcome). */
  listen(): Promise<Listening>;
  /** Stop: the WAV to send, or null when nothing was recorded. */
  stop(): Promise<Blob | null>;
  /** Stop and keep nothing. */
  cancel(): void;
  /** What was recorded, measured (after stop). */
  measure(): RecordingMeasure;
}

/** A recording, begun AT THE PRESS (the page's audio resumed inside the gesture); the microphone opens at `listen()`.
 *  `onLevel`: how loud the voice is now (0…1), for the orb that shows VESTA hears it.
 *  ⚠️ A ScriptProcessorNode, not an AudioWorklet: the worklet needs a module of its own loaded by URL, this needs
 *  nothing, and every Safari and Chrome a wall tablet runs has it. */
export function startRecording(onLevel?: (level: number) => void): Recording {
  const ctx = audioAtTheTouch();
  stopSpeech();                          // VESTA stops speaking as the person speaks
  const chunks: Float32Array[] = [];
  let stream: MediaStream | null = null;
  let node: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let ended = false;
  let asked: Promise<Listening> | null = null;
  const pressed = performance.now();
  let opened = 0, stopped = 0, micRate = 0, peak = 0;
  const times: number[] = [];
  const release = () => {
    ended = true;
    source?.disconnect();
    node?.disconnect();
    if (node) node.onaudioprocess = null;
    stream?.getTracks().forEach((t) => t.stop());
  };
  const open = async (): Promise<Listening> => {
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      release();
      return e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "refused" : "none";
    }
    allowed = true;
    // let go while the browser was still asking: the microphone goes back at once
    if (ended) { release(); return "none"; }
    opened = performance.now();
    try { micRate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate ?? 0; } catch { micRate = 0; }
    source = ctx.createMediaStreamSource(stream);
    // one input channel: a stereo microphone is mixed down to it by the node itself; 2048 samples (about 40ms) a
    // block, so the orb follows the voice and little is left unread when the finger lifts
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => {
      const block = new Float32Array(e.inputBuffer.getChannelData(0));
      chunks.push(block);
      times.push(e.playbackTime);
      for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
      if (onLevel) {
        let sum = 0;
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
        onLevel(Math.min(1, Math.sqrt(sum / block.length) * 4));
      }
    };
    source.connect(node);
    node.connect(ctx.destination);       // a processor not connected onward is never run (Chrome); it outputs silence
    return "listening";
  };
  return {
    listen() { return (asked ??= open()); },
    async stop() {
      const rate = ctx.sampleRate;
      stopped = performance.now();
      release();
      const length = chunks.reduce((n, c) => n + c.length, 0);
      if (!length) return null;
      const all = new Float32Array(length);
      chunks.reduce((at, c) => { all.set(c, at); return at + c.length; }, 0);
      return new Blob([encodeWav(all, rate).buffer as ArrayBuffer], { type: "audio/wav" });
    },
    cancel: release,
    measure: () => ({
      heldMs: (stopped || performance.now()) - pressed, openMs: opened ? (stopped || performance.now()) - opened : 0,
      rate: ctx.sampleRate, micRate, blocks: times.length, missing: missingBlocks(times, 2048 / ctx.sampleRate),
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -100,
    }),
  };
}
