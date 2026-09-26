// src/babylon/dashableRectangle.ts
// Babylon GUI's Rectangle, able to DASH its border — so a card badge draws
// every state's border with ONE mechanism: the same rectangle, the same corner
// radius, the same weight, solid or dashed.
//
// ⚠️ TWO MECHANISMS DREW ONE BORDER (owner, 2026-09-26: "why is there a
// difference in the icon shape, format? aren't you applying DRY?"). A
// Rectangle stroked every state's ring; the dashed (unavailable) one — which a
// Rectangle cannot draw — was a separately baked image laid over the card
// (2.496.130), which did not agree with the Rectangle about where the card's
// edge is: Rectangle lays its children out INSET by its thickness
// (rectangle.js _additionalProcessing), and the dash showed on two sides
// only. Rectangle draws its border between its own context.save/restore, so a
// line dash set around that one call applies to the stroke and nothing else
// (a dash does not affect a fill).

import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import type { ICanvasRenderingContext } from "@babylonjs/core/Engines/ICanvas";

export class DashableRectangle extends Rectangle {
  /** The border's dash pattern in px ([on, off]); null for a solid border. */
  dash: number[] | null = null;

  protected override _localDraw(context: ICanvasRenderingContext): void {
    if (!this.dash) { super._localDraw(context); return; }
    context.save();
    context.setLineDash(this.dash);
    super._localDraw(context);
    context.restore();
  }
}
