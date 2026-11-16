// src/babylon/shaderArrays.ts
// A vec4[] uniform of a material plugin, uploaded so every browser receives it.
//
// ⚠️ WITHOUT UNIFORM BUFFERS THE ARRAY GOES IN AS vec4 (owner's desktop,
// 2026-11-16). Babylon turns uniform buffers off for some browsers (its
// ThinEngine.ExceptionList: Chrome on macOS, Chrome 12x on Android), and then
// `UniformBuffer.updateFloatArray` uploads with uniform1fv, which WebGL refuses
// for a vec4[]: every lamp stayed at zero and the glow lit nothing there.
// setFloatArray4 is uniform4fv. tests/oracles/shader_rules.mjs keeps every
// vec4[] upload in this file.

import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";

/** Upload `values` (four floats per element) to the vec4[] uniform `name`. */
export function uploadVec4Array(ubo: UniformBuffer, subMesh: SubMesh, name: string, values: Float32Array): void {
  const effect = ubo.useUbo ? null : subMesh.effect;
  if (effect) effect.setFloatArray4(name, values);
  else ubo.updateFloatArray(name, values);
}
