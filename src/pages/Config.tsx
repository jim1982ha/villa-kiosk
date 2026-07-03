// src/pages/Config.tsx
// Full-page Config Editor: entity metadata, mesh bindings.

import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ConfigEditor from "@/components/settings/ConfigEditor";
import BindingsTable from "@/components/settings/BindingsTable";

export default function Config() {
  const navigate = useNavigate();

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

        </div>
      </div>
    </div>
  );
}
