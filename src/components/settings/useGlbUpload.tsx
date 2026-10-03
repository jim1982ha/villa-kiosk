// src/components/settings/useGlbUpload.tsx
// Central GLB/room-data upload — pushes straight into the add-on's /data
// store via the supervisor-proxy (no SSH/Samba, no path to configure).
// Used by ConfigEditorModal's header and by the no-model screen (Owner only).
//
// The operation itself — what is checked, in what order it is written, what
// the person is told — is utils/modelUpload's. This hook holds its progress
// state and adopts the uploaded room data into this device's config.

import { useEffect, useRef, useState } from "react";
import { useConfig } from "@/config/ConfigContext";
import { roomDataPatch } from "@/config/roomData";
import { fetchAddonConfig, uploadCentralModel, clearAddonConfigCache, type AddonConfig } from "@/utils/centralModel";
import { getLoadedModelInfo } from "@/utils/modelInfo";
import { planModelUpload, runModelUpload, uploadReport, type UploadKind } from "@/utils/modelUpload";

export function useGlbUpload(enabled: boolean, onModelChanged: () => void) {
  const { config, update } = useConfig();

  const [addonCfg, setAddonCfg] = useState<AddonConfig | null>(null);
  useEffect(() => { if (enabled) fetchAddonConfig().then(setAddonCfg); }, [enabled]);

  const glbUploadRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState<null | UploadKind>(null);
  const [uploadMsg, setUploadMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /** 0-100 while a chunked upload is in flight, null otherwise. */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // A stalled chunk is retried (centralModel.ts's postUploadRequest), which from the
  // outside looks exactly like a frozen percentage for up to 45s — the reported
  // symptom was "the upload badge never progresses and nothing happens". Say so
  // instead: the count pill switches to the attempt number and the message line
  // explains the pause, both cleared the moment a chunk lands.
  const [uploadRetry, setUploadRetry] = useState<{ attempt: number; of: number } | null>(null);

  /** The ONE upload entry point: a lone .glb, a .glb + its .rooms.json picked
   *  together, or a lone .rooms.json. See utils/modelUpload. */
  const uploadGlbAndRooms = async (files: File[]) => {
    setUploadMsg(null);
    const plan = await planModelUpload(files);
    if (!plan.ok) {
      setUploadMsg({ text: plan.message, ok: false });
      return;
    }
    setUploadRetry(null);
    const outcome = await runModelUpload(plan.steps, async (step) => {
      setUploadBusy(step.kind);
      setUploadPct(0);
      try {
        return await uploadCentralModel(
          step.file, step.kind, step.file.name,
          (sent, total) => {
            setUploadRetry(null); // a chunk landed — whatever stalled is over
            setUploadPct(Math.round((sent / total) * 100));
          },
          (attempt, of) => {
            setUploadRetry({ attempt, of });
            setUploadMsg({ text: `Upload stalled — retrying (${attempt} of ${of})…`, ok: true });
          },
        );
      } finally {
        setUploadRetry(null);
      }
    });
    setUploadBusy(null);
    setUploadPct(null);
    // The room data was written for every device: adopt it here at once, as
    // the owner's deliberate replacement of the plan (roomDataPatch "upload").
    if (outcome.written.some((w) => w.kind === "rooms")) {
      const patch = roomDataPatch(config, plan.rooms, "upload");
      if (patch) update(patch);
    }
    const report = uploadReport(outcome);
    setUploadMsg({ text: report.text, ok: report.ok });
    if (outcome.written.length > 0) {
      clearAddonConfigCache();
      setAddonCfg(await fetchAddonConfig());
    }
    if (report.reload) setTimeout(() => onModelChanged(), 600);
  };

  return {
    addonCfg,
    loadedModel: getLoadedModelInfo(),
    uploadBusy,
    uploadPct,
    uploadRetry,
    uploadMsg,
    glbUploadRef,
    uploadGlbAndRooms,
    openPicker: () => glbUploadRef.current?.click(),
  };
}

/** The hidden file input every upload entry point opens (openPicker): a lone
 *  .glb, a .glb with its .rooms.json, or a lone .rooms.json. One element for
 *  Settings and the no-model screen (written out in both until 2.496.263). */
export function ModelFileInput({ upload }: { upload: ReturnType<typeof useGlbUpload> }) {
  return (
    <input
      ref={upload.glbUploadRef} type="file" multiple hidden
      accept=".glb,.json,application/json,model/gltf-binary"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) void upload.uploadGlbAndRooms(files);
      }}
    />
  );
}
