// src/components/teleport/TeleportMenu.tsx
// Room grid for instant navigation: tap a card to go there, plus add/remove.
//
// The long-press/right-click "re-anchor this room to where I'm standing"
// gesture that used to live here is GONE, along with the per-room saved
// overview pose it wrote. Framing a room is now derived from the floor plan
// itself (SceneManager.computeRoomOverviewPose fits the room's real polygon),
// so a hand-saved viewpoint was not just redundant but actively worse: it
// froze one person's one-time eyeballed zoom in config, and a shot that
// wasn't tight enough also left that room's badges grouped on arrival.
// Deleting it removed the hold-vs-scroll touch arbitration this grid needed
// purely to host the gesture.

import { X, MapPin, Plus, Trash2 } from "lucide-react";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { useState } from "react";
import { useConfig } from "@/config/ConfigContext";
import AskDialog from "@/components/common/AskDialog";
import { roomKey } from "@/config/roomKey";
import type { TeleportPoint, Vec3 } from "@/types/scene.types";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  currentFloor: number;
  onClose: () => void;
  onTeleport: (point: TeleportPoint) => void;
}

export default function TeleportMenu({ manager, currentFloor, onClose, onTeleport }: Props) {
  const { config, update } = useConfig();
  const points = config.teleportPoints;
  /** Which in-app dialog is open, if any — see AskDialog for why these are not
   *  `prompt`/`confirm`/`alert`. `null` means none. */
  const [ask, setAsk] = useState<{ kind: "add" } | { kind: "remove"; name: string } | null>(null);

  /**
   * "Where am I standing" — captured from whichever camera is ACTUALLY
   * active, for a NEW room only. The Rooms menu can be opened from either
   * mode, but the first-person camera goes dormant (input detached, position
   * frozen) while browsing in overview, so reading it there returns a stale
   * pose from wherever it was last left rather than what's on screen.
   *
   * In overview there is no first-person look direction to derive a standing
   * position from, so one is synthesized from the orbit target (the same
   * fallback SceneManager uses for its own calibrated rooms) purely so a
   * later first-person teleport to this room lands somewhere sane. Nothing
   * about the current ZOOM/angle is stored — that is re-derived per room from
   * its floor-plan footprint every time it's visited.
   */
  const captureCurrentPose = (): { position: Vec3; target: Vec3 } => {
    if (manager!.getViewMode() === "overview") {
      const pose = manager!.overview.getPose();
      const position = { x: round(pose.target.x), y: round(config.eyeHeight), z: round(pose.target.z) };
      return { position, target: { x: position.x, y: position.y, z: position.z + 1.5 } };
    }
    const cam = manager!.camera.camera;
    const pos = cam.position;
    const dir = cam.getDirection(Axis.Z);
    return {
      position: { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
      target: { x: round(pos.x + dir.x), y: round(pos.y + dir.y), z: round(pos.z + dir.z) },
    };
  };

  // ⚠️ THIS IS WHERE `roomKey` WAS MISSING, AND IT IS THE ONE PLACE THAT
  // CREATES THE DATA (/dry-audit, 2026-08-18). Forty-three sites across the app
  // compare room names through `roomKey` — case- and whitespace-insensitively —
  // and this file compared them raw, so typing "Kitchen" while "kitchen "
  // already existed produced TWO teleport points for ONE room. Every consumer
  // then collapsed them back to a single room, leaving two rows in this grid
  // pointing at different poses and no way to tell which was which.
  //
  // Worse than a local glitch: `teleportPoints` is a SHARED config key, so the
  // duplicate syncs to every client in the villa. A rule honoured at every
  // reader and absent at the writer is the exact shape this audit exists to
  // find.
  /** Returns a rejection string for AskDialog, or nothing on success. */
  const addRoomHere = (name: string): string | void => {
    if (!manager) return "The scene is not ready yet.";
    // The name is kept VERBATIM — `roomKey` is for comparing, never for
    // storing (see its header). Only the collision test is normalised.
    const key = roomKey(name);
    const clash = config.teleportPoints.find((p) => roomKey(p.name) === key);
    // Rejected INLINE rather than through a second dialog: the native flow was
    // prompt → alert → prompt, which threw away what was typed and asked twice.
    if (clash) return `"${clash.name}" already exists — remove or rename it first.`;
    const { position, target } = captureCurrentPose();
    update({
      teleportPoints: [...config.teleportPoints, { name, floor: currentFloor as 1 | 2, position, target }],
    });
    setAsk(null);
  };

  const removeRoom = (name: string) => {
    // By KEY, so the row the user is looking at goes whatever case it was typed
    // in. Deduping on the way in makes this at most one row in practice; it
    // matters for the entries an older build already stored.
    const key = roomKey(name);
    update({ teleportPoints: config.teleportPoints.filter((p) => roomKey(p.name) !== key) });
  };

  return (
    <>
    {ask?.kind === "add" && (
      <AskDialog
        title="Add room"
        input={{ label: "Name this room or viewpoint", placeholder: "e.g. Kitchen" }}
        confirmLabel="Add"
        onConfirm={addRoomHere}
        onCancel={() => setAsk(null)}
      />
    )}
    {ask?.kind === "remove" && (
      <AskDialog
        title="Remove room"
        message={`Remove "${ask.name}"? This only deletes the saved viewpoint, not the room itself.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => { removeRoom(ask.name); setAsk(null); }}
        onCancel={() => setAsk(null)}
      />
    )}
    <div className="teleport-grid">
      <button
        className="icon-btn"
        style={{
          position: "absolute",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          right: "calc(20px + env(safe-area-inset-right, 0px))",
        }}
        onClick={onClose}
        aria-label="Close rooms menu"
      >
        <X size={22} />
      </button>
      <h2>Rooms</h2>
      <div className="tp-cards">
        {points.map((p) => (
          <button
            key={p.name}
            className="tp-card"
            style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : undefined}
            onClick={() => onTeleport(p)}
            title={`Go to ${p.name}`}
          >
            <div className="scrim" />
            {p.floor !== currentFloor && <span className="floor-tag">F{p.floor}</span>}
            <span
              role="button"
              tabIndex={-1}
              className="tp-delete"
              onClick={(e) => {
                e.stopPropagation();
                setAsk({ kind: "remove", name: p.name });
              }}
              title="Remove room"
              aria-label={`Remove room ${p.name}`}
            >
              <Trash2 size={16} />
            </span>
            <span>{p.name}</span>
          </button>
        ))}

        <button className="tp-card tp-add" onClick={() => setAsk({ kind: "add" })} title="Add current viewpoint as a room">
          <Plus size={26} />
          <span>Add room here</span>
        </button>
      </div>
      <p className="muted center mt body-text">
        <MapPin size={16} /> Tap a room to fly there — the view is framed to that room automatically.
      </p>
    </div>
    </>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
