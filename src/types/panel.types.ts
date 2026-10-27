import type { HassEntity } from "./ha.types";
import type { EntityMapping } from "./scene.types";

/** Identifies the currently open entity panel (or null when closed).
 *
 *  Every entity has exactly ONE compact panel, chosen from its type by
 *  PanelRouter (GenericPanel's state + 24h history is the fallback for types
 *  with no controls of their own — see there). Tap and long-press both land
 *  on it UNLESS the type has a distinct "quick action" for tap, exactly the
 *  same split isQuickToggle already makes for light/switch/fan (tap = instant
 *  toggle, no panel at all; long-press = the compact panel). Camera is the
 *  other type with a quick action: tap = jump straight into the live feed.
 *  Long-press must therefore ask for the compact panel EXPLICITLY (`detail`)
 *  — without it, camera's own PanelRouter case (the feed) is what long-press
 *  would resolve to as well, since nothing else distinguishes the two calls,
 *  and a camera long-pressed for "give me details" has no business jumping
 *  into the live view a plain tap already reaches. This is not a type-based
 *  exception in the "one more if-camera" sense: it's the SAME quick-action/
 *  compact-panel pair every toggleable type gets, just expressed as a flag
 *  because camera's quick action still opens *a* panel (the feed) rather than
 *  skipping the panel entirely. */
export interface ActivePanel {
  entityId: string;
  detail?: boolean;
}

/** The open device window as the device is set NOW (components/panels/openDevice, resolved on every render from the
 *  live config and the profile): `mapping` as stored, `label` as every screen names it.
 *
 *  ⚠️ THE WINDOW KEPT THE DEVICE AS IT WAS WHEN IT OPENED (architecture review P, 2026-10-27): the open panel held a
 *  copy of its mapping, so a device renamed or set to "ask before switching" in Advanced Settings came back under its
 *  old name and switched without asking, while the map already used the new settings; only the badge colour and the
 *  linked switch looked again, each by its own patch. The screen state holds which device is open, never its settings. */
export interface OpenDevice extends ActivePanel {
  mapping: EntityMapping;
  label: string;
}

export interface PanelProps {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  onClose: () => void;
}
