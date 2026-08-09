// src/components/panels/PanelActionsContext.ts
// Header extras the shared BasePanel shows for whichever device panel is open —
// the HA entity_id it controls, and a shortcut to edit that entity in Advanced
// Settings. Provided by Dashboard (which knows the active entity + permissions)
// so BasePanel needn't be threaded through all ten panel components.

import { createContext, useContext } from "react";
import type { Category } from "@/types/scene.types";
import type { DeviceSurfaceState } from "@/config/EntityCategories";

export interface PanelActions {
  /** The HA entity_id the open panel controls (shown under the title). */
  entityId?: string;
  /** Open Advanced Settings focused on this entity. Undefined when the current
   *  profile may not edit config — the edit button is then hidden. */
  onEdit?: () => void;
  /** Raise a maintenance fault against the open device — opens the Facility
   *  workspace on the Faults tab with this device already filled in.
   *
   *  The point is the moment of noticing. Someone walking the villa taps the
   *  badge of a lamp that will not come on; before this, acting on that meant
   *  closing the panel, opening Facility, finding Faults, and searching for
   *  the device they had just been looking at — four steps and a name they
   *  may not know. Undefined for profiles without manageFacility, which is
   *  what hides the button. */
  onReportFault?: () => void;
  /** Everything BasePanel needs to render THIS device's exact map badge in its
   *  header (same glyph + colour as the 3D view) and make it a colour editor.
   *  Provided by Dashboard, which knows the live entity + config. */
  badge?: {
    category: Category;
    iconKey: string;
    /** Current per-entity override (#rrggbb), or undefined for category default. */
    color?: string;
    /** Representative category colour, for the picker's "default" chip. */
    categoryColor: string;
    /** Drives the header icon's fill/glyph/ring exactly like its map badge
     *  (see config/EntityCategories.categorySurface + babylon/badgeIcons.ts,
     *  which bakes this into the same image both places use) — "unavailable"
     *  is the SAME isUnavailable() every status pill already reads, "alert"
     *  is set whenever this device's linked entity (EntityMapping.
     *  linkedEntityId, set in Advanced Settings) is presently "on", plus a
     *  binary_sensor's own "on" state — computed the same way the map badge
     *  is (live entity state, no separate lookup), just DOM-side. */
    state: DeviceSurfaceState;
  };
  /** Persist a new badge colour for the open entity (null = category default).
   *  Undefined when the profile may not edit config — the badge is then a plain,
   *  non-interactive icon. */
  onSetBadgeColor?: (hex: string | null) => void;
  /** The open device's LINKED entity (EntityMapping.linkedEntityId), when one
   *  is configured and the profile may control it. Renders as an on/off switch
   *  in the shared panel chrome, so EVERY device type gets it for free the
   *  moment that field is set — no per-panel wiring, no type checks. Toggling
   *  it is what drives the badge's red ring (see EntityVisuals' linkActiveIds),
   *  which is why the two live and die together. Undefined = no linked entity
   *  configured, or read-only profile: the switch is then not rendered. */
  linked?: {
    /** Resolved display name of the linked entity, for the switch's label. */
    label: string;
    /** Live state — drives both the switch position and the header ring. */
    isOn: boolean;
    toggle: () => void;
  };
  /** The open camera's MOTION sensor (EntityMapping.motionEntityId), when one
   *  is configured — camera-only, unlike linkedEntityId above. Read-only: it
   *  reports what HA already knows (and drives the map's detection beam), not
   *  something this panel can flip, so there is no toggle — just the current
   *  reading, so a camera's own panel can finally show that a motion sensor
   *  is wired up to it at all instead of that being invisible outside
   *  Advanced Settings. Undefined = no motion sensor configured for this
   *  camera, or the open panel isn't a camera. */
  motion?: {
    /** Resolved display name of the motion sensor entity. */
    label: string;
    /** Live state — "Motion detected" vs "Clear". */
    isOn: boolean;
  };
}

const PanelActionsContext = createContext<PanelActions>({});
export const PanelActionsProvider = PanelActionsContext.Provider;
export const usePanelActions = (): PanelActions => useContext(PanelActionsContext);
