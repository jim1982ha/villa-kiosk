// src/config/sanitizeConfig.ts
// Structural validation for config data that crosses a trust boundary — an
// imported backup ZIP anyone could have handcrafted or corrupted in transit.
// JSON.parse hands back `any`; blindly spreading that into the live AppConfig
// lets a single wrong-typed field (e.g. entityMap: "oops") crash far from the
// import site, deep inside the scene or a render pass. Whitelist known keys,
// require each one's basic shape to match, drop everything else — and never
// accept a credential from a shared file.

import { DEFAULT_CONFIG, type AppConfig } from "./AppConfig";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Optional AppConfig keys that have no entry in DEFAULT_CONFIG, with the
// container shape each must have to be accepted.
const OPTIONAL_KEY_SHAPES: Record<string, "array" | "boolean"> = {
  sh3dRooms: "array",
  sh3dEntities: "array",
  extraGlassHints: "array",
  grassGroundHints: "array",
  grassGround: "boolean",
};

/**
 * Reduce untrusted parsed JSON to a Partial<AppConfig> containing only known
 * keys whose values have the expected basic shape (array/object/primitive
 * kind, matched against DEFAULT_CONFIG). `haToken` is always dropped: exports
 * never include it (see exportBackup) and a token arriving in an imported
 * file is by definition not one this kiosk should silently adopt.
 * Returns null when the input isn't a config object at all.
 */
export function sanitizeImportedConfig(raw: unknown): Partial<AppConfig> | null {
  if (!isPlainObject(raw)) return null;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "haToken" || value === undefined || value === null) continue;

    const optionalShape = OPTIONAL_KEY_SHAPES[key];
    if (optionalShape) {
      if (optionalShape === "array" ? Array.isArray(value) : typeof value === "boolean") {
        out[key] = value;
      }
      continue;
    }

    if (!(key in DEFAULT_CONFIG)) continue;
    const expected = (DEFAULT_CONFIG as unknown as Record<string, unknown>)[key];
    const shapeMatches = Array.isArray(expected)
      ? Array.isArray(value)
      : isPlainObject(expected)
        ? isPlainObject(value)
        : typeof value === typeof expected;
    if (shapeMatches) out[key] = value;
  }
  return out as Partial<AppConfig>;
}
