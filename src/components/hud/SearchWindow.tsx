// src/components/hud/SearchWindow.tsx
// Search and quick control (owner-approved review P3-03, 2026-11-21): one box finds the rooms to fly to, the devices
// this profile may switch and the scenes it may run. What is listed is config/quickSearch's; every piece is the one
// the app already has: a device is the summary lists' own row (useDeviceRows: its switch, its unlock and "ask before
// switching" questions), a room's Go is the Rooms window's fly-to, a scene asks the scenes' own question.

import { useMemo, useState } from "react";
import { MapPin, Search, Sparkles } from "lucide-react";
import Window, { WindowHeader } from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";
import SearchPicker from "@/components/common/SearchPicker";
import EmptyLine from "@/components/common/EmptyLine";
import Button from "@/components/common/Button";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { mayControlDevice, roleCan } from "@/auth/permissions";
import { ROLE_LABELS } from "@/auth/roles";
import { useVillaModel } from "@/config/VillaModel";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import { useSceneConfirm } from "@/hooks/useSceneConfirm";
import { useDeviceRows } from "@/components/panels/useDeviceRows";
import { quickSearch } from "@/config/quickSearch";
import type { HaSceneInfo } from "@/config/haScenes";
import type { TeleportPoint } from "@/types/scene.types";

export default function SearchWindow({ scenes, onClose, onGoToRoom, onOpenEntity }: {
  scenes: HaSceneInfo[];
  onClose: () => void;
  /** Fly to a room (the Rooms window's own). */
  onGoToRoom: (point: TeleportPoint) => void;
  /** Open a device's own window. */
  onOpenEntity: (entityId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const { config } = useConfig();
  const { entities } = useHA();
  const { role } = useProfile();
  const { visibleEntities, visibleTo } = useVillaModel();
  const src = useDeviceSearch();
  const { renderRow } = useDeviceRows();
  const scene = useSceneConfirm();

  const listed = useMemo(() => {
    const covers = visibleTo(role);
    return Object.keys(visibleEntities).filter((id) => covers.has(id)).sort();
  }, [visibleEntities, visibleTo, role]);
  // a profile that switches nothing (the read-only Display) finds its devices to look at (quickSearch `look`)
  const look = !!role && !roleCan(role, "controlEntities");
  const found = quickSearch(query, {
    devices: listed,
    mayControl: (id) => mayControlDevice(role, id, config.entityMap[id], entities[id]),
    src, rooms: config.teleportPoints, scenes, look,
  });
  const nothing = query.trim() && !found.rooms.length && !found.devices.length && !found.scenes.length;

  return (
    <Window kind="content" label="Search" onClose={onClose} className="settings-modal search-window">
      <WindowHeader title="Search" icon={<Search size={22} />}
        under={role ? `What the ${ROLE_LABELS[role]} profile may ${look ? "see" : "control"}` : undefined} />
      <div className="modal-body">
        <SearchPicker text={{ value: query, onChange: setQuery }} rows={() => []} onPick={() => {}} startOpen
          placeholder="Search devices, rooms and scenes" clear={!!query && { label: "Clear the search", run: () => setQuery("") }} />
        {nothing && <EmptyLine>Nothing found for “{query.trim()}”.</EmptyLine>}
        {found.rooms.length > 0 && (
          <div className="summary-section">
            <div className="summary-section-heading"><span>Rooms</span></div>
            <div className="summary-entity-grid">
              {found.rooms.map((r) => (
                <div key={r.name} className="summary-entity-row search-room-row">
                  <span className="summary-entity-main">
                    <MapPin size={20} aria-hidden />
                    <span className="summary-entity-text"><span className="summary-entity-name">{r.name}</span></span>
                  </span>
                  <Button small onClick={() => { onClose(); onGoToRoom(r); }} label={`Go to ${r.name}`}>Go</Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {found.devices.length > 0 && (
          <div className="summary-section">
            <div className="summary-section-heading"><span>Devices</span></div>
            <div className="summary-entity-grid">
              {found.devices.map((id) => entities[id] && renderRow(entities[id], {
                canControl: !look, onOpen: (entityId) => { onClose(); onOpenEntity(entityId); } }))}
            </div>
          </div>
        )}
        {found.scenes.length > 0 && (
          <div className="summary-room-scenes">
            <div className="section-title">Scenes</div>
            <div className="summary-room-scenes-row">
              {found.scenes.map((s) => (
                <Button icon={<Sparkles size={16} />} key={s.entityId} onClick={() => scene.ask(s)}>{s.name}</Button>
              ))}
            </div>
          </div>
        )}
      </div>
      <ModalFooter onClose={onClose} />
      {scene.dialog}
    </Window>
  );
}
