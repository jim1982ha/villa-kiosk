// src/components/panels/feedSound.ts
// Whether a playing camera feed carries sound — the sound button shows only then.
//
// ⚠️ ASKING FOR SOUND IS NOT GETTING IT (owner, 2026-10-25: "you are displaying the Sound icon for Hikvision camera
// feed … but there is no Sound coming these camera"). The live feed always asks for sound (HACameraWebRTC adds an
// audio receiver, as the villa system's own player does), so an audio track exists on every feed, also a camera with
// no microphone. A track that has never received anything stays `muted`; one that carries sound unmutes as the first
// packets arrive. A recorded-style feed (HLS) says it through the element: `audioTracks` (Safari, the iPad's native
// player), `mozHasAudio` (Firefox), or audio actually decoded (Chrome, under hls.js).
//
// No React, no DOM of its own: tests/oracles/feed_sound.mjs drives it with plain objects.

interface TrackLike { muted: boolean; readyState: string }
interface StreamLike { getAudioTracks(): TrackLike[] }
export interface FeedLike {
  srcObject: unknown;
  audioTracks?: { length: number };
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
}

/** True once the feed is known to carry sound. False also while it is not known yet: ask again as it plays. */
export function feedHasSound(v: FeedLike): boolean {
  const stream = v.srcObject as StreamLike | null;
  if (stream && typeof stream.getAudioTracks === "function") {
    return stream.getAudioTracks().some((t) => t.readyState === "live" && !t.muted);
  }
  if (v.audioTracks) return v.audioTracks.length > 0;
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  return (v.webkitAudioDecodedByteCount ?? 0) > 0;
}
