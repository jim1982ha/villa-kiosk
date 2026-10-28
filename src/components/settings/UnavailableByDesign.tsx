// src/components/settings/UnavailableByDesign.tsx
// Advanced Settings › Devices › "Asleep between reports": the villa's devices whose "unavailable" is their design
// (AppConfig.unavailableByDesign, shared). Picked, never typed: the same pills and picker as a device group's members.
// What picking one does is the entity store's (ha/unavailableByDesign); this only edits the list.

import type { ReactNode } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import EntityPicker from "./EntityPicker";
import RemovablePill from "@/components/common/RemovablePill";
import Fold from "./Fold";
import { countOf } from "@/utils/countOf";
import { withItem } from "@/utils/listToggle";


export default function UnavailableByDesign({ heading }: { heading?: ReactNode } = {}) {
  const { config, update } = useConfig();
  const ids = config.unavailableByDesign;
  // as every screen names a device (owner, 2026-10-28: one owner of a device's name; it printed the platform's)
  const name = useEntityLabel();
  const set = (id: string, on: boolean) => update({ unavailableByDesign: withItem(ids, id, on) });
  // folded under its title like Grouped devices (owner, 2026-10-22: the same chevron and closed line)
  return (
    <Fold heading={heading} summary={countOf(ids.length, "device")}>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {ids.map((id) => (
          <RemovablePill key={id} label={name(id)} tip={id} removeLabel={`Take ${name(id)} off this list`}
            onRemove={() => set(id, false)} />
        ))}
        <div style={{ flex: "1 1 180px", minWidth: 140 }}>
          <EntityPicker onChange={(id) => set(id, true)} placeholder="Add a device…" hideCurrentLabel compact />
        </div>
      </div>
    </Fold>
  );
}
