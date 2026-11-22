// src/components/panels/useDeviceRows.tsx
// ONE device row (SummaryEntityRow with its inline switch, EntityRowToggle) for every list that shows devices to act
// on: a summary group's window (SummaryGroupPanel) and the search window (hud/SearchWindow). Its badge, its words,
// whether it may be switched and how (deviceSwitch: the unlock and "ask before switching" questions) are decided
// here once, so a device reads and switches the same wherever it is listed.

import type { JSX } from "react";
import { rowText } from "@/config/reading";
import EntityRowToggle from "./EntityRowToggle";
import SummaryEntityRow from "./SummaryEntityRow";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { badgeImage } from "@/babylon/badgeIcons";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { badgeOwnerOf, deviceLook, lookMarks, storeLookSource, type LookSource } from "@/utils/deviceActivity";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { ROW_SWITCH_DOMAINS } from "@/utils/quickAction";
import type { HassEntity } from "@/types/ha.types";
import type { Category } from "@/types/scene.types";
import { useVillaModel } from "@/config/VillaModel";
import { deviceSwitch } from "@/utils/devicePower";
import { NOT_SENT } from "@/ha/serviceOutcome";
import { domainOf } from "@/utils/entityDomain";
import { useMemo } from "react";

interface RowOptions {
  /** Whether the profile may switch it here (else the row only opens its window). */
  canControl: boolean;
  /** Open the device's own window. */
  onOpen: (entityId: string) => void;
}

/** The rows' shared sources and the row itself. `looks`: how every device looks, the map's own rule over the store
 *  and this profile's marks (a group's "Turn all on/off" reads it too). */
export function useDeviceRows(): { looks: LookSource; renderRow: (e: HassEntity, opts: RowOptions) => JSX.Element } {
  const { mappedEntityIds, marksFor } = useVillaModel();
  const { entities, hiddenInHaEntityIds, callService } = useHA();
  const { config } = useConfig();
  // Each row's badge is a PNG baked from the theme's tokens — see the hook.
  const theme = useResolvedTheme();
  /** How every row looks — utils/deviceActivity's deviceLook over the store,
   *  the SAME rule and the same inputs the map badge is painted from (its
   *  linked entity through devicePower, its device_class alarm). A
   *  linked entity is frequently not itself in this group (a pump's switch
   *  lives elsewhere), so this reads the whole store, not the group's list. */
  // ...and the villa model's marks as THIS profile sees the villa (VillaModel marksFor): a critical device that lost
  // contact is red, a hidden row keeps its "hidden" mark (never red or amber), a card its own Cockpit lists an amber "!".
  const { role } = useProfile();
  const marks = useMemo(() => marksFor(role), [marksFor, role]);
  const looks = storeLookSource(entities, { ...config, ...lookMarks(marks) });
  const entityLabel = useEntityLabel();

  const renderRow = (e: HassEntity, { canControl, onOpen }: RowOptions) => {
    const id = e.entity_id;
    const domain = domainOf(id);
    const look = deviceLook(id, looks);
    const type = look.type;
    // A device's LINKED entity wears that device's badge, as on the map (deviceActivity.badgeOwnerOf); its face is its own
    const owner = badgeOwnerOf(id, config.entityMap);
    const ownerType = owner === id ? type : looks.typeOf(owner);
    const ownerEnt = owner === id ? e : entities[owner];
    const cat: Category = effectiveCategory(subjectOf(owner, config.entityMap[owner], ownerEnt, ownerType));
    const label = entityLabel(id);
    // ⚠️ ONE OWNER, AND THIS ROW USED NOT TO USE IT. This was written out here
    // as `pretty(state) + " " + unit` — no scaling — so the row printed
    // "6570.989 W" beside a badge that said "6.6 kW". The climate arrow and the
    // room-vs-setpoint reasoning moved with it; see config/reading's rowText.
    const stateText = rowText(id, e);

    // `rowInHa` gates every CONTROL on the row. A phantom is rendered so the
    // device is reported, not so it can be operated: Home Assistant would
    // reject the service call, and nothing would ever come back to change the
    // row's state, so the control could only ever look broken.
    const rowInHa = !!entities[id];
    // ⚠️ THREE ANSWERS, AND THE THIRD WITHHOLDS THE CONTROL. This was
    // `isLock ? e.state !== "locked" : !OFF.has(e.state)` — and `!== "locked"`
    // is also true for `unavailable`, `unknown` and `jammed`, so a lock Home
    // Assistant had lost contact with rendered its switch in the UNLOCKED
    // position, announced as "on", while this same row's text said
    // "Unavailable" and its badge was amber. A switch has two positions and
    // the villa did not know which one was true, so it now offers none —
    // the same reasoning `rowInHa` already applies one line up. See
    // entityState.switchPosition, through devicePower.deviceSwitch — the one
    // answer for which way it sits, what throws it, and whether to ask first
    // (2.496.259: this row's switch unlocked a door in one tap, and ignored
    // the owner's "ask before switching").
    const sw = deviceSwitch(e, id, { label, requireConfirm: config.entityMap[id]?.requireConfirm });
    const position = sw.position;
    const canToggle = canControl && rowInHa && position !== "unknown"
      && ROW_SWITCH_DOMAINS.has(domain);
    // EXACTLY what the map paints: `look` above is deviceLook, the map's own
    // rule with the map's own inputs. This used to re-derive the surface from
    // classifyDeviceActivity plus its own unavailable check, which matched the
    // map for most devices and silently disagreed for any entity with a
    // `linkedEntityId`: a pump's power sensor is ringed on the map while its
    // pump runs, and every one of them listed here as plain grey. And until
    // 2.496.245 it resolved the LINKED entity as a raw `state === "on"`, where
    // the map asks devicePower — so a device linked to a lock that was
    // UNLOCKED, or a cover that was OPEN, was ringed on the map and plain here.
    const badge = look;
    const notInHaRow = !rowInHa;
    // An id HA has no entity for is reported as THAT, not as "not on the map"
    // — it may well have geometry, and saying it is missing from the model
    // would send someone to fix the wrong thing.
    const offMapRow = rowInHa && !mappedEntityIds.has(id);
    // A user explicitly hid this in HA (registry hidden_by) — distinct from
    // being merely diagnostic-category, and worth surfacing explicitly: a
    // caller that opted out of filterSuppressed (the room/category browses)
    // can now show this row at all, but the user should still be able to
    // tell "HA itself says this is hidden" from an ordinary device at a
    // glance, not just infer it silently.
    const hiddenInHa = hiddenInHaEntityIds.has(id);
    // The flip is deviceSwitch's (lock/unlock, open/close, a domain's toggle).
    const doToggle = () => {
      const f = sw.flip;
      return f ? callService(f.domain, f.service, {}, { entity_id: id }) : Promise.resolve(NOT_SENT);
    };

    // The tile itself is SummaryEntityRow — a device that lost contact wears it whole (2.496.428).
    return (
      <SummaryEntityRow
        key={id}
        label={label}
        stateText={stateText}
        look={badge}
        badgeSrc={badgeImage({
          category: cat, iconKey: iconKeyFor(ownerType, ownerEnt), state: badge.face, mark: badge.mark, linkPill: badge.linkPill,
          color: config.entityMap[owner]?.badgeColor ?? config.entityMap[id]?.badgeColor,
        })}
        badgeKey={theme}
        notInHa={notInHaRow}
        offMap={offMapRow}
        hidden={hiddenInHa}
        onOpen={() => onOpen(id)}
        toggle={canToggle && (
          <EntityRowToggle
            entityId={id}
            actualOn={position === "on"}
            ask={sw.ask}
            label={label}
            rule={look.statusRule}
            onToggle={doToggle}
          />
        )}
      />
    );
  };

  return { looks, renderRow };
}
