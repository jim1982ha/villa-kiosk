// src/babylon/lightingMode.ts
// Which lights a villa gets, decided ONCE from what its model is.
//
// ⚠️ IT WAS DECIDED BY TWO FLAGS NOBODY CHECKED AGAINST EACH OTHER. `baked`
// (albedo-baked OR lightmapped) made floor pools; "some material already
// carries the lamp glow" switched the furniture light on, inferred deep in the
// load; the shadow maps read `baked` again; and nine comments still said a
// baked villa has no PointLights at all — it always had them. Architecture
// review, round 3. Now the model loader states the flavour and this table
// says what each one gets; every consumer reads the table.
//
// The PointLights exist in every flavour — what they LIGHT differs:
//   * unbaked      — the rooms: the only light there is, with wall shadows;
//   * albedo-baked — only what is not structure (the structure is unlit);
//   * lightmapped  — only what the furniture light leaves out: glass, the
//                    fixtures themselves, non-PBR materials (bulbSet.ts).
// Pure: tests/oracles/lighting_mode.mjs.

export type ModelFlavour = "unbaked" | "albedo-baked" | "lightmapped";

export interface LightingMode {
  flavour: ModelFlavour;
  /** Floor pools under every bulb (LightPoolSet): the bake has no light of
   *  its own for a lamp that is switched on. */
  pools: boolean;
  /** The bulbs' light on every lit surface (lampGlow.ts), fed from the pools:
   *  a lightmap multiplies a PointLight to nothing. */
  furnitureLight: boolean;
  /** One cube shadow map per lit entity, so a lamp does not light the next
   *  room: only where the walls' shadows are not already in a bake. */
  lightShadows: boolean;
  /** One line for the load capture: why the villa is lit the way it is. */
  describe: string;
}

const MODES: Record<ModelFlavour, Omit<LightingMode, "flavour">> = {
  unbaked: {
    pools: false, furnitureLight: false, lightShadows: true,
    describe: "UNBAKED — every bulb's PointLight lights its room, with wall shadows",
  },
  "albedo-baked": {
    pools: true, furnitureLight: false, lightShadows: false,
    describe: "BAKED (albedo) — structure unlit; floor pools; PointLights light free furniture only",
  },
  lightmapped: {
    pools: true, furnitureLight: true, lightShadows: false,
    describe: "BAKED (lightmap) — floor pools + the furniture light on every lit surface; "
      + "PointLights light glass and the fixtures only",
  },
};

/** The flavour a loaded model is, from what the loader found. */
export function flavourOf(found: { baked: boolean; lightmapped?: boolean }): ModelFlavour {
  return found.lightmapped ? "lightmapped" : found.baked ? "albedo-baked" : "unbaked";
}

/** What a model of this flavour gets. */
export function lightingModeFor(flavour: ModelFlavour): LightingMode {
  return { flavour, ...MODES[flavour] };
}
