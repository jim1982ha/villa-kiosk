// How a new build reaches the installed app (src/utils/swUpdate.ts,
// 2.496.256). The service worker now serves the page from its own saved copy,
// so a new build is a new WORKER left waiting; the page moves onto it at its
// next start (the wall tablet's 04:00 reload included) or when the update
// notice is tapped — always by asking it to skip waiting, then reloading.
// Driven with fake workers.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { switchToWaiting, whenUpdateReady } = await import("@/utils/swUpdate");

const worker = (state = "installed") => {
  const ls = [], sent = [];
  const w = {
    state, sent,
    postMessage: (m) => { sent.push(m); if (m?.type === "SKIP_WAITING" && w.autoActivate) { w.state = "activated"; ls.forEach((l) => l()); } },
    addEventListener: (_t, l) => ls.push(l),
    become: (s) => { w.state = s; ls.forEach((l) => l()); },
    autoActivate: true,
  };
  return w;
};
console.log("  switching to a waiting build:");
{
  const w = worker(); let reloads = 0;
  const r = { waiting: w, installing: null, addEventListener() {} };
  const did = await switchToWaiting(r, () => reloads++);
  ck("the page ASKS the waiting worker to take over, then reloads once it has", did && w.sent[0]?.type === "SKIP_WAITING" && reloads === 1);
  const none = await switchToWaiting({ waiting: null, installing: null, addEventListener() {} }, () => reloads++);
  ck("nothing waiting: nothing asked, no reload", none === false && reloads === 1);
  const slow = worker(); slow.autoActivate = false;
  const t0 = Date.now();
  await switchToWaiting({ waiting: slow, installing: null, addEventListener() {} }, () => reloads++, 50);
  ck("a worker that never reports 'activated' still ends in a reload (bounded wait)", reloads === 2 && Date.now() - t0 < 1000);
}

console.log("\n  offering an update that arrives while the app is open:");
{
  let ready = 0;
  const found = [];
  const r = { waiting: null, installing: null, addEventListener: (_t, l) => found.push(l) };
  whenUpdateReady(r, () => true, () => ready++);
  const w = worker("installing");
  r.installing = w; found.forEach((l) => l());
  ck("nothing is offered while the new build is still downloading", ready === 0);
  w.become("installed");
  ck("once it has installed, the update is offered", ready === 1);
  let first = 0;
  const r2 = { waiting: null, installing: null, addEventListener: (_t, l) => found.push(l) };
  const w2 = worker("installing");
  whenUpdateReady({ ...r2, installing: w2 }, () => false, () => first++);
  w2.become("installed");
  ck("the very FIRST install (no worker in control yet) is not an update — no notice", first === 0);
  let already = 0;
  whenUpdateReady({ waiting: worker(), installing: null, addEventListener() {} }, () => true, () => already++);
  ck("an update already waiting is offered at once", already === 1);
}

console.log("\n  who uses it:");
{
  const src = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
  const sw = src("src/utils/swUpdate.ts"), main = src("src/main.tsx");
  ck("startup switches at once when an update is already waiting (the wall tablet's nightly reload)",
     /getRegistration\(\)\.then\(\(reg\) => \{\s*if \(reg && reg\.waiting && controlled\(\)\) void switchToWaiting\(reg, \(\) => location\.reload\(\)\)/.test(sw));
  ck("main.tsx registers through it, never under Home Assistant", /if \("serviceWorker" in navigator && !insideHa\) startServiceWorker\("\.\/sw\.js"\)/.test(main)
     && !/serviceWorker\.register\(/.test(main));
  const worker = src("public/sw.js");
  ck("the worker serves content-hashed files from its copy and never refreshes them",
     /includes\("\/assets\/"\)\) \{\s*event\.respondWith\(\s*caches\.match\(req\)\.then\(\(cached\) => cached \|\| fetch\(req\)\.then\(cacheCopy\)\)/.test(worker));
}

done("✅ a new build reaches the installed app without a network wait on every open");
