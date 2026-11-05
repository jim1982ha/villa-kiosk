// src/components/common/IdText.tsx
// An entity id (or a 3D object's name) as text a line may break: after each "." and "_", never mid-word (owner,
// 2026-11-06: "fan.example_house_guest_roo / m" on a phone). The id reads, copies and is found as one word.
import { Fragment } from "react";

/** The id's parts, each ending at a "." or "_" (the break comes after it). Pure. */
export function idParts(id: string): string[] {
  return id.match(/[^._]*[._]|[^._]+$/g) ?? [id];
}

export default function IdText({ id }: { id: string }) {
  const parts = idParts(id);
  return <>{parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <wbr />}</Fragment>)}</>;
}
