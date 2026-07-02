// src/utils/sh3dParser.ts
// Parse a SweetHome 3D ".sh3d" file (a ZIP containing Home.xml) entirely in the
// browser to extract room names + polygons and entity-named furniture positions.
//
// This is what makes room identification automatic for ANY future villa: upload
// the .sh3d alongside the GLB and the app learns the room names + the plan
// positions it needs to fit the plan->model transform — no code changes, no
// per-file work.

import JSZip from "jszip";

export interface ParsedRoom {
  name: string;
  points: { x: number; y: number }[];
}
export interface ParsedEntity {
  entityId: string;
  x: number;
  y: number;
  /** SweetHome 3D's plan-rotation for this object, in degrees (0 = default
   *  unrotated orientation; SweetHome omits the attribute at 0). Lets a
   *  camera's simulated "detection beam" point the same way the camera prop
   *  was rotated to face in the plan — rotate the camera in SweetHome 3D to
   *  aim it, no other config needed. */
  angle: number;
}
export interface ParsedSh3d {
  rooms: ParsedRoom[];
  entities: ParsedEntity[];
}

const ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;

export async function parseSh3d(data: ArrayBuffer | File): Promise<ParsedSh3d> {
  const zip = await JSZip.loadAsync(data);
  const homeFile = zip.file("Home.xml");
  if (!homeFile) throw new Error("Not a valid .sh3d (no Home.xml inside).");

  const xmlText = await homeFile.async("string");
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse Home.xml.");

  // Rooms: named polygons.
  const rooms: ParsedRoom[] = [];
  doc.querySelectorAll("room").forEach((roomEl) => {
    const name = roomEl.getAttribute("name");
    if (!name) return;
    const points: { x: number; y: number }[] = [];
    roomEl.querySelectorAll("point").forEach((p) => {
      points.push({ x: Number(p.getAttribute("x")), y: Number(p.getAttribute("y")) });
    });
    if (points.length >= 3) rooms.push({ name, points });
  });

  // Entity calibration: furniture whose name is an HA entity_id, at known x/y.
  const entities: ParsedEntity[] = [];
  doc.querySelectorAll("pieceOfFurniture, doorOrWindow").forEach((f) => {
    const name = f.getAttribute("name");
    const x = f.getAttribute("x");
    const y = f.getAttribute("y");
    if (!name || x === null || y === null) return;
    if (!ENTITY_ID_RE.test(name)) return;
    const angle = f.getAttribute("angle"); // omitted by SweetHome when 0
    entities.push({ entityId: name, x: Number(x), y: Number(y), angle: angle === null ? 0 : Number(angle) });
  });

  return { rooms, entities };
}

/**
 * Re-zip a .sh3d down to just its Home.xml — the only entry this app ever
 * reads (see parseSh3d above). A SweetHome project also bundles the full 3D
 * preview model (OBJ/MTL/textures) for every catalog piece of furniture used
 * in the plan, which is what actually makes these files tens of MB; none of
 * that is ever touched here.
 *
 * This exists because Home Assistant's Ingress proxy hard-caps a proxied
 * request body at 16 MB (a Supervisor-level limit — see
 * github.com/home-assistant/supervisor/issues/2950 — that this add-on has no
 * way to raise), so uploading a full multi-tens-of-MB .sh3d through the
 * kiosk's "Upload central SH3D" button fails with a 413 no matter how large
 * nginx/aiohttp's own limits are set. Home.xml alone is realistically well
 * under a megabyte even for a large villa, so minifying before upload avoids
 * the ceiling entirely with zero functional loss.
 */
export async function minifySh3d(data: ArrayBuffer | File): Promise<Blob> {
  const zip = await JSZip.loadAsync(data);
  const homeXml = zip.file("Home.xml");
  if (!homeXml) throw new Error("Not a valid .sh3d (no Home.xml inside).");
  const xmlText = await homeXml.async("string");
  const mini = new JSZip();
  mini.file("Home.xml", xmlText);
  return mini.generateAsync({ type: "blob", compression: "DEFLATE" });
}
