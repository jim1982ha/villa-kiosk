// src/components/settings/UnavailableByDesign.tsx
// Advanced Settings › Devices › "Asleep between reports": the villa's devices whose "unavailable" is their design
// (AppConfig.unavailableByDesign, shared). Picked, never typed: the list's one field (SearchOrAdd, as Grouped devices')
// narrows the cards and offers the devices, "On the list" (shown) or "Add to the list".
// What picking one does is the entity store's (ha/unavailableByDesign); this only edits the list.

import { useMemo, useState, type ReactNode } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import SearchOrAdd, { SearchEmpty, useSearchHit } from "@/components/common/SearchOrAdd";
import type { AddOffer } from "@/config/searchOrAdd";
import { deviceMatches } from "@/config/deviceRecord";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import RecordCard from "@/components/fm/RecordCard";
import IdText from "@/components/common/IdText";
import { useCardRoom } from "@/config/VillaModel";
import { Moon, X } from "lucide-react";
import Fold from "./Fold";
import { countOf } from "@/utils/countOf";
import { withItem } from "@/utils/listToggle";


export default function UnavailableByDesign({ title, tip }: { title: string; tip?: ReactNode }) {
  const { config, update } = useConfig();
  const ids = config.unavailableByDesign;
  // as every screen names a device (owner, 2026-10-28: one owner of a device's name; it printed the platform's)
  const name = useEntityLabel();
  const set = (id: string, on: boolean) => update({ unavailableByDesign: withItem(ids, id, on) });
  const roomOf = useCardRoom();
  const [search, setSearch] = useState("");
  const src = useDeviceSearch();
  const shown = useMemo(() => ids.filter((id) => deviceMatches(id, search, src)), [ids, search, src]);
  const { hit, marked, listRef } = useSearchHit();
  const offer: AddOffer = {
    placeOf: (id) => (ids.includes(id) ? "On the list" : null),
    addWords: "Add to the list", exactWords: (d) => `Add ${d} to the list`,
  };
  const add = (id: string) => { set(id, true); setSearch(""); hit(id); };
  const showOne = (id: string) => { setSearch(id); hit(id); };
  // folded under its title like Grouped devices (owner, 2026-10-22: the same chevron and closed line); its field first,
  // each device the Cockpit's card (owner, 2026-11-06): its name, its room and id, "Take off the list" its bar
  return (
    <Fold title={title} tip={tip} summary={countOf(ids.length, "device")}>
      <SearchOrAdd query={search} onQuery={(q) => { setSearch(q); hit(null); }} placeholder="Search, or a device to add…"
        offer={offer} onAdd={add} onFound={showOne} />
      {shown.length === 0 && search.trim() !== "" && (
        <SearchEmpty query={search} noun="device on the list" offer={offer} onAdd={add} />
      )}
      {shown.length > 0 && (
        <div className="fm-list settings-cards" ref={listRef}>
          {shown.map((id) => (
            <RecordCard key={id} title={name(id)} lead={<Moon size={16} aria-hidden />} room={roomOf({ entityId: id })}
              tone={marked(id)}
              pills={<span><IdText id={id} /></span>}
              actions={
                <button type="button" className="btn ghost" aria-label={`Take ${name(id)} off this list`} onClick={() => set(id, false)}>
                  <X size={16} aria-hidden /><span className="work-long">Take off the list</span><span className="work-short">Remove</span>
                </button>
              } />
          ))}
        </div>
      )}
    </Fold>
  );
}
