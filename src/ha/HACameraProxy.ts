// src/ha/HACameraProxy.ts
// Build the authenticated camera stream URL for an <img> MJPEG takeover.
//
// HA's /api/camera_proxy[_stream] can't be reached from an <img> with the
// long-lived token: that token only authenticates via the Authorization header
// or a session cookie, neither of which an <img> can send. What these endpoints
// DO accept as a ?token= query param is the camera entity's own rotating signed
// token, exposed as its `access_token` attribute (HA refreshes it and pushes it
// over the websocket, so the value we read from the live entity stays valid).
// Under Ingress we instead hit the add-on's Supervisor proxy, which injects real
// auth server-side — so the URL carries no token at all and `camAccessToken` is
// ignored.

import { isIngress, ingressApiBase } from "./ingress";

export function cameraStreamUrl(haUrl: string, camAccessToken: string, entityId: string): string {
  if (isIngress()) return `${ingressApiBase()}/camera_proxy_stream/${entityId}`;
  const base = haUrl.replace(/\/+$/, "");
  return `${base}/api/camera_proxy_stream/${entityId}?token=${encodeURIComponent(camAccessToken)}`;
}

/**
 * Still-image (snapshot) URL for a camera. Used as a fallback when the MJPEG
 * stream isn't available: `camera_proxy_stream` only works for cameras that
 * implement an MJPEG stream, but `camera_proxy` returns the latest frame for
 * essentially every camera (RTSP/ONVIF/HLS included), so polling it gives a
 * live view that works wherever the camera works in HA. Same token rules as
 * cameraStreamUrl — the entity's `access_token`, not the long-lived token.
 */
export function cameraSnapshotUrl(haUrl: string, camAccessToken: string, entityId: string): string {
  if (isIngress()) return `${ingressApiBase()}/camera_proxy/${entityId}`;
  const base = haUrl.replace(/\/+$/, "");
  return `${base}/api/camera_proxy/${entityId}?token=${encodeURIComponent(camAccessToken)}`;
}
