// src/components/settings/MarkersTable.tsx
// Review/remove floating control markers. Creating them is done by tapping in the
// villa (Settings → Drop control markers); this is for management.

import { Trash2, MapPin } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { removeMarker } from "@/config/markerUtils";

export default function MarkersTable() {
  const { config, update } = useConfig();
  const { entities } = useHA();

  if (config.markers.length === 0) {
    return (
      <p className="muted body-text">
        No markers yet. In the villa, open <strong>Settings → Drop control markers (tap mode)</strong>
        and tap a spot to place one. Use these for lamps/curtains/AC that aren't separate objects,
        or entities you haven't created in HA yet.
      </p>
    );
  }

  return (
    <table className="config-table">
      <thead>
        <tr><th>Entity</th><th>Type</th><th>Floor</th><th>Status</th><th /></tr>
      </thead>
      <tbody>
        {config.markers.map((m) => {
          const live = entities[m.entityId];
          return (
            <tr key={m.id}>
              <td style={{ fontSize: 12 }}>
                <MapPin size={12} /> {m.entityId}
                {m.label && <div className="muted" style={{ fontSize: 11 }}>{m.label}</div>}
              </td>
              <td>{m.type}</td>
              <td>F{m.floor}</td>
              <td className="muted" style={{ fontSize: 12 }}>
                {live ? live.state : "not in HA yet"}
              </td>
              <td>
                <button
                  className="icon-btn" style={{ width: 34, height: 34 }}
                  onClick={() => update(removeMarker(config, m.id))}
                  title="Remove marker"
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
