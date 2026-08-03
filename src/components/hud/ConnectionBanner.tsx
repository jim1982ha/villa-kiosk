// src/components/hud/ConnectionBanner.tsx
// A persistent, unmissable notice while the Home Assistant socket is down.
//
// The problem this fixes: the ONLY connection indicator was a small coloured
// dot in the top bar's brand chip, and that dot is deliberately display:none
// below 640px (it was colliding with the category row — a real layout fix,
// not something to undo). So on a phone, and on the wall tablet in portrait,
// a dropped connection was completely invisible. Every control still looked
// live, every tap still did nothing, and the only feedback was a service-call
// toast that may not even fire — a dead socket often fails silently rather
// than erroring. The user's reasonable conclusion is "this app is broken".
//
// Deliberately a BANNER, not a disabled state on every control:
//   * Disabling ~40 scattered controls would need every one of them to learn
//     about connection state, and would still leave the user without an
//     explanation for why everything went grey.
//   * A reconnect here is usually seconds (HAWebSocket retries on its own),
//     so hard-disabling would flicker the whole UI on a brief blip.
//   * One banner states the cause once, in words, and disappears by itself.
// The controls stay tappable on purpose: a queued tap that lands right as the
// socket returns is better than a control the user couldn't press at all.
//
// Not shown while merely "connecting" on FIRST load — the villa is still
// behind its own loading overlay then, and a "disconnected" banner over a
// loading screen reads as a failure when nothing has gone wrong yet.

import { useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";

/** Grace period before saying anything. A socket that drops and recovers
 *  within a second or two (a phone waking, a brief AP roam) should not flash
 *  an alarming banner — this is the difference between an indicator that
 *  informs and one that cries wolf. */
const GRACE_MS = 2500;

export default function ConnectionBanner() {
  const { connection } = useHA();
  const [show, setShow] = useState(false);
  // Only warn about a connection that was previously ESTABLISHED. The very
  // first connect happens behind the loading overlay; surfacing it there
  // would report a normal cold start as a fault.
  const everConnected = useRef(false);

  useEffect(() => {
    if (connection === "connected") {
      everConnected.current = true;
      setShow(false);
      return;
    }
    if (!everConnected.current) return;
    const t = setTimeout(() => setShow(true), GRACE_MS);
    return () => clearTimeout(t);
  }, [connection]);

  if (!show) return null;

  return (
    // role="status" + aria-live="polite": announced once when it appears,
    // without interrupting whatever a screen-reader user is currently on.
    // Deliberately not role="alert" (assertive) — the connection dropping is
    // important context, not an emergency that should cut someone off
    // mid-sentence, and it re-announces on every reconnect cycle.
    <div className="connection-banner" role="status" aria-live="polite">
      <WifiOff size={15} />
      <span>
        Disconnected from Home Assistant — reconnecting…
        {" "}
        <span className="muted">Controls won&rsquo;t respond until this clears.</span>
      </span>
    </div>
  );
}
