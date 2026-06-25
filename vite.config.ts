import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath, URL } from "node:url";

// The app is served by Home Assistant under /local/villa-kiosk/.
// A relative base ("./") keeps every asset reference working regardless of the
// exact sub-path it is mounted on, and also lets it run from `vite preview`.
export default defineConfig(({ command }) => ({
  base: "./",
  // Serve `npm run dev` / `npm run preview` over HTTPS (self-signed). PWA install
  // and service-worker registration require a SECURE CONTEXT — https:// or
  // localhost. When you open the dev server from another device by its LAN IP it's
  // plain http, so the browser hides the install button and skips the SW. The
  // self-signed cert triggers a one-time "proceed anyway" warning, after which the
  // origin counts as secure and the PWA install prompt appears. Dev/preview only —
  // the production build is static files served by HA's own HTTPS.
  plugins: [react(), ...(command === "serve" ? [basicSsl()] : [])],
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
  },
  optimizeDeps: {
    // The Inspector is large and only loaded on demand (calibration). Keep it out
    // of dev pre-bundling so the dev server starts fast and doesn't choke on it.
    exclude: ["@babylonjs/inspector"],
  },
}));
