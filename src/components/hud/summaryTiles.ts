// src/components/hud/summaryTiles.ts
//
// WHAT THE VILLA IS, AT A GLANCE — the wall tablet's bottom strip.
//
// ⚠️ 178 PURE LINES IN A FILE `node` REFUSES OUTRIGHT. This decided whether the
// doors are locked, how warm the house is and what it is drawing, and no suite
// could reach any of it. Two of its inputs (`summaryGroups`, `entityState`)
// were already extracted, so the seam was proven and this was the residue.
//
// ⚠️ ITS OWN COMMENT NAMED THE PINNED SIBLING. `POOL_WORD` says it anchors
// against "the same substring-collision bug class as EntityCategories'
// SWITCH_PURPOSE_HINTS" — and that table is pinned character-for-character in
// `tests/consistency/villa_rules.ts` and `test_consistency_parity`. This one
// was pinned nowhere.
//
// Three more rules live here and only here, each with a stated defect behind
// it: the lock tile's "N Unknown" branch (an unavailable lock reported as
// unlocked is "a plain lie about a door"), climate's refusal to average target
// setpoints, and Energy's replacement of a hardcoded `totalW > 3000` with
// per-sensor thresholds — the first hard rule's own worked example.
//
// ⚠️ ITS ONLY NON-PURE EDGE IS lucide's `IconType`, which crosses a `.ts` seam
// already (`summaryGroups.ts` does the same) and loads under the harness.

import type { ComponentType } from "react";
// ⚠️ lucide LOADS UNDER BARE NODE — verified. It is not what kept this
// module out of the harness; the `.tsx` extension was.
import { Snowflake, Zap, Waves } from "lucide-react";
import { levelForValue, type Threshold } from "@/config/ThresholdConfig";
import { locksGroup, lightsGroup } from "@/config/summaryGroups";
import { isOn, onOffSummary, OFF_STATES } from "@/utils/entityState";
import { formatUnitValue } from "@/utils/entityValue";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping } from "@/types/scene.types";

type IconType = ComponentType<{ size?: number | string; className?: string }>;

export interface SummaryTile {
  id: string;
  icon: IconType;
  label: string;
  value: string;
  tone: "on" | "off" | "warn" | "neutral";
  category: Category;
  entityIds: string[];
  title: string;
  canControl: boolean;
}

/** Build the ordered tile list from the live entity snapshot. Pure (no side
 *  effects) so it's cheap to recompute on every state push via useMemo. */
export function deriveTiles(
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
  resolvedRooms: Record<string, string>,
  can: (c: Category) => boolean,
  thresholds: Record<string, Threshold>,
): SummaryTile[] {
  const all = Object.values(entities);
  const byDomain = (d: string) => all.filter((e) => e.entity_id.startsWith(`${d}.`));
  const tiles: SummaryTile[] = [];

  // ── Door locks ───────────────────────────────────────────────────────
  // `lock.*` entities only — see locksGroup's own docstring for why this
  // isn't extended to switches that merely LOOK like a door/gate relay by
  // name (tried once, matched every "outdoor" light switch in the villa via
  // an unanchored "door" substring — reverted). Shared with the Facility
  // Readiness tab's "View doors" shortcut (see summaryGroups.ts) so both
  // open the identical group, not two independently-derived lists.
  // ⚠️ DELIBERATELY UNFILTERED, AND THIS IS THE OPEN QUESTION /dry-audit left
  // (2026-08-21). `locksGroup` now accepts a villa-device set and Facility's
  // Readiness drill-down passes one, because its CHECK counts villa devices and
  // the two must agree. The bottom bar has no such neighbour to contradict, so
  // narrowing it here would change a visible count on the main screen with
  // nothing reporting the old one as wrong — a design change, not an audit
  // finding. If the tile should show only the villa's locks, pass
  // `selectableDeviceIds` here and verify the count on hardware.
  const locksG = locksGroup(entities, entityMap);
  if (locksG) {
    const locks = locksG.entityIds.map((id) => entities[id]).filter((e): e is HassEntity => !!e);
    const lockedN = locks.filter((l) => l.state === "locked").length;
    const unlockedN = locks.filter((l) => l.state === "unlocked").length;
    const allLocked = lockedN === locks.length;
    const single = locks.length === 1;
    tiles.push({
      id: "__locks",
      icon: locksG.icon,
      // Short + generic on purpose, even for a single lock: the tile's real
      // constraint is horizontal space in the bar, and "Outdoor Entrance
      // Lock" (the lock's own HA friendly_name) was one of the widest tiles
      // in it. "Door Lock" also reads sensibly once a second lock exists (the
      // tile already becomes the even-more-generic "Locks" at that point —
      // see the `single` branch below). The MODAL this tile opens still uses
      // the real per-device name (title, further down) — it has the room.
      label: single ? "Door Lock" : "Locks",
      // Reads as a STATE, not as a score. "2/2 locked" makes you do the
      // arithmetic before you know whether anything is wrong, and the one
      // number that matters — how many are open — is the one it never prints.
      // "Locked" needs no reading at all, and "1 Unlocked" names the problem
      // and its size in fewer characters than the fraction used — which is the
      // point: the bar's real constraint is horizontal space, so the all-good
      // case says the same word the single-lock tile says and no more.
      // Same shape as the single-lock branch above and the light tile's "2 On".
      value: single
        ? (locks[0].state === "locked" ? "Locked" : locks[0].state === "unlocked" ? "Unlocked" : locks[0].state)
        : allLocked ? "Locked"
          : unlockedN > 0 ? `${unlockedN} Unlocked`
            // Not all locked, yet none actually UNLOCKED: every remainder is
            // unavailable or jammed. Counting those as unlocked would be a
            // plain lie about a door, on the tile whose whole job is to be
            // trusted at a glance — so they are reported as what they are.
            : `${locks.length - lockedN} Unknown`,
      tone: allLocked ? "neutral" : "warn",
      category: "access_control",
      entityIds: locksG.entityIds,
      title: locksG.title,
      canControl: can("access_control"),
    });
  }

  // ── Pool / jacuzzi switches ──────────────────────────────────────────
  // Two independent rules, either one qualifies: the entity's own id/name
  // reads as pool equipment, OR the ROOM it resolves to (resolvedRooms — HA's
  // own Area, falling back to GLB geometry, not this switch's own name) is
  // the pool room. The second rule is the more robust one: it catches a
  // switch named nothing like "pool" (a generic "Filter Pump 2") as long as
  // it's placed in the Swimming Pool room, without touching the first rule at
  // all. Anchored against "."/"_"/" "/start/end (room names are human text
  // with spaces, entity ids use "_") — a bare "spa" would otherwise match
  // inside e.g. "spartan_gym_relay" (same substring-collision bug class as
  // EntityCategories' SWITCH_PURPOSE_HINTS).
  const POOL_WORD = /(?:^|[._ ])(?:pool|jacuzzi|jaccuzi|spa)(?:[._ ]|$)/i;
  const poolSwitches = byDomain("switch").filter(
    (e) => POOL_WORD.test(e.entity_id) || POOL_WORD.test(resolvedRooms[e.entity_id] ?? ""),
  );
  if (poolSwitches.length) {
    const on = poolSwitches.some(isOn);
    tiles.push({
      id: "__pool", icon: Waves, label: "Pool",
      value: onOffSummary(poolSwitches.filter(isOn).length, poolSwitches.length),
      tone: on ? "on" : "off", category: "energy",
      entityIds: poolSwitches.map((e) => e.entity_id), title: "Pool", canControl: can("energy"),
    });
  }

  // ── All lights ───────────────────────────────────────────────────────
  // Shared with the Facility Readiness tab's "View lights" shortcut (see
  // summaryGroups.ts) so both open the identical full list of lights, not
  // just the ones a readiness check happens to flag as still lit.
  const lightsG = lightsGroup(entities);
  if (lightsG) {
    const lights = lightsG.entityIds.map((id) => entities[id]).filter((e): e is HassEntity => !!e);
    const n = lights.filter(isOn).length;
    tiles.push({
      id: "__lights", icon: lightsG.icon, label: "Lights",
      value: onOffSummary(n, lights.length),
      tone: n > 0 ? "on" : "off", category: "light",
      entityIds: lightsG.entityIds, title: lightsG.title, canControl: can("light"),
    });
  }

  // ── Climate ("AC") ───────────────────────────────────────────────────
  const climates = byDomain("climate");
  if (climates.length) {
    const active = climates.filter((e) => e.state !== "off" && !OFF_STATES.has(e.state));
    // ONLY real current_temperature readings — never a fallback to `temperature`
    // (the TARGET setpoint). That fallback used to mean this tile could show a
    // bare "26°C" that was actually one unit's target, not a measured room
    // temperature, with nothing to say which — reported as exactly that
    // confusion. Averaging real readings across several rooms is still a
    // meaningful "how warm is the house" glance value; averaging two units'
    // independently-set TARGETS is not a real quantity at all (a living room
    // aimed at 26° and a bedroom aimed at 18° do not average to a "22°" that
    // means anything). With no real reading available, this now falls back to
    // the shared on/off phrasing instead of ever showing a number that isn't
    // actually a temperature.
    const temps = active
      .map((e) => e.attributes.current_temperature)
      .filter((t): t is number => typeof t === "number");
    const avg = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
    tiles.push({
      id: "__climate", icon: Snowflake, label: "AC",
      // Average CURRENT temperature is the more useful glance value while
      // anything is running and actually reporting one; otherwise defer to
      // the shared phrasing so "All Off" here matches "All Off" on the Lights
      // tile beside it (and "3 On" with no reading reads the same way too).
      value: active.length && avg !== null
        ? `${avg}°C`
        : onOffSummary(active.length, climates.length),
      tone: active.length ? "on" : "off", category: "comfort",
      entityIds: climates.map((e) => e.entity_id), title: "Climate", canControl: can("comfort"),
    });
  }

  // ── Energy → total instantaneous power across power sensors (read-only) ─
  const powerSensors = byDomain("sensor").filter(
    (e) => e.attributes.device_class === "power" || /(^|_)w$|watt/i.test(e.attributes.unit_of_measurement ?? ""),
  );
  if (powerSensors.length) {
    const totalW = powerSensors.reduce((sum, e) => {
      const v = Number(e.state);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    tiles.push({
      id: "__energy", icon: Zap, label: "Energy",
      value: formatUnitValue(totalW, "W"),
      // A HARDCODED `totalW > 3000` used to live here, and it was exactly the
      // per-site tuning constant the first hard rule forbids: 3 kW is
      // an idle afternoon in a villa with a pool pump and an alarming spike in
      // a small apartment. It was right for the machine it was written on and
      // wrong everywhere else — a tile permanently red on one install and
      // never lit on another.
      //
      // The tile now inherits the alert state of its own members, the way the
      // Locks tile already does: it warns if any contributing power sensor is
      // over the threshold configured FOR THAT SENSOR (config.alertThresholds,
      // which ships empty — see ThresholdConfig). With none configured it stays
      // informational, which is the honest default: the app has no basis for
      // calling any wattage high in a villa it has never seen.
      tone: powerSensors.some((e) => {
        const v = Number(e.state);
        return Number.isFinite(v) && levelForValue(v, thresholds[e.entity_id]) !== "normal";
      }) ? "warn" : "neutral",
      category: "energy",
      entityIds: powerSensors.map((e) => e.entity_id), title: "Energy", canControl: false,
    });
  }

  return tiles;
}
