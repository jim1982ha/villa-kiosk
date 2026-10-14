// src/components/common/infoTipPlacement.ts
// Where an (i)'s card goes on the screen. Pure — tests/oracles/info_tip.mjs drives it by value.

const GAP = 8;       // between the (i) and its card
const MARGIN = 12;   // the card never touches the screen's edge
const WIDTH = 510;   // its width when the screen has room
const MIN_HEIGHT = 120;

export interface InfoTipPlacement {
  left: number;
  width: number;
  /** `top` when it opens below the (i), `bottom` (from the screen's bottom edge) when above. */
  top: number;
  bottom: number;
  above: boolean;
  maxHeight: number;
}

/**
 * Below the (i) — above it only when the card does not fit below and there is more room above; as tall as it needs,
 * never past the screen's edge (it scrolls inside only then). Its LEFT edge on the (i)'s left when the (i) sits in the
 * screen's left half, its RIGHT edge on the (i)'s right otherwise (an (i) at the end of a title line), always inside
 * the screen. `contentHeight`: the card's own height once drawn (0 before).
 */
export function infoTipPlacement(
  button: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  contentHeight: number,
): InfoTipPlacement {
  const width = Math.min(WIDTH, viewport.width - 2 * MARGIN);
  const below = viewport.height - button.bottom - GAP - MARGIN;
  const aboveRoom = button.top - GAP - MARGIN;
  const above = contentHeight > below && aboveRoom > below;
  const centre = (button.left + button.right) / 2;
  const wanted = centre < viewport.width / 2 ? button.left : button.right - width;
  const left = Math.min(Math.max(wanted, MARGIN), viewport.width - MARGIN - width);
  return {
    left, width, above,
    top: button.bottom + GAP,
    bottom: viewport.height - button.top + GAP,
    maxHeight: Math.max(MIN_HEIGHT, above ? aboveRoom : below),
  };
}
