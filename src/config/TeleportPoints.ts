// src/config/TeleportPoints.ts
//
// Seed room list — intentionally EMPTY.
//
// This used to hold the twelve rooms of the ONE villa this app was first built
// against: their names ("Master Bedroom", "Pool / Garden"…), hand-derived
// world coordinates and thumbnail paths. Like the old ENTITY_MAP seed it
// predated the runtime pipeline that replaced it, and was simply never
// removed — so a fresh install on any other villa opened with a dozen rooms
// belonging to somebody else's house, at coordinates meaningless in their
// model.
//
// Rooms are produced at runtime instead: SceneManager fits the SweetHome
// plan→world transform and derives a teleport point per room polygon
// (calibrateRooms), which Dashboard adopts into the stored config — the single
// source of truth. A user can also add one by hand via the Rooms menu. Nothing
// specific to any one villa belongs in shipped code.
//
// Keep this empty. An install with no room data yet simply has no rooms until
// its model is calibrated, which is the honest state — far better than
// offering navigation to rooms that don't exist.

import type { TeleportPoint } from "@/types/scene.types";

export const TELEPORT_POINTS: TeleportPoint[] = [];
