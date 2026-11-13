// tests/oracles/model_upload.mjs
// A model the 3D view would refuse whole is never uploaded (owner, 2026-11-12: a texture written without its image,
// "/textures/364/source: Failed to find index", and every tablet then failed to load the villa). Invented models.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { planModelUpload } = await import("@/utils/modelUpload");

/** A glTF-Binary file holding only its JSON chunk. */
function glb(doc, name = "villa.glb") {
  let json = new TextEncoder().encode(JSON.stringify(doc));
  const pad = (4 - (json.length % 4)) % 4;
  json = new Uint8Array([...json, ...Array(pad).fill(0x20)]);
  const out = new Uint8Array(20 + json.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  return new File([out], name);
}
const model = (textures) => ({ asset: { version: "2.0" }, images: [{ uri: "a.webp" }], textures, materials: [
  { name: "wall", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
  { name: "cover", pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
] });

console.log("\n  a model whose every texture has its image is uploaded; one with a texture missing its image is not:");
const good = await planModelUpload([glb(model([{ extensions: { EXT_texture_webp: { source: 0 } } }, { source: 0 }]))]);
ck("every texture with its image (its own or the WebP one's): the upload goes ahead", good.ok, good);
const bad = await planModelUpload([glb(model([{ extensions: { EXT_texture_webp: { source: 0 } } }, { extensions: {} }]))]);
ck("  ...a texture with no image: nothing is uploaded, and the material it is for is named",
   !bad.ok && /cover/.test(bad.message) && /Nothing was uploaded/.test(bad.message) && !/wall/.test(bad.message), bad);

// owner, 2026-11-13: a landed upload came as a green band over the Villa tab; it is said on the button now
const { uploadProgress } = await import("@/components/settings/useGlbUpload");
console.log("\n  what the upload button says:");
ck("in flight its percentage; retried its attempt; landed \"Uploaded, reloading…\"; else its own words",
   uploadProgress(true, 42, null).words === "Uploading… 42%" && uploadProgress(true, 42, { attempt: 2, of: 5 }).words === "Retrying (2 of 5)…"
   && uploadProgress(false, null, null, true).words === "Uploaded, reloading…" && uploadProgress(false, null, null).words === null);
done("A model whose texture has no image is refused at upload, the material named");
