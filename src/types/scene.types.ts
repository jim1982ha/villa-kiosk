import type { EntityDomain } from "./ha.types";

/** The kind of control panel a tapped mesh should open. */
export type EntityType = EntityDomain;

/** Grouping used by the map's category filter (HUD left column) and the
 *  Config Editor's "Category" column. Default assignment per device type —
 *  and per-entity exceptions — live in `config/EntityCategories.ts`. */
export type Category = "comfort" | "light" | "network" | "energy" | "access_control" | "others";

export interface EntityMapping {
  entityId: string;
  type: EntityType;
  label: string; // Human-readable name for UI panels
  // Room is NOT stored here any more — it's live-computed (HA's own Area
  // assignment, falling back to GLB geometric detection) rather than a
  // stored/user-editable field, so it can never drift from Home Assistant's
  // own room organisation. See config/devicePlace.ts's resolveEntityRoom and
  // ConfigContext's resolvedRooms.
  category?: Category; // Map filter grouping; falls back to categoryForEntity() when unset
  /** The owner picked `category` by hand, rather than it having been
   *  auto-assigned.
   *
   *  ⚠️ WITHOUT THIS, A PICK COULD NOT BE DISTINGUISHED FROM A DEFAULT, AND
   *  SIX CHOICES WERE UNSELECTABLE. `effectiveCategory` discards a stored
   *  category that happens to equal the LEGACY default for its type, so a
   *  defaults re-org re-buckets devices nobody ever chose for — which is
   *  right, and was indistinguishable from a deliberate choice. Picking
   *  "Others" for a lock, or "Network" for a camera, round-tripped straight
   *  back to the default in the dropdown, because the dropdown's own value is
   *  that function. A recorded pick is honoured verbatim. */
  categoryPicked?: true;
  /** Hide this device from the 3D view entirely: no badge/label, no blue
   *  highlight, not tappable — the mesh stays as plain geometry. For devices
   *  modelled ahead of their Home Assistant integration (e.g. ceiling fans not
   *  yet controllable). Toggled per-device in Advanced Settings. */
  disabled?: boolean;
  /** Explicit per-device opt-in: a plain tap on this device's map badge no
   *  longer instantly toggles it (see utils/quickAction.ts's isQuickToggle),
   *  and its panel's own on/off button asks "Turn on/off?" before acting
   *  (PowerToggle) — the SAME two-step confirm pattern SummaryGroupPanel's
   *  "Turn all on/off" already uses, not a new one. For a switch/light/fan
   *  that is really a door release, gate motor, or anything else where an
   *  accidental tap has a real physical consequence.
   *
   *  Deliberately NOT inferred from the entity_id (a relay-controlled lock
   *  modelled as switch.* has no reliable naming convention — an earlier
   *  attempt at auto-detecting one from the name was tried, misfired, and
   *  was reverted; see CLAUDE.md's gotchas) — only ever set by hand in
   *  Advanced Settings, off by default on every device. A `type: "lock"`
   *  entity doesn't need this: it already never quick-toggles and already
   *  has its own two-step confirm on Unlock (see LockPanel). */
  requireConfirm?: boolean;
  /** The entity LINKED to this device — no domain or type restriction (a pump's relay, a light's switch, a camera's
   *  motion sensor…), configurable on every entity type, and set by hand in Advanced Settings. Drives the badge's
   *  bottom-right pill (deviceActivity.linkPillOf: its own problem, else filled on / hollow off) and the window's
   *  linked switch or sensor band. What else it drives is decided by WHAT it is, never by the device's type alone: a
   *  presence detector linked to a camera drives the camera's beam on the map and its window's motion status
   *  (BinarySensorClasses.cameraMotionId).
   *
   *  ⚠️ ONE FIELD (owner, 2026-10-22): a camera had a second one for its motion sensor, and its
   *  long press toggled this one. Merged — AppConfig.mergeMotionIntoLinked moves a stored motion sensor here — and a
   *  camera's long press opens its details like every other device's. */
  linkedEntityId?: string;
  /** For type "light": a per-fixture override, -1..1 (Advanced Settings shows
   *  it as a -100%..+100% slider), applied ON TOP of the entity's live HA
   *  brightness and the global "Light effect strength" setting — 0 = no
   *  change, -1 = fully off, +1 = double. Lets one light be tuned brighter or
   *  dimmer than its HA dimmer level alone would produce (e.g. a fixture
   *  whose room reads darker than the others) without affecting every other
   *  light (EntityVisuals.lightReading's `frac`; at −1 every output is off —
   *  LightPools.poolStrength treats 0 as off since 2.496.185). */
  lightIntensityRatio?: number;
  /** Per-entity badge background colour (#rrggbb) set from the device panel's
   *  icon. Overrides the category's preset gradient for THIS device's map badge
   *  only (see babylon/badgeIcons.badgeImageDataUrl). Unset = category default.
   *  Persisted with entityMap (local storage) and in the config export bundle. */
  badgeColor?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TeleportPoint {
  name: string;
  /** 1-based storey index — 1 is the ground floor.
   *
   *  ⚠️ NOT `1 | 2`. It was, and SceneManager clamped a third storey down onto
   *  the second to satisfy it, under a comment calling a third floor
   *  "hypothetical". In a redistributable add-on it is not hypothetical, it is
   *  the first hard rule: no villa dimension ships. The GLB parser has always
   *  read the honest type (sh3dParser's `floor: number`), so the pipeline read
   *  N storeys and this union threw away everything past two. Third instance of
   *  the same assumption found in one day — HUD's `[1, 2]` and FloorManager's
   *  FLOOR_SPLIT_Y were the others. */
  floor: number;
  /** FIRST-PERSON teleport destination (a standing pose). The bird's-eye
   *  framing is NOT stored: it's derived per room from the floor plan's own
   *  footprint on arrival — see babylon/roomShot.ts. There
   *  used to be a hand-saved `overviewPose` here as well, which froze one
   *  eyeballed zoom into config and, being usually too wide, also left the
   *  room's badges grouped when you arrived. */
  position: Vec3;
  target: Vec3;
  thumbnail?: string;
  /**
   * DERIVED, not authored: this point was fitted from the floor plan by
   * SceneManager.calibrateRooms and is recomputed on every model load. Absent
   * on a point the user added themselves ("Add room here" in the Rooms menu),
   * which is the only kind worth storing anywhere.
   *
   * The flag exists because these are NOT SHARED CONFIG and were being synced
   * as if they were. The plan→world fit is re-solved and the floor height is
   * raycast per load, so the coordinates differ slightly between devices — and
   * `teleportPoints` is a shared key whose diff compares items by JSON. Every
   * device therefore pushed all 23 rooms on every boot, pulled another
   * device's fit, disagreed with it, and pushed again: a feedback loop that
   * telemetry finally caught as `changed: {teleportPoints: 23}` on all five
   * devices in one session. Quantising the geometry did not stop it, because
   * the fits genuinely differ by more than the quantum.
   *
   * The fix is to stop storing what is already derivable: the GLB and its room
   * data are ALREADY shared, so every client computes these for itself from
   * the same inputs. See pickSharedConfig/mergeSharedConfig, which are the one
   * place that split lives.
   */
  fitted?: boolean;
}
