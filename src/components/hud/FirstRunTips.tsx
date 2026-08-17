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
import { useModalA11y } from "@/hooks/useModalA11y";

export default function FirstRunTips({ onClose }: { onClose: () => void }) {
  const dismiss = () => { markFirstRunTipsSeen(); onClose(); };
  // ── THE WHOLE DIALOG CONTRACT, NOT HALF OF IT (2.433.0) ──────────────────
  // This called `useBackToClose` directly and had no focus trap, no Escape and
  // no focus restore — it did one quarter of what every other surface sharing
  // the `.modal-backdrop` shell does. `useModalA11y` registers back-to-close
  // ITSELF (see its line 58: "registered here rather than per surface, because
  // 'this is a dialog' is the whole of what qualifies something"), so the old
  // call was the exact duplicate that hook exists to absorb.
  //
  // The gap mattered most here of anywhere. useModalA11y's own header names the
  // failure: behind every dialog sits the full-screen Babylon canvas and the
  // whole HUD, so a Tab out of an open dialog "walked into the live villa
  // controls underneath, still visually covered by the scrim — the user could
  // then click a light they couldn't see". This card is shown on a kiosk's
  // FIRST-EVER login, to someone who has never seen the app, and it is the one
  // surface whose entire job is teaching the controls it was letting them
  // blunder into.
  //
  // Found by /dry-audit's negative space: `grep -L useModalA11y` over everything
  // rendering the modal shell. RoomChoiceSheet's header documents the same
  // journey one step further along — it composed BasePanel to stop hand-rolling
  // this. Composing the panel shell here too is the tidier end state; the hook
  // is the part that was a defect.
  const dialogRef = useModalA11y(dismiss);
  return (
    // panel-modal-backdrop/panel-modal: this is short content, so on mobile it
    // gets the same small centered rounded card as the device panel — without
    // these it fell through to the base full-screen top-anchored sheet meant
    // for long forms (Settings), which is why it rendered up at the top with a
    // big empty area below instead of centered like every other popup.
    <div className="modal-backdrop panel-modal-backdrop first-run-backdrop" onClick={dismiss}>
      <div ref={dialogRef} className="modal panel-modal first-run-tips" role="dialog" aria-modal="true" aria-label="Quick tips" onClick={(e) => e.stopPropagation()}>
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
