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
    /** Drives the header icon's FILL and GLYPH exactly like its map badge
     *  (config/EntityCategories.categorySurface + babylon/badgeIcons.ts bake
     *  the same image both places use). This device's OWN state only —
     *  "unavailable" is the same isUnavailable() every status pill reads, and
     *  a binary_sensor's "on" is its own alert. A LINKED entity no longer
     *  lands here: it rings the badge instead, see ringState. */
    state: DeviceSurfaceState;
    /** The RING's state, when it differs from the face's — a linked entity
     *  being on rings the badge without recolouring the device's own glyph.
     *  See deviceActivity.badgeFaceAndRing. */
    ringState?: DeviceSurfaceState;
  };
  /** Persist a new badge colour for the open entity (null = category default).
   *  Undefined when the profile may not edit config — the badge is then a plain,
   *  non-interactive icon. */
  onSetBadgeColor?: (hex: string | null) => void;
  /** The open device's LINKED entity (EntityMapping.linkedEntityId), when one
   *  is configured and the profile may control it. Renders as an on/off switch
   *  in the shared panel chrome, so EVERY device type gets it for free the
   *  moment that field is set — no per-panel wiring, no type checks. Toggling
   *  it is what drives the badge's ring (see deviceActivity.deviceLook),
   *  which is why the two live and die together. Undefined = no linked entity
   *  configured, or read-only profile: the switch is then not rendered. */
  linked?: {
    /** Resolved display name of the linked entity, for the switch's label. */
    label: string;
    /** Live state — drives both the switch position and the header ring. */
    isOn: boolean;
    /** False when HA cannot say (unavailable, a lock in motion): the switch
     *  is shown "Unavailable" and cannot be thrown (utils/devicePower). */
    known: boolean;
    toggle: () => void;
  };
  /** The open device's OTHER readings (deviceGroups.deviceReadings: its
   *  group's members and the registry siblings nobody placed — a pump plug's
   *  energy and current), listed under its controls; tapping one opens that
   *  reading's own panel (2.496.260). Empty or undefined: nothing listed. */
  readings?: { id: string; label: string; text: string }[];
  onOpenReading?: (entityId: string) => void;
  /** Where this panel was opened FROM, when that was another window — a
   *  device's reading opened from the device, a device from a room list, the
   *  Cockpit, the VESTA Agent or Facility. Drawn as "Back" at the header's
   *  top right, and Escape / the phone's back gesture take it too; Close still
   *  closes everything (owner, 2026-10-04: "no way to come back to the main
   *  device"). Undefined: opened from the map, nothing to go back to. */
  back?: { label: string; go: () => void };
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
/**
 * The linked entity's switch SEMANTICS — what it does, whether it can, and
 * what it says to assistive tech — spread onto whichever button draws it:
 * the panel chrome's toggle (BasePanel) or the camera's rail icon
 * (CameraPanel). They look different on purpose; they wrote these five
 * attributes out separately (round 11, 2.496.173), where one could drift
 * from the other — the "Unavailable" state reached both only because
 * 2.496.164 edited both.
 */
export function linkedSwitchProps(linked: NonNullable<PanelActions["linked"]>) {
  return {
    onClick: linked.known ? linked.toggle : undefined,
    disabled: !linked.known,
    role: "switch" as const,
    "aria-checked": linked.isOn,
    "aria-label": `${linked.label}: ${!linked.known ? "unavailable" : linked.isOn ? "on" : "off"}`,
  };
}

export const PanelActionsProvider = PanelActionsContext.Provider;
export const usePanelActions = (): PanelActions => useContext(PanelActionsContext);
