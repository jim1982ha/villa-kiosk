// src/babylon/villaPictureCapture.ts
// THE VILLA PICTURES (owner, 2026-11-24), made here: on a capable device, a still picture of each floor by day and by
// night, taken straight down, for a device too weak for the 3D villa (villaPictures.ts has the format,
// utils/pictureManifest.ts the arithmetic, components/canvas/useVillaPictures.ts when it runs).
//
// What a picture must NOT hold, because it is kept for good and the picture view draws these live over it: the
// badges (the GUI layer is off), the clickable outlines, the room glows, the light pools, the camera beams and the
// sky (only the model's own meshes are drawn: SceneManager.picturesStage), the lamps (shown off for the shot:
// EntityVisuals.lampsOff) and the curtains (every cover shown open: EntityVisuals.coversOpen) and
// the ceiling fans (hidden: EntityVisuals.ceilingFansHidden). Day and night are forced
// (SunController.forceLook), the floor shown without becoming the active one (FloorManager.showForPicture). Everything is put back in a `finally`, then a frame is asked for.
//
// The canvas on screen does not change while it runs: the render loop draws nothing (picturesStage holds it) and the
// pictures render into an offscreen target (PictureTarget), so the person sees the frame drawn before it, never a
// floor or a look the capture set; the engine's preserveDrawingBuffer (off) plays no part.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SceneManager } from "./SceneManager";
import {
  PICTURE_FLOORS, buildManifest, houseFrame, pictureSize, viewFileFor, type Look, type PictureFrame, type PictureSource, type WorldAnchor,
} from "@/utils/pictureManifest";
import type { PicturesManifest, ViewFile } from "@/utils/villaPictures";

/** The person used the screen while the pictures were taken: nothing is kept, and the caller tries again later. */
export class CaptureAborted extends Error {
  constructor() { super("interrupted"); }
}

/** This browser cannot write a webp picture (Safari's canvas cannot): the set is left to another device. */
export class NoWebp extends Error {
  constructor() { super("this browser cannot write webp pictures"); }
}

export interface CapturedSet {
  /** The pictures, in VIEW_FILES order, then the manifest LAST (uploadView's order). */
  files: { name: ViewFile; blob: Blob }[];
  manifest: PicturesManifest;
  bytes: number;
}

const LOOKS: readonly Look[] = ["day", "night"];
/** A picture not ready to draw by then never will be (a lost context, a shader that does not compile). */
const READY_TIMEOUT_MS = 120_000;
const WEBP_QUALITY = 0.85;
/** Render target samples: smooth edges at the picture's own size. */
const SHOT_SAMPLES = 4;

/** A top-down orthographic camera over the frame: forward -y, the picture's up +z (north), its right +x, so a
 *  world point lands at toUv's (u, v) on every floor. Checked, not assumed: a camera turned another way would
 *  store mirrored pictures every reader trusts. */
function topDownCamera(manager: SceneManager, frame: PictureFrame, min: Vector3, max: Vector3): TargetCamera {
  const sx = frame.maxX - frame.minX, sz = frame.maxZ - frame.minZ;
  const cam = new TargetCamera("villaPictureCamera",
    new Vector3((frame.minX + frame.maxX) / 2, max.y + 10, (frame.minZ + frame.maxZ) / 2),
    manager.scene, false);
  cam.rotation.set(Math.PI / 2, 0, 0);
  cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
  cam.orthoLeft = -sx / 2;
  cam.orthoRight = sx / 2;
  cam.orthoBottom = -sz / 2;
  cam.orthoTop = sz / 2;
  cam.minZ = 0.1;
  cam.maxZ = max.y - min.y + 20;
  cam.getViewMatrix(true);
  const fwd = cam.getDirection(Vector3.Forward()), up = cam.getDirection(Vector3.Up()), right = cam.getDirection(Vector3.Right());
  if (fwd.y > -0.999 || up.z < 0.999 || right.x < 0.999) {
    cam.dispose();
    throw new Error(`the picture camera is not looking straight down north up (forward ${fwd}, up ${up}, right ${right})`);
  }
  return cam;
}

/** The offscreen target every picture of a set renders into, made once: the shaders its pass needs are compiled for
 *  the first picture and kept for the other three. */
class PictureTarget {
  private readonly rtt: RenderTargetTexture;
  constructor(private readonly scene: Scene, private readonly cam: TargetCamera, private readonly meshes: AbstractMesh[],
    size: { width: number; height: number }) {
    this.rtt = new RenderTargetTexture("villaPicture", size, scene, { generateMipMaps: false, samples: SHOT_SAMPLES });
    // only the model: everything else in the scene (sky, pools, glows, beams) is a live layer over the picture
    this.rtt.renderList = meshes;
    this.rtt.activeCamera = cam;
    this.rtt.clearColor = new Color4(0, 0, 0, 0);
  }

  /** One picture of the scene as it is now, as a webp with alpha. Waits, a frame at a time, until every mesh is ready
   *  for this target (a first picture compiles its shaders: seconds on a slow GPU), then draws the scene once into it
   *  the way the screen's frame is drawn (scene.render, so the before-render work runs: the lamps' furniture light). */
  async shoot(interrupted: () => boolean): Promise<Blob> {
    const { scene, cam, rtt } = this;
    const until = performance.now() + READY_TIMEOUT_MS;
    while (!(rtt.isReadyForRendering() && cam.isReady(true))) {
      if (interrupted()) throw new CaptureAborted();
      if (performance.now() > until) {
        // the telemetry says which meshes held it, the only lead on a device nobody can attach a console to
        const waiting = this.meshes.filter((m) => m.isEnabled() && m.isVisible && !m.isReady(true)).map((m) => m.name);
        throw new Error(`a picture did not get ready (${waiting.length} meshes waiting: ${waiting.slice(0, 4).join(", ")})`);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    const camera = scene.activeCamera, cameras = scene.activeCameras, all = scene.meshes, sprites = scene.spritesEnabled;
    scene.incrementRenderId();
    scene.resetCachedMaterial();
    scene.activeCamera = cam;
    scene.activeCameras = null;
    scene.meshes = this.meshes;
    scene.spritesEnabled = false;
    cam.outputRenderTarget = rtt;
    try {
      scene.render();
    } finally {
      cam.outputRenderTarget = null;
      scene.activeCamera = camera;
      scene.activeCameras = cameras;
      scene.meshes = all;
      scene.spritesEnabled = sprites;
    }
    const data = await rtt.readPixels(0, 0, null, true, false);
    if (!data) throw new Error("the picture could not be read back");
    const { width, height } = rtt.getSize();
    return encodeWebp(width, height, data);
  }

  dispose(): void { this.rtt.dispose(); }
}

/** The target's pixels (bottom row first, as GL reads them) as a webp picture, top row first. */
function encodeWebp(width: number, height: number, data: ArrayBufferView): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no 2D canvas to write the picture"));
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const img = ctx.createImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) img.data.set(src.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("the picture could not be written"));
      else if (blob.type !== "image/webp") reject(new NoWebp());
      else resolve(blob);
    }, "image/webp", WEBP_QUALITY);
  });
}

/**
 * Take the whole set: each floor the format holds (1F, 2F), by day then by night, and the manifest made from the same
 * moment (badges, rooms, frame). `interrupted` is asked between pictures; when it says yes the capture stops, puts
 * the villa back and throws CaptureAborted.
 */
export async function captureVillaPictures(
  manager: SceneManager, source: PictureSource, interrupted: () => boolean = () => false,
): Promise<CapturedSet> {
  const stage = manager.picturesStage();
  if (!stage) throw new Error("the villa is not ready for pictures");
  const { scene, floors, sun, visuals } = manager;
  const clear = scene.clearColor.clone();
  let cam: TargetCamera | null = null;
  let target: PictureTarget | null = null;
  let lampsBack: (() => void) | null = null;
  let coversBack: (() => void) | null = null;
  let fansBack: (() => void) | null = null;
  try {
    // an unstamped badge is drawn on every floor in the 3D villa; a picture has one place for it: the lowest floor
    const detectedFloors = floors.getFloorsDetected();
    const lowest = PICTURE_FLOORS.find((f) => detectedFloors.includes(f)) ?? 1;
    const anchors: WorldAnchor[] = visuals.anchorSnapshot().map((a) => ({ ...a, floor: a.floor ?? lowest }));
    const frame = houseFrame(stage.house, { min: stage.min, max: stage.max }, anchors);
    const size = pictureSize(frame);
    const detected = floors.getFloorsDetected();
    const shown = PICTURE_FLOORS.filter((f) => detected.includes(f));
    if (!shown.length) throw new Error("the model has no floor 1 or 2");
    cam = topDownCamera(manager, frame, stage.min, stage.max);
    target = new PictureTarget(scene, cam, stage.meshes, size);
    lampsBack = visuals.lampsOff();
    const covers = visuals.coversOpen();
    coversBack = covers.back;
    const fans = visuals.ceilingFansHidden();
    fansBack = fans.back;
    const pictures = new Map<ViewFile, Blob>();
    for (const floor of shown) {
      floors.showForPicture(floor);
      for (const look of LOOKS) {
        if (interrupted()) throw new CaptureAborted();
        sun.forceLook(look);
        // after the look, which writes the sky colour: the picture's empty space is transparent
        scene.clearColor = new Color4(0, 0, 0, 0);
        pictures.set(viewFileFor(floor, look), await target.shoot(interrupted));
      }
    }
    if (interrupted()) throw new CaptureAborted();
    const manifest = buildManifest({ source, madeAt: new Date(), frame, floors: shown, size, anchors, rooms: stage.rooms,
      covers: covers.poses.map((c) => ({ ...c, floor: c.floor ?? lowest })),
      fans: fans.fans.map((f) => ({ ...f, floor: f.floor ?? lowest })),
      lamps: visuals.lampSpots().map((l) => ({ ...l, floor: l.floor ?? lowest })) });
    const files = [...pictures].map(([name, blob]) => ({ name, blob }));
    files.push({ name: "manifest.json", blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }) });
    return { files, manifest, bytes: files.reduce((n, f) => n + f.blob.size, 0) };
  } finally {
    floors.showForPicture(null);
    lampsBack?.();
    coversBack?.();
    fansBack?.();
    scene.clearColor = clear;
    sun.forceLook(null);
    target?.dispose();
    cam?.dispose();
    stage.release();
  }
}
