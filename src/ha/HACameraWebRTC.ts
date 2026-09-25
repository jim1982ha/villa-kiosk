// src/ha/HACameraWebRTC.ts
// Play a camera over WebRTC, through Home Assistant's own negotiation.
//
// ⚠️ THIS IS HOME ASSISTANT'S PATH, NOT A NEW ONE. HA's own camera view asks
// `camera/capabilities` and plays WebRTC whenever the camera offers it — which
// every camera with an RTSP source does once HA's built-in go2rtc is loaded.
// The kiosk only ever asked for HLS, and HLS cannot start fast: HA has to open
// the camera's RTSP stream, wait for a keyframe and cut segments before the
// first playlist exists. Measured on a live property: 7s from opening the feed
// to the first playlist, during which the panel showed the camera's SNAPSHOT —
// a different stream (4:3, refreshed every ~2s) from the one that then played.
//
// Signalling rides the existing websocket (so the proxy's auth and role gate
// apply to it like any other frame). The media itself is peer-to-peer between
// this browser and go2rtc; the ICE servers are HA's own client configuration,
// never a host this app names.

import type { HAWebSocket } from "./HAWebSocket";

/** Whether HA offers WebRTC for this camera. False on any error — the caller
 *  then uses HLS exactly as before. */
export async function cameraSupportsWebRtc(ws: HAWebSocket, entityId: string): Promise<boolean> {
  try {
    const caps = await ws.sendMessage<{ frontend_stream_types?: string[] }>(
      "camera/capabilities", { entity_id: entityId });
    return caps.frontend_stream_types?.includes("web_rtc") ?? false;
  } catch {
    return false;
  }
}

type OfferEvent =
  | { type: "session"; session_id: string }
  | { type: "answer"; answer: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "error"; code?: string; message?: string };

/**
 * Negotiate a receive-only session and attach it to `video`. Resolves with a
 * teardown once the offer is accepted; `onConnected` fires when the media path
 * is up (ICE connected), `onFail` on any error HA reports or a failed peer
 * connection. The first painted frame is the caller's `playing` event.
 */
export async function startCameraWebRtc(
  ws: HAWebSocket,
  entityId: string,
  video: HTMLVideoElement,
  handlers: { onConnected: () => void; onFail: (reason: string) => void },
): Promise<() => void> {
  const { configuration } = await ws.sendMessage<{ configuration?: RTCConfiguration }>(
    "camera/webrtc/get_client_config", { entity_id: entityId });
  const pc = new RTCPeerConnection(configuration ?? {});
  // Same transceivers as HA's own player: receive only, audio and video.
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.addTransceiver("video", { direction: "recvonly" });
  const remote = new MediaStream();
  pc.ontrack = (e) => {
    remote.addTrack(e.track);
    if (video.srcObject !== remote) video.srcObject = remote;
    void video.play().catch(() => {}); // muted autoplay; a refusal is not a failure
  };

  let closed = false;
  let sessionId: string | null = null;
  // Local candidates found before HA has named the session wait here.
  const queued: RTCIceCandidateInit[] = [];
  const sendCandidate = (candidate: RTCIceCandidateInit) => {
    ws.sendMessage("camera/webrtc/candidate", {
      entity_id: entityId, session_id: sessionId, candidate,
    }).catch(() => {}); // one lost candidate is not a lost session
  };
  pc.onicecandidate = (e) => {
    if (!e.candidate || closed) return;
    const c = e.candidate.toJSON();
    if (sessionId) sendCandidate(c); else queued.push(c);
  };
  pc.onconnectionstatechange = () => {
    if (closed) return;
    if (pc.connectionState === "connected") handlers.onConnected();
    else if (pc.connectionState === "failed") handlers.onFail("peer connection failed");
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  let end: (() => void) | null = null;
  const teardown = () => {
    if (closed) return;
    closed = true;
    end?.();
    pc.close();
    video.srcObject = null;
  };
  try {
    end = await ws.subscribeCommand(
      "camera/webrtc/offer", { entity_id: entityId, offer: offer.sdp },
      (raw) => {
        if (closed) return;
        const ev = raw as OfferEvent;
        if (ev.type === "session") {
          sessionId = ev.session_id;
          queued.splice(0).forEach(sendCandidate);
        } else if (ev.type === "answer") {
          pc.setRemoteDescription({ type: "answer", sdp: ev.answer })
            .catch((err: Error) => handlers.onFail(`answer rejected: ${err.message}`));
        } else if (ev.type === "candidate") {
          pc.addIceCandidate(ev.candidate).catch(() => {});
        } else if (ev.type === "error") {
          handlers.onFail(ev.message ?? ev.code ?? "Home Assistant refused the offer");
        }
      });
  } catch (err) {
    teardown();
    throw err;
  }
  if (closed) end();
  return teardown;
}
