// src/components/hud/FirstRunTips.tsx
// One-time orientation card for a kiosk's first-ever login (see
// utils/storage.ts's hasSeenFirstRunTips for the per-device "seen" gate).
// Addresses two related gaps at once rather than as separate, competing
// overlays: the HUD's icon-only chrome has no text labels to learn from, and
// several controls' long-press actions had no discovery path beyond a hover
// tooltip (useless on a touchscreen kiosk). A non-blocking card, not a guided
// tour — dismiss by tapping the backdrop or "Got it", never shown again on
// this device either way.

import { Armchair, Compass, Info } from "lucide-react";
import { markFirstRunTipsSeen } from "@/utils/storage";
import { useBackToClose } from "@/hooks/useBackToClose";

export default function FirstRunTips({ onClose }: { onClose: () => void }) {
  // Back closes this, never the app: only the villa map lets a press through
  // to the platform. One line per surface, from the shared hook.
  useBackToClose(() => { markFirstRunTipsSeen(); onClose(); });
  const dismiss = () => { markFirstRunTipsSeen(); onClose(); };
  return (
    // panel-modal-backdrop/panel-modal: this is short content, so on mobile it
    // gets the same small centered rounded card as the device panel — without
    // these it fell through to the base full-screen top-anchored sheet meant
    // for long forms (Settings), which is why it rendered up at the top with a
    // big empty area below instead of centered like every other popup.
    <div className="modal-backdrop panel-modal-backdrop first-run-backdrop" onClick={dismiss}>
      <div className="modal panel-modal first-run-tips" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Quick tips</h2>
        </div>
        <div className="settings-body">
          <ul className="first-run-tip-list">
            <li>
              <Armchair size={18} />
              <span>The colored icons in the top bar filter which devices show on the map — tap one to hide or show that category.</span>
            </li>
            <li>
              <Compass size={18} />
              <span>A button with a small <span className="first-run-dot-demo" aria-hidden="true" /> dot also does something extra when you press and hold it — try holding the compass button to manage rooms.</span>
            </li>
            <li>
              <Info size={18} />
              <span>Tap the <strong>?</strong> icon anytime to see what the map's colors mean.</span>
            </li>
          </ul>
        </div>
        <div className="settings-footer">
          <span />
          <button className="btn primary" onClick={dismiss}>Got it, thanks</button>
        </div>
      </div>
    </div>
  );
}
