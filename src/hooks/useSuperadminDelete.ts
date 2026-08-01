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

/**
 * @param intent  What the prompt says is about to be destroyed.
 * @param erase   Performs the deletion with the token it is handed. Runs ONLY
 *                after a correct code; the token authorises one write.
 */
export function useSuperadminDelete(
  intent: ElevationIntent,
  erase: (elevation: string) => Promise<void>,
): LongPressHandlers {
  const { authorize } = useSuperadmin();
  return useLongPress(useCallback(() => {
    void (async () => {
      const token = await authorize(intent);
      if (token) await erase(token);
    })();
    // The intent is spread so a changed label doesn't rebuild the handler on
    // every keystroke elsewhere in the screen.
  }, [authorize, erase, intent.title, intent.detail])); // eslint-disable-line react-hooks/exhaustive-deps
}
