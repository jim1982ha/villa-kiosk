import { Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "@/config/ConfigContext";
import { ScenesProvider } from "@/config/ScenesContext";
import { HAStateProvider } from "@/ha/HAStateStore";
import { ProfileProvider } from "@/auth/ProfileContext";
import ProfileGate from "@/components/auth/ProfileGate";
import Dashboard from "@/pages/Dashboard";

export default function App() {
  return (
    <ConfigProvider>
      <ProfileProvider>
        <HAStateProvider>
          <div className="app-root">
            <ProfileGate>
              {/* ScenesProvider is INSIDE the gate: reaching the shared
                  /scenes store needs an established session (the gate is what
                  establishes it), and it wraps the Dashboard so the SummaryBar
                  and Settings share one server-synced scenes source. */}
              <ScenesProvider>
                {/* The Config Editor is a modal over the Dashboard (see
                    ConfigEditorModal), not a route — leaving it never unmounts
                    the villa scene, so there's no GLB reload. */}
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </ScenesProvider>
            </ProfileGate>
          </div>
        </HAStateProvider>
      </ProfileProvider>
    </ConfigProvider>
  );
}
