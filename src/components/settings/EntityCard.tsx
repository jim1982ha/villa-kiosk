// src/components/settings/EntityCard.tsx
// ⚠️ ONE CARD FOR AN ENTITY IN SETTINGS AND ADVANCED SETTINGS (owner, 2026-11-06: its header "the user friendly name of
// the entity that it controls", never its device's; its first line "only showing the baseline entity name": "Other · <id>
// · primary (keeps the map badge)" and "… · 3D object: …" said what the card already did). A device's card in Devices, a
// group, a bound 3D object, an entity no object shows, a device asleep between reports: its entity's name in its strip
// (useEntityLabel, every screen's), its id alone on its first line, then its fields. No room, no explanation (the
// section's (i) has it). The Cockpit's RecordCard underneath.

import type { ReactNode } from "react";
import RecordCard, { type RecordCardProps } from "@/components/fm/RecordCard";
import IdText from "@/components/common/IdText";
import { useEntityLabel } from "@/hooks/useEntityLabel";

export default function EntityCard({ entityId, also, idLine = true, ...card }: Omit<RecordCardProps, "title" | "room" | "pills" | "device"> & {
  entityId: string;
  /** The entities joined to it ("<primary> + <member>": a suggested group). */
  also?: readonly string[];
  /** false: its id is on a line of its own making (a device's card in Devices, its box and its id). */
  idLine?: boolean;
}) {
  const nameOf = useEntityLabel();
  const line: ReactNode = idLine
    ? <span>{[entityId, ...(also ?? [])].map((id, i) => <span key={id}>{i > 0 && " + "}<IdText id={id} /></span>)}</span>
    : undefined;
  return <RecordCard {...card} title={nameOf(entityId)} pills={line} />;
}
