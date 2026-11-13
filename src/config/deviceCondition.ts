// src/config/deviceCondition.ts
// IS THIS DEVICE IN TROUBLE, IN USE OR AT REST: answered once, per reading (architecture review, 2026-10-26). Every
// surface projects the one condition this returns: the badge's face and corner mark, its linked entity's pill, the 3D
// object's tint and pulse (utils/deviceActivity), a room's glow (babylon/motionRouting), a room's and a group's health
// (deviceActivity.groupLook), the Cockpit's alarms (attention.attentionOf) and, through its own projection
// below, a sensor's window and history bar (config/binaryLook). Pure: tests/oracles/device_condition.mjs drives a class
// × state table through it and every projection.
//
// ⚠️ SIX PLACES ANSWERED IT (to 2.496.542): the class table's flags were read by alertStateFor, problemStateOf,
// alertIsFault, inUse and glowsRoom (BinarySensorClasses); a lock was read three ways (deviceActivity's own branch,
// its private inUseNow, stateColors.lockBolt); the Cockpit filtered the alarms a second time with a rule that could no
// longer match. Each reading of a device now asks conditionOf, a lock through lockBolt.

import type { EntityType } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import { binaryStatus, contactOf, lockBolt, statusKeyFor, type StatusKey } from "@/utils/stateColors";
import { alertStateFor, binarySensorClassInfo, isMotionSensor } from "./BinarySensorClasses";

/**
 * One device's reading, as every surface takes it:
 *
 *   wrong    something is wrong: a leak, smoke, a low battery, connectivity off, a jammed lock, a fault word
 *   inUse    in use: a detection (motion, occupancy, presence), a door, window or lock sensor open, a lock unlocked
 *   rest     nothing to say: the device at rest, or doing its ordinary job (a light on is "rest" here: on is its face)
 *   lost     contact lost (unavailable, or never reported)
 *   noValue  in contact, with nothing to say (unknown)
 *
 * ⚠️ IN USE IS NO ERROR (owner, 2026-10-26: "reserve the ! for devices that are really in error"): it was the red "!"
 * of a leak on the map, and a line in "Needs attention". Its badge wears the plain dot now and it is calm in the rooms
 * and the Cockpit; its window keeps red (windowProblemState, owner the same day: "keep red there").
 */
export type DeviceCondition = "wrong" | "inUse" | "rest" | "lost" | "noValue";

/** Whether this binary sensor's "on" is the device in use, by its class or, a detection with no class (a "…_pir"), by
 *  its id (isMotionSensor): a detection (the table's `detects`), or a door, window or lock sensor (its `use`). */
function inUseClass(entityId: string, deviceClass: string | undefined): boolean {
  return isMotionSensor(entityId, deviceClass) || !!binarySensorClassInfo(deviceClass).use;
}

/** A binary sensor's condition in `state`: in use when its class is one in use and it reads "on"; wrong when it reads
 *  its class's problem state (alertStateFor: "on" for a leak, "off" for connectivity); else at rest. */
function binaryCondition(entityId: string, deviceClass: string | undefined, state: string): DeviceCondition {
  if (inUseClass(entityId, deviceClass)) return state === "on" ? "inUse" : "rest";
  const problem = alertStateFor(deviceClass);
  return problem !== undefined && state === problem ? "wrong" : "rest";
}

/** THE condition of `entity`, drawn as `type` (the map's mapping, else its entity map's or its domain's type). Contact
 *  first, whatever the type; then a lock by where its bolt is (stateColors.lockBolt, the one reading of a lock: jammed
 *  is wrong, open or unlocked in use), a binary sensor by its class, a sensor by the status vocabulary's fault words. */
export function conditionOf(type: EntityType, entity: Pick<HassEntity, "entity_id" | "state" | "attributes">): DeviceCondition {
  const contact = contactOf(entity.state);
  if (contact === "lost") return "lost";
  if (contact === "no-value") return "noValue";
  switch (type) {
    case "lock": {
      const bolt = lockBolt(entity.state);
      return bolt === "jammed" ? "wrong" : bolt === "open" ? "inUse" : "rest";
    }
    case "binary_sensor":
      return binaryCondition(entity.entity_id, entity.attributes?.device_class as string | undefined, entity.state);
    case "sensor":
      return statusKeyFor(entity.state, "sensor") === "alert" ? "wrong" : "rest";
    default:
      return "rest";
  }
}

/** THE MAP'S ROOM GLOW: whether this binary sensor's "on" glows its room, its condition then in use or wrong (someone
 *  there, a door open, a leak). ⚠️ ANY SUCH "ON" GLOWS (owner, 2026-10-21: the laundry room red while its door sensor
 *  read Open, "keep it that way, it makes sense"); a connected access point or a charger plugged in never does. */
export function glowsRoom(entityId: string, deviceClass: string | undefined): boolean {
  const on = binaryCondition(entityId, deviceClass, "on");
  return on === "inUse" || on === "wrong";
}

/** Whether its room's glow is an alarm (a leak, smoke: its "on" is WRONG), red, rather than a room in use (someone
 *  there, a door open), purple — the status table's alert and active (owner, 2026-11-13: one colour code). */
export function glowIsAlarm(entityId: string, deviceClass: string | undefined): boolean {
  return binaryCondition(entityId, deviceClass, "on") === "wrong";
}

/** THE WINDOW'S PROJECTION: the state a binary sensor's window and history bar paint red (binaryLook), its class's own
 *  problem state when that state is WRONG (a leak, smoke, a low battery, connectivity off): never a class in use (a door,
 *  a detection, a "…_pir" with no class: inUseClass, as the map reads it). ⚠️ IN USE IS ACTIVE, NOT RED (owner, 2026-11-13: one colour code for every status, red is an
 *  alarm): an open door, a detection were red in their window since 2026-10-26 ("keep red there") while calm on the map
 *  and in the Cockpit; they are the purple of "on, doing something" now, there as on the map (conditionOf: in use). */
export function windowProblemState(entityId: string, deviceClass: string | undefined): string | undefined {
  return inUseClass(entityId, deviceClass) ? undefined : alertStateFor(deviceClass);
}

/** THE STATUS A DEVICE'S WINDOW SAYS, as its pill and history bar colour it: a binary sensor by its class's problem
 *  state (binaryLook), anything else by the status vocabulary (stateColors.statusKeyFor, by its domain). A critical
 *  device's "needs a look" and lost contact are an alarm (stateColors.criticalStatus), applied by who knows it critical.
 *  ⚠️ ITS 3D OBJECT PAINTS THIS, NEVER A CALMER READING (owner, 2026-11-04: "i don't want to have inconsistent colours
 *  for the 3D assets. It shall always be consistent with the device status"): an unlocked lock was red in its window
 *  and the teal "in use" glow on the map (deviceActivity.meshLookFor). */
export function windowStatusOf(entity: Pick<HassEntity, "entity_id" | "state" | "attributes">): StatusKey {
  return entity.entity_id.startsWith("binary_sensor.")
    ? binaryStatus(entity.state, windowProblemState(entity.entity_id, entity.attributes?.device_class as string | undefined))
    : statusKeyFor(entity.state, entity.entity_id);
}
