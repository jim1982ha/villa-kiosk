// src/components/panels/PanelActionsContext.ts
// Header extras the shared BasePanel shows for whichever device panel is open —
// the HA entity_id it controls, and a shortcut to edit that entity in Advanced
// Settings. Provided by Dashboard (which knows the active entity + permissions)
// so BasePanel needn't be threaded through all ten panel components.

import { createContext, useContext } from "react";
import type { Category } from "@/types/scene.types";

export interface PanelActions {
  /** The HA entity_id the open panel controls (shown under the title). */
  entityId?: string;
  /** Open Advanced Settings focused on this entity. Undefined when the current
   *  profile may not edit config — the edit button is then hidden. */
  onEdit?: () => void;
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
    /** Fades the header icon exactly like its map badge — the SAME
     *  isUnavailable() every status pill already reads. Without this the
     *  header badge rendered full-strength regardless of live state, out of
     *  step with both the map (which fades) and the pill right below it
     *  (which turns amber). */
    unavailable?: boolean;
  };
  /** Persist a new badge colour for the open entity (null = category default).
   *  Undefined when the profile may not edit config — the badge is then a plain,
   *  non-interactive icon. */
  onSetBadgeColor?: (hex: string | null) => void;
}

const PanelActionsContext = createContext<PanelActions>({});
export const PanelActionsProvider = PanelActionsContext.Provider;
export const usePanelActions = (): PanelActions => useContext(PanelActionsContext);
