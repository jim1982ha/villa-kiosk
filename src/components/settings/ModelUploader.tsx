// src/components/settings/ModelUploader.tsx
// The no-model screen's upload: the villa's first model, sent to the add-on
// exactly as Settings sends it (useGlbUpload → utils/modelUpload), so it
// reaches every device with its room data.
//
// ⚠️ IT STORED THE MODEL IN THIS BROWSER ONLY (to 2.496.253) — IndexedDB, no
// room data, no add-on — so on a fresh install the owner's first upload never
// reached the wall tablet, and Settings' own upload was a different path with
// different rules. Owner-only, like Settings' (the screen shows it to a
// profile with "manageModel").

import { Upload } from "lucide-react";
import { useGlbUpload, ModelFileInput } from "./useGlbUpload";

export default function ModelUploader({ onUploaded }: { onUploaded: () => void }) {
  const up = useGlbUpload(true, onUploaded);
  return (
    <div>
      <ModelFileInput upload={up} />
      <button className="btn primary" style={{ width: "100%" }} disabled={up.uploadBusy !== null} onClick={up.openPicker}>
        <Upload size={18} />{" "}
        {up.uploadBusy === null
          ? "Upload .glb model"
          : up.uploadRetry ? `Retrying (${up.uploadRetry.attempt} of ${up.uploadRetry.of})…`
          : `Uploading… ${up.uploadPct ?? 0}%`}
      </button>
      {up.uploadMsg && <div className={`test-result ${up.uploadMsg.ok ? "ok" : "fail"}`}>{up.uploadMsg.text}</div>}
    </div>
  );
}
