// src/components/common/IdText.tsx
// An entity id (or a 3D object's name) as text a line may break: after each "." and "_", never mid-word (owner,
// 2026-11-06: "fan.example_house_guest_roo / m" on a phone). The id reads, copies and is found as one word.
import { Fragment } from "react";
import { Box } from "lucide-react";

/** The id's parts, each ending at a "." or "_" (the break comes after it). Pure. */
export function idParts(id: string): string[] {
  return id.match(/[^._]*[._]|[^._]+$/g) ?? [id];
}

export default function IdText({ id }: { id: string }) {
  const parts = idParts(id);
  return <>{parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <wbr />}</Fragment>)}</>;
}

/** A thing's name with its id after it, as a card's strip names it: "Example Owner (notify.example_owner_chat)" (owner,
 *  2026-11-06: a chat of Who gets the messages, whose card has no id line). Pure: the words NamedId draws. */
export function namedIdText(name: string, id: string): string {
  return name === id ? id : `${name} (${id})`;
}

/** namedIdText drawn: the name first, the id after it in the strip's quiet style (.named-id), broken only by IdText's
 *  rule, so a phone wraps after the name or after a "." or "_" of the id, never inside a word of it. */
export function NamedId({ name, id }: { name: string; id: string }) {
  if (name === id) return <span className="named-id"><IdText id={id} /></span>;
  return <>{name} <span className="named-id">(<IdText id={id} />)</span></>;
}

/** A 3D object's name as every list of them shows it: a cube, then the name (IdText's breaks) — so it never reads as
 *  an entity of the villa's system (owner, 2026-11-12: a pill "camera.storage_room" on another camera's card read as
 *  a second device, not as the model's object showing this one). */
export function ObjectName({ name }: { name: string }) {
  return <span className="object-name"><Box size={13} aria-hidden="true" /><span><IdText id={name} /></span></span>;
}
