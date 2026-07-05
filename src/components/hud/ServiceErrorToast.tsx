// src/components/hud/ServiceErrorToast.tsx
// Global feedback for failed service calls. Every control in the app fires
// its HA call without awaiting it, so when a call fails (disconnected socket,
// unsupported service, HA-side error) the tap used to do exactly nothing.
// This toast is that missing feedback: it surfaces the failure for a few
// seconds wherever it happened — no per-panel wiring needed.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";

export default function ServiceErrorToast() {
  const { serviceError } = useHA();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!serviceError) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [serviceError]);

  if (!visible || !serviceError) return null;

  return (
    <div className="service-toast" role="alert">
      <AlertTriangle size={16} />
      <span>{serviceError.message}</span>
    </div>
  );
}
