#!/usr/bin/env node
/**
 * Deploy the built app to Home Assistant's www folder over SSH/SCP.
 * Target is read from env (.env): VITE_DEPLOY_HOST / USER / PATH.
 *
 *   npm run build && npm run deploy
 *
 * Requires `ssh`/`scp` on PATH and key-based access to HA (or you'll be prompted
 * for a password per file). See README.md for the full walkthrough.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function loadEnv() {
  const env = { ...process.env };
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const host = env.VITE_DEPLOY_HOST;
const user = env.VITE_DEPLOY_USER || "root";
const path = env.VITE_DEPLOY_PATH || "/config/www/villa-kiosk";

if (!host) {
  console.error("✖ VITE_DEPLOY_HOST is not set. Add it to .env (see .env.example).");
  process.exit(1);
}
if (!existsSync("dist")) {
  console.error("✖ No dist/ folder. Run `npm run build` first.");
  process.exit(1);
}

const target = `${user}@${host}`;
console.log(`→ Deploying dist/ to ${target}:${path}`);

try {
  execSync(`ssh ${target} "mkdir -p ${path}"`, { stdio: "inherit" });
  // Trailing /. copies contents (not the dir itself).
  execSync(`scp -r dist/. ${target}:${path}/`, { stdio: "inherit" });
  console.log(`✓ Deployed. Open: http://${host}:8123/local/villa-kiosk/`);
} catch (err) {
  console.error("✖ Deploy failed:", err.message);
  process.exit(1);
}
