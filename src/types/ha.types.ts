// Home Assistant data shapes (subset we use).

export interface HassContext {
  id: string;
  parent_id: string | null;
  user_id: string | null;
}

export interface HassEntityAttributes {
  friendly_name?: string;
  unit_of_measurement?: string;
  device_class?: string;
  supported_features?: number;
  supported_color_modes?: string[];

  // light
  brightness?: number; // 0-255
  color_temp_kelvin?: number;
  min_color_temp_kelvin?: number;
  max_color_temp_kelvin?: number;
  rgb_color?: [number, number, number];
  hs_color?: [number, number];

  // climate
  temperature?: number;
  current_temperature?: number;
  min_temp?: number;
  max_temp?: number;
  target_temp_step?: number;
  hvac_modes?: string[];
  hvac_action?: string;
  fan_mode?: string;
  fan_modes?: string[];

  // cover
  current_position?: number; // 0-100

  // fan
  percentage?: number;
  preset_mode?: string;
  preset_modes?: string[];

  // media
  media_title?: string;
  media_artist?: string;

  // camera — a rotating, per-entity signed token HA accepts as ?token= on
  // /api/camera_proxy[_stream]. NOT the long-lived access token (which only
  // authenticates via header/cookie, unusable from an <img>).
  access_token?: string;
  entity_picture?: string;

  // generic
  [key: string]: unknown;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: HassEntityAttributes;
  last_changed: string;
  last_updated: string;
  context: HassContext;
}

export interface HassServiceTarget {
  entity_id: string | string[];
}

/** Subset of `config/entity_registry/list`'s rows we use — just enough to
 *  tell whether the USER hid an entity in HA (Settings > Entities >
 *  "Visible" toggle) or HA itself filed it under Configuration/Diagnostics
 *  rather than the main entity list. `hidden_by` is a string (e.g. "user")
 *  when hidden, null otherwise; unrelated to `disabled_by` (a disabled entity
 *  has no state at all, so it already can't appear via get_states).
 *  `entity_category` is "config" | "diagnostic" | null — the SAME field HA's
 *  own auto-generated dashboards read to keep those entities off area/device
 *  cards (they're still fully visible on the entity's own HA page).
 *  `area_id`/`device_id` feed the room-suggestion signal in HAStateStore —
 *  an entity's own `area_id` wins; when null, it inherits its device's (see
 *  HassDeviceRegistryEntry). Both null for an entity with no area assigned
 *  anywhere in HA — same as any other installation's real, per-site data,
 *  never a value this app ships or assumes. */
export interface HassEntityRegistryEntry {
  entity_id: string;
  hidden_by: string | null;
  entity_category: string | null;
  area_id: string | null;
  device_id: string | null;
}

/** Subset of `config/device_registry/list`'s rows — only needed to resolve
 *  the AREA an entity inherits when its own registry row has no `area_id`
 *  of its own (the common case: HA assigns area at the device level and
 *  entities inherit it). */
export interface HassDeviceRegistryEntry {
  id: string;
  area_id: string | null;
}

/** Subset of `config/area_registry/list`'s rows — id → human-readable name,
 *  the only two fields the room-suggestion signal needs. */
export interface HassAreaRegistryEntry {
  area_id: string;
  name: string;
}

/** Subset of `energy/get_prefs`'s response — only the statistic IDs the
 *  Energy Dashboard is configured against, never the values themselves (see
 *  HAWebSocket.getStatisticsDuringPeriod for those). Both arrays are empty,
 *  not absent, on an install with no Energy Dashboard configured at all. */
export interface EnergyPrefs {
  energy_sources: { type: string; stat_energy_from?: string }[];
  device_consumption: { stat_consumption: string }[];
}

/** One row of `recorder/list_statistic_ids` — which statistic IDs actually
 *  have recorded data, cross-checked against energy_sources/device_consumption
 *  before trusting either (a configured source can reference an ID that no
 *  longer resolves, e.g. after an unrelated entity rename). */
export interface StatisticIdInfo {
  statistic_id: string;
  unit_class: string | null;
}

/** One bucket of `recorder/statistics_during_period` (types: ["change"]) —
 *  `change` is the consumption WITHIN this bucket, already computed by HA. */
export interface StatisticPeriod {
  start: number;
  end: number;
  change: number | null;
}

export type EntityDomain =
  | "light"
  | "climate"
  | "lock"
  | "camera"
  | "cover"
  | "fan"
  | "binary_sensor"
  | "sensor"
  | "media_player"
  | "switch"
  | "input_boolean"
  | "assist_satellite";

/** A single point of a sensor history series (for sparklines). */
export interface HistoryPoint {
  t: number; // epoch ms
  v: number; // numeric value
}

/** A single state-change point (for StateTimeline) — the RAW state string, no
 *  numeric parsing, so it also works for on/off, enum and free-text sensors
 *  (e.g. an access point's "connected"/"disconnected"). */
export interface StateHistoryPoint {
  t: number; // epoch ms
  state: string;
}
