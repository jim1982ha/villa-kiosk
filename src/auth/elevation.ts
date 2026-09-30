// src/auth/elevation.ts
// Client for the one-shot superadmin elevation (POST /auth/elevate).
//
// This is NOT a login and deliberately looks nothing like one: it mints no
// session, changes no profile, and there is nothing to sign out of. A correct
// code returns a single token that authorises exactly ONE destructive write —
// the server consumes it on use, so it cannot be replayed or saved for later.
//
// The privilege is real because the SERVER enforces it: it rejects any write
// that removes a Facility Manager record without a fresh token, whatever the
// client believes. This module only carries the token; it grants nothing.

import { ingressPath } from "@/ha/ingress";
import { askPin, type PinOutcome } from "./pinOutcome";

/** Ask for a one-shot superadmin elevation. "accepted" carries the token;
 *  "closed" means no superadmin code is configured. Never throws. */
export async function requestElevation(pin: string): Promise<PinOutcome> {
  return askPin(ingressPath("auth/elevate"), { pin });
}
