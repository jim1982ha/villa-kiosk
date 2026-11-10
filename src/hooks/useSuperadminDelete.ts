// src/hooks/useSuperadminDelete.ts
// Press-and-hold a record → superadmin code → the record is gone.
//
// One hook so every erasable row behaves identically: the same hold duration,
// the same scroll tolerance, the same prompt, the same "cancel means nothing
// happened". Each call site is then a single line plus the `fm-erasable`
// class that draws the hint, which is what stops the fourth erasable list
// from inventing a fifth interaction.

import { useCallback } from "react";
import { useLongPress, type LongPressHandlers } from "./useLongPress";
import { useSuperadmin, type ElevationIntent } from "@/auth/SuperadminGate";
import { useAppNotice } from "@/components/hud/AppNotice";

/**
 * @param intent  What the prompt says is about to be destroyed.
 * @param erase   Performs the deletion with the token it is handed. Runs ONLY
 *                after a correct code; the token authorises one write. A line
 *                it resolves to is why the record is still there, said where
 *                every save that did not happen is (the villa view's notices):
 *                a message's erase answered nobody (owner, 2026-11-10). A
 *                Facility record's delete says its own (FmDataContext).
 */
export function useSuperadminDelete(
  intent: ElevationIntent,
  erase: (elevation: string) => Promise<unknown>,
): LongPressHandlers {
  const { authorize } = useSuperadmin();
  const notice = useAppNotice();
  return useLongPress(useCallback(() => {
    void (async () => {
      const token = await authorize(intent);
      if (!token) return;
      const said = await erase(token);
      if (typeof said === "string") notice({ text: said, tone: "alert" });
    })();
    // The intent is spread so a changed label doesn't rebuild the handler on
    // every keystroke elsewhere in the screen.
  }, [authorize, erase, notice, intent.title, intent.detail])); // eslint-disable-line react-hooks/exhaustive-deps
}
