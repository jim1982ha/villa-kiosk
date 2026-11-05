// src/components/settings/BindingRow.tsx
// The cards of BindingsTable's three lists (Advanced Settings › Villa › Bound 3D objects): a bound 3D object, an object
// bound to nothing, and an entity no object shows. Each holds the LINK only: the device's name and display settings are
// edited in ONE place, its card in Devices (config/deviceRecord; architecture review 2026-10-12) — the bound row used to
// carry the same fields (MappingFields), a second editor for the same record. React.memo'd, as EntityMapRow.
//
// ⚠️ THE COCKPIT'S CARD (owner, 2026-11-06: "the same card in Settings and Advanced Settings"): its one action in its bar
// (Unbind, Bind). They were rows of fixed columns with a small icon at the end. A bound object's card is named after
// its ENTITY as an asleep device's is (its name in the strip, room · id on the quiet line), its words "<object> is bound
// to <entity>", then the search that changes it (owner, 2026-11-06); an object bound to nothing is named after the
// object, the search its words; an entity no object shows, after the entity, room · id on its quiet line.

import { Link2, Unlink, Box, EyeOff } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { memo, useState } from "react";
import IdText from "@/components/common/IdText";
import SearchPicker from "@/components/common/SearchPicker";
import RecordCard from "@/components/fm/RecordCard";

/** A bound 3D object: its entity's card, "<object> is bound to <entity>", the picker changing it at once; Unbind in its bar. */
function BoundObjectCardInner({ mesh, entityId, name, room, onBind, onUnbind }: {
  mesh: string;
  entityId: string;
  /** Its entity's name on every screen (useEntityLabel). */
  name: string;
  /** Its entity's room, every card's (useCardRoom). */
  room: string;
  onBind: (mesh: string, entityId: string) => void;
  onUnbind: (mesh: string) => void;
}) {
  return (
    <RecordCard title={name} lead={<Link2 size={16} aria-hidden />} room={room}
      pills={<span><IdText id={entityId} /></span>}
      body={<>
        <p className="binding-said"><IdText id={mesh} /> is bound to {name}</p>
        <EntityPicker value={entityId} onChange={(id) => onBind(mesh, id)} allowCustom hideCurrentLabel />
      </>}
      actions={
        <button type="button" className="btn ghost" aria-label={`Unbind ${mesh}`} onClick={() => onUnbind(mesh)}>
          <Unlink size={16} aria-hidden />Unbind
        </button>
      } />
  );
}
export const BoundObjectCard = memo(BoundObjectCardInner);

/** A 3D object bound to nothing: an entity picked, then Bind, the card's main action. */
function UnboundObjectCardInner({ mesh, onBind }: { mesh: string; onBind: (mesh: string, entityId: string) => void }) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  return (
    <RecordCard title={<IdText id={mesh} />} lead={<Box size={16} aria-hidden />}
      body={<EntityPicker value={picked} onChange={setPicked} placeholder="Bind to entity…" allowCustom hideCurrentLabel />}
      actions={
        <button type="button" className="btn ghost fm-bar-main" disabled={!picked} aria-label={`Bind ${mesh}`}
          onClick={() => { if (picked) { onBind(mesh, picked); setPicked(undefined); } }}>
          <Link2 size={16} aria-hidden />Bind
        </button>
      } />
  );
}
export const UnboundObjectCard = memo(UnboundObjectCardInner);

/** An entity no 3D object shows: one of the unbound objects picked, then Bind (the object then shows it). */
function UnshownEntityCardInner({ entityId, name, room, objects, onBind }: {
  entityId: string;
  /** Its name on every screen (useEntityLabel). */
  name: string;
  room: string;
  /** The 3D objects bound to nothing, to pick from. */
  objects: readonly string[];
  onBind: (mesh: string, entityId: string) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  return (
    <RecordCard title={name} lead={<EyeOff size={16} aria-hidden />} room={room}
      pills={<span><IdText id={entityId} /></span>}
      body={objects.length > 0 && (
        <SearchPicker placeholder={picked ?? "Pick the 3D object that shows it…"} onPick={setPicked}
          rows={(q) => objects.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())).map((o) => ({ key: o, label: <IdText id={o} /> }))} />
      )}
      actions={objects.length > 0 && (
        <button type="button" className="btn ghost fm-bar-main" disabled={!picked} aria-label={`Bind ${name} to a 3D object`}
          onClick={() => { if (picked) { onBind(picked, entityId); setPicked(undefined); } }}>
          <Link2 size={16} aria-hidden />Bind
        </button>
      )} />
  );
}
export const UnshownEntityCard = memo(UnshownEntityCardInner);
