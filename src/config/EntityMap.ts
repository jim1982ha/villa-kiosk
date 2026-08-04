// src/config/EntityMap.ts
//
// Maps GLB mesh names -> HA entity metadata.
//
// The convention: interactive objects are named in SweetHome 3D *with their
// full HA entity_id* (e.g. "camera.hallway_cam"), which is what the Blender
// pipeline emits. So the primary key is the entity_id itself, and
// `resolveMeshToMapping()` (below) matches a tapped mesh by entity_id, by a
// "[type]_[room]" alias, or by a sanitised form (dots -> underscores, which
// some glTF exporters emit).
//
// This file ships NO device data. Both tables below are deliberately empty —
// the map is built at runtime by auto-detection + Advanced Settings and lives
// in the stored config, which is the single source of truth. Nothing specific
// to one villa belongs in shipped code; see the tables' own comments.

import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

export type { EntityMapping, EntityType };

/**
 * Seed entity map — intentionally EMPTY.
 *
 * This used to ship ~22 literal entries for the ONE villa this app was first
 * built against (real entity_ids, labels and room names). That predated the
 * Config Editor and auto-detection, and once those existed nobody removed the
 * seed — so every install, on any villa, started with two dozen devices that
 * belong to somebody else's house. Worse, DEFAULT_CONFIG is spread UNDER
 * stored config on load (see AppConfig's mergeStored), so deleting one of
 * those entries in the UI silently came back on the next reload — a real bug
 * users hit as "stale entities I can't get rid of".
 *
 * The map is populated at runtime instead: auto-detection binds meshes named
 * with their entity_id, and anything else is bound by hand in Advanced
 * Settings. Both write to the stored config, which is the single source of
 * truth. Keep this empty — nothing specific to any one villa belongs in the
 * shipped code.
 */
export const ENTITY_MAP: Record<string, EntityMapping> = {};

/**
 * Alias table for the "[type]_[room]" Blender naming convention — also
 * intentionally EMPTY, and for the same reason: the entries it used to hold
 * were hand-written for one specific villa's devices.
 *
 * The lookup that consumes it (resolveMeshUnchecked strategy 2) is kept, so a
 * future villa can reintroduce aliases as DATA if its model ever uses that
 * convention. Meshes named with a real entity_id — what the pipeline actually
 * emits — are matched by strategies 1 and 3 and never needed this.
 */
const MESH_ALIASES: Record<string, string> = {};

/** Infer a panel/entity type from an entity_id domain prefix. */
export function inferTypeFromEntityId(entityId: string): EntityType | null {
  const domain = entityId.split(".")[0];
  const known: EntityType[] = [
    "light", "climate", "lock", "camera", "cover", "fan",
    "binary_sensor", "sensor", "media_player", "switch", "input_boolean",
    "assist_satellite",
  ];
  return (known as string[]).includes(domain) ? (domain as EntityType) : null;
}

/** Collapse an immediately-repeated leading word-group — "master bedroom
 *  master bedroom light ceiling" → "master bedroom light ceiling". This
 *  villa's HA integration names several devices <area>_<area>_<domain>_
 *  <fixture>: the area prefix HA itself adds is ALSO already baked into the
 *  device's own configured name, so the raw entity_id doubles it verbatim.
 *  Longest possible repeat wins first, so a 2-word area name ("master
 *  bedroom") dedupes as one unit rather than leaving one copy of "bedroom"
 *  behind. */
function dedupeRepeatedPrefix(words: string[]): string[] {
  for (let len = Math.floor(words.length / 2); len >= 1; len--) {
    const a = words.slice(0, len).join(" ").toLowerCase();
    const b = words.slice(len, 2 * len).join(" ").toLowerCase();
    if (a === b) return [...words.slice(0, len), ...words.slice(2 * len)];
  }
  return words;
}

/** Underscore→space, dedupe a repeated leading phrase (see
 *  dedupeRepeatedPrefix), then Title Case each remaining word — the shared
 *  core of prettifyEntitySlug (derives its raw string from an entity_id) and
 *  displayLabelFor's own guard against a raw-slug HA friendly_name (some
 *  integrations/YAML entities default friendly_name to the bare object_id
 *  verbatim, which otherwise reached a panel title unprettified). Falls back
 *  to the original string if it somehow dedupes/splits to nothing. */
function prettifyRaw(raw: string): string {
  const words = dedupeRepeatedPrefix(raw.replace(/_/g, " ").split(/\s+/).filter(Boolean));
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || raw;
}

/** True when `s` reads as a raw machine slug (snake_case, no spaces, no
 *  uppercase) rather than something a person wrote — the shape a bare
 *  object_id has, and what an unnamed HA entity's friendly_name sometimes
 *  defaults to verbatim. */
function looksLikeRawSlug(s: string): boolean {
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(s);
}

/** Turn a raw entity_id local part into a readable label when no HA
 *  friendly_name is available — instead of the all-lowercase, doubled-up
 *  raw slug ("master bedroom master bedroom light ceiling center") that
 *  used to be the permanent fallback. */
export function prettifyEntitySlug(entityId: string): string {
  const raw = entityId.split(".")[1] ?? entityId;
  return prettifyRaw(raw);
}

/**
 * Human label from an entity_id: the friendly name if supplied, else the
 * prettified local part ("light.living_room" → "Living Room"). One place so the
 * same derivation isn't re-implemented in every binding/marker/config site.
 */
function labelFromEntityId(entityId: string, friendlyName?: string): string {
  return friendlyName?.trim() || prettifyEntitySlug(entityId);
}

/** True when `label` is still the untouched raw fallback labelFromEntityId()
 *  produces when no friendly_name is available yet — NOT a real HA
 *  friendly_name and NOT something a user actually typed in Advanced
 *  Settings (both of those are virtually always capitalised; the raw
 *  entity_id-derived fallback never is). Devices bound to a mesh during
 *  model load often get auto-created BEFORE their HA state (and so their
 *  friendly_name) has arrived over the websocket — this label then sits
 *  permanently in config, indistinguishable from a deliberate customisation,
 *  even though a proper name was available moments later. */
function looksLikeRawFallbackLabel(entityId: string, label: string): boolean {
  // Compare NORMALISED forms (underscores → spaces, whitespace collapsed,
  // lower-cased) on BOTH sides. Normalising only the entity_id — as this did
  // originally — missed the very common case of a label that is the raw slug
  // still carrying its UNDERSCORES ("ceiling_fan_master_bedroom"): it differs
  // from the space-separated id form by punctuation alone, so it was read as
  // a deliberate user customisation and shown verbatim as a panel title,
  // while the visually identical space-separated variant was correctly
  // upgraded to the friendly name. Same string, two different outcomes,
  // depending only on whether an underscore survived — which is exactly the
  // inconsistency reported ("the name is wrong now… sometimes it works").
  const norm = (s: string) => s.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const raw = entityId.split(".")[1] ?? "";
  return norm(label) === norm(raw);
}

/**
 * THE single place every display surface (device panel titles, the bottom-bar
 * group modal, device-group rows, the motion toast…) resolves "what to call
 * this entity" — a REAL stored customisation always wins, but a label that's
 * still the untouched raw auto-fallback (see looksLikeRawFallbackLabel) is
 * upgraded live to the current HA friendly_name, or failing that a properly
 * Title-Cased/deduped version of the id — so an entity bound early in model
 * load doesn't stay stuck with an ugly name forever even once a perfectly
 * good one is available. Advanced Settings' own Label EDIT FIELD deliberately
 * does NOT go through this — editing shows the exact raw stored value, not a
 * live-computed stand-in for it.
 *
 * A live HA friendly_name is normally trusted verbatim (assumed already
 * human-written) — but some integrations, and any YAML/UI entity with no
 * explicit name configured, leave friendly_name as the bare object_id
 * itself, e.g. "ceiling_fan_gym_room". Reported as a panel title/badge that
 * "still looks like a technical name" for exactly those entities. Caught the
 * same way a raw stored label is (looksLikeRawSlug) and prettified rather
 * than shown as-is, same as the no-friendly-name fallback below it always was.
 */
export function displayLabelFor(
  entityId: string, storedLabel: string | undefined, friendlyName?: string,
): string {
  if (storedLabel && !looksLikeRawFallbackLabel(entityId, storedLabel)) return storedLabel;
  const fn = friendlyName?.trim();
  if (fn) return looksLikeRawSlug(fn) ? prettifyRaw(fn) : fn;
  return prettifyEntitySlug(entityId);
}

/**
 * THE authoritative factory for a default EntityMapping when we have no stored
 * metadata yet. Tap-to-bind, marker-drop, the Config Editor and the mesh
 * resolver all funnel through here, so the default rules — inferred type,
 * derived label, default category — live in exactly one place (DDD).
 */
export function createDefaultMapping(
  entityId: string,
  opts: { friendlyName?: string; type?: EntityType; category?: Category } = {},
): EntityMapping {
  const type = opts.type ?? inferTypeFromEntityId(entityId) ?? "sensor";
  return {
    entityId,
    type,
    label: labelFromEntityId(entityId, opts.friendlyName),
    // Category is NOT pinned per entity — it's derived from device type +
    // device_class at read time (see effectiveCategory / EntityCategories.ts).
    // Only a value the user explicitly picks in the Config Editor is stored.
    category: opts.category,
  };
}

/**
 * THE authoritative rule for "what room is this device in" — Dashboard.tsx's
 * room-resolution effect calls this once per mapped entity, on every HA
 * registry change and every scene re-calibration, and pushes the result to
 * both React (ConfigContext's resolvedRooms) and Babylon (SceneManager.
 * setResolvedRooms). Room used to be a field on EntityMapping itself,
 * hand-typed in two separate Advanced Settings editors — which meant it could
 * silently disagree with Home Assistant's own Area assignment for the same
 * device, two sources of truth that had no way to reconcile. Now there is
 * exactly one: HA's Area wins whenever the device has one; geometric
 * detection (which drawn room polygon the device's own 3D anchor sits
 * inside) is the fallback for whatever HA hasn't organised into an Area yet.
 * Nothing in the kiosk writes a room any more — see BindingsTable.tsx /
 * EntityMapRow.tsx, which used to.
 */
export function resolveEntityRoom(
  areaName: string | undefined,
  geometricRoom: string | null,
): string {
  return areaName || geometricRoom || "";
}

/**
 * Same precedence as resolveEntityRoom, for STOREY instead of room: HA's own
 * Floor (via the device's Area — see HassAreaRegistryEntry.floor_id) wins
 * whenever one is assigned; the floor-plan's own per-room `floor` value
 * (sh3dRooms, matched by room NAME — see cockpitData.ts's buildRoomGroups)
 * is the fallback for whatever HA hasn't organised into a Floor yet.
 *
 * `haFloorName` is checked BEFORE `haFloorLevel`, not after: HA's `level` is
 * an optional, user-set integer with no forced meaning (a real villa had
 * "1F" at level 1 but "2F" at level null — set for one floor and not the
 * other), whereas this app's own UI already labels every floor "1F"/"2F"
 * throughout (the HUD's floor toggle, Cockpit's floor pivot), so a leading
 * digit in the Floor's own name is the more reliable, convention-matching
 * signal whenever it's present.
 */
export function resolveEntityFloor(
  haFloorName: string | undefined,
  haFloorLevel: number | null | undefined,
  geometricFloor: number | null,
): number | null {
  if (haFloorName) {
    const digits = haFloorName.match(/\d+/);
    if (digits) return Number(digits[0]);
  }
  if (haFloorLevel != null) return haFloorLevel;
  return geometricFloor;
}

/** Passthrough kept for its call sites. Categories are no longer pinned onto a
 *  mapping — they're derived from device type + device_class at read time (see
 *  effectiveCategory / EntityCategories.ts), so a mapping's `category` is left
 *  as-is: undefined for auto devices, set only when the user picked one. */
function withCategory(m: EntityMapping): EntityMapping {
  return m;
}

/** Build a usable EntityMapping for an entity_id, falling back to inference. */
export function mappingForEntityId(
  entityId: string,
  map: Record<string, EntityMapping>,
): EntityMapping | null {
  if (map[entityId]) {
    const m = map[entityId];
    // Transparently upgrade entries that were stored with the old "sensor"
    // fallback before a domain (e.g. input_boolean) was added to the known list.
    if (
      m.type === "sensor" &&
      !entityId.startsWith("sensor.") &&
      !entityId.startsWith("binary_sensor.")
    ) {
      const upgraded = inferTypeFromEntityId(entityId);
      if (upgraded) return withCategory({ ...m, type: upgraded });
    }
    return withCategory(m);
  }
  const inferred = inferTypeFromEntityId(entityId);
  if (!inferred) return null;
  return createDefaultMapping(entityId, { type: inferred });
}

/** Strip glTF/Blender export artifacts ONLY — ".001" (Blender's own
 *  duplicate-object suffix), "_primitive0" (glTF's per-primitive child
 *  suffix), "(clone)", and a bare trailing " (2)"/"_2" numeric duplicate —
 *  but NOT the optional "__<variant>" visual-state suffix (see
 *  extractVariantSuffix below). Shared by normaliseMeshName (which also strips
 *  the variant suffix, for entity resolution) and extractVariantSuffix (which
 *  reads it, for visual-state grouping) so both start from the exact same
 *  export-artifact-free name.
 *
 *  LOOPS until stable rather than stripping each pattern once: a mesh can pick
 *  up SEVERAL of these at once and in either order — Babylon appends
 *  "_primitive<N>" when it splits a multi-material mesh, Blender appends
 *  ".00N" for a duplicate object, and depending on which happened first the
 *  tail can read "__open.001_primitive0" OR "__open_primitive0.001". A single
 *  fixed-order pass caught the first but left the "__open" un-strippable on
 *  the second — so that pose's meshes resolved to their OWN entity
 *  ("cover.x__open") instead of the base ("cover.x"), never joined the base's
 *  variant group, and thus never got toggled: the exact "one pose (usually
 *  the default) is always visible while the others toggle fine" symptom.
 *  Looping removes whatever's on the tail regardless of order or how many. */
function stripExportArtifacts(meshName: string): string {
  let s = meshName.trim();
  for (;;) {
    const next = s
      .replace(/_primitive\d+$/i, "")
      .replace(/\.\d{3,}$/, "")
      .replace(/\s*\(clone\)$/i, "")
      .replace(/\s*\(\d+\)$/, "")
      .trim();
    if (next === s) return s;
    s = next;
  }
}

/**
 * Normalise a Babylon/glTF mesh name for ENTITY resolution: strips export
 * artifacts (see stripExportArtifacts) AND an optional trailing
 * "__<variant>" visual-state suffix, so e.g. "cover.curtain_big__closed" and
 * "cover.curtain_big__open" both resolve to the exact same entity as a plain
 * "cover.curtain_big" would — see extractVariantSuffix's docstring for what
 * that suffix means and why "__" was chosen as its delimiter.
 */
export function normaliseMeshName(meshName: string): string {
  return stripExportArtifacts(meshName).replace(/__[a-z0-9]+$/i, "").trim();
}

/**
 * An OPTIONAL "__<variant>" suffix on an object's SweetHome3D/Blender name
 * marks it as one of several alternate meshes standing in for the SAME
 * entity, each a different discrete visual pose — e.g. a curtain modelled
 * three times as "cover.curtain_big__closed" / "__half" / "__open", with
 * EntityVisuals showing whichever one matches the entity's live state and
 * hiding the other two (see VARIANT_VOCAB / applyMeshVariant there). "__"
 * (double underscore) is deliberately the delimiter: HA entity_ids and every
 * other naming convention this app already recognises (MESH_ALIASES) only
 * ever use a SINGLE underscore, so "__" is a distinctive, low-collision
 * marker a real entity_id essentially never contains naturally. If one ever
 * did, resolution for that one entity would need a manual mesh binding
 * (Advanced Settings' remap) as a fallback — an accepted, documented trade-off
 * for keeping this convention simple rather than threading per-type
 * vocabulary knowledge into name resolution, which happens before an
 * entity's type is even known.
 *
 * Returns null when the mesh has no such suffix — by far the common case,
 * and the ENTIRE point of this being opt-in: a mesh with no variant suffix
 * keeps its type's configured default meaning (see VARIANT_VOCAB), and until
 * a SECOND variant is ever authored for the same entity, that default mesh
 * behaves exactly as if this mechanism didn't exist — always visible, never
 * hidden by state. A villa that never uses this convention is completely
 * unaffected by it.
 */
export function extractVariantSuffix(meshName: string): string | null {
  const m = /__([a-z0-9]+)$/i.exec(stripExportArtifacts(meshName));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Resolve a tapped mesh name to an EntityMapping using several strategies, in
 * priority order. Returns null for non-interactive meshes (walls, furniture).
 *
 * Strategy order:
 *   0) explicit user binding (meshName -> entity_id) — the turnkey path,
 *   1-4) name-based matching (mesh named with the entity_id / alias / inferred).
 */
export function resolveMeshToMapping(
  meshName: string,
  map: Record<string, EntityMapping> = ENTITY_MAP,
  bindings: Record<string, string> = {},
  deniedTypes: readonly EntityType[] = [],
): EntityMapping | null {
  const mapping = resolveMeshUnchecked(meshName, map, bindings);
  // RBAC backstop (AppConfig.deniedTypes). map/bindings arrive role-filtered,
  // but strategy 4 below fabricates a mapping from the mesh NAME alone — a
  // pipeline GLB names entity meshes with their entity_id, so "camera.gate"
  // self-binds and a guest got camera badges/highlights the permission matrix
  // denies. A denied type resolves to null: no badge, no blue highlight, not
  // tappable — the mesh itself stays visible as plain geometry.
  if (mapping && deniedTypes.includes(mapping.type)) return null;
  // Per-device disable (Advanced Settings): same effect as a denied type — the
  // device drops out of every UI surface but the mesh stays as plain geometry.
  if (mapping?.disabled) return null;
  return mapping;
}

function resolveMeshUnchecked(
  meshName: string,
  map: Record<string, EntityMapping>,
  bindings: Record<string, string>,
): EntityMapping | null {
  if (!meshName) return null;

  const base = normaliseMeshName(meshName);

  // 0) Explicit binding wins (raw name or normalised name).
  // mappingForEntityId already handles type-upgrade for old "sensor" fallbacks.
  const boundId = bindings[meshName] ?? bindings[base];
  if (boundId) return mappingForEntityId(boundId, map);

  // 1) Exact entity_id match (mesh named with the entity_id).
  if (map[base]) return withCategory(map[base]);

  // 2) Spec alias "[type]_[room]".
  if (MESH_ALIASES[base] && map[MESH_ALIASES[base]]) return withCategory(map[MESH_ALIASES[base]]);

  // 3) Sanitised form: some exporters turn "camera.livingroom_cam" into
  //    "camera_livingroom_cam". Re-insert the first underscore as a dot.
  const firstUnderscore = base.indexOf("_");
  if (firstUnderscore > 0) {
    const candidate = base.slice(0, firstUnderscore) + "." + base.slice(firstUnderscore + 1);
    if (map[candidate]) return withCategory(map[candidate]);
  }

  // 4) Looks like an entity_id we simply don't have metadata for yet — build a
  //    minimal mapping so it is still tappable (graceful unknown-entity handling).
  const inferred = inferTypeFromEntityId(base);
  if (inferred) return createDefaultMapping(base, { type: inferred });

  return null;
}
