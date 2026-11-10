// src/components/hud/AppNotice.tsx
// A passing notice of the villa view — "Motion detected · Kitchen", "Floor 3 isn't modelled yet" — gone after a few
// seconds. Drawn as every notice is (Notice): its tone says what it is, from the map's own colours.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Activity, Info } from "lucide-react";
import { NoticeView, type NoticeTone } from "./Notice";

/** What to say, and what it is: a sensor triggered ("active"), plain news ("info"), or something that did NOT happen
 *  ("alert": a number that was none, a delete that failed), drawn with every such line (ProblemNotices). */
export interface AppNoticeMessage { text: string; tone: Extract<NoticeTone, "active" | "info" | "alert"> }

/** Raise a notice from anywhere under the villa view — a window's Save or Cancel says what it did (owner,
 *  2026-10-20). Outside the view (a check rendering a window alone) it says nothing. */
export const AppNoticeContext = createContext<(message: AppNoticeMessage) => void>(() => {});
export const useAppNotice = () => useContext(AppNoticeContext);

/** The villa view's raised notices: the passing one (the latest replaces the one before), and what did not happen,
 *  each line once. ⚠️ NEWS NEVER REPLACES A PROBLEM: "Saved" follows a number that was not taken within the same
 *  second, and would be the only thing read. */
export function useRaisedNotices() {
  const [passing, setPassing] = useState<AppNoticeMessage | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const raise = useCallback((m: AppNoticeMessage) => {
    if (m.tone === "alert") setProblems((said) => (said.includes(m.text) ? said : [...said, m.text]));
    else setPassing(m);
  }, []);
  const expire = useCallback(() => setPassing(null), []);
  const drop = useCallback((line: string) => setProblems((said) => said.filter((l) => l !== line)), []);
  return { passing, problems, raise, expire, drop };
}

export default function AppNotice({ message, onExpire }: { message: AppNoticeMessage | null; onExpire: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); onExpire(); }, 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!visible || !message || message.tone === "alert") return null;
  // a sensor's notice belongs to the villa map: never over the fullscreen camera's live picture
  return (
    <NoticeView tone={message.tone} icon={message.tone === "active" ? <Activity size={16} /> : <Info size={16} />}
      belowCamera={message.tone === "active"}>
      {message.text}
    </NoticeView>
  );
}
