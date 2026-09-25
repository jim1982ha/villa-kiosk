// src/components/panels/cameraTiers.ts
// The four ways to reach a camera, in the order the panel tries them. Each
// only starts itself on an element and reports back — the order, watchdogs and
// fallback are cameraPlayer's.
//
//  0. WebRTC — what Home Assistant's own camera view plays whenever the camera
//     offers it (HA's built-in go2rtc, see HACameraWebRTC). Starts in about a
//     second, at the main stream's own resolution and shape.
//  1. HLS — the "stream" pipeline HA's frontend used before WebRTC. Played via
//     hls.js whenever it's supported (it fetches the playlist/segments over XHR
//     and feeds MediaSource itself, so it works through the Ingress/proxy chain
//     where the native <video> HLS player chokes on the Content-Type); native
//     HLS only for browsers without MSE (real iOS Safari).
//  2. MJPEG (camera_proxy_stream) — for cameras without stream support.
//  3. Still-image polling (camera_proxy) — works for essentially any camera.

import type Hls from "hls.js";
import type { HAWebSocket } from "@/ha/HAWebSocket";
import { cameraStreamUrl, cameraSnapshotUrl, cameraHlsUrl } from "@/ha/HACameraProxy";
import { cameraSupportsWebRtc, startCameraWebRtc } from "@/ha/HACameraWebRTC";
import type { CameraTier } from "./cameraPlayer";

// WebRTC is judged in two steps, because its two ways of failing look nothing
// alike. The media path either comes up (ICE "connected") within a few seconds
// or it never will — a browser with no route to go2rtc — and waiting longer
// only delays the HLS fallback. Once it IS up, the first frame still has to
// wait for the camera's next keyframe, which on a long-GOP camera is seconds.
const WEBRTC_CONNECT_MS = 5000;
const WEBRTC_FRAME_MS = 8000;
// On the FIRST request for a camera HA has to spin up its own FFmpeg-based
// stream worker before it can serve even the master playlist, and the extra
// hops over a tunnel add latency on top.
const HLS_WATCHDOG_MS = 15000;
// A camera that doesn't serve MJPEG (most RTSP/ONVIF/HLS cameras) leaves HA's
// camera_proxy_stream connection open without ever sending a frame — the
// <img> then fires neither load nor error, so without a watchdog the view
// would sit blank forever. Generous for an external tunnel's extra hops.
const STREAM_WATCHDOG_MS = 6000;
// How often to refresh the fallback snapshot, and how many consecutive
// failures to tolerate before declaring the camera unavailable.
const SNAPSHOT_INTERVAL_MS = 800;
const SNAPSHOT_MAX_ERRORS = 3;

export function cameraTiers(ws: HAWebSocket, entityId: string): CameraTier[] {
  return [
    {
      mode: "webrtc", element: "video",
      watchdogMs: WEBRTC_CONNECT_MS, afterConnectMs: WEBRTC_FRAME_MS,
      start(el, report) {
        const video = el as HTMLVideoElement;
        let cancelled = false;
        let stop: (() => void) | null = null;
        const onPlaying = () => report.frame();
        video.addEventListener("playing", onPlaying);
        (async () => {
          if (typeof RTCPeerConnection === "undefined") {
            report.fail("WebRTC unsupported in this browser");
            return;
          }
          if (!(await cameraSupportsWebRtc(ws, entityId))) {
            report.fail("camera offers no WebRTC");
            return;
          }
          if (cancelled) return;
          try {
            const s = await startCameraWebRtc(ws, entityId, video, {
              onConnected: () => report.connected(),
              onFail: (reason) => report.fail(reason),
            });
            if (cancelled) s(); else stop = s;
          } catch (err) {
            report.fail(`offer failed: ${(err as Error).message}`);
          }
        })();
        return () => {
          cancelled = true;
          video.removeEventListener("playing", onPlaying);
          stop?.();
        };
      },
    },
    {
      mode: "hls", element: "video", watchdogMs: HLS_WATCHDOG_MS,
      start(el, report) {
        const video = el as HTMLVideoElement;
        let cancelled = false;
        let hls: Hls | null = null;
        let native = false;
        const onPlaying = () => report.frame();
        // Native HLS has no error signal but the element's own. hls.js reports
        // through Hls.Events.ERROR instead, and its destroy() makes the element
        // fire an error of its own — which is why this listener is attached on
        // the native path only, and removed before any teardown.
        const onNativeError = () => report.fail("native video element error");
        video.addEventListener("playing", onPlaying);
        (async () => {
          try {
            // Loaded on demand — most kiosks never open a camera panel at all,
            // so hls.js (~165 KB gzipped) never reaches the main bundle.
            const { default: HlsJs } = await import("hls.js");
            if (cancelled) return;
            const canHlsJs = HlsJs.isSupported();
            // canPlayType("application/vnd.apple.mpegurl") is NOT a reliable
            // "can play HLS" signal — Chromium says "maybe" and then can't demux
            // the playlist. Native is trusted only where hls.js cannot run.
            const canNative =
              !canHlsJs && video.canPlayType("application/vnd.apple.mpegurl") !== "";
            if (!canHlsJs && !canNative) {
              report.fail("HLS unsupported in this browser");
              return;
            }
            const url = await cameraHlsUrl(ws, entityId);
            if (cancelled) return;
            if (canNative) {
              native = true;
              video.addEventListener("error", onNativeError);
              video.src = url;
              void video.play().catch(() => {}); // autoplay may need a tap; not an error
              return;
            }
            hls = new HlsJs({ lowLatencyMode: true });
            // Non-fatal errors (a transient bufferStalledError) are recovered by
            // hls.js itself; only a fatal one means the stream cannot continue.
            hls.on(HlsJs.Events.ERROR, (_evt, data) => {
              if (data.fatal) report.fail(`hls.js fatal error: ${data.details}`);
            });
            // play() only once the manifest is in — calling it straight after
            // attachMedia, with nothing buffered, is a known way to have
            // autoplay silently dropped.
            hls.on(HlsJs.Events.MANIFEST_PARSED, () => { void video.play().catch(() => {}); });
            hls.loadSource(url);
            hls.attachMedia(video);
          } catch (err) {
            report.fail(`stream URL request failed: ${(err as Error).message}`);
          }
        })();
        return () => {
          cancelled = true;
          video.removeEventListener("playing", onPlaying);
          video.removeEventListener("error", onNativeError);
          if (hls) {
            // hls.js owns the MediaSource it attached; destroy() is its whole
            // teardown. Clearing src on top of it would only add a spurious
            // native error from our own teardown.
            hls.destroy();
          } else if (native) {
            video.removeAttribute("src");
            video.load();
          }
        };
      },
    },
    {
      mode: "stream", element: "img", watchdogMs: STREAM_WATCHDOG_MS,
      start(el, report) {
        const img = el as HTMLImageElement;
        const onLoad = () => report.frame();
        const onError = () => report.fail("MJPEG image error");
        img.addEventListener("load", onLoad);
        img.addEventListener("error", onError);
        img.src = cameraStreamUrl(entityId);
        return () => {
          img.removeEventListener("load", onLoad);
          img.removeEventListener("error", onError);
          // Ends the open multipart connection, which otherwise outlives the
          // tier for as long as the element does.
          img.removeAttribute("src");
        };
      },
    },
    {
      mode: "snapshot", element: "img",
      start(el, report) {
        const img = el as HTMLImageElement;
        const base = cameraSnapshotUrl(entityId);
        const sep = base.includes("?") ? "&" : "?";
        let n = 0;
        let errors = 0;
        // Cache-bust each poll so the browser actually re-requests the frame.
        const poll = () => { img.src = `${base}${sep}_=${n++}`; };
        const onLoad = () => { errors = 0; report.frame(); };
        const onError = () => {
          if (++errors >= SNAPSHOT_MAX_ERRORS) report.fail(`${errors} snapshots in a row failed`);
        };
        img.addEventListener("load", onLoad);
        img.addEventListener("error", onError);
        poll();
        const id = setInterval(poll, SNAPSHOT_INTERVAL_MS);
        return () => {
          clearInterval(id);
          img.removeEventListener("load", onLoad);
          img.removeEventListener("error", onError);
        };
      },
    },
  ];
}
