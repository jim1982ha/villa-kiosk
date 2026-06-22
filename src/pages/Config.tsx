// src/pages/Config.tsx
// Full-page Config Editor (mesh/entity mapping + thresholds).

import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ConfigEditor from "@/components/settings/ConfigEditor";
import BindingsTable from "@/components/settings/BindingsTable";
import MarkersTable from "@/components/settings/MarkersTable";
import { useConfig } from "@/config/ConfigContext";

export default function Config() {
  const navigate = useNavigate();
  const { config, update } = useConfig();

  return (
    <div className="teleport-grid" style={{ padding: "24px" }}>
      <div className="row spread" style={{ maxWidth: 1000, margin: "0 auto 20px" }}>
        <button className="btn ghost" onClick={() => navigate("/")}>
          <ArrowLeft size={18} /> Back to villa
        </button>
        <h2 style={{ margin: 0 }}>Config Editor</h2>
        <span style={{ width: 120 }} />
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 0 }}>
          3D object → entity bindings
        </h3>
        <BindingsTable />

        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 32 }}>
          Floating control markers
        </h3>
        <MarkersTable />

        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 32 }}>
          Entity metadata
        </h3>
        <ConfigEditor />

        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 32 }}>Alert thresholds</h3>
        <table className="config-table">
          <thead>
            <tr><th>Entity</th><th>Min</th><th>Max</th></tr>
          </thead>
          <tbody>
            {Object.entries(config.alertThresholds).map(([id, t]) => (
              <tr key={id}>
                <td style={{ fontSize: 12 }}>{id}</td>
                <td>
                  <input
                    type="number" value={t.min ?? ""}
                    onChange={(e) =>
                      update({
                        alertThresholds: {
                          ...config.alertThresholds,
                          [id]: { ...t, min: e.target.value === "" ? undefined : Number(e.target.value) },
                        },
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number" value={t.max ?? ""}
                    onChange={(e) =>
                      update({
                        alertThresholds: {
                          ...config.alertThresholds,
                          [id]: { ...t, max: e.target.value === "" ? undefined : Number(e.target.value) },
                        },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
