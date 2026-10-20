// Every dialog is drawn at the top of the app, never inside the screen that opened it (owner, 2026-10-21: the
// Cockpit's "Open a ticket", drawn inside its fault card, jumped into the card's box on every press — the card's
// press nudge is a transform, and a transformed box holds an absolutely placed backdrop — "i can't click anywhere").
// Read from the compiler's tree (jsx.mjs): which element carries a backdrop class, and where DialogLayer draws it.
// And the phone's "Close this? No action needed.": the card's row of buttons takes the whole width while it asks.
import { readFileSync } from "node:fs";
import { ck, done, tsFiles } from "../consistency/check.mjs";
import { parseTsx, elements, propText, tagOf } from "../consistency/jsx.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const BACKDROP = /\bmodal-backdrop\b/;

// every element whose className names a backdrop, in every screen: only DialogLayer may carry one
const carriers = [];
for (const f of tsFiles(SRC).filter((p) => p.endsWith(".tsx"))) {
  const tree = parseTsx(f);
  const visit = (n) => {
    const tag = tagOf(n);
    if (tag) {
      const cls = propText(n, "className");
      if (typeof cls === "string" && BACKDROP.test(cls)) carriers.push({ f: f.slice(SRC.length), tag });
    }
    n.forEachChild((c) => visit(c));
  };
  visit(tree);
}
const drawnInPlace = carriers.filter((c) => c.tag !== "DialogLayer" && c.f !== "components/common/DialogLayer.tsx");
ck(`every backdrop is drawn through DialogLayer (${carriers.length} dialogs)`, carriers.length >= 12 && drawnInPlace.length === 0,
   drawnInPlace);

// …into the app's shell: the box App.tsx draws, the one sized to the real screen on iOS
const layer = readFileSync(SRC + "components/common/DialogLayer.tsx", "utf8");
const host = layer.match(/const HOST = "\.([\w-]+)";/)?.[1];
const app = elements(parseTsx("App.tsx"), "div").map((d) => propText(d, "className"));
ck("DialogLayer draws into the app's shell", host === "app-root" && app.includes('"app-root"') &&
   /createPortal\(backdrop, host\)/.test(layer), { host, app });
const base = readFileSync(SRC + "styles/01-base.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
ck("…the shell is pinned to the screen", /\.app-root\s*\{[^}]*position:\s*fixed/.test(base));

// the card's press nudge is a transform: never while the press is on one of its controls
const fac = readFileSync(SRC + "styles/07-facility.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const nudges = [...fac.matchAll(/([^{}]*\.fm-openable:active[^{]*)\{([^}]*)\}/g)].filter((m) => /transform/.test(m[2]));
ck("the card nudges only on its own press", nudges.length === 1 && /:not\(:has\(button:active/.test(nudges[0][1]),
   nudges.map((m) => m[1].trim()));
// asking, the card's row of buttons takes the whole width (it was as wide as its content, wider than a phone)
const asking = fac.match(/\.fm-record-actions:has\(> \.modal-actions\)\s*\{([^}]*)\}/)?.[1] ?? "";
ck("a card's question takes the whole row", /flex:\s*1 1 100%/.test(asking) && /min-width:\s*0/.test(asking), asking);

done("✅ every dialog at the top of the app; a card's question fits a phone");
