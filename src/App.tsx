import { Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "@/config/ConfigContext";
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
              {/* The Config Editor is a modal over the Dashboard (see
                  ConfigEditorModal), not a route — leaving it never unmounts
                  the villa scene, so there's no GLB reload. */}
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ProfileGate>
          </div>
        </HAStateProvider>
      </ProfileProvider>
    </ConfigProvider>
  );
}
