// An upload's progress, seen on a phone too, and said once (architecture review K, 2026-10-24: Advanced Settings' upload
// button hid its words at the phone tier, so a phone saw a bare icon for the whole upload; the no-model screen and
// Advanced Settings each wrote their own words: "Retry 2" in one, "Retrying (2 of 5)…" in the other).
//
// By value (settings/useGlbUpload uploadProgress), the two screens' markup by the compiler's tree, and the phone
// tier's rule read from the stylesheet.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { elements, parseTsx, propText, guardsOf } from "../consistency/jsx.mjs";
const { uploadProgress } = await import("@/components/settings/useGlbUpload");

const idle = uploadProgress(false, null, null);
ck("nothing uploading: no words, no mark", idle.words === null && idle.mark === null, idle);
const going = uploadProgress(true, 42, null);
ck("uploading: the words and the mark name the same percentage", going.words === "Uploading… 42%" && going.mark === "42%", going);
const stalled = uploadProgress(true, 42, { attempt: 2, of: 5 });
ck("a stalled chunk: the retry, in words and on the mark", stalled.words === "Retrying (2 of 5)…" && stalled.mark === "↻2", stalled);
ck("just started: 0%", uploadProgress(true, null, null).mark === "0%");

const editor = parseTsx("components/settings/ConfigEditorModal.tsx");
const spans = elements(editor, "span");
const label = spans.find((s) => propText(s, "className") === '"btn-label"' && /progress\.words/.test(s.getText()));
ck("Advanced Settings' upload button says the hook's words", !!label, spans.map((s) => s.getText()).filter((t) => /upload/i.test(t)));
const mark = spans.find((s) => /btn-mark/.test(propText(s, "className") ?? ""));
ck("  ...and keeps the mark on its icon while it uploads",
  !!mark && /progress\.mark/.test(mark.getText()) && guardsOf(mark).some((g) => /progress\.mark/.test(g)), mark?.getText());
const uploader = readFileSync(new URL("../../src/components/settings/ModelUploader.tsx", import.meta.url), "utf8");
ck("the no-model screen says the same words", /progress\.words/.test(uploader) && !/Retrying|Uploading/.test(uploader));

const css = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// each phone-tier block, whole (braces counted), and the stylesheet without them
const blocks = [];
let outside = "";
for (let i = 0; i < css.length;) {
  const at = css.indexOf("@media (max-width: 640px)", i);
  if (at < 0) { outside += css.slice(i); break; }
  outside += css.slice(i, at);
  let j = css.indexOf("{", at) + 1, depth = 1;
  for (; depth > 0; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
  blocks.push(css.slice(at, j));
  i = j;
}
ck("the mark is hidden where the words show", /\.btn-mark\s*\{\s*display:\s*none/.test(outside));
ck("  ...and shown at the phone tier, where the words are hidden", blocks.some((b) =>
  /\.btn-label\s*\{\s*display:\s*none/.test(b) && /\.btn-mark\s*\{[^}]*display:\s*block/.test(b)), blocks.length);

done("✅ an upload's progress shows on a phone too, in the one set of words");
