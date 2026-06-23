// src/components/hud/HUD.tsx
// Top bar (brand, floor switch, clock, connection, action buttons) +
// bottom bar (joystick, teleport, alerts, settings).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Grid3x3, Settings, Wifi, WifiOff, Link2, MapPin, Sliders } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import VirtualJoystick from "./VirtualJoystick";
import AlertBadge from "./AlertBadge";

interface Props {
  currentFloor: number;
  floorsAvailable: number[];
  onSwitchFloor: (floor: number) => void;
  onOpenTeleport: () => void;
  onOpenSettings: () => void;
  onEnterBindMode: () => void;
  onEnterPlaceMode: () => void;
  onMove: (x: number, y: number) => void;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HUD({
  currentFloor, floorsAvailable, onSwitchFloor, onOpenTeleport,
  onOpenSettings, onEnterBindMode, onEnterPlaceMode, onMove,
}: Props) {
  const { connection, haConfig } = useHA();
  const { config } = useConfig();
  const navigate = useNavigate();
  const clock = useClock();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const floors = [1, 2];

  useEffect(() => { document.title = title; }, [title]);

  const connClass =
    connection === "connected" ? "online" : connection === "disconnected" ? "" : "connecting";

  return (
    <>
      <div className="hud-topbar">
        <div className="hud-brand">
          <Home size={22} /> {title}
        </div>

        <div className="floor-switch">
          {floors.map((f) => (
            <button
              key={f}
              className={f === currentFloor ? "active" : ""}
              disabled={!floorsAvailable.includes(f)}
              title={floorsAvailable.includes(f) ? `Floor ${f}` : "Coming soon"}
              onClick={() => onSwitchFloor(f)}
            >
              Floor {f}
            </button>
          ))}
        </div>

        <div className="hud-right">
          <span className="hud-clock">{clock}</span>
          <span className={`conn-dot ${connClass}`}>
            <span className="dot" />
            {connection === "connected" ? <Wifi size={15} /> : <WifiOff size={15} />}
          </span>
          {/* Quick-access toolbar — bind, place marker, config editor */}
          <button className="icon-btn" onClick={onEnterBindMode} title="Bind 3D object to entity">
            <Link2 size={18} />
          </button>
          <button className="icon-btn" onClick={onEnterPlaceMode} title="Drop control marker">
            <MapPin size={18} />
          </button>
          <button className="icon-btn" onClick={() => navigate("/config")} title="Config Editor">
            <Sliders size={18} />
          </button>
          <button className="icon-btn" onClick={onOpenSettings} title="Settings">
            <Settings size={20} />
          </button>
        </div>
      </div>

      <div className="bottom-bar">
        <VirtualJoystick onMove={onMove} />
        <div className="bottom-right">
          <button className="icon-btn" onClick={onOpenTeleport} title="Rooms">
            <Grid3x3 size={22} />
          </button>
          <AlertBadge />
        </div>
      </div>
    </>
  );
}
