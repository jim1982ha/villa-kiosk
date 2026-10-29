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

/** What became of asking for the microphone: recording; the person or the browser refused it; there is none. */
export type Listening = "listening" | "refused" | "none";

/** One spoken question being recorded. */
export interface Recording {
  /** Ask for the microphone and record from it. */
  listen(): Promise<Listening>;
  /** Stop: the WAV to send, or null when nothing was recorded. */
  stop(): Promise<Blob | null>;
  /** Stop and keep nothing. */
  cancel(): void;
}

/** A recording, begun AT THE PRESS: ⚠️ an iPad starts a page's sound only inside the person's gesture, so the audio
 *  context is made here, synchronously; the microphone is asked for only by `listen()` (a tap never asks for it).
 *  ⚠️ A ScriptProcessorNode, not an AudioWorklet: the worklet needs a module of its own loaded by URL, this needs
 *  nothing, and every Safari and Chrome a wall tablet runs has it. */
export function startRecording(): Recording {
  const Ctx = audioContextClass();
  if (!Ctx) throw new Error("no Web Audio");
  const ctx = new Ctx();
  void ctx.resume().catch(() => undefined);
  const chunks: Float32Array[] = [];
  let stream: MediaStream | null = null;
  let node: ScriptProcessorNode | null = null;
  let ended = false;
  const release = () => {
    ended = true;
    node?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };
  return {
    async listen() {
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        release();
        return e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "refused" : "none";
      }
      // let go while the browser was still asking: the microphone goes back at once
      if (ended) { release(); return "none"; }
      const source = ctx.createMediaStreamSource(stream);
      // one input channel: a stereo microphone is mixed down to it by the node itself
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      source.connect(node);
      node.connect(ctx.destination);       // a processor not connected onward is never run (Chrome); it outputs silence
      return "listening";
    },
    async stop() {
      const rate = ctx.sampleRate;
      release();
      const length = chunks.reduce((n, c) => n + c.length, 0);
      if (!length) return null;
      const all = new Float32Array(length);
      chunks.reduce((at, c) => { all.set(c, at); return at + c.length; }, 0);
      return new Blob([encodeWav(all, rate).buffer as ArrayBuffer], { type: "audio/wav" });
    },
    cancel: release,
  };
}
