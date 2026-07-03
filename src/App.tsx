import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { ConfigProvider } from "@/config/ConfigContext";
import { HAStateProvider } from "@/ha/HAStateStore";
import { ProfileProvider, useProfile } from "@/auth/ProfileContext";
import { hasCapability, type Capability } from "@/auth/permissions";
import ProfileGate from "@/components/auth/ProfileGate";
import Dashboard from "@/pages/Dashboard";
import Config from "@/pages/Config";

/** Route guard: deep links can't reach a page the active profile may not use. */
function RequireCapability({ cap, children }: { cap: Capability; children: ReactNode }) {
  const { role } = useProfile();
  if (!role || !hasCapability(role, cap)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ConfigProvider>
      <ProfileProvider>
        <HAStateProvider>
          <div className="app-root">
            <ProfileGate>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route
                  path="/config"
                  element={
                    <RequireCapability cap="editConfig">
                      <Config />
                    </RequireCapability>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ProfileGate>
          </div>
        </HAStateProvider>
      </ProfileProvider>
    </ConfigProvider>
  );
}
