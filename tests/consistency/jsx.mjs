// A screen's JSX read through the compiler's own tree (retro, 2026-10-20): a check that matched a line of source broke
// a release twice in one day on a correct change — a reflowed `&&`, a prop moved to its own line. These read what the
// code SAYS (which element, which prop, under which condition), whatever its layout. Prefer rendering
// (screen_render.mjs) or driving values; reach for this when the fact is the shape of the markup.
import { readFileSync } from "node:fs";
import ts from "typescript";

const SRC = new URL("../../src/", import.meta.url).pathname;
const squash = (s) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();

/** The tree of `src/<rel>` (a .tsx). */
export function parseTsx(rel) {
  const path = rel.startsWith("/") ? rel : SRC + rel;
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const opening = (n) => (ts.isJsxElement(n) ? n.openingElement : n);
/** The tag name of a JSX element (`BasePanel`), or null for anything else. */
export function tagOf(n) {
  return ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) ? opening(n).tagName.getText() : null;
}

/** Every `<tag …>` in the tree, in source order. */
export function elements(tree, tag) {
  const out = [];
  const visit = (n) => { if (tagOf(n) === tag) out.push(n); ts.forEachChild(n, visit); };
  visit(tree);
  return out;
}

/** A prop's value as one line of text (`words ?? stateWords(entityId, …)`, braces dropped); true for a bare prop;
 *  null when the element has no such prop. */
export function propText(el, name) {
  const a = opening(el).attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === name);
  if (!a) return null;
  if (!a.initializer) return true;
  const init = ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer;
  return squash(init.getText());
}

/** The conditions an element is drawn under: the left side of every `a && <el/>` around it, innermost last, each as
 *  one line of text (`!missingFromHa(entities, entityId)`). */
export function guardsOf(el) {
  const out = [];
  for (let n = el; n.parent; n = n.parent) {
    const p = n.parent;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === n) {
      const flat = [];
      const split = (e) => ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ? (split(e.left), split(e.right)) : flat.push(squash(e.getText()));
      split(p.left);
      out.unshift(...flat);
    }
    if (ts.isJsxElement(p) || ts.isSourceFile(p)) break;
  }
  return out;
}

/** Every tag drawn among an element's CHILDREN (not inside its props), at any depth. */
export function childTags(el) {
  const out = [];
  const visit = (n) => { const t = tagOf(n); if (t) out.push(t); ts.forEachChild(n, visit); };
  if (ts.isJsxElement(el)) el.children.forEach(visit);
  return out;
}
