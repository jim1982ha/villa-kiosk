// src/components/fm/useWorkFields.ts
// What a piece of work records, asked by both forms that record one (the Today tab's completion, a fault's stage
// dialog): who did it (WorkerPicker), what happened, the photos and what it cost. One set of fields, so the two forms
// cannot record a piece of work two ways.

import { useState } from "react";

export function useWorkFields() {
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  return {
    who, setWho, note, setNote, photoIds, setPhotoIds, amount, setAmount,
    /** The work as a record keeps it: the name picked, the note without its edges, the photos. */
    work: () => ({ who: who || undefined, note: note.trim() || undefined, photoIds }),
  };
}
