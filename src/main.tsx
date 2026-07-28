import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* HashRouter so deep links work under the HA Ingress prefix and on the
        add-on's own hostname alike, without server-side route config. */}
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </StrictMode>,
);
