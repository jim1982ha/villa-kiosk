import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import { fileURLToPath, URL } from "node:url";

// PWA install + service-worker registration require a SECURE CONTEXT (https:// or
// localhost). Opening the dev server from another device by its LAN IP over plain
// http hides the install button and skips the SW, so `npm run dev` is served over
// HTTPS. Two ways to get a cert, in priority order:
//
//   1. TRUSTED cert in ./certs/ (key.pem + cert.pem) — used if present. Generate
//      with mkcert so it's trusted by your devices, which is what Chrome needs to
//      actually REGISTER the service worker / show the install prompt:
//          mkcert -install
//          mkcert -key-file certs/key.pem -cert-file certs/cert.pem <your-LAN-IP> localhost
//
//   2. Self-signed via @vitejs/plugin-basic-ssl (fallback, zero setup). This makes
//      the origin https:// after a one-time "proceed anyway" warning — enough for a
//      secure context, but Chrome still BLOCKS the service worker with an SSL error
//      ("An SSL certificate error occurred when fetching the script") because the
//      cert isn't trusted. Firefox, which honours the manual exception, works fully.
//      For a working install button on Chrome in dev, use option 1.
//
// Dev/preview only — the production build is static files served by HA's own HTTPS.
const CERT_KEY = "./certs/key.pem";
const CERT_CRT = "./certs/cert.pem";

export default defineConfig(({ command }) => {
  const serving = command === "serve";
  const haveTrustedCert =
    serving && fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT);

  return {
    base: "./",
    plugins: [
      react(),
      // Only fall back to a self-signed cert when no trusted cert is provided.
      ...(serving && !haveTrustedCert ? [basicSsl()] : []),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      target: "es2020",
      outDir: "dist",
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks: {
            // Babylon is large — split it so the React shell can paint first.
            babylon: ["@babylonjs/core", "@babylonjs/loaders", "@babylonjs/materials", "@babylonjs/gui"],
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      // Allow access through a reverse proxy / any external host (dev only).
      // The production build is static files served by Home Assistant, so this
      // only affects `npm run dev`.
      allowedHosts: true,
      // A trusted cert (mkcert) lets Chrome register the SW; basic-ssl can't.
      ...(haveTrustedCert
        ? { https: { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) } }
        : {}),
    },
    optimizeDeps: {
      // The Inspector is large and only loaded on demand (calibration). Keep it out
      // of dev pre-bundling so the dev server starts fast and doesn't choke on it.
      exclude: ["@babylonjs/inspector"],
    },
  };
});
