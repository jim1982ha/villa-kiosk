// src/components/panels/PanelActionsContext.ts
// Header extras the shared BasePanel shows for whichever device panel is open —
// the HA entity_id it controls, and a shortcut to edit that entity in Advanced
// Settings. Provided by Dashboard (which knows the active entity + permissions)
// so BasePanel needn't be threaded through all ten panel components.

import { createContext, useContext } from "react";

export interface PanelActions {
  /** The HA entity_id the open panel controls (shown under the title). */
  entityId?: string;
  /** Open Advanced Settings focused on this entity. Undefined when the current
   *  profile may not edit config — the edit button is then hidden. */
  onEdit?: () => void;
}

const PanelActionsContext = createContext<PanelActions>({});
export const PanelActionsProvider = PanelActionsContext.Provider;
export const usePanelActions = (): PanelActions => useContext(PanelActionsContext);
