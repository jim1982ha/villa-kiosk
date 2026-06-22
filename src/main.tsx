import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

// Register the PWA service worker (best-effort). Skip it under HA Ingress: the
// add-on is served from a per-session path (/api/hassio_ingress/<token>/), so a
// SW would re-register and accumulate caches each session for no benefit — HA
// already serves the shell. The /local/ and standalone deployments keep the PWA.
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
    {/* HashRouter so deep links work under HA's /local/villa-kiosk/ static mount. */}
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </StrictMode>,
);
