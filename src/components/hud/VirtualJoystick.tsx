// src/components/hud/VirtualJoystick.tsx
// Touch joystick that reports a normalised vector (-1..1) for camera movement.

import { useCallback, useRef, useState } from "react";

interface Props {
  onMove: (x: number, y: number) => void;
}

const RADIUS = 60; // matches CSS .joystick-base radius
const KNOB = 26;

export default function VirtualJoystick({ onMove }: Props) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activeId = useRef<number | null>(null);

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      const max = RADIUS - KNOB / 2;
      if (dist > max) {
        dx = (dx / dist) * max;
        dy = (dy / dist) * max;
      }
      setKnob({ x: dx, y: dy });
      // Up on screen (negative dy) = forward (positive Y for the camera).
      onMove(dx / max, -dy / max);
    },
    [onMove],
  );

  const end = useCallback(() => {
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  }, [onMove]);

  return (
    <div
      ref={baseRef}
      className="joystick-base"
      onPointerDown={(e) => {
        activeId.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (activeId.current === e.pointerId) update(e.clientX, e.clientY);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="joystick-knob"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}
