// src/babylon/GroundGrass.ts
// SweetHome 3D exports the terrain OUTSIDE the grass room as a bare, flat, grey
// slab (it's in the .sh3d, not added by Blender). It reads as an ugly grey plinth
// the villa sits on. Detect that slab and paint it with a procedurally generated
// grass texture so the garden extends visually to the edge of the model.
//
// The texture is drawn on a canvas (DynamicTexture) — no image asset to bundle and
// no extra dependency, so it works offline under HA Ingress.

import {
  Color3, DynamicTexture, StandardMaterial, Texture,
  PBRMaterial, type AbstractMesh, type Scene,
} from "@babylonjs/core";

/** Build a tileable grass material from a canvas — green base + speckled blades. */
function makeGrassMaterial(scene: Scene): StandardMaterial {
  const size = 256;
  const tex = new DynamicTexture("grassGroundTex", size, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // Mottled green base so large tiles don't look like one flat colour.
  ctx.fillStyle = "#4f7a37";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const g = 70 + Math.random() * 70;
    ctx.fillStyle = `rgba(${30 + Math.random() * 30},${g},${30 + Math.random() * 25},0.5)`;
    const r = 6 + Math.random() * 22;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Short blades for texture.
  for (let i = 0; i < 7000; i++) {
    const g = 90 + Math.random() * 90;
    ctx.fillStyle = `rgb(${25 + Math.random() * 35},${g},${25 + Math.random() * 35})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1 + Math.random() * 2);
  }
  tex.update();

  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 60; // tile ~ every 0.5 m across a big plinth
  tex.vScale = 60;

  const mat = new StandardMaterial("grassGround", scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0, 0, 0); // grass isn't shiny
  mat.diffuseColor = new Color3(1, 1, 1);
  return mat;
}

/** Approx base colour of a mesh's material (or null if not a coloured material). */
function baseColour(m: AbstractMesh): Color3 | null {
  const mat = m.material;
  if (mat instanceof PBRMaterial) return mat.albedoColor;
  if (mat instanceof StandardMaterial) return mat.diffuseColor;
  return null;
}

function looksGreen(c: Color3 | null): boolean {
  return !!c && c.g > c.r + 0.08 && c.g > c.b + 0.08;
}

/**
 * Find the large flat slab(s) at the base of the model and replace the grey
 * terrain material with grass. Conservative on purpose: a slab only qualifies if
 * it is flat, sits at the bottom, spans a big share of the whole model, and is
 * NOT already green — so the indoor (tiled, cream) floors and the existing grass
 * room are left untouched. Runs after the model is normalised to metres + centred.
 */
export function applyGrassGround(scene: Scene, meshes: AbstractMesh[]): void {
  // Overall extent + floor of the model.
  let spanMax = 0;
  let baseY = Infinity;
  const infos = meshes.map((m) => {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    const h = bb.maximumWorld.y - bb.minimumWorld.y;
    const fx = bb.maximumWorld.x - bb.minimumWorld.x;
    const fz = bb.maximumWorld.z - bb.minimumWorld.z;
    spanMax = Math.max(spanMax, fx, fz);
    baseY = Math.min(baseY, bb.minimumWorld.y);
    return { m, h, footMin: Math.min(fx, fz), footMax: Math.max(fx, fz), minY: bb.minimumWorld.y };
  });

  const targets = infos.filter(({ m, h, footMin, footMax, minY }) =>
    m.getTotalVertices() > 0 &&
    h < 1.2 &&                       // flat slab, not a wall/furniture
    minY < baseY + 0.6 &&            // sits at the very bottom (the terrain)
    footMin > 3 &&                   // big in BOTH axes → a ground plane
    footMax > 0.55 * spanMax &&      // spans most of the model → the outer terrain
    !looksGreen(baseColour(m)),      // don't touch the existing green grass room
  );

  if (targets.length === 0) {
    console.info("[GroundGrass] no grey terrain slab detected — nothing to grass.");
    return;
  }

  const grass = makeGrassMaterial(scene);
  for (const { m, footMax, footMin } of targets) {
    m.material = grass;
    m.receiveShadows = true;
    console.info(
      `[GroundGrass] painted grass on "${m.name}" (${footMax.toFixed(1)}×${footMin.toFixed(1)} m).`,
    );
  }
}
