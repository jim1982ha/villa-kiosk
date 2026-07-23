// src/components/hud/TapRipple.tsx
// Instant, non-committal "your tap registered" feedback for the in-scene
// quick-toggle gesture (tap a light/switch mesh -> instant on/off with no
// panel). That gesture calls Home Assistant over the network and waits for
// the real state_changed event before anything on screen changes — on a slow
// link that gap reads as "did that even work?". An optimistic on/off
// PREDICTION was tried here before and reverted (see CHANGELOG ~v2.32.7-20:
// mispredicted state on rapid taps, e.g. a fast ON then OFF). This sidesteps
// that failure mode entirely: it never predicts the outcome, just acknowledges
// the tap itself with a brief expanding ring at the tap point, purely in the
// DOM (zero Babylon/material involvement, so it can't race or desync from the
// real 3D state).
//
// Dashboard owns the ripple list (spawn on each quick-toggle tap, auto-expire
// after the animation).

export interface Ripple {
  id: number;
  x: number;
  y: number;
}

const RIPPLE_LIFETIME_MS = 500;

export { RIPPLE_LIFETIME_MS };

export default function TapRipple({ ripples }: { ripples: Ripple[] }) {
  if (ripples.length === 0) return null;
  return (
    <div className="tap-ripple-layer" aria-hidden="true">
      {ripples.map((r) => (
        <span key={r.id} className="tap-ripple" style={{ left: r.x, top: r.y }} />
      ))}
    </div>
  );
}
