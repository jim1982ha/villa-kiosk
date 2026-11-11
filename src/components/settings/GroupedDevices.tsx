// src/components/settings/GroupedDevices.tsx
// Advanced Settings section: fold several HA entities that are really one
// physical device (e.g. a combo sensor exposing separate temperature and
// humidity entities) into a single map badge — see config/deviceGroups.ts
// and components/panels/DeviceGroupPanel for the combined detail view.

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import AskDialog from "@/components/common/AskDialog";
import { Layers, Plus, Sparkles } from "lucide-react";
import EntityCard from "./EntityCard";
import CardField from "./CardField";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";
import EntityPicker from "./EntityPicker";
import SearchOrAdd, { SearchEmpty, useSearchHit } from "@/components/common/SearchOrAdd";
import type { AddOffer } from "@/config/searchOrAdd";
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
import EmptyLine from "@/components/common/EmptyLine";

/** The list Grouped devices shows: its groups, or the groups it suggests. */
type GroupView = "groups" | "suggested";

export default function GroupedDevices({ title, tip }: { title: string; tip?: ReactNode }) {
  const { config, update } = useConfig();
  const { entityDeviceIds } = useHA();
  const entityLabel = useEntityLabel();
  /** A refusal to show in the app's own dialog — see AskDialog for why this is
   *  not `alert()`. */
  const [notice, setNotice] = useState<string | null>(null);
  // ⚠️ ITS TWO LISTS ARE ITS TITLE'S COUNTS (owner, 2026-11-06: "Show fewer" and the suggestions' own "15 suggested
  // groups" toggle sat side by side on one line): "N groups · N suggested", one shown at a time, the groups first
  const [picked, setPicked] = useState<GroupView>("groups");
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
  // the search narrows the list shown: a suggestion by either of its two devices
  const suggested = useMemo(() => suggestions.filter((s) =>
    groupMatches({ primaryEntityId: s.primaryEntityId, memberEntityIds: [s.memberEntityId] }, search, searchSource)),
  [suggestions, search, searchSource]);
  const shownSuggestions = useTruncated(suggested);
  // no suggestion left (the last one created): the groups
  const view: GroupView = suggestions.length ? picked : "groups";
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
  // ⚠️ ONE FIELD (owner, 2026-11-06): it narrows the groups, and its suggestions are the devices — one in a group shows
  // that group, one in none creates a group with it as the primary (the old "New group" picker and its Create button)
  const { hit, marked, listRef } = useSearchHit();
  const groupOf = (id: string) => config.deviceGroups.find((g) => g.primaryEntityId === id || g.memberEntityIds.includes(id));
  const offer: AddOffer = {
    placeOf: (id) => { const g = groupOf(id); return g ? `In group ${entityLabel(g.primaryEntityId)}` : null; },
    addWords: "Create a group", exactWords: (d) => `Create a group with ${d}`,
  };
  const createGroup = (primaryEntityId: string) => {
    const id = newGroupId();
    if (edit({ kind: "create", primaryEntityId, id })) { setSearch(""); hit(id); }
  };
  const showGroup = (entityId: string) => { setSearch(entityId); hit(groupOf(entityId)?.id ?? null); };
  const typed = (q: string) => { setSearch(q); hit(null); };
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
          notice
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}
      {/* what this section does is its title's (i) (ConfigEditorModal, owner 2026-10-22: no visible description) */}

      <Fold title={title} tip={tip} summary={countOf(config.deviceGroups.length, "group")} views={suggestions.length ? {
        items: [
          { key: "groups", words: countOf(config.deviceGroups.length, "group") },
          { key: "suggested", words: `${suggestions.length} suggested` },
        ],
        shown: view, onShow: (k) => setPicked(k as GroupView),
      } : undefined}>

      <SearchOrAdd query={search} onQuery={typed} placeholder="Search groups, or a device to group…"
        offer={offer} onAdd={createGroup} onFound={showGroup} />

      {view === "groups" && config.deviceGroups.length === 0 && !search.trim() && <EmptyLine>No grouped devices yet.</EmptyLine>}

      {(view === "groups" ? matches : suggested).length === 0 && search.trim() !== "" && (
        <SearchEmpty query={search} noun={view === "groups" ? "group" : "suggested group"} offer={offer} onAdd={createGroup} />
      )}

      {/* ⚠️ EACH GROUP AN ENTITYCARD (owner, 2026-11-06): its primary's name in the strip, the group's icon before it;
          its primary's id alone on its first line (its room and "primary (keeps the map badge)" said nothing the card and
          the section's (i) did not: owner, 2026-11-06); its members and "Add another
          entity…" its one field, "Members" (owner, 2026-11-06: every card's fields as a device's); its bin at its strip's
          right (owner, 2026-11-06), so it has no bar */}
      {view === "groups" && shown.visible.length > 0 && (
        <div className="fm-list settings-cards" ref={listRef}>
          {shown.visible.map((group) => (
            <EntityCard key={group.id} entityId={group.primaryEntityId} lead={<Layers size={16} aria-hidden />}
              tone={marked(group.id)}
              body={
                // the member pills and the "add another" picker share one line, the picker compact at the pills' height
                <CardField label="Members"><div className="group-members">
                  {group.memberEntityIds.map((id) => (
                    <RemovablePill key={id} label={entityLabel(id)} tip={id} removeLabel="Remove from group"
                      onRemove={() => removeMember(group, id)} />
                  ))}
                  <div className="group-members-add">
                    <EntityPicker
                      onChange={(id) => addMember(group, id)}
                      placeholder="Add another entity…"
                      compact
                    />
                  </div>
                </div></CardField>
              }
              remove={{ label: `Delete the group ${entityLabel(group.primaryEntityId)}`, run: () => deleteGroup(group.id) }} />
          ))}
        </div>
      )}
      {view === "groups" && <ShowAll list={shown} noun="group" />}

      {/* a suggested group: the same card, its main action first in its bar */}
      {view === "suggested" && shownSuggestions.visible.length > 0 && (
        <div className="fm-list settings-cards">
          {shownSuggestions.visible.map((s) => (
            <EntityCard key={`${s.primaryEntityId}|${s.memberEntityId}`} entityId={s.primaryEntityId} also={[s.memberEntityId]}
              lead={<Sparkles size={16} aria-hidden />}
              actions={
                <button type="button" className="btn fm-bar-main" onClick={() => acceptSuggestion(s.primaryEntityId, s.memberEntityId)}>
                  <Plus size={16} aria-hidden />Create this group
                </button>
              } />
          ))}
        </div>
      )}
      {view === "suggested" && <ShowAll list={shownSuggestions} noun="suggested group" />}
      </Fold>
    </div>
  );
}
