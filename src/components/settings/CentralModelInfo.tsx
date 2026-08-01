// src/components/settings/CentralModelInfo.tsx
// The (i) hover/focus tooltip carrying the full central-model details (path,
// size, mesh count, SHA-256, source, latest plan) — lives in the Advanced
// Settings modal's header, next to the GLB upload button (see
// ConfigEditorModal), Owner profile only.

import { Info } from "lucide-react";
import type { getLoadedModelInfo } from "@/utils/modelInfo";
import type { AddonConfig } from "@/utils/storage";

export default function CentralModelInfo({
  addonCfg, loadedModel, editable,
}: {
  addonCfg: AddonConfig;
  loadedModel: ReturnType<typeof getLoadedModelInfo>;
  editable: boolean;
}) {
  return (
    <span className="info-tip">
      <button type="button" className="info-btn" aria-label="Model details">
        <Info size={16} />
      </button>
      <div className="info-pop" role="tooltip">
          <div className="row">
            <span>Latest SH3D plan</span>
            <span>
              {addonCfg.rooms_upload?.original_name ? (
                <>
                  <code>{addonCfg.rooms_upload.original_name}</code>
                  {addonCfg.rooms_upload.uploaded_at &&
                    ` · ${new Date(addonCfg.rooms_upload.uploaded_at).toLocaleString()}`}
                </>
              ) : "—"}
            </span>
          </div>
          {/* Show the ORIGINAL uploaded filename (the one the user recognises),
              not the managed on-disk name — every upload overwrites the same
              managed file, so showing that would always read as "villa.glb" and
              look like the wrong file. Full name, allowed to wrap so a long name
              is never truncated. It's stored/served as villa.glb (see the
              "From" URL below + the footer). */}
          <div className="row">
            <span>GLB</span>
            <span style={{ wordBreak: "break-word", textAlign: "right" }}>
              <code>{addonCfg.model_upload?.original_name || addonCfg.model_path}</code>
              {addonCfg.model_upload?.uploaded_at &&
                ` · ${new Date(addonCfg.model_upload.uploaded_at).toLocaleString()}`}
            </span>
          </div>
          {loadedModel && (
            <>
              <div className="row"><span>Loaded</span><span>{(loadedModel.bytes / 1_000_000).toFixed(2)} MB · {loadedModel.meshCount} meshes</span></div>
              {/* Fetch = getting the bytes (network or cache); Parse = Babylon
                  building the scene from them. A fast fetch with a still-slow
                  overall load points at the parse, not the network/caching. */}
              <div className="row"><span>Load time</span><span>fetch {loadedModel.fetchMs}ms · parse {loadedModel.parseMs}ms</span></div>
              {/* Parse split further: import = Babylon's own SceneLoader call
                  (glTF parse, Draco decode, texture decode + GPU upload) vs.
                  post = this app's own mesh-indexing/structure setup after
                  that. Almost all of parse is normally import. */}
              <div className="row"><span>&nbsp;&nbsp;↳ parse split</span><span>import {loadedModel.importMs}ms · post {loadedModel.postMs}ms</span></div>
              {loadedModel.sha256 && (
                <div className="row"><span>SHA-256</span><span><code>{loadedModel.sha256}</code></span></div>
              )}
              <div className="row"><span>From</span><span><code>{loadedModel.url}</code></span></div>
            </>
          )}
          <div style={{ marginTop: 8, color: "var(--text-dim)" }}>
            {editable ? (
              <>
                Stored in the add-on's own <code>/data</code> volume (on disk as <code>villa.glb</code>)
                and served to every client from there — an upload overwrites it, so re-uploading a new
                file replaces the villa for everyone (the name above is the file it came from). The
                room-data sidecar (<code>.rooms.json</code>, emitted next to the GLB by the Blender
                pipeline) lives alongside it. Upload both via the GLB button in the top bar; there's no
                path to configure.
              </>
            ) : (
              <>
                Loaded from the add-on's central store — every client (sidebar or direct hostname)
                loads the same model. To replace it, upload a new GLB/room-data file from the top bar's
                upload button on the Owner profile; other devices pick it up automatically on next open.
              </>
            )}
          </div>
      </div>
    </span>
  );
}
