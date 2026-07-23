import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

// Lists every emitted /assets/ file (content-hashed JS/CSS/wasm — the Babylon
// engine chunk, Draco decoder, HLS chunk, app shell) into dist/asset-manifest.json
// so the service worker can PRECACHE them all at install time (in the
// background, while the previous version is still serving) instead of only
// ever caching reactively on first fetch. Without this, a deploy that changes
// one of those chunks pays its full download cost live, in the loading
// spinner, on whichever open happens to be the first after the update — see
// public/sw.js's install handler, which fetches this file.
function assetManifestPlugin(): Plugin {
  return {
    name: "villa-kiosk-asset-manifest",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir ?? "dist";
      const assetsDir = path.join(outDir, "assets");
      if (!fs.existsSync(assetsDir)) return;
      const assets = fs
        .readdirSync(assetsDir)
        .filter((f) => !f.endsWith(".map"))
        .map((f) => `assets/${f}`);
      fs.writeFileSync(
        path.join(outDir, "asset-manifest.json"),
        JSON.stringify({ assets }),
      );
    },
  };
}

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

// Bake the running version into the bundle (Advanced Settings footer) so a
// kiosk's Settings screen can show which build is actually deployed, without
// a separate network call. package.json/villa-kiosk/config.yaml are already
// bumped together per this repo's release convention, so this always matches.
const pkgVersion = (JSON.parse(fs.readFileSync("./package.json", "utf-8")) as { version: string }).version;

export default defineConfig(({ command }) => {
  const serving = command === "serve";
  const haveTrustedCert =
    serving && fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT);

  if (serving) {
    // Tell the user which cert is in play, so a missing install button / cert
    // warning is easy to diagnose (basic-ssl is untrusted → no PWA install).
    console.log(
      haveTrustedCert
        ? `\x1b[32m[vite] HTTPS using trusted cert from ${CERT_CRT} — PWA install should work.\x1b[0m`
        : `\x1b[33m[vite] HTTPS using self-signed basic-ssl (UNTRUSTED). The browser will warn ` +
          `and Chrome will NOT show the install button. Drop a trusted mkcert cert at ` +
          `${CERT_KEY} + ${CERT_CRT} for a working PWA.\x1b[0m`,
    );
  }

  return {
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    plugins: [
      react(),
      assetManifestPlugin(),
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
          // Babylon is large — split it so the React shell can paint first.
          // Function form: Vite 8's rolldown bundler dropped the object form
          // ("manualChunks is not a function" build error).
          manualChunks(id: string) {
            if (id.includes("node_modules/@babylonjs/")) return "babylon";
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      // Allow access through a reverse proxy / any external host (dev only).
      // The production build is static files served by the add-on's nginx, so
      // this only affects `npm run dev`.
      allowedHosts: true,
      // The app now ALWAYS talks to the add-on backend (proxy-injected token,
      // server-verified PINs, session cookie, /model, /addon-config) — there's
      // no standalone/token path left. So for `npm run dev` to reach a real HA,
      // forward those backend routes to a running add-on instance. Point
      // VITE_DEV_PROXY at the add-on's own hostname/port (e.g.
      // http://homeassistant.local:8099) in your .env. Without it, dev serves
      // the UI shell but backend calls 404 (fine for pure visual work).
      ...(process.env.VITE_DEV_PROXY
        ? {
            proxy: Object.fromEntries(
              ["/core", "/auth", "/addon-config", "/model", "/model-upload"].map((p) => [
                p,
                {
                  target: process.env.VITE_DEV_PROXY,
                  changeOrigin: true,
                  ws: p === "/core",
                  secure: false,
                },
              ]),
            ),
          }
        : {}),
      // A trusted cert (mkcert) lets Chrome register the SW; basic-ssl can't.
      ...(haveTrustedCert
        ? { https: { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) } }
        : {}),
    },
    optimizeDeps: {
      // Pre-bundle the heavy, statically-imported deps up front so the optimizer
      // does ONE cold pass at startup. Otherwise Vite discovers them lazily on the
      // first page request and kicks off a SECOND optimize pass ("updating
      // dependencies"); that pass writes into node_modules/.vite/deps_temp_* and can
      // race its own commit, failing with `ENOENT ... deps_temp_*/_metadata.json` —
      // especially on slower/external filesystems where the temp rename lags.
      // Listed specifiers must match what src actually imports (deep subpaths
      // included), or Vite warns "Failed to resolve dependency … in optimizeDeps".
      include: [
        "react",
        "react-dom/client",
        "react-router-dom",
        "lucide-react",
        "@babylonjs/core",
        "@babylonjs/gui",
        "@babylonjs/loaders/glTF",
        "@babylonjs/materials/sky/skyMaterial",
      ],
      // The Inspector is large and only loaded on demand (calibration). Keep it out
      // of dev pre-bundling so the dev server starts fast and doesn't choke on it.
      exclude: ["@babylonjs/inspector"],
    },
  };
});
