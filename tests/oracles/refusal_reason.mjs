// A refused request says the add-on's own reason (architecture review round 8, 2026-10-30): a guest's photo refused
// for any reason said "Only the owner or facility manager can add photos.", a reason guessed from the status and
// copied from a rule the add-on no longer had (guests may add photos: supervisor-proxy.py fm_evidence_post_handler),
// and the owner's telemetry read did the same. ONE reader of the add-on's `{error}` (utils/storeSave refusalOf), for
// the store writes, the photo upload (fm/fmApi uploadEvidence) and the telemetry read
// (components/settings/TelemetryPanel.tsx). Driven by value through the real upload, on a fake add-on.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { parseTsx } from "../consistency/jsx.mjs";
import ts from "typescript";

// a browser's photo pipeline, as small as the upload needs: a bitmap, a canvas, a JPEG blob
globalThis.window ??= globalThis;
globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: (cb) => cb(new Blob(["x"])) }) };

const { refusalOf, storeSaveResult } = await import("@/utils/storeSave");
const { uploadEvidence } = await import("@/fm/fmApi");

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status,
  json: async () => { if (body === undefined) throw new SyntaxError("no JSON"); return body; } });

console.log("  the add-on's reason, read once:");
ck("its `error`, as it said it", await refusalOf(answer(403, { error: "You do not have permission to add evidence." }))
   === "You do not have permission to add evidence.");
ck("  ...none when it gave none (no body, no text, an empty one)",
   await refusalOf(answer(403)) === undefined && await refusalOf(answer(403, { error: 7 })) === undefined
   && await refusalOf(answer(403, { error: " " })) === undefined && await refusalOf(answer(403, null)) === undefined);
const saved = await storeSaveResult(answer(403, { error: "Only the owner profile may edit device configuration." }));
ck("a store write reads it the same way", saved.refused && saved.message === "Only the owner profile may edit device configuration.", saved);

console.log("\n  a refused photo says why:");
const upload = async (status, body) => {
  globalThis.fetch = async () => answer(status, body);
  try { await uploadEvidence(new Blob(["x"])); return null; } catch (e) { return e.message; }
};
for (const [status, why] of [[403, "You do not have permission to add evidence."], [413, "photo too large"], [400, "not a JPEG"]]) {
  const said = await upload(status, { error: why });
  ck(`HTTP ${status}: the add-on's reason, never a guess from the status`, said === `The add-on refused this photo: ${why}`, said);
}
ck("  ...and only a NO carries one: a sign-in to renew (401) or a failure (5xx) is no refusal",
   await refusalOf(answer(401, { error: "unauthorized" })) === undefined && await refusalOf(answer(502, { error: "bad gateway" })) === undefined);
const bare = await upload(502);
ck("  ...no reason given: the status, as it is", bare === "Upload failed (HTTP 502).", bare);
ck("  ...a photo the add-on took: no error", await upload(200, { ok: true, id: "ph-1" }) === null);

// the telemetry read: a component, so its refusal branch is read through the compiler — it asks refusalOf and says no
// reason of its own for a status
const tree = parseTsx("components/settings/TelemetryPanel.tsx");
const texts = [];
const strings = [];
const visit = (n) => {
  if (ts.isCallExpression(n)) texts.push(n.expression.getText());
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) strings.push(n.text);
  ts.forEachChild(n, visit);
};
visit(tree);
ck("the telemetry read asks the add-on's reason, and guesses none", texts.includes("refusalOf")
   && !strings.some((s) => /profile required/i.test(s)), strings.filter((s) => /owner/i.test(s)));

done("✅ a refusal says the add-on's own reason");
