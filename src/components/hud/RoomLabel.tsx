// src/components/hud/RoomLabel.tsx
import { useEffect, useState } from "react";

export default function RoomLabel({ room }: { room: string | null }) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<string | null>(room);

  useEffect(() => {
    if (!room) {
      setVisible(false);
      return;
    }
    setShown(room);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [room]);

  if (!visible || !shown) return null;
  return <div className="room-label room-title">{shown}</div>;
}
