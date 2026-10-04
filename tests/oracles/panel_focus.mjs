// A device window's first focus is its heading, never the badge (owner,
// 2026-10-05: an amber border round the badge of a pump that was simply off —
// the phone's own focus ring on the Owner's recolour button). .tsx: pinned.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const base = rd("components/panels/BasePanel.tsx"), css = rd("styles/03-panels.css");
ck("the window's heading takes the first focus (data-autofocus, out of the Tab order)",
   /<h2 title=\{title\} tabIndex=\{-1\} data-autofocus>\{title\}<\/h2>/.test(base));
ck("the badge button's focus is VESTA's accent, only for the keyboard — never the platform's ring",
   /\.panel-badge-btn:focus \{ outline: none; \}/.test(css) && /\.panel-badge-btn:focus-visible \{ outline: 2px solid var\(--accent\);/.test(css));
ck("a focused heading draws no ring", /h2\[data-autofocus\]:focus \{ outline: none; \}/.test(css));
done("✅ opening a device window rings nothing but the device's own state");
