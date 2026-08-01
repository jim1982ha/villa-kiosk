// src/components/hud/useGlbUpload.ts
// Central GLB/room-data upload — pushes straight into the add-on's /data
// store via the supervisor-proxy (no SSH/Samba, no path to configure).
// Called once from HUD.tsx (Owner only) so the desktop button and the
// mobile overflow-menu item share one file input and one upload state
// instead of duplicating the async flow per render site.

import { useEffect, useRef, useState } from "react";
import { useConfig } from "@/config/ConfigContext";
import { parseRoomData } from "@/utils/sh3dParser";
import { extractEmbeddedRoomDataJson } from "@/utils/glbRoomDataExtractor";
import { fetchAddonConfig, uploadCentralModel, clearAddonConfigCache, type AddonConfig } from "@/utils/storage";
import { getLoadedModelInfo } from "@/utils/modelInfo";

export function useGlbUpload(enabled: boolean, onModelChanged: () => void) {
  const { update } = useConfig();

  const [addonCfg, setAddonCfg] = useState<AddonConfig | null>(null);
  useEffect(() => { if (enabled) fetchAddonConfig().then(setAddonCfg); }, [enabled]);

  const glbUploadRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState<null | "glb" | "rooms">(null);
  const [uploadMsg, setUploadMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /** 0-100 while a chunked upload is in flight, null otherwise. */
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // Adopt a room-data sidecar (<model>.rooms.json emitted by the Blender
  // pipeline) into this running client immediately after a central upload.
  const applyRoomData = (text: string) => {
    // parseRoomData deliberately REJECTS a document with zero rooms (throws
    // "No named rooms found…") — the right call for the manual upload
    // button, where an empty result usually means the wrong file got picked.
    // But uploadGlbAndRooms ALSO uploads a genuinely, deliberately empty
    // {rooms:[]} document on purpose (a GLB with no room data of its own,
    // see its docstring) — that's not a mistake to reject, it's the reset
    // itself, so recognise that specific shape before handing off to the
    // stricter validator.
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { raw = null; }
    const isDeliberateEmpty = !!raw && typeof raw === "object"
      && Array.isArray((raw as { rooms?: unknown }).rooms)
      && (raw as { rooms: unknown[] }).rooms.length === 0;
    const { rooms, entities } = isDeliberateEmpty ? { rooms: [], entities: [] } : parseRoomData(text);
    update({
      sh3dRooms: rooms,
      sh3dEntities: entities,
      // A new plan replaces the villa's rooms wholesale — drop every previously
      // defined room (old rooms AND any "Add room here" points) so the Rooms
      // menu shows ONLY what this file defines. The scene re-calibrates on reload.
      teleportPoints: [],
    });
  };

  const uploadCentral = async (file: File, kind: "glb" | "rooms", opts?: { reload?: boolean }) => {
    const okExt = kind === "glb" ? [".glb"] : [".json"];
    if (!okExt.some((e) => file.name.toLowerCase().endsWith(e))) {
      setUploadMsg({ text: `Please choose a ${okExt.join(" / ")} file.`, ok: false });
      return;
    }
    setUploadBusy(kind);
    setUploadMsg(null);
    setUploadPct(0);
    try {
      const { path, size } = await uploadCentralModel(
        file, kind, file.name,
        (sent, total) => setUploadPct(Math.round((sent / total) * 100)),
      );
      // For the room-data sidecar, ALSO adopt it into this running client's
      // config so its rooms/beams take effect immediately (not just for other
      // clients on their next open).
      if (kind === "rooms") applyRoomData(await file.text());
      clearAddonConfigCache();
      setAddonCfg(await fetchAddonConfig());
      const mb = size / 1_000_000;
      setUploadMsg({ text: `Uploaded ${mb < 1 ? `${(size / 1000).toFixed(0)} KB` : `${mb.toFixed(1)} MB`} → ${path}. Reloading…`, ok: true });
      // Skippable so a combined GLB+rooms upload (see uploadGlbAndRooms) only
      // reloads once, after the SECOND file lands — reloading after the
      // first would tear down the canvas mid-sequence.
      if (opts?.reload ?? true) setTimeout(() => onModelChanged(), 600);
    } catch (err) {
      setUploadPct(null);
      setUploadMsg({ text: (err as Error).message, ok: false });
    } finally {
      setUploadBusy(null);
    }
  };

  /** The ONE upload entry point: a lone .glb, a .glb + its .rooms.json picked
   *  together, or a lone .rooms.json on its own. GLB uploads first when both
   *  are present, sequentially (uploadBusy/uploadPct are single-flight
   *  state), reloading only once at the end.
   *
   *  A .glb with no rooms file picked alongside it is no longer necessarily
   *  missing its room data at all: a pipeline ≥2.14.0 embeds it directly in
   *  the GLB (glTF extras on a carrier node — see blender_pipeline.py's
   *  _embed_room_data). Read the raw GLB bytes for that embedded copy
   *  (glbRoomDataExtractor — no Babylon/WebGL needed, just the binary) and,
   *  if present and valid, upload it through the EXACT SAME "rooms" path a
   *  manually-picked .rooms.json would take.
   *
   *  If NEITHER an embedded copy nor a picked file is available, upload an
   *  EMPTY room-data document instead of just leaving whatever was there
   *  from a PREVIOUS GLB untouched — otherwise a genuinely new floor plan
   *  (an older pipeline export, or one where the embed failed) would keep
   *  silently "matching" against stale room polygons/positions from a model
   *  this one may no longer resemble at all, with nothing to say so. */
  const uploadGlbAndRooms = async (files: File[]) => {
    const glb = files.find((f) => f.name.toLowerCase().endsWith(".glb"));
    let rooms = files.find((f) => f.name.toLowerCase().endsWith(".json"));
    if (!glb && !rooms) {
      setUploadMsg({ text: "Please choose a .glb and/or a .rooms.json file.", ok: false });
      return;
    }
    if (glb && !rooms) {
      try {
        const embeddedJson = extractEmbeddedRoomDataJson(await glb.arrayBuffer());
        if (embeddedJson) {
          parseRoomData(embeddedJson); // throws if malformed — don't trust/upload garbage
          rooms = new File([embeddedJson], `${glb.name.replace(/\.glb$/i, "")}.rooms.json`, { type: "application/json" });
        }
      } catch {
        // No embedded data, or it didn't parse — fall through to the empty
        // reset below, same as a GLB that never had any.
      }
      if (!rooms) {
        rooms = new File(
          [JSON.stringify({ schema: 1, rooms: [], entities: [] })],
          `${glb.name.replace(/\.glb$/i, "")}.rooms.json`,
          { type: "application/json" },
        );
      }
    }
    if (glb) await uploadCentral(glb, "glb", { reload: !rooms });
    if (rooms) await uploadCentral(rooms, "rooms", { reload: true });
  };

  return {
    addonCfg,
    loadedModel: getLoadedModelInfo(),
    uploadBusy,
    uploadPct,
    uploadMsg,
    glbUploadRef,
    uploadGlbAndRooms,
    openPicker: () => glbUploadRef.current?.click(),
  };
}
