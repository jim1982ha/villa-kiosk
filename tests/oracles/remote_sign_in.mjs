// An expired remote access sign-in (auth/remoteSignIn, owner 2026-11-15): the passcode pad and the profiles say so,
// with one button that opens VESTA's address past the app's offline copy. The gate is a redirect away from VESTA's
// own answer; no connection at all stays "couldn't reach".
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { h, draw } = await import("../consistency/screen.mjs");

let opened = null;
globalThis.window = { location: { pathname: "/", origin: "http://localhost", href: "http://localhost/",
  assign: (u) => { opened = u; } } };
globalThis.location = globalThis.window.location;
const { askPin } = await import("@/auth/pinOutcome");
const { signInExpired, signInAgain, SIGN_IN_EXPIRED, SIGN_IN_AGAIN } = await import("@/auth/remoteSignIn");
const { default: SignInAgain } = await import("@/components/auth/SignInAgain");

const gate = async (url, init) => {
  if (init?.redirect === "manual") return { type: "opaqueredirect", status: 0 };
  throw new TypeError("Failed to fetch");             // the page's own request cannot follow the gate's redirect
};
const offline = async () => { throw new TypeError("Failed to fetch"); };
const vesta = async (url, init) => init?.method === "POST"
  ? new Response(JSON.stringify({ ok: true }), { status: 200 })
  : new Response(JSON.stringify({ roles: {} }), { status: 200 });

globalThis.fetch = gate;
ck("behind an expired sign-in, the passcode answers \"sign in again\", not \"couldn't reach\"",
   (await askPin("/auth/verify", { role: "owner", pin: "1234" })).kind === "signIn");
globalThis.fetch = offline;
ck("  ...with no connection at all, it stays \"couldn't reach\"",
   (await askPin("/auth/verify", { role: "owner", pin: "1234" })).kind === "unavailable");
globalThis.fetch = vesta;
ck("  ...and VESTA's own answer is unchanged", (await askPin("/auth/verify", { role: "owner", pin: "1234" })).kind === "accepted"
   && (await signInExpired()) === false);

globalThis.window.location.pathname = "/api/hassio_ingress/abc/";
globalThis.fetch = gate;
ck("inside the villa's own app there is no gate: never \"sign in again\"", (await signInExpired()) === false);
globalThis.window.location.pathname = "/";

const shown = draw(h(SignInAgain, {}));
ck("the screen says the sign-in expired, in a problem line, with its one button",
   shown.includes(SIGN_IN_EXPIRED) && shown.includes(SIGN_IN_AGAIN) && /class="problem-line"/.test(shown), shown);
signInAgain();
ck("  ...which opens VESTA's address past the offline copy", opened === "http://localhost/?vk-sw-bypass=1", opened);

done("✅ an expired remote sign-in is said, with one way back in");
