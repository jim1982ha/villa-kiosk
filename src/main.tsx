import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorCapture } from "./utils/diagnostics";
import { installLifecycleTelemetry } from "./utils/telemetry";
import "./styles.css";

// Record uncaught errors / rejections to localStorage so one that fires just
// before a reload still surfaces in the next load's diagnostics report.
installGlobalErrorCapture();
// Page-lifecycle + WebGL signals — the trail that explains an iOS white
// screen after an app switch (see telemetry.ts / SceneManager.handlePageHide).
installLifecycleTelemetry();

// Register the PWA service worker (best-effort). Skip it under HA Ingress: the
// add-on is served from a per-session path (/api/hassio_ingress/<token>/), so a
// SW would re-register and accumulate caches each session for no benefit — HA
// already serves the shell there. On the add-on's OWN hostname (direct /
// Cloudflare, served at "/") the SW registers so the kiosk installs as a
// full-screen PWA with none of the HA UI around it.
const underIngress = location.pathname.includes("/api/hassio_ingress/");
if ("serviceWorker" in navigator && !underIngress) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("[SW] registration failed", err);
    });
  });
}

// Under Ingress, this page is ALWAYS embedded below HA's own chrome — the
// sidebar's top bar on desktop, or the Companion App's own toolbar (quick
// actions, notification bell, overflow menu) on iOS/Android — never touching
// the physical screen edge itself. HA's wrapper is what actually needs to
// clear the Dynamic Island / notch there, not us; our OWN safe-area-inset-top
// reservation on top of that stacked BELOW an already-cleared area, forcing a
// second, redundant gap and pushing every top-anchored element (the floor
// stack, the villa-name chip) down further than the villa's own UI needs.
// A user field report (iPhone, Ingress/Companion-App context specifically —
// confirmed NOT reproducing on the direct-hostname PWA, where this page IS
// the top-level document and genuinely owns that inset) is exactly this.
// Set once, before React mounts, so CSS (--safe-top, see styles.css) can act
// on it from first paint with no flash of the wrong layout. Left/right/bottom
// insets are untouched — HA's wrapper is a horizontal bar at the very top
// only, it doesn't help with the home indicator or a landscape side notch.
if (underIngress) document.documentElement.classList.add("vk-ingress");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* No router: the kiosk is a single screen. HashRouter existed so deep
        links survived the HA Ingress path prefix, but nothing ever linked to a
        second route — there are no route params, no useLocation, no #/ links.
        Serving one component directly keeps working identically under both the
        Ingress prefix and the add-on's own hostname. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
