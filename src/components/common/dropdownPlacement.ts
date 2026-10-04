// src/components/common/dropdownPlacement.ts
// Where a Dropdown's list goes on the screen. Pure — tests/oracles/dropdowns.mjs
// drives it by value.

/** One option row's height in CSS px (.dropdown-option: 44 px, the touch target). */
export const DROPDOWN_ROW_PX = 44;
const GAP = 4;       // between the button and the list
const MARGIN = 8;    // the list never touches the screen's edge
const MIN_WIDTH = 180;

export interface DropdownPlacement {
  left: number;
  width: number;
  /** Set when the list opens downwards (`top`) or upwards (`bottom`, from the
   *  viewport's bottom edge). */
  top: number;
  bottom: number;
  above: boolean;
  maxHeight: number;
}

/**
 * Under the button, as wide as it (at least MIN_WIDTH, never wider than the
 * screen); ABOVE it only when the whole list does not fit below and there is
 * more room above — a list at the foot of a phone screen opens upwards
 * instead of being cut to two rows.
 */
export function dropdownPlacement(
  button: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  optionCount: number,
): DropdownPlacement {
  const want = optionCount * DROPDOWN_ROW_PX + 2 * GAP;
  const below = viewport.height - button.bottom - GAP - MARGIN;
  const aboveRoom = button.top - GAP - MARGIN;
  const above = want > below && aboveRoom > below;
  const width = Math.min(Math.max(button.width, MIN_WIDTH), viewport.width - 2 * MARGIN);
  const left = Math.min(Math.max(button.left, MARGIN), viewport.width - MARGIN - width);
  return {
    left, width, above,
    top: button.bottom + GAP,
    bottom: viewport.height - button.top + GAP,
    maxHeight: Math.max(DROPDOWN_ROW_PX * 2, Math.min(want, above ? aboveRoom : below)),
  };
}
