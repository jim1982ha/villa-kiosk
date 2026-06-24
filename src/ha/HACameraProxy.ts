// src/ha/HACameraProxy.ts
// Build the authenticated camera stream URL for an <img> MJPEG takeover.
//
// HA's /api/camera_proxy_stream serves MJPEG and accepts the long-lived token as
// a query param, which is what we need for an <img> tag (can't set headers).
// Under Ingress we instead hit the add-on's Supervisor proxy, which injects the
// token server-side — so the URL carries no token at all.

import { isIngress, ingressApiBase } from "./ingress";

export function cameraStreamUrl(haUrl: string, token: string, entityId: string): string {
  if (isIngress()) return `${ingressApiBase()}/camera_proxy_stream/${entityId}`;
  const base = haUrl.replace(/\/+$/, "");
  return `${base}/api/camera_proxy_stream/${entityId}?token=${encodeURIComponent(token)}`;
}

/**
 * Still-image (snapshot) URL for a camera. Used as a fallback when the MJPEG
 * stream isn't available: `camera_proxy_stream` only works for cameras that
 * implement an MJPEG stream, but `camera_proxy` returns the latest frame for
 * essentially every camera (RTSP/ONVIF/HLS included), so polling it gives a
 * live view that works wherever the camera works in HA.
 */
export function cameraSnapshotUrl(haUrl: string, token: string, entityId: string): string {
  if (isIngress()) return `${ingressApiBase()}/camera_proxy/${entityId}`;
  const base = haUrl.replace(/\/+$/, "");
  return `${base}/api/camera_proxy/${entityId}?token=${encodeURIComponent(token)}`;
}
