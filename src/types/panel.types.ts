import type { HassEntity } from "./ha.types";
import type { EntityMapping } from "./scene.types";

/** Identifies the currently open entity panel (or null when closed). */
export interface ActivePanel {
  entityId: string;
  mapping: EntityMapping;
}

export interface PanelProps {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  onClose: () => void;
}
