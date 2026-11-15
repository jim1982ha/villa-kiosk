// src/auth/remoteSignIn.ts
// The remote access sign-in in front of VESTA (an access gate on its public address) expired: say so, and offer the
// one tap that signs in again.
//
// ⚠️ FIVE STEPS FOR ONE EXPIRED SIGN-IN (owner, 2026-11-15): the gate answered every request with a redirect to its
// own sign-in page; a request from the page cannot follow it, so the passcode pad said "Couldn't reach the passcode
// service", and the app's offline copy (public/sw.js: the page from its own cache first) never let the gate's page
// show. Getting back in took deleting the app, clearing the site's data, reopening the address and installing it
// again. Now a failed request asks once whether the gate is redirecting (`signInExpired`), and "Sign in again" opens
// the address past the offline copy (`signInAgain`): the gate's sign-in, then VESTA.

import { ingressPath, underIngress } from "@/ha/ingress";
import { withServiceWorkerBypass } from "@/utils/fetchProgress";

/** What the screens say, and the button. */
export const SIGN_IN_EXPIRED = "Your remote access sign-in has expired.";
export const SIGN_IN_AGAIN = "Sign in again";

/** Whether a request to VESTA is being redirected away (an access gate's sign-in page) rather than answered: a
 *  same-origin request VESTA answers is never a redirect, so a redirect is the gate. Never inside the villa's own app
 *  (no gate there). False when it cannot tell (no connection at all: that is a connection problem, said as such). */
export async function signInExpired(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (underIngress()) return false;
  try {
    const res = await fetchImpl(withServiceWorkerBypass(ingressPath("auth/roles")),
      { redirect: "manual", cache: "no-store", credentials: "same-origin" });
    return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
}

/** Open VESTA's address again, past the app's offline copy, so the gate shows its sign-in and sends back to VESTA. */
export function signInAgain(): void {
  window.location.assign(withServiceWorkerBypass(`${window.location.origin}${ingressPath("")}`));
}
