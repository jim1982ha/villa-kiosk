// src/components/settings/UnavailableByDesign.tsx
// Advanced Settings › Devices › "Asleep between reports": the villa's devices whose "unavailable" is their design
// (AppConfig.unavailableByDesign, shared). Picked, never typed: the same pills and picker as a device group's members.
// What picking one does is the entity store's (ha/unavailableByDesign); this only edits the list.

import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import EntityPicker from "./EntityPicker";
import RemovablePill from "@/components/common/RemovablePill";

/** The list with `id` added (once) or removed — the one edit this section makes. */
export function withDevice(list: readonly string[], id: string, on: boolean): string[] {
  return on ? (list.includes(id) ? [...list] : [...list, id]) : list.filter((x) => x !== id);
}

export default function UnavailableByDesign() {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const ids = config.unavailableByDesign;
  const name = (id: string) => String(entities[id]?.attributes?.friendly_name ?? id);
  const set = (id: string, on: boolean) => update({ unavailableByDesign: withDevice(ids, id, on) });
  return (
    <>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {ids.map((id) => (
          <RemovablePill key={id} label={name(id)} tip={id} removeLabel={`Take ${name(id)} off this list`}
            onRemove={() => set(id, false)} />
        ))}
        <div style={{ flex: "1 1 180px", minWidth: 140 }}>
          <EntityPicker onChange={(id) => set(id, true)} placeholder="Add a device…" hideCurrentLabel compact />
        </div>
      </div>
      <p className="muted body-text field-hint">
        Devices that sleep between reports, such as a battery door sensor: their "unavailable" is normal. VESTA shows
        what each one last reported, never "Unavailable", and raises no fault for it; the VESTA Agent skips its
        offline checks for them too.
      </p>
    </>
  );
}
