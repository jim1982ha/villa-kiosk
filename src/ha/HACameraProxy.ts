// src/ha/HACameraProxy.ts
// Build authenticated camera stream / snapshot URLs.
//
// HA's /api/camera_proxy_stream serves MJPEG and accepts the long-lived token as
// a query param, which is what we need for an <img> tag (can't set headers).

export function cameraStreamUrl(haUrl: string, token: string, entityId: string): string {
  const base = haUrl.replace(/\/+$/, "");
  return `${base}/api/camera_proxy_stream/${entityId}?token=${encodeURIComponent(token)}`;
}

/** Single still frame — handy as a low-cost poster / fallback. */
export function cameraSnapshotUrl(haUrl: string, token: string, entityId: string): string {
  const base = haUrl.replace(/\/+$/, "");
  return `${base}/api/camera_proxy/${entityId}?token=${encodeURIComponent(token)}&_=${Date.now()}`;
}
