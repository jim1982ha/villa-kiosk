// src/components/settings/BindingRow.tsx
// The cards of BindingsTable's three lists (Advanced Settings › Villa › Bound 3D objects): a bound 3D object, an object
// bound to nothing, and an entity no object shows. Each holds the LINK only: the device's name and display settings are
// edited in ONE place, its card in Devices (config/deviceRecord; architecture review 2026-10-12) — the bound row used to
// carry the same fields (MappingFields), a second editor for the same record. React.memo'd, as EntityMapRow.
//
// ⚠️ THE COCKPIT'S CARD (owner, 2026-11-06: "the same card in Settings and Advanced Settings"): Bind in its bar, Unbind
// an ✕ at its strip's right (owner, 2026-11-06: a remove is an icon in the band, never a word in the bar). They were rows of fixed columns with a small icon at the end. A bound object's card and an
// entity no object shows are EntityCards (its entity's name, its id alone on its first line: owner, 2026-11-06), then ONE
// field, "Bound to" / "3D object" and its search, as a device card's Linked entity (owner, 2026-11-06: "<object> is bound
// to <entity>" above a bare search did not look like the other cards; "Other · <id> · 3D object: <object>" was a long
// line saying nothing more); an object bound to nothing an EntityCard too (its object's name, its id under it), its field "Bind to".

import { Link2, Box, EyeOff } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { memo, useState } from "react";
import IdText from "@/components/common/IdText";
import SearchPicker from "@/components/common/SearchPicker";
import CardField from "./CardField";
import EntityCard from "./EntityCard";
import { useEntityLabel } from "@/hooks/useEntityLabel";

/** A bound 3D object: its entity's card, "Bound to" the picker changing it at once; its ✕ unbinds it. */
function BoundObjectCardInner({ mesh, entityId, onBind, onUnbind }: {
  mesh: string;
  entityId: string;
  onBind: (mesh: string, entityId: string) => void;
  onUnbind: (mesh: string) => void;
}) {
  const name = useEntityLabel()(entityId);
  return (
    <EntityCard entityId={entityId} lead={<Link2 size={16} aria-hidden />}
      body={
        <CardField label="Bound to">
          <EntityPicker value={entityId} onChange={(id) => onBind(mesh, id)} allowCustom hideCurrentLabel />
        </CardField>
      }
      remove={{ icon: "x", label: `Unbind ${mesh} from ${name}`, run: () => onUnbind(mesh) }} />
  );
}
export const BoundObjectCard = memo(BoundObjectCardInner);

/** A 3D object bound to nothing: an entity picked, then Bind, the card's main action. */
function UnboundObjectCardInner({ mesh, onBind }: { mesh: string; onBind: (mesh: string, entityId: string) => void }) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  return (
    // named as every card (owner, 2026-11-06: its strip showed the raw id): its friendly name, its id under it
    <EntityCard entityId={mesh} lead={<Box size={16} aria-hidden />}
      body={
        <CardField label="Bind to">
          <EntityPicker value={picked} onChange={setPicked} placeholder="An entity…" allowCustom hideCurrentLabel />
        </CardField>
      }
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
function UnshownEntityCardInner({ entityId, objects, onBind }: {
  entityId: string;
  /** The 3D objects bound to nothing, to pick from. */
  objects: readonly string[];
  onBind: (mesh: string, entityId: string) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const name = useEntityLabel()(entityId);
  return (
    <EntityCard entityId={entityId} lead={<EyeOff size={16} aria-hidden />}
      body={objects.length > 0 && (
        <CardField label="3D object">
          <SearchPicker placeholder={picked ?? "The 3D object that shows it…"} onPick={setPicked}
            rows={(q) => objects.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())).map((o) => ({ key: o, label: <IdText id={o} /> }))} />
        </CardField>
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
