import { ConfigProvider } from "@/config/ConfigContext";
import DeviceConfigSync from "@/config/DeviceConfigSync";
import { FmDataProvider } from "@/fm/FmDataContext";
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
              {/* Headless — reconciles the shared DEVICE configuration
                  (bindings, per-device metadata, rooms, groups) with the
                  add-on's /device-config store. Inside the gate: that
                  endpoint needs the session the gate establishes. */}
              <DeviceConfigSync />
              {/* The Config Editor is a modal over the Dashboard (see
                  ConfigEditorModal), not a route — leaving it never unmounts
                  the villa scene, so there's no GLB reload. */}
              {/* Facility Manager working set — inside the gate for the same
                  reason as DeviceConfigSync: /fm-data needs the session the
                  gate establishes. */}
              <FmDataProvider>
                {/* One screen, rendered directly. This was a react-router
                    <Routes> with a single "/" route and a catch-all redirect
                    back to it — a routing library for an app with nowhere to
                    route. Dropping it removed two advisories (GHSA-wrjc-x8rr-h8h6
                    open redirect, GHSA-337j-9hxr-rhxg constructor injection)
                    by removing the dependency rather than tracking its
                    versions. Neither was exploitable here (no useNavigate, no
                    <Link>, no SSR), but an unused dependency is pure
                    supply-chain surface. */}
                <Dashboard />
              </FmDataProvider>
            </ProfileGate>
          </div>
        </HAStateProvider>
      </ProfileProvider>
    </ConfigProvider>
  );
}
