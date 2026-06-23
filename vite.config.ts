import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The app is served by Home Assistant under /local/villa-kiosk/.
// A relative base ("./") keeps every asset reference working regardless of the
// exact sub-path it is mounted on, and also lets it run from `vite preview`.
export default defineConfig({
  base: "./",
  plugins: [react()],
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
});
