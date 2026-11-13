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

/** What an upload in flight says, ONCE for every screen that shows one (architecture review K, 2026-10-24: Advanced
 *  Settings and the no-model screen each wrote their own): `words` beside the icon, `mark` the short form a phone keeps
 *  on the icon when the words are hidden ("42%", "↻2"); `done`, an upload that just landed, the model reloading. Both
 *  null while nothing uploads. */
export function uploadProgress(busy: boolean, pct: number | null, retry: { attempt: number; of: number } | null,
  done = false): { words: string | null; mark: string | null } {
  if (!busy) return done ? { words: "Uploaded, reloading…", mark: "✓" } : { words: null, mark: null };
  if (retry) return { words: `Retrying (${retry.attempt} of ${retry.of})…`, mark: `↻${retry.attempt}` };
  return { words: `Uploading… ${pct ?? 0}%`, mark: `${pct ?? 0}%` };
}

export function useGlbUpload(enabled: boolean, onModelChanged: () => void) {
  const { config, update } = useConfig();

  const [addonCfg, setAddonCfg] = useState<AddonConfig | null>(null);
  useEffect(() => { if (enabled) fetchAddonConfig().then(setAddonCfg); }, [enabled]);

  const glbUploadRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState<null | UploadKind>(null);
  // ⚠️ ONLY WHAT WENT WRONG IS A LINE (owner, 2026-11-13: "Uploaded 17.9 MB → villa.glb with its room data.
  // Reloading…" came as a green band over the Villa tab, pushing every setting down): progress, a retry and a landed
  // upload are said on the button itself (uploadProgress); a refusal or a failure, which the person must read, below
  const [uploadMsg, setUploadMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [uploaded, setUploaded] = useState(false);
  useEffect(() => {
    if (!uploaded) return;
    const t = setTimeout(() => setUploaded(false), 5000);
    return () => clearTimeout(t);
  }, [uploaded]);
  /** 0-100 while a chunked upload is in flight, null otherwise. */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // A stalled chunk is retried (centralModel.ts's postUploadRequest), which from the
  // outside looks exactly like a frozen percentage for up to 45s — the reported
  // symptom was "the upload badge never progresses and nothing happens". Say so
  // instead: the button says "Retrying (2 of 5)…" and its pill the attempt
  // number, both cleared the moment a chunk lands.
  const [uploadRetry, setUploadRetry] = useState<{ attempt: number; of: number } | null>(null);

  /** The ONE upload entry point: a lone .glb, a .glb + its .rooms.json picked
   *  together, or a lone .rooms.json. See utils/modelUpload. */
  const uploadGlbAndRooms = async (files: File[]) => {
    setUploadMsg(null);
    setUploaded(false);
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
    if (report.ok) setUploaded(true);
    else setUploadMsg({ text: report.text, ok: false });
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
    progress: uploadProgress(uploadBusy !== null, uploadPct, uploadRetry, uploaded),
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
