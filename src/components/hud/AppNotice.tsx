// src/components/hud/AppNotice.tsx
// General-purpose themed toast for app-level notices that aren't a failed HA
// service call (see ServiceErrorToast for that specific case) — e.g. "this
// floor isn't modelled yet". Reuses the same .service-toast chrome so every
// transient message in the kiosk looks consistent, instead of a native
// alert() that breaks out of the app's own dark/light theme entirely.

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

export default function AppNotice({ message, onExpire }: { message: string | null; onExpire: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); onExpire(); }, 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!visible || !message) return null;

  return (
    <div className="service-toast app-notice" role="status">
      <Info size={16} />
      <span>{message}</span>
    </div>
  );
}
