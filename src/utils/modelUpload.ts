// src/utils/modelUpload.ts
// Uploading the villa's model — a .glb, a .rooms.json, or both — as ONE
// operation: everything is checked first, then the files are written, and the
// outcome is worded once. The React hook (settings/useGlbUpload) only holds
// the progress state; the no-model screen and Settings both upload through it.
//
// ⚠️ IT WAS ORCHESTRATED INSIDE THE HOOK (to 2.496.253), and the order was
// wrong in two ways nothing could test:
//   * a picked .json was WRITTEN to the add-on, for every device, and only then
//     parsed — so a wrong file showed an error while already being live;
//   * the GLB and its room data are two writes, and when the second failed
//     the first stood with no word about it: every device then showed the new
//     model against the previous model's rooms.
//
// Pure apart from what is passed in. tests/oracles/model_upload.mjs.

import { EMPTY_ROOM_DATA, readRoomData } from "@/config/roomData";
import type { ParsedRoomData } from "./sh3dParser";
import { extractEmbeddedRoomDataJson } from "./glbRoomDataExtractor";

export type UploadKind = "glb" | "rooms";

export interface UploadStep {
  file: File;
  kind: UploadKind;
  /** Where the room data came from: picked beside the GLB (or alone), read
   *  out of the GLB, or the explicit reset for a GLB that carries none. */
  origin: "picked" | "embedded" | "reset" | "model";
}

export type UploadPlan =
  | { ok: true; steps: UploadStep[]; rooms: ParsedRoomData }
  | { ok: false; message: string };

const isGlb = (f: File) => f.name.toLowerCase().endsWith(".glb");
const isJson = (f: File) => f.name.toLowerCase().endsWith(".json");

/**
 * What uploading `files` will write, every file already checked — or why
 * nothing will be. A GLB always goes up with room data: the file picked
 * beside it, else the copy the pipeline embedded in it, else the explicit
 * reset (EMPTY_ROOM_DATA) so devices drop the previous model's rooms.
 */
export async function planModelUpload(files: readonly File[]): Promise<UploadPlan> {
  const glb = files.find(isGlb);
  const json = files.find(isJson);
  if (!glb && !json) return { ok: false, message: "Please choose a .glb and/or a .rooms.json file." };

  let roomsText: string;
  let origin: UploadStep["origin"];
  if (json) {
    roomsText = await json.text();
    try {
      readRoomData(roomsText);
    } catch (err) {
      return { ok: false, message: `${json.name}: ${(err as Error).message} Nothing was uploaded.` };
    }
    origin = "picked";
  } else {
    const embedded = extractEmbeddedRoomDataJson(await glb!.arrayBuffer());
    let usable = false;
    if (embedded) {
      try { readRoomData(embedded); usable = true; } catch { /* treated as none */ }
    }
    roomsText = usable ? embedded! : EMPTY_ROOM_DATA;
    origin = usable ? "embedded" : "reset";
  }

  const roomsName = json?.name ?? `${glb!.name.replace(/\.glb$/i, "")}.rooms.json`;
  const steps: UploadStep[] = [];
  if (glb) steps.push({ file: glb, kind: "glb", origin: "model" });
  steps.push({
    file: json ?? new File([roomsText], roomsName, { type: "application/json" }),
    kind: "rooms", origin,
  });
  return { ok: true, steps, rooms: readRoomData(roomsText) };
}

export interface Written { kind: UploadKind; path: string; size: number }

export interface UploadOutcome {
  written: Written[];
  /** The step that failed, if one did — every step after it was not tried. */
  failed?: { kind: UploadKind; message: string };
}

/** Write the plan's steps in order (the GLB first), stopping at the first
 *  failure. `put` is centralModel.uploadCentralModel, with its progress. */
export async function runModelUpload(
  steps: readonly UploadStep[],
  put: (step: UploadStep) => Promise<{ path: string; size: number }>,
): Promise<UploadOutcome> {
  const written: Written[] = [];
  for (const step of steps) {
    try {
      const { path, size } = await put(step);
      written.push({ kind: step.kind, path, size });
    } catch (err) {
      return { written, failed: { kind: step.kind, message: (err as Error).message } };
    }
  }
  return { written };
}

const amount = (size: number) => {
  const mb = size / 1_000_000;
  return mb < 1 ? `${(size / 1000).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
};

/**
 * What the person is told, and whether the villa reloads. It reloads when
 * anything was written — a model that changed on the add-on must not stay
 * hidden behind the old one on the device that changed it.
 *
 * ONE message for one action: uploading a GLB is two writes, and announcing
 * the second ("Uploaded 19 KB → villa.rooms.json" after choosing a 12 MB
 * model) read as the app having ignored the model.
 */
export function uploadReport(outcome: UploadOutcome): { text: string; ok: boolean; reload: boolean } {
  const glb = outcome.written.find((w) => w.kind === "glb");
  const rooms = outcome.written.find((w) => w.kind === "rooms");
  const reload = outcome.written.length > 0;
  if (outcome.failed) {
    if (glb && outcome.failed.kind === "rooms") {
      return {
        ok: false, reload,
        text: `The model was uploaded (${amount(glb.size)}), but its room data was not: ${outcome.failed.message} `
          + "Every device shows the new model with the previous rooms until you upload it again.",
      };
    }
    return { ok: false, reload, text: outcome.failed.message };
  }
  if (glb) return { ok: true, reload, text: `Uploaded ${amount(glb.size)} → ${glb.path} with its room data. Reloading…` };
  return { ok: true, reload, text: `Uploaded ${amount(rooms!.size)} → ${rooms!.path}. Reloading…` };
}
