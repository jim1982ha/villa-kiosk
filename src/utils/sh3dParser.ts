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
    entities.push({ entityId: name, x: Number(x), y: Number(y) });
  });

  return { rooms, entities };
}
