// src/components/settings/GroupedDevices.tsx
// Advanced Settings section: fold several HA entities that are really one
// physical device (e.g. a combo sensor exposing separate temperature and
// humidity entities) into a single map badge — see config/deviceGroups.ts
// and components/panels/DeviceGroupPanel for the combined detail view.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X, Sparkles } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import type { HassEntity } from "@/types/ha.types";
import {
  suggestDeviceGroups, upsertGroup, removeGroup, newGroupId, groupedEntityIds,
} from "@/config/deviceGroups";
import type { DeviceGroup, AppConfig } from "@/config/AppConfig";
import { displayLabelFor } from "@/config/EntityMap";

// Same resolver every other display surface uses — a real stored label wins,
// an untouched raw-id fallback is upgraded live to friendly_name (or a
// properly Title-Cased/deduped id) — instead of this file's own narrower
// version, which ignored any stored label entirely and fell back to the
// bare, unprettified entity_id.
function entityLabel(config: AppConfig, entities: Record<string, HassEntity>, id: string): string {
  return displayLabelFor(id, config.entityMap[id]?.label, entities[id]?.attributes.friendly_name);
}

export default function GroupedDevices() {
  const { config, update } = useConfig();
  const { entities, entityDeviceIds } = useHA();
  const [newPrimary, setNewPrimary] = useState<string | undefined>(undefined);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(
    () => suggestDeviceGroups(config.entityMap, config.deviceGroups, entityDeviceIds),
    [config.entityMap, config.deviceGroups, entityDeviceIds],
  );
  // Every entity already spoken for by some group (either role) — guards
  // against adding the same entity to two groups at once.
  const grouped = useMemo(() => groupedEntityIds(config.deviceGroups), [config.deviceGroups]);

  // A device_id-linked device can have more than 2 sibling entities (e.g. a
  // combo sensor's temperature/humidity/battery/…), which suggestDeviceGroups
  // surfaces as one suggestion row PER sibling against the same primary —
  // accepting a second row for a primary that already has a group must ADD
  // to it, not silently create a second, orphaned group under the same
  // primaryEntityId (only the first would ever be found by groupForPrimary).
  const acceptSuggestion = (primaryEntityId: string, memberEntityId: string) => {
    const existing = config.deviceGroups.find((g) => g.primaryEntityId === primaryEntityId);
    update(upsertGroup(config, existing
      ? { ...existing, memberEntityIds: [...existing.memberEntityIds, memberEntityId] }
      : { id: newGroupId(), primaryEntityId, memberEntityIds: [memberEntityId] }));
  };

  const createGroup = (primaryEntityId: string) => {
    if (grouped.has(primaryEntityId)) {
      alert("This entity is already part of another group.");
      return;
    }
    update(upsertGroup(config, { id: newGroupId(), primaryEntityId, memberEntityIds: [] }));
    setNewPrimary(undefined);
  };

  const addMember = (group: DeviceGroup, memberEntityId: string) => {
    if (!memberEntityId || memberEntityId === group.primaryEntityId) return;
    if (grouped.has(memberEntityId)) {
      alert("This entity is already part of a group.");
      return;
    }
    update(upsertGroup(config, { ...group, memberEntityIds: [...group.memberEntityIds, memberEntityId] }));
  };

  const removeMember = (group: DeviceGroup, memberEntityId: string) =>
    update(upsertGroup(config, {
      ...group, memberEntityIds: group.memberEntityIds.filter((id) => id !== memberEntityId),
    }));

  const deleteGroup = (groupId: string) => update(removeGroup(config, groupId));

  return (
    <div>
      <p className="muted body-text" style={{ marginTop: 0, marginBottom: 12 }}>
        Fold several HA entities that are really one physical device (e.g. a combo
        sensor exposing separate temperature and humidity entities) into a single
        map badge. Only the primary entity keeps a badge on the map; every other
        member's value and 24h history appear in that badge's detail view instead.
      </p>

      {/* New group — first, since creating one is the primary action here;
          the existing-groups list below is what you get once you've made
          some. No border under this any more: it used to sit LAST, below
          the groups list, separated from it by a rule that made sense in
          that order but not in this one. */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          New group
        </label>
        <p className="muted body-text" style={{ fontSize: 11, marginBottom: 10 }}>
          Pick the entity that should keep the map badge (e.g. temperature) — add
          the rest as members once the group is created.
        </p>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <EntityPicker
              value={newPrimary} onChange={setNewPrimary}
              placeholder="Search or type entity_id…" hideCurrentLabel
            />
          </div>
          <button
            className="btn ghost" onClick={() => newPrimary && createGroup(newPrimary)}
            disabled={!newPrimary} style={{ flexShrink: 0 }}
          >
            <Plus size={18} /> Create
          </button>
        </div>
      </div>

      {config.deviceGroups.length === 0 && (
        <p className="muted body-text mt">No grouped devices yet.</p>
      )}

      {config.deviceGroups.map((group) => (
        <div key={group.id} style={{ padding: "14px 0", borderTop: "1px solid var(--hairline)" }}>
          <div className="row spread" style={{ gap: 12 }}>
            {/* flex:1 + minWidth:0 + overflowWrap so a long entity_id with no
                friendly_name (one unbreakable underscore-joined token) wraps
                inside the row instead of pushing the delete button off-screen. */}
            <div style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {entityLabel(config, entities, group.primaryEntityId)}
              <div className="muted body-text" style={{ fontSize: 11, marginTop: 2, overflowWrap: "anywhere" }}>
                {group.primaryEntityId} — primary (keeps the map badge)
              </div>
            </div>
            <button className="icon-btn icon-btn-danger" style={{ flexShrink: 0 }} title="Delete group" onClick={() => deleteGroup(group.id)}>
              <Trash2 size={15} />
            </button>
          </div>

          {group.memberEntityIds.length > 0 && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {group.memberEntityIds.map((id) => (
                <span
                  key={id}
                  className="body-text"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
                    padding: "4px 8px", borderRadius: 999, background: "var(--bg-input)",
                    maxWidth: "100%", overflowWrap: "anywhere",
                  }}
                >
                  {entityLabel(config, entities, id)}
                  <button
                    className="icon-btn" style={{ width: 20, height: 20, borderRadius: 999, flexShrink: 0 }}
                    title="Remove from group" onClick={() => removeMember(group, id)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10, maxWidth: 320 }}>
            <EntityPicker
              onChange={(id) => addMember(group, id)}
              placeholder="Add another entity to this device…"
              hideCurrentLabel
            />
          </div>
        </div>
      ))}

      {/* Suggestions — collapsed by default: this section only shows what's
          already grouped unless you go looking for more. */}
      {suggestions.length > 0 && (
        <button
          className="btn ghost mt"
          onClick={() => setShowSuggestions((s) => !s)}
        >
          {showSuggestions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Sparkles size={13} /> {suggestions.length} suggested group{suggestions.length === 1 ? "" : "s"}
        </button>
      )}

      {showSuggestions && suggestions.map((s) => (
        <div
          key={`${s.primaryEntityId}|${s.memberEntityId}`}
          className="row spread"
          style={{ padding: "8px 0", borderTop: "1px solid var(--hairline)" }}
        >
          <span className="body-text" style={{ fontSize: 12, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
            {entityLabel(config, entities, s.primaryEntityId)} <span className="muted">+</span>{" "}
            {entityLabel(config, entities, s.memberEntityId)}
          </span>
          <button
            className="btn ghost"
            style={{ padding: "5px 10px", fontSize: 12, flexShrink: 0 }}
            onClick={() => acceptSuggestion(s.primaryEntityId, s.memberEntityId)}
          >
            Group these
          </button>
        </div>
      ))}
    </div>
  );
}
