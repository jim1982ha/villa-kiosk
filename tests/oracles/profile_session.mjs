// The life of this device's sign-in (auth/profileSession.ts), driven by value
// with stand-in adapters — until 2.496.233 it lived in two screen files and
// the oracles could only search their text. Also the one "opened inside Home
// Assistant" rule (ha/ingress.ingressBaseOf).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { ProfileSession } = await import("@/auth/profileSession");
const { ingressBaseOf } = await import("@/ha/ingress");

/** A session over stand-ins; `server` is what the server answers. */
function make({ stored = null, server = "none", everywhere = true } = {}) {
  const log = [];
  let tab = stored, pending = null, answer = server;
  const s = new ProfileSession({
    stored: { read: () => tab, write: (r) => { tab = r; log.push(`stored:${r}`); }, clear: () => { tab = null; log.push("stored:clear"); } },
    pendingLost: { take: () => { const p = pending; pending = null; return p; }, put: (r) => { pending = r; log.push(`pending:${r.source}`); } },
    askServer: async () => { log.push("ask"); return answer; },
    signOut: () => log.push("signOut"),
    signOutEverywhere: async () => { log.push("everywhere"); return everywhere; },
    forget: () => log.push("forget"),
    signedIn: () => log.push("signedIn"),
    report: (r) => log.push(`report:${r.source}`),
    now: () => 1000,
  });
  return { s, log, setAnswer: (a) => { answer = a; } };
}

console.log("  at start:");
{
  const a = make({ server: { role: "owner" } });
  ck("nothing in this tab: it asks the server, and resolves", a.s.getState().resolving);
  await a.s.start();
  ck("  ...the server's session is taken — without a person's `auth` mark", a.s.getState().role === "owner" && !a.log.includes("signedIn") && !a.s.getState().resolving, a.log.join());
  const b = make({ server: "none" });
  await b.s.start();
  ck("the server says NO session: the cached floor plan is cleared (it survived a session that ended while closed)",
     b.s.getState().role === null && b.log.includes("forget"), b.log.join());
  const c = make({ server: "unknown" });
  await c.s.start();
  ck("the server cannot be reached: nothing is cleared (an offline wall iPad keeps its villa)", !c.log.includes("forget"), c.log.join());
  const d = make({ stored: "guest" });
  await d.s.start();
  ck("remembered in this tab: straight in, no question", d.s.getState().role === "guest" && !d.log.includes("ask"));
}

console.log("\n  signing in and out:");
{
  const a = make();
  a.s.login("ops");
  ck("login: signed in, remembered, and the model prefetch / auth mark run once", a.s.getState().role === "ops" && a.log.join() === "signedIn,stored:ops", a.log.join());
  a.log.length = 0; a.s.logout();
  ck("logout: the server is told, the tab forgets, the cache is cleared", a.log.join() === "signOut,stored:clear,forget" && a.s.getState().role === null, a.log.join());
  const b = make({ stored: "owner", everywhere: false });
  ck("sign every device out: this one stays when the server did not confirm", (await b.s.logoutAll()) === false && b.s.getState().role === "owner");
  const c = make({ stored: "owner" });
  ck("  ...and signs out when it did", (await c.s.logoutAll()) === true && c.s.getState().role === null && c.log.includes("forget"));
  const d = make({ stored: "owner" });
  d.s.beginSwitch();
  ck("switching keeps the profile underneath (no reload of the villa)", d.s.getState().switching && d.s.getState().role === "owner");
  d.s.login("guest");
  ck("  ...and a sign-in ends the switch", !d.s.getState().switching && d.s.getState().role === "guest");
}

console.log("\n  the server refusing this device:");
{
  const a = make({ stored: "owner", server: "unknown" });
  await a.s.sessionLost("socket 4401");
  ck("the server unreachable: the profile is kept", a.s.getState().role === "owner");
  a.setAnswer("none");
  await a.s.sessionLost("http fm-data");
  ck("the server says no session: signed out, the cache cleared, the report kept for later",
     a.s.getState().role === null && a.log.includes("forget") && a.log.includes("pending:http fm-data"), a.log.join());
  a.log.length = 0; a.s.login("owner");
  ck("  ...and the report goes out with the next sign-in", a.log.includes("report:http fm-data"), a.log.join());
}

console.log("\n  opened inside Home Assistant:");
ck("the Ingress base of a sidebar path", ingressBaseOf("/api/hassio_ingress/abc123/index.html") === "/api/hassio_ingress/abc123/");
ck("the add-on's own hostname is not Ingress", ingressBaseOf("/index.html") === null);
ck("a path merely CONTAINING the words is not either (the looser check said it was)", ingressBaseOf("/api/hassio_ingress/") === null);

done("✅ one sign-in life: a session gone at start clears the cache; offline keeps it");
