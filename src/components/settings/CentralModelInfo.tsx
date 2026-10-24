// src/components/settings/CentralModelInfo.tsx
// The (i) hover/focus tooltip carrying the full central-model details (path,
// size, mesh count, SHA-256, source, latest plan) — in Advanced Settings'
// footer, beside "Upload model" (ConfigEditorModal, owner 2026-10-24), for the
// profile that may upload a model only.

import InfoTip from "@/components/common/InfoTip";
import type { getLoadedModelInfo } from "@/utils/modelInfo";
import type { AddonConfig } from "@/utils/centralModel";
import { stampText } from "@/utils/dateText";

export default function CentralModelInfo({
  addonCfg, loadedModel,
}: {
  addonCfg: AddonConfig;
  loadedModel: ReturnType<typeof getLoadedModelInfo>;
}) {
  return (
    <InfoTip label="Model details">
          <div className="row">
            <span>Latest SH3D plan</span>
            <span>
              {addonCfg.rooms_upload?.original_name ? (
                <>
                  <code>{addonCfg.rooms_upload.original_name}</code>
                  {addonCfg.rooms_upload.uploaded_at &&
                    ` · ${stampText(addonCfg.rooms_upload.uploaded_at)}`}
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
                ` · ${stampText(addonCfg.model_upload.uploaded_at)}`}
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
          {/* ⚠️ NO PLACE THAT IS NOT THERE (review L, owner 2026-10-25): it said "the GLB button in the top bar", gone
              since the upload moved to this footer (2.496.516); a second text for a profile that cannot upload was
              never drawn (this tip is only beside "Upload model") */}
          <div style={{ marginTop: 8, color: "var(--text-dim)" }}>
            Stored in the add-on's own <code>/data</code> volume (on disk as <code>villa.glb</code>)
            and served to every client from there, an upload overwrites it, so re-uploading a new
            file replaces the villa for everyone (the name above is the file it came from). The
            room-data sidecar (<code>.rooms.json</code>, emitted next to the GLB by the Blender
            pipeline) lives alongside it. Upload both with Upload model, here beside this (i); there's no
            path to configure.
          </div>
    </InfoTip>
  );
}
