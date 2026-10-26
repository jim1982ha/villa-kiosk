// src/config/deviceCondition.ts
// IS THIS DEVICE IN TROUBLE, IN USE OR AT REST: answered once, per reading (architecture review, 2026-10-26). Every
// surface projects the one condition this returns: the badge's face and corner mark, its linked entity's pill, the 3D
// object's tint and pulse (utils/deviceActivity), a room's glow (babylon/motionRouting), a room's and a group's health
// (deviceActivity.groupLook), the Cockpit's alarms (attention.buildAttentionItems) and, through its own projection
// below, a sensor's window and history bar (config/binaryLook). Pure: tests/oracles/device_condition.mjs drives a class
// × state table through it and every projection.
//
// ⚠️ SIX PLACES ANSWERED IT (to 2.496.542): the class table's flags were read by alertStateFor, problemStateOf,
// alertIsFault, inUse and glowsRoom (BinarySensorClasses); a lock was read three ways (deviceActivity's own branch,
// its private inUseNow, stateColors.lockBolt); the Cockpit filtered the alarms a second time with a rule that could no
// longer match. Each reading of a device now asks conditionOf, a lock through lockBolt.

import type { EntityType } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import { contactOf, lockBolt, statusKeyFor } from "@/utils/stateColors";
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

/** THE WINDOW'S PROJECTION: the state a binary sensor's window and history bar paint red (binaryLook), its class's own
 *  problem state, in use or wrong alike. ⚠️ THE ONE PLACE THE WINDOW DIFFERS FROM THE MAP (owner, 2026-10-26: "keep red
 *  there"): an open door or a detection is red in its window, calm on the map and in the Cockpit (conditionOf: in use).
 *  By class only, as the window always read it: a presence or moving sensor (no problem state) is never red there. */
export function windowProblemState(deviceClass: string | undefined): string | undefined {
  return alertStateFor(deviceClass);
}
