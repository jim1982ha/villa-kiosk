// src/components/hud/ServiceErrorToast.tsx
// Global feedback for failed service calls. Every control in the app fires its call without awaiting it, so when a
// call fails (disconnected socket, unsupported service, an error on the villa's side) the tap used to do exactly
// nothing. This is that missing feedback, for a few seconds, wherever it happened — drawn as every notice is (Notice).

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { NoticeView } from "./Notice";

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

  return <NoticeView tone="alert" role="alert" icon={<AlertTriangle size={16} />}>{serviceError.message}</NoticeView>;
}
