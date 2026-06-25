// src/babylon/GroundGrass.ts
// SweetHome 3D exports the terrain OUTSIDE the grass room as a bare, flat, GREY
// slab (it's in the .sh3d, not added by Blender). It reads as an ugly grey plinth
// the villa sits on. Detect that slab and paint it with a procedurally generated
// grass texture so the garden extends visually to the edge of the model.
//
// IMPORTANT — only the EXTERIOR grey terrain must change. The indoor floors (tiled,
// cream) and any furniture must be left exactly as they are. The Blender pipeline
// fuses non-entity geometry and splits it by MATERIAL, so a single mesh =
// "all faces using material X" — repaint one and you repaint everything sharing
// that material. So the discriminator is the material being GREY (low saturation,
// mid/dark), NOT merely "large and flat": cream indoor tile and coloured furniture
// are rejected even when they're big flat slabs.
//
// The texture is drawn on a canvas (DynamicTexture) — no image asset to bundle and
// no extra dependency, so it works offline under HA Ingress.

import {
  Color3, DynamicTexture, StandardMaterial, Texture,
  PBRMaterial, type AbstractMesh, type Scene,
} from "@babylonjs/core";
import { devLog } from "@/utils/devLog";

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

/**
 * Greyish = nearly equal R/G/B (low saturation) AND mid-to-dark brightness. This is
 * the bare SweetHome terrain. It deliberately rejects:
 *   - cream / white indoor floor tile (low saturation but BRIGHT, max > ~0.72),
 *   - the green grass room and any coloured furniture (saturated),
 *   - near-black (max < 0.12).
 */
function isGreyTerrain(c: Color3 | null): boolean {
  if (!c) return false;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const sat = max - min;
  return sat < 0.1 && max >= 0.12 && max <= 0.72;
}

function matName(m: AbstractMesh): string {
  return (m.material?.name ?? "").toLowerCase();
}

/**
 * Paint the exterior grey terrain slab with grass. Two modes:
 *
 *  - If `hints` are given (config.grassGroundHints), grass exactly the meshes whose
 *    material/mesh name matches one — deterministic, no guessing. Use this when the
 *    user has tapped the terrain to read its material name.
 *  - Otherwise auto-detect: a flat slab at the bottom of the model, spanning nearly
 *    the whole footprint, whose material is GREY. Conservative on purpose so indoor
 *    floors and furniture are never touched.
 *
 * Runs after the model is normalised to metres + centred.
 */
export function applyGrassGround(
  scene: Scene,
  meshes: AbstractMesh[],
  hints: string[] = [],
): void {
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

  const loweredHints = hints.map((s) => s.toLowerCase()).filter(Boolean);

  let candidates = infos.filter(({ m, h, footMin, footMax, minY }) => {
    if (m.getTotalVertices() === 0) return false;
    if (loweredHints.length) {
      // Explicit override: match by name only, ignore the heuristics entirely.
      const mn = matName(m);
      const meshN = m.name.toLowerCase();
      return loweredHints.some((hn) => mn.includes(hn) || meshN.includes(hn));
    }
    return (
      h < 1.2 &&                    // flat slab, not a wall/furniture
      minY < baseY + 0.6 &&         // sits at the very bottom (the terrain)
      footMin > 3 &&                // big in BOTH axes → a ground plane
      footMax > 0.8 * spanMax &&    // spans nearly the WHOLE model → the outer terrain
      isGreyTerrain(baseColour(m))  // grey only — not cream indoor tile, not furniture
    );
  });

  // The terrain is the BIGGEST grey slab — it underlies the whole model. Other grey
  // flat things (a window's silver reflector pane, a large grey door) can also be
  // flat, low and span a big dimension, so keep only the largest-area candidate(s).
  // This drops e.g. a 21×7 m window reflector while keeping the 26×13 m ground.
  // (Skipped when explicit hints are given — then the user has named the targets.)
  if (!loweredHints.length && candidates.length > 1) {
    const area = (c: (typeof candidates)[number]) => c.footMax * c.footMin;
    const maxArea = Math.max(...candidates.map(area));
    candidates = candidates.filter((c) => area(c) >= 0.85 * maxArea);
  }
  const targets = candidates;

  if (targets.length === 0) {
    devLog(
      loweredHints.length
        ? `[GroundGrass] no mesh matched grassGroundHints ${JSON.stringify(hints)} — nothing to grass.`
        : "[GroundGrass] no grey terrain slab detected — nothing to grass. " +
          "If the grey ground is still grey, tap it to read its material name and add it to config.grassGroundHints.",
    );
    return;
  }

  const grass = makeGrassMaterial(scene);
  for (const { m, footMax, footMin } of targets) {
    const wasMat = matName(m) || "(none)";
    m.material = grass;
    m.receiveShadows = true;
    devLog(
      `[GroundGrass] painted grass on "${m.name}" / was material "${wasMat}" ` +
      `(${footMax.toFixed(1)}×${footMin.toFixed(1)} m).`,
    );
  }
}
