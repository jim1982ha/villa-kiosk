// src/pages/Config.tsx
// Full-page Config Editor: entity metadata, mesh bindings, markers, thresholds.

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
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)" }}>

      {/* ── Sticky header ── */}
      <div
        style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--bg-base)",
          borderBottom: "1px solid var(--hairline)",
          padding: "16px 24px",
        }}
      >
        <div className="config-topbar">
          <button className="btn ghost" onClick={() => navigate("/")}>
            <ArrowLeft size={18} /> Back to villa
          </button>
          <h2>Config Editor</h2>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>

          {/* 1 — Auto-detected entities (GLB-named meshes + pre-configure) */}
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 0 }}>
            Auto-detected entity settings
          </h3>
          <ConfigEditor />

          {/* 2 — Manually bound 3D objects */}
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 40 }}>
            Bound 3D objects
          </h3>
          <BindingsTable />

          {/* 3 — Floating control markers */}
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 40 }}>
            Floating control markers
          </h3>
          <MarkersTable />

          {/* 4 — Alert thresholds */}
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 40 }}>
            Alert thresholds
          </h3>
          <p className="muted body-text">
            Min / max values for numeric sensors. Exceeding the range turns the
            sensor label red in the scene.
          </p>
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
    </div>
  );
}
