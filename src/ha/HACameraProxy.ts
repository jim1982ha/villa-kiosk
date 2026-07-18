// src/ha/HACameraProxy.ts
// Build the camera stream URL for an <img> MJPEG takeover.
//
// The kiosk always reaches HA through the add-on's Supervisor proxy, which
// injects real auth server-side — so camera URLs route through the proxy's
// same-origin `/core/api/...` path and carry no token at all. (Before the
// single-mode refactor there was also a standalone branch that appended the
// camera entity's own rotating `access_token` as a ?token= query param; that's
// gone now that every deployment is proxy-backed.)

import { ingressApiBase } from "./ingress";
import type { HAWebSocket } from "./HAWebSocket";

export function cameraStreamUrl(entityId: string): string {
  return `${ingressApiBase()}/camera_proxy_stream/${entityId}`;
}

/**
 * Still-image (snapshot) URL for a camera. Used as a fallback when the MJPEG
 * stream isn't available: `camera_proxy_stream` only works for cameras that
 * implement an MJPEG stream, but `camera_proxy` returns the latest frame for
 * essentially every camera (RTSP/ONVIF/HLS included), so polling it gives a
 * live view that works wherever the camera works in HA.
 */
export function cameraSnapshotUrl(entityId: string): string {
  return `${ingressApiBase()}/camera_proxy/${entityId}`;
}

/**
 * HLS playlist URL for a camera, via the SAME "stream" pipeline Home
 * Assistant's own frontend prefers for any camera that supports it (most
 * RTSP/ONVIF/generic IP cameras do, via CameraEntityFeature.STREAM) — that's
 * why the exact same camera can look noticeably smoother in the HA UI than
 * in a kiosk that only ever falls back to `camera_proxy_stream`: that MJPEG
 * endpoint makes HA continuously re-decode + re-encode every frame as a JPEG
 * server-side, a much heavier and more rate-limited path than passing the
 * camera's native H.264 through as HLS segments.
 *
 * Asks HA over the websocket (`camera/stream`) for a fresh stream URL — HA
 * returns a path already rooted at `/api/...` (e.g.
 * `/api/hls/<token>/master_playlist.m3u8`), which we route through the add-on's
 * `/core/api/...` proxy the same way every other REST call here does (see
 * ingressApiBase) — stripping the leading `/api` HA already included before
 * appending it.
 *
 * Throws if the camera doesn't support the stream pipeline (not every camera
 * does) or the websocket call otherwise fails — callers should catch this and
 * fall back to the MJPEG/snapshot path, exactly as if HLS were never tried.
 */
export async function cameraHlsUrl(ws: HAWebSocket, entityId: string): Promise<string> {
  const { url } = await ws.sendMessage<{ url: string }>("camera/stream", {
    entity_id: entityId,
    format: "hls",
  });
  return `${ingressApiBase()}${url.replace(/^\/api/, "")}`;
}
