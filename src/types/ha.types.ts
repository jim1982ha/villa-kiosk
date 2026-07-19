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
