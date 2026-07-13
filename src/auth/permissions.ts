// src/auth/permissions.ts
// THE role-based access control matrix. Edit the PERMISSION_MATRIX table to
// change what a profile can see or do — nothing else in the app needs to
// change. Components never read the table directly; they ask the resolver
// functions at the bottom, so the table's shape can evolve freely.
//
// Categories are the existing map-filter categories (config/EntityCategories.ts
// — comfort / light / network / energy / access_control / others) and the
// existing category→device-type assignment is preserved: RBAC composes ON TOP
// of it. `deniedTypes` handles the case where a category is allowed but one
// device type inside it is not (e.g. guests may see wifi — category "network" —
// but never cameras, which share that category).

import type { Category, EntityMapping, EntityType } from "@/types/scene.types";
import type { AppConfig } from "@/config/AppConfig";
import { CATEGORY_ORDER, categoryForEntity } from "@/config/EntityCategories";
import type { Role } from "./roles";

/** Things a profile can DO (beyond seeing devices). */
export type Capability =
  /** Toggle / drive devices from the map and panels. */
  | "controlEntities"
  /** Open the Settings modal at all. */
  | "openSettings"
  /** Appearance / behaviour tweaks inside Settings (theme, quality, icons…). */
  | "customizeAppearance"
  /** The full Config Editor modal: villa coordinates, bindings, entity metadata. */
  | "editConfig"
  /** Upload / replace / reset the central 3D model and SH3D plan. */
  | "manageModel";

export interface RolePermissions {
  /** Device categories this profile sees on the map. "all" = every category. */
  allowedCategories: Category[] | "all";
  /** Device types hidden even inside an allowed category. */
  deniedTypes: EntityType[];
  capabilities: Capability[];
  /** Bounded controls (spec: guests get a clamped A/C range). */
  controlLimits?: { climateMin: number; climateMax: number };
}

/**
 * Who sees what:
 *  - guest  — comfort, lights, wifi, doors. Never energy, monitoring or
 *             security devices (cameras / motion sensors share the "network"
 *             and "others" buckets, hence the type denials). A/C is clamped.
 *             May open Settings for the visual/UI options (theme, render
 *             quality, icons, movement feel) — never connection, calibration,
 *             model or config administration.
 *  - owner  — sees everything and administers the kiosk (the owner is the
 *             only profile that validates and customises).
 *  - ops    — sees everything to find their way around on site, but the
 *             kiosk is consultation + control only: no settings, no config.
 */
export const PERMISSION_MATRIX: Record<Role, RolePermissions> = {
  guest: {
    allowedCategories: ["comfort", "light", "network", "access_control"],
    deniedTypes: ["camera", "binary_sensor"],
    capabilities: ["controlEntities", "openSettings", "customizeAppearance"],
    controlLimits: { climateMin: 22, climateMax: 28 },
  },
  owner: {
    allowedCategories: "all",
    deniedTypes: [],
    capabilities: [
      "controlEntities", "openSettings", "customizeAppearance", "editConfig", "manageModel",
    ],
  },
  ops: {
    allowedCategories: "all",
    deniedTypes: [],
    capabilities: ["controlEntities"],
  },
};

export function hasCapability(role: Role, cap: Capability): boolean {
  return PERMISSION_MATRIX[role].capabilities.includes(cap);
}

export function isCategoryAllowed(role: Role, category: Category): boolean {
  const allowed = PERMISSION_MATRIX[role].allowedCategories;
  return allowed === "all" || allowed.includes(category);
}

/** Categories the role must never see — merged into the scene's hidden set. */
export function deniedCategories(role: Role): Category[] {
  return CATEGORY_ORDER.filter((c) => !isCategoryAllowed(role, c));
}

/** Full per-entity check: category allowed AND type not denied. */
export function isEntityAllowed(role: Role, type: EntityType, category: Category): boolean {
  return isCategoryAllowed(role, category) && !PERMISSION_MATRIX[role].deniedTypes.includes(type);
}

/** The guest-style bounded climate range, when the role has one. */
export function climateLimits(role: Role): { climateMin: number; climateMax: number } | null {
  return PERMISSION_MATRIX[role].controlLimits ?? null;
}

/** Per-entity check using its stored mapping (falls back to the category
 *  defaults exactly like the rest of the app does). */
export function isMappingAllowed(role: Role, entityId: string, mapping: EntityMapping): boolean {
  const category = mapping.category ?? categoryForEntity(entityId, mapping.type);
  return isEntityAllowed(role, mapping.type, category);
}

/**
 * The config the 3D scene should see for this role: denied categories merged
 * into the hidden set, denied entities stripped from the entity map (and their
 * mesh bindings with them). This is the single choke point that keeps the whole
 * Babylon layer RBAC-unaware — it just renders the config it's given.
 * Returns the input unchanged (same reference) for unrestricted roles, so the
 * scene's config-diffing sees no phantom updates.
 */
export function filterConfigForRole(config: AppConfig, role: Role): AppConfig {
  const perms = PERMISSION_MATRIX[role];
  const denied = deniedCategories(role);
  if (denied.length === 0 && perms.deniedTypes.length === 0) return config;

  const entityMap: Record<string, EntityMapping> = {};
  for (const [id, mapping] of Object.entries(config.entityMap)) {
    if (isMappingAllowed(role, id, mapping)) entityMap[id] = mapping;
  }
  const meshBindings: Record<string, string> = {};
  for (const [mesh, id] of Object.entries(config.meshBindings)) {
    if (!config.entityMap[id] || entityMap[id]) meshBindings[mesh] = id;
  }
  return {
    ...config,
    entityMap,
    meshBindings,
    hiddenCategories: [...new Set([...config.hiddenCategories, ...denied])],
    // Blocks the resolver's mesh-NAME inference fallback too (see the field's
    // doc in AppConfig): stripping entityMap/meshBindings above doesn't stop a
    // mesh literally named after an entity_id from self-binding.
    deniedTypes: perms.deniedTypes,
  };
}
