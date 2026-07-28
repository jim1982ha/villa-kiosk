import type { HassEntity } from "./ha.types";
import type { EntityMapping } from "./scene.types";

/** Identifies the currently open entity panel (or null when closed).
 *
 *  There is deliberately no "which variant" flag here: every entity has
 *  exactly ONE panel, chosen from its type by PanelRouter (with GenericPanel's
 *  state + 24h history as the fallback for types that have no controls of
 *  their own). A `detail` boolean used to force that fallback for cameras on
 *  long-press; it was removed because it made the SAME gesture mean different
 *  things per type, which is precisely the kind of exception that has to be
 *  re-decided every time a new type or field shows up. */
export interface ActivePanel {
  entityId: string;
  mapping: EntityMapping;
}

export interface PanelProps {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  onClose: () => void;
}
