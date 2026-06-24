// src/components/settings/ModelUploader.tsx
// Upload a .glb -> persist to IndexedDB. Shows current stored model meta.

import { useRef, useState } from "react";
import { Upload, Box } from "lucide-react";
import { ingestUploadedModel } from "@/babylon/ModelLoader";
import { getModelMeta, clearStoredModel } from "@/utils/storage";

interface Props {
  onUploaded: () => void;
  /**
   * Minimal mode: render only the upload button (no stored-model meta, no
   * "Replace"/"Remove" management controls). Used by the no-model overlay, where
   * the scene has nothing loaded and only a plain first upload makes sense.
   */
  minimal?: boolean;
}

export default function ModelUploader({ onUploaded, minimal = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState(() => getModelMeta());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".glb")) {
      setError("Please choose a .glb file (export from Blender as glTF Binary).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await ingestUploadedModel(file);
      setMeta(getModelMeta());
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {!minimal && meta && (
        <div className="row spread body-text" style={{ marginBottom: 12 }}>
          <span><Box size={16} /> {meta.name}</span>
          <span className="muted">{(meta.size / 1024 / 1024).toFixed(1)} MB</span>
        </div>
      )}

      <button className="btn primary" style={{ width: "100%" }} disabled={busy} onClick={() => inputRef.current?.click()}>
        <Upload size={18} /> {busy ? "Importing…" : minimal ? "Upload .glb model" : meta ? "Replace 3D model" : "Upload .glb model"}
      </button>

      {!minimal && meta && (
        <button
          className="btn ghost mt"
          style={{ width: "100%" }}
          onClick={async () => {
            await clearStoredModel();
            setMeta(null);
          }}
        >
          Remove stored model
        </button>
      )}

      {error && <div className="test-result fail">{error}</div>}
    </div>
  );
}
