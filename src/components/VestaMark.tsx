// src/components/VestaMark.tsx
// The VESTA "V" as an inline UI element, for the places the brand mark itself
// should appear (the sign-in gate's headline, the HUD's home/brand button).
//
// Painted as a CSS MASK over `currentColor`, not as an <img>. The asset's arms
// are `currentColor`, and an <img> renders its SVG in a separate document
// context where that resolves to the SVG's own default black rather than
// inheriting anything from this page — so a themed colour would silently never
// arrive. Masking paints the inherited colour THROUGH the shape instead, which
// keeps one SVG on disk and re-themes for free wherever it is used.
//
// The mono asset (not the canonical two-tone one) for the same reason it is
// used on the gate: the two-tone mark's dark arm is #1F5C33, which all but
// disappears against the dark and night themes. Two-tone is reserved for the
// app/PWA icons, where it always sits on its own controlled cream plate.
// Vite inlines the 254-byte file as a data URI, so this costs no request.

import markUrl from "@/assets/brand/vesta-mark-mono.svg?url";

interface Props {
  /** Rendered height in px. The mark's own 100:93 aspect sets the width. */
  size?: number;
  className?: string;
}

export default function VestaMark({ size = 24, className }: Props) {
  return (
    <span
      className={`vesta-mark${className ? ` ${className}` : ""}`}
      style={{
        ["--mark" as string]: `url("${markUrl}")`,
        height: size,
        width: Math.round(size * (100 / 93)),
      }}
      aria-hidden="true"
    />
  );
}

// ── The APP ICON, as opposed to the bare mark above ───────────────────────
// The plated, two-tone artwork the PWA/home-screen icon uses — cream plate
// with the green V, and its dark-theme counterpart. This is what belongs in
// the HUD's brand position: VestaMark paints in `currentColor`, which
// resolves to --text-primary there and so rendered as a near-BLACK V, when
// the product's actual icon is green and already designed for exactly this.
//
// Both URLs are handed in as custom properties and the THEME picks one in
// CSS (see .vesta-appicon). It cannot be chosen in JS here: the theme lives
// as a data-theme attribute that changes at runtime, so a component reading
// it once would keep the wrong icon after a theme switch — and an inline
// style would beat any themed rule anyway. Setting both and letting the
// cascade choose is what makes it re-theme for free.
//
// Imported from src/assets (not referenced at their public/ paths) so Vite
// rewrites the URLs — bundled CSS resolves relative URLs against /assets/,
// which would break under HA Ingress's sub-path.
import appIconLight from "@/assets/brand/vesta-appicon.svg?url";
import appIconDark from "@/assets/brand/vesta-appicon-dark.svg?url";

export function VestaAppIcon({ size = 28, className }: Props) {
  return (
    <span
      className={`vesta-appicon${className ? ` ${className}` : ""}`}
      style={{
        ["--icon-light" as string]: `url("${appIconLight}")`,
        ["--icon-dark" as string]: `url("${appIconDark}")`,
        height: size,
        width: size,
      }}
      aria-hidden="true"
    />
  );
}
