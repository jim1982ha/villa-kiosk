import type { HassEntity } from "./ha.types";
import type { EntityMapping } from "./scene.types";

/** Identifies the currently open entity panel (or null when closed). */
export interface ActivePanel {
  entityId: string;
  mapping: EntityMapping;
  /** Open the entity's DETAIL panel (state + history + Edit) rather than its
   *  type-specific experience. Set by a long-press on a camera, whose normal
   *  panel is the fullscreen live feed — a long-press should reach the same
   *  detail/edit view every other entity gives, for consistency. */
  detail?: boolean;
}

export interface PanelProps {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  onClose: () => void;
}
