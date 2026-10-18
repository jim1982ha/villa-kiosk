// src/components/hud/AppNotice.tsx
// A passing notice of the villa view — "Motion detected · Kitchen", "Floor 3 isn't modelled yet" — gone after a few
// seconds. Drawn as every notice is (Notice): its tone says what it is, from the map's own colours.

import { useEffect, useState } from "react";
import { Activity, Info } from "lucide-react";
import { NoticeView, type NoticeTone } from "./Notice";

/** What to say, and what it is: a sensor triggered ("active") or plain news ("info"). */
export interface AppNoticeMessage { text: string; tone: Extract<NoticeTone, "active" | "info"> }

export default function AppNotice({ message, onExpire }: { message: AppNoticeMessage | null; onExpire: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); onExpire(); }, 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!visible || !message) return null;
  // a sensor's notice belongs to the villa map: never over the fullscreen camera's live picture
  return (
    <NoticeView tone={message.tone} icon={message.tone === "active" ? <Activity size={16} /> : <Info size={16} />}
      belowCamera={message.tone === "active"}>
      {message.text}
    </NoticeView>
  );
}
