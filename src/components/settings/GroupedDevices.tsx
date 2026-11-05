// src/components/settings/GroupedDevices.tsx
// Advanced Settings section: fold several HA entities that are really one
// physical device (e.g. a combo sensor exposing separate temperature and
// humidity entities) into a single map badge — see config/deviceGroups.ts
// and components/panels/DeviceGroupPanel for the combined detail view.

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import AskDialog from "@/components/common/AskDialog";
import { Layers, Plus, Search, Trash2, Sparkles } from "lucide-react";
import { FoldToggle } from "@/components/common/FoldedList";
import IdText from "@/components/common/IdText";
import RecordCard from "@/components/fm/RecordCard";
import { useCardRoom } from "@/config/VillaModel";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";
import EntityPicker from "./EntityPicker";
import Fold from "./Fold";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import {
  suggestDeviceGroups, removeGroup, newGroupId, groupEdit, type GroupEdit,
} from "@/config/deviceGroups";
import type { DeviceGroup } from "@/config/AppConfig";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import RemovablePill from "@/components/common/RemovablePill";
import { countOf } from "@/utils/countOf";
import { groupMatches } from "@/config/deviceRecord";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";

export default function GroupedDevices({ title, tip }: { title: string; tip?: ReactNode }) {
  const { config, update } = useConfig();
  const { entityDeviceIds } = useHA();
  const entityLabel = useEntityLabel();
  const roomOf = useCardRoom();
  const [newPrimary, setNewPrimary] = useState<string | undefined>(undefined);
  /** A refusal to show in the app's own dialog — see AskDialog for why this is
   *  not `alert()`. */
  const [notice, setNotice] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [search, setSearch] = useState("");

  // ⚠️ EVERY DEVICE OF THE GROUP, BY WHAT ANY DEVICE IS FOUND BY (deviceRecord.deviceSearchTexts: the name on screen,
  // the villa's system's name, the room, the id), its lead and its members alike: it matched only ids and names
  const searchSource = useDeviceSearch();
  const matches = useMemo(() => config.deviceGroups.filter((g) => groupMatches(g, search, searchSource)),
    [config.deviceGroups, search, searchSource]);
  const shown = useTruncated(matches);

  const suggestions = useMemo(
    () => suggestDeviceGroups(config.entityMap, config.deviceGroups, entityDeviceIds),
    [config.entityMap, config.deviceGroups, entityDeviceIds],
  );
  // Every edit goes through deviceGroups.groupEdit, which enforces "one
  // entity, one group" (2.496.260). It is asked TWICE: once against what this
  // render shows, to explain a refusal, and again inside update() against
  // the config the change is applied to — so two edits in a row, or a change
  // from another device, can never sneak a duplicate past the first check.
  const edit = (e: GroupEdit) => {
    const now = groupEdit(config, e);
    if (typeof now === "string") { setNotice(now); return false; }
    update((c) => { const r = groupEdit(c, e); return typeof r === "string" ? {} : r; });
    return true;
  };
  const acceptSuggestion = (primaryEntityId: string, memberEntityId: string) =>
    edit({ kind: "accept", primaryEntityId, memberEntityId, id: newGroupId() });
  const createGroup = (primaryEntityId: string) => {
    if (edit({ kind: "create", primaryEntityId, id: newGroupId() })) setNewPrimary(undefined);
  };
  const addMember = (group: DeviceGroup, memberEntityId: string) =>
    edit({ kind: "add", groupId: group.id, memberEntityId });
  const removeMember = (group: DeviceGroup, memberEntityId: string) =>
    edit({ kind: "remove-member", groupId: group.id, memberEntityId });

  const deleteGroup = (groupId: string) => update((c) => removeGroup(c, groupId));

  return (
    <div>
      {notice && (
        <AskDialog
          title="Cannot group this entity"
          message={notice}
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}
      {/* what this section does is its title's (i) (ConfigEditorModal, owner 2026-10-22: no visible description) */}

      <Fold title={title} tip={tip} summary={countOf(config.deviceGroups.length, "group")
        + (suggestions.length ? ` · ${suggestions.length} suggested` : "")}>

      {/* New group — first, since creating one is the primary action here;
          the existing-groups list below is what you get once you've made
          some. No border under this any more: it used to sit LAST, below
          the groups list, separated from it by a rule that made sense in
          that order but not in this one. */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", fontWeight: 500 }}>
          New group
        </label>
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

      {config.deviceGroups.length > 0 && (
        <div className="config-search">
          <Search size={16} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by entity ID or label…"
            aria-label="Filter grouped devices"
          />
        </div>
      )}

      {config.deviceGroups.length > 0 && matches.length === 0 && (
        <p className="muted body-text mt">No groups match “{search}”.</p>
      )}

      {/* ⚠️ EACH GROUP THE COCKPIT'S CARD (owner, 2026-11-06): its name (its primary's) in the strip, the group's icon
          before it; its room, its primary's id and what the primary does on its quiet line; its members and "Add another
          entity…" its words; Remove group its bar */}
      {shown.visible.length > 0 && (
        <div className="fm-list settings-cards">
          {shown.visible.map((group) => (
            <RecordCard key={group.id} title={entityLabel(group.primaryEntityId)} lead={<Layers size={16} aria-hidden />}
              room={roomOf({ entityId: group.primaryEntityId })}
              pills={<><span><IdText id={group.primaryEntityId} /></span><span>primary (keeps the map badge)</span></>}
              body={
                // the member pills and the "add another" picker share one line, the picker compact at the pills' height
                <div className="group-members">
                  {group.memberEntityIds.map((id) => (
                    <RemovablePill key={id} label={entityLabel(id)} tip={id} removeLabel="Remove from group"
                      onRemove={() => removeMember(group, id)} />
                  ))}
                  <div className="group-members-add">
                    <EntityPicker
                      onChange={(id) => addMember(group, id)}
                      placeholder="Add another entity…"
                      hideCurrentLabel
                      compact
                    />
                  </div>
                </div>
              }
              actions={
                <button type="button" className="btn ghost" aria-label={`Remove the group ${entityLabel(group.primaryEntityId)}`}
                  onClick={() => deleteGroup(group.id)}>
                  <Trash2 size={16} aria-hidden />Remove group
                </button>
              } />
          ))}
        </div>
      )}
      <ShowAll list={shown} noun="group" />

      {/* Suggestions — collapsed by default: this section only shows what's
          already grouped unless you go looking for more. */}
      {suggestions.length > 0 && (
        <FoldToggle open={showSuggestions} onToggle={() => setShowSuggestions((s) => !s)}>
          <Sparkles size={16} aria-hidden /> {countOf(suggestions.length, "suggested group")}
        </FoldToggle>
      )}

      {/* a suggested group: the same card, its main action first in its bar */}
      {showSuggestions && (
        <div className="fm-list settings-cards">
          {suggestions.map((s) => (
            <RecordCard key={`${s.primaryEntityId}|${s.memberEntityId}`}
              title={`${entityLabel(s.primaryEntityId)} + ${entityLabel(s.memberEntityId)}`} lead={<Sparkles size={16} aria-hidden />}
              room={roomOf({ entityId: s.primaryEntityId })}
              pills={<><span><IdText id={s.primaryEntityId} /></span><span><IdText id={s.memberEntityId} /></span></>}
              actions={
                <button type="button" className="btn ghost fm-bar-main" onClick={() => acceptSuggestion(s.primaryEntityId, s.memberEntityId)}>
                  <Plus size={16} aria-hidden />Create this group
                </button>
              } />
          ))}
        </div>
      )}
      </Fold>
    </div>
  );
}
