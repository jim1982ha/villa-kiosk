import { Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "@/config/ConfigContext";
import { HAStateProvider } from "@/ha/HAStateStore";
import Dashboard from "@/pages/Dashboard";
import Config from "@/pages/Config";

export default function App() {
  return (
    <ConfigProvider>
      <HAStateProvider>
        <div className="app-root">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/config" element={<Config />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </HAStateProvider>
    </ConfigProvider>
  );
}
