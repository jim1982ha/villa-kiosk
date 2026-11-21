// src/components/settings/ModelUploader.tsx
// The upload the no-model and too-heavy screens offer: a model sent to the add-on
// exactly as Settings sends it (useGlbUpload → utils/modelUpload), so it
// reaches every device with its room data.
//
// ⚠️ IT STORED THE MODEL IN THIS BROWSER ONLY (to 2.496.253) — IndexedDB, no
// room data, no add-on — so on a fresh install the owner's first upload never
// reached the wall tablet, and Settings' own upload was a different path with
// different rules. Owner-only, like Settings' (the screen shows it to a
// profile with "manageModel").

import { useGlbUpload, UploadModelButton, UploadProblem } from "./useGlbUpload";

export default function ModelUploader() {
  const up = useGlbUpload(true);
  return (
    <div>
      <UploadModelButton upload={up} style={{ width: "100%" }} />
      <UploadProblem upload={up} className="mt" />
    </div>
  );
}
