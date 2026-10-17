// Draw a screen and read it — the one harness the oracles draw with (architecture review, round two, 2026-10-17).
//
// A check that draws what the owner sees fails only when what they see changes; one that matches the code's text
// breaks when code moves and passes when the screen is wrong (165 of 208 checks did that). Three oracles had their own
// copy of this harness; they import it from here now.
//
//   import { h, draw, inside, text } from "../consistency/screen.mjs";
//   const html = draw(h(SomeScreen, props));          // the markup React renders, as a string
//   inside(html, "fm-record-head")                    // the markup of the first element with that class
//   text(html)                                        // what a reader sees: words, an [icon] for each svg, "|" between
//
// Importing it registers the alias hook (the `@/` imports, .tsx screens, stylesheets emptied), so it goes first.
import { register } from "node:module";
register("./alias-hook.mjs", import.meta.url);
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { SuperadminGate } = await import("@/auth/SuperadminGate");

export { React };
export const h = React.createElement;

/** The markup `el` draws. Inside the superadmin gate's context, as every screen in the app is. */
export const draw = (el) => renderToStaticMarkup(h(SuperadminGate, null, el));

/** The markup between the first element whose class starts with `cls` and its own closing tag — exact for nested
 *  divs; "" when there is none. */
export function inside(html, cls) {
  const at = html.indexOf(`class="${cls}`);
  if (at < 0) return "";
  let depth = 0;
  const i = html.lastIndexOf("<", at);
  const tag = /^<(\w+)/.exec(html.slice(i))[1];
  for (const m of html.slice(i).matchAll(new RegExp(`<(\\/?)${tag}\\b[^>]*>`, "g"))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(i, i + m.index + m[0].length);
  }
  return html.slice(i);
}

/** What a reader sees: the words, each icon as [icon], "|" where one element's words end and the next begin. */
export const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "[icon]").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|")
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A plain button, for a card's actions. */
export const btn = (label) => h("button", { type: "button", className: "btn ghost" }, label);
