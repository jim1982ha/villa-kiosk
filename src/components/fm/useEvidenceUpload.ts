// src/components/fm/useEvidenceUpload.ts
// Photos picked for a record, uploaded one by one: what is busy, what went wrong, and the ids that went through.
//
// ⚠️ TWO COPIES, TWO BEHAVIOURS (UI scan, 2026-11-10): the operator's strip (EvidenceRow) kept the photos that went
// through when a later one failed; the guest's report (GuestReportModal) dropped every one of them, uploaded and all,
// and said "attach" where the strip said "add".

import { useState } from "react";
import { uploadEvidence } from "@/fm/fmApi";

export function useEvidenceUpload(onAdded: (ids: string[]) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: string[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await uploadEvidence(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that photo.");
      }
    }
    if (added.length) onAdded(added);
    setBusy(false);
  };

  return { busy, error, add };
}
