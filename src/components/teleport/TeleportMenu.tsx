// src/components/teleport/TeleportMenu.tsx
// Room grid for instant navigation, with an in-app "set anchor here" calibration
// affordance (long-press a card) so placeholder coordinates can be fixed live.

import { useRef, useState } from "react";
import { X, MapPin, Plus, Trash2, Check } from "lucide-react";
import { Axis } from "@babylonjs/core";
import { useConfig } from "@/config/ConfigContext";
import type { TeleportPoint } from "@/types/scene.types";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  currentFloor: number;
  onClose: () => void;
  onTeleport: (point: TeleportPoint) => void;
}

// How long a press-and-hold takes to count as a long-press, matching the
// same threshold used for the in-scene badge tap/long-press gesture
// (EntityVisuals.wireBadgeGestures) so the two feel consistent.
const LONG_PRESS_MS = 480;

export default function TeleportMenu({ manager, currentFloor, onClose, onTeleport }: Props) {
  const { config, update } = useConfig();
  // Name of the room whose anchor was just set, so the tip line can briefly
  // confirm it — setAnchorHere used to be entirely silent, which made a
  // successful right-click/long-press indistinguishable from nothing
  // happening at all.
  const [justAnchored, setJustAnchored] = useState<string | null>(null);
  const anchoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shared press-tracking state for whichever card is currently being held —
  // only one card can be pressed at a time, so a single ref is enough.
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; longFired: boolean }>({
    timer: null,
    longFired: false,
  });

  const points = config.teleportPoints;

  /** Calibrate: store the camera's current pose as this room's anchor. */
  const setAnchorHere = (point: TeleportPoint) => {
    if (!manager) return;
    const cam = manager.camera.camera;
    const pos = cam.position;
    const dir = cam.getDirection(Axis.Z);
    const updated = config.teleportPoints.map((p) =>
      p.name === point.name
        ? {
            ...p,
            position: { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
            target: { x: round(pos.x + dir.x), y: round(pos.y + dir.y), z: round(pos.z + dir.z) },
          }
        : p,
    );
    update({ teleportPoints: updated });

    setJustAnchored(point.name);
    if (anchoredTimer.current) clearTimeout(anchoredTimer.current);
    anchoredTimer.current = setTimeout(() => setJustAnchored(null), 1800);
  };

  const cancelPress = () => {
    if (press.current.timer) {
      clearTimeout(press.current.timer);
      press.current.timer = null;
    }
  };

  const onCardPointerDown = (point: TeleportPoint) => {
    press.current.longFired = false;
    cancelPress();
    press.current.timer = setTimeout(() => {
      press.current.longFired = true;
      setAnchorHere(point);
    }, LONG_PRESS_MS);
  };

  /** Tap = teleport, unless a long-press just fired (its own timer already
   *  handled the anchor — the click that follows release shouldn't ALSO
   *  teleport). */
  const onCardClick = (point: TeleportPoint) => {
    cancelPress();
    if (press.current.longFired) {
      press.current.longFired = false;
      return;
    }
    onTeleport(point);
  };

  /** Add a brand-new room anchored at the camera's current pose. */
  const addRoomHere = () => {
    if (!manager) return;
    const name = prompt("Name this room/viewpoint:")?.trim();
    if (!name) return;
    const cam = manager.camera.camera;
    const pos = cam.position;
    const dir = cam.getDirection(Axis.Z);
    const point: TeleportPoint = {
      name,
      floor: currentFloor as 1 | 2,
      position: { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
      target: { x: round(pos.x + dir.x), y: round(pos.y + dir.y), z: round(pos.z + dir.z) },
    };
    update({ teleportPoints: [...config.teleportPoints, point] });
  };

  const removeRoom = (name: string) => {
    update({ teleportPoints: config.teleportPoints.filter((p) => p.name !== name) });
  };

  return (
    <div className="teleport-grid">
      <button
        className="icon-btn"
        style={{
          position: "absolute",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          right: "calc(20px + env(safe-area-inset-right, 0px))",
        }}
        onClick={onClose}
      >
        <X size={22} />
      </button>
      <h2>Rooms</h2>
      <div className="tp-cards">
        {points.map((p) => (
          <button
            key={p.name}
            className="tp-card"
            style={{
              ...(p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : undefined),
              touchAction: "manipulation",
              WebkitTouchCallout: "none",
            }}
            onClick={() => onCardClick(p)}
            onContextMenu={(e) => {
              e.preventDefault();
              setAnchorHere(p);
            }}
            onPointerDown={(e) => {
              if (e.button !== undefined && e.button !== 0) return; // ignore right/middle click
              onCardPointerDown(p);
            }}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            title="Tap to go · long-press / right-click to set anchor here"
          >
            <div className="scrim" />
            {p.floor !== currentFloor && <span className="floor-tag">F{p.floor}</span>}
            {justAnchored === p.name && (
              <span className="tp-anchored">
                <Check size={22} />
              </span>
            )}
            <span
              role="button"
              tabIndex={-1}
              className="tp-delete"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove "${p.name}"?`)) removeRoom(p.name);
              }}
              title="Remove room"
            >
              <Trash2 size={14} />
            </span>
            <span>{p.name}</span>
          </button>
        ))}

        <button className="tp-card tp-add" onClick={addRoomHere} title="Add current viewpoint as a room">
          <Plus size={26} />
          <span>Add room here</span>
        </button>
      </div>
      <p className="muted center mt body-text">
        {justAnchored ? (
          <><Check size={14} /> Anchor set for "{justAnchored}".</>
        ) : (
          <><MapPin size={14} /> Tip: right-click / long-press a room to re-anchor it to your current spot.</>
        )}
      </p>
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
