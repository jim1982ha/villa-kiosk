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
import { CATEGORY_ORDER, effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { mappingForEntityId } from "@/config/EntityMap";
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
  | "manageModel"
  /** The Facility Manager workspace: maintenance schedule, completions with
   *  photo evidence, maintenance spend against the configured Minor
   *  Maintenance cap, and fault tickets. Held by BOTH the facility manager
   *  (whose job it is) and
   *  the owner (who is accountable for the property and signs off the monthly
   *  report), so this is not simply "ops-only". */
  | "manageFacility"
  /** May file a fault report. Held by EVERY profile, guests included: the
   *  person living in the villa is the one most likely to notice something
   *  broken, and a report they cannot file is a fault nobody records. It is
   *  NOT manageFacility — a guest files a report and can do nothing else with
   *  it; triage, status, cost and resolution stay with owner/ops, and the
   *  add-on enforces that shape server-side (_fm_guest_write_ok). */
  | "reportFault";

export interface RolePermissions {
  /** Device categories this profile sees on the map. "all" = every category. */
  allowedCategories: Category[] | "all";
  /** Device types hidden even inside an allowed category. */
  deniedTypes: EntityType[];
  capabilities: Capability[];
  /**
   * A narrower A/C range to offer this profile, when one is configured.
   *
   * ⚠️ THIS IS A UI AFFORDANCE, NOT AN ENFORCED CONTROL, AND ITS OLD NAME SAID
   * OTHERWISE. It was `controlLimits`, inside a record this file's own header
   * calls "THE role-based access control matrix" — vocabulary that reads as
   * enforced. It is not: the add-on permits `climate` service calls for any
   * signed-in role and places no bound on the temperature payload
   * (supervisor-proxy's _service_call_allowed), so this only narrows the
   * stepper a guest is shown. Every other denial in this file has a server
   * mirror, and the proxy says so where it mirrors one; this one never had.
   *
   * ⚠️ AND THE VALUES WERE ONE VILLA'S. It shipped `{ climateMin: 22,
   * climateMax: 28 }` — a tropical comfort band applied to every install, in a
   * redistributable add-on. Empty now, the same posture as the maintenance cap:
   * unset means the device's own min_temp/max_temp govern, which is the honest
   * default. Wiring it to per-install config is the follow-up; a "helpful" seed
   * here would be the hardcoding again in a friendlier shape.
   */
  comfortRange?: { climateMin: number; climateMax: number };
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
 *  - ops    — the facility manager. Sees everything to find their way around
 *             on site, controls devices, and owns the Facility workspace
 *             (maintenance schedule, evidence, spend, faults). Still no
 *             config/model administration — that stays with the owner.
 */
const PERMISSION_MATRIX: Record<Role, RolePermissions> = {
  guest: {
    allowedCategories: ["comfort", "light", "network", "access_control"],
    deniedTypes: ["camera", "binary_sensor"],
    capabilities: ["controlEntities", "openSettings", "customizeAppearance", "reportFault"],
    // comfortRange deliberately unset — see its declaration. The A/C stepper
    // falls back to the device's own reported limits.
  },
  owner: {
    allowedCategories: "all",
    deniedTypes: [],
    capabilities: [
      "controlEntities", "openSettings", "customizeAppearance", "editConfig", "manageModel",
      "manageFacility", "reportFault",
    ],
  },
  ops: {
    allowedCategories: "all",
    deniedTypes: [],
    // Facility managers get Settings access (open + personal appearance/comfort
    // tweaks), same as a guest — the admin-only sections (editConfig,
    // manageModel) stay gated to the owner. manageFacility is the one thing
    // they hold that the guest does not: the maintenance/fault workspace that
    // evidences the property's own maintenance/inspection obligations.
    capabilities: [
      "controlEntities", "openSettings", "customizeAppearance", "manageFacility", "reportFault",
    ],
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
function deniedCategories(role: Role): Category[] {
  return CATEGORY_ORDER.filter((c) => !isCategoryAllowed(role, c));
}

/** Full per-entity check: category allowed AND type not denied. */
function isEntityAllowed(role: Role, type: EntityType, category: Category): boolean {
  return isCategoryAllowed(role, category) && !PERMISSION_MATRIX[role].deniedTypes.includes(type);
}

/** The guest-style bounded climate range, when the role has one. */
export function climateLimits(role: Role): { climateMin: number; climateMax: number } | null {
  return PERMISSION_MATRIX[role].comfortRange ?? null;
}

/**
 * Per-entity check using its stored mapping and its LIVE entity.
 *
 * ⚠️ THE ENTITY IS A REQUIRED ARGUMENT, AND ITS ABSENCE WAS THE DEFECT. This
 * resolved the category from three of the four signals — it could not see
 * `device_class` — while the badge, the map filter and the settings row all
 * resolved it from four. The comment that used to sit here claimed the call
 * was deliberately aligned with "the category the badge/filter actually uses"
 * and warned that disagreement "is an RBAC hole, not cosmetic". It was not
 * aligned: two consecutive lines of one filter in `Dashboard` computed the
 * same entity's category two different ways.
 *
 * Pass `undefined` for an entity Home Assistant has not loaded. That is a
 * statement; omitting it was an accident nothing could see.
 */
export function isMappingAllowed(
  role: Role, entityId: string, mapping: EntityMapping,
  entity: { attributes?: { device_class?: unknown } } | undefined,
): boolean {
  const category = effectiveCategory(subjectOf(entityId, mapping, entity));
  return isEntityAllowed(role, mapping.type, category);
}

/**
 * The mapping whose panel this profile may open for `entityId`, or null — the
 * ONE gate for every way a device panel opens (round 10, 2.496.159). The 3D
 * tap and long-press each repeated mappingForEntityId + isMappingAllowed (the
 * long-press against a stale entity snapshot), and the summary tile's opener
 * checked nothing at all, relying on the tile having checked first.
 *
 * `control`: opening from the 3D model is an ACTION on the device (a tap may
 * toggle it), so it needs the controlEntities capability too; a summary tile
 * opens the panel to LOOK, which the category alone decides — the panel's own
 * controls enforce control rights for anything done inside it.
 */
export function panelMapping(
  entityId: string,
  map: Record<string, EntityMapping>,
  role: Role | null,
  entity: { attributes?: { device_class?: unknown } } | undefined,
  opts: { control: boolean },
): EntityMapping | null {
  const mapping = mappingForEntityId(entityId, map);
  if (!mapping || !role) return null;
  if (opts.control && !hasCapability(role, "controlEntities")) return null;
  return isMappingAllowed(role, entityId, mapping, entity) ? mapping : null;
}

/**
 * The config the 3D scene should see for this role: denied categories merged
 * into the hidden set, denied types passed through as deniedTypes. This is
 * the single choke point that keeps the whole Babylon layer RBAC-unaware —
 * it just renders the config it's given.
 * Returns the input unchanged (same reference) for unrestricted roles, so the
 * scene's config-diffing sees no phantom updates.
 *
 * entityMap/meshBindings are passed through BY REFERENCE, not filtered — this
 * used to rebuild both as new, denied-entries-stripped objects, which meant
 * switching profile (Owner -> Guest, say) always looked STRUCTURALLY
 * different to SceneManager.updateConfig's entityMapDelta/meshBindingsChanged
 * checks, forcing a full multi-second structural re-index (material re-clone,
 * per-light PointLight recreation — the "villa map is reloading" a profile
 * switch visibly triggered) purely to hide a few badges. That rebuild bought
 * nothing: every consumer that actually needs to hide a denied entity already
 * independently re-checks hiddenCategories/deniedTypes on its own — cullLabels
 * and applyHighlight both re-run on a bare hiddenCategories change with no
 * structural flag needed, and resolveMeshToMapping (used by both indexMeshes
 * and PickHandler) already nullifies any mapping whose type is in deniedTypes
 * regardless of what's in entityMap. Leaving entityMap/meshBindings untouched
 * keeps those references `===` stable across a role switch, so the structural
 * checks correctly see "nothing changed" and skip the expensive rebuild, while
 * hiding behaves identically either way.
 */
export function filterConfigForRole(config: AppConfig, role: Role): AppConfig {
  const perms = PERMISSION_MATRIX[role];
  const denied = deniedCategories(role);
  if (denied.length === 0 && perms.deniedTypes.length === 0) return config;

  return {
    ...config,
    hiddenCategories: [...new Set([...config.hiddenCategories, ...denied])],
    deniedTypes: perms.deniedTypes,
  };
}
