// src/components/hud/ProblemNotices.tsx
// What did NOT happen, said in ONE place: a red notice in the villa view's column, over whatever window is open, with
// its ✕. Drawn as every notice is (Notice).
//
// ⚠️ FIVE SILENCES (owner, 2026-11-10: "a save that did not happen says so"). A shared change the server refused was
// said in Advanced Settings and not in Settings, which saves the same things; a save made with no connection was a
// line at the top of the Cockpit's scrolling body; this device's storage refusing its own settings was a line in the
// console; a number that was none went back to the one before; a card's erase that failed answered nobody. Each store
// keeps its own line (it knows when it is over); a line raised by name (`raised`: useAppNotice, tone "alert"; a
// command that failed: AppNotice.useFailedCommandNotice) passes after the notices' one time. This is the only piece that
// draws any of them.

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useFmDataOrNull } from "@/fm/FmDataContext";
import { ANNOUNCEMENT_NOTICE_MS } from "@/messages/announcements";
import { NoticeView } from "./Notice";

export default function ProblemNotices({ raised, onDrop }: { raised: readonly string[]; onDrop: (line: string) => void }) {
  const { saveProblem, setSaveProblem, storeProblem, setStoreProblem } = useConfig();
  const fm = useFmDataOrNull();
  // each line once, whoever says it: with no connection the device setup and the Facility record say the same words
  const said = new Map<string, { gone: (() => void)[]; passes: boolean }>();
  const say = (line: string | null | undefined, gone: () => void, passes = false) => {
    if (!line) return;
    const was = said.get(line);
    said.set(line, { gone: [...(was?.gone ?? []), gone], passes: passes && was?.passes !== false });
  };
  say(saveProblem, () => setSaveProblem(null));
  say(storeProblem, () => setStoreProblem(null));
  say(fm?.saveError, () => fm?.dismissSaveError());
  for (const line of raised) say(line, () => onDrop(line), true);
  return (
    <>
      {[...said].map(([line, { gone, passes }]) => (
        <ProblemNotice key={line} line={line} passes={passes} onGone={() => gone.forEach((g) => g())} />
      ))}
    </>
  );
}

/** One of them. `passes`: nothing will say it is over, so it leaves by itself after the notices' one time. */
function ProblemNotice({ line, passes, onGone }: { line: string; passes: boolean; onGone: () => void }) {
  useEffect(() => {
    if (!passes) return;
    const t = setTimeout(onGone, ANNOUNCEMENT_NOTICE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one time per line, not per draw
  }, [passes]);
  return <NoticeView tone="alert" role="alert" icon={<AlertTriangle size={16} />} onDismiss={onGone}>{line}</NoticeView>;
}
