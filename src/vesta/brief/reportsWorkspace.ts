// src/vesta/brief/reportsWorkspace.ts
//
// The two decisions the Briefings dialog makes that are not rendering.
//
// ⚠️ BOTH COVER A SHIPPED DEFECT AND NEITHER COULD BE TESTED (extracted
// 2026-09-06). They lived inside a 536-line modal that holds eleven pieces of
// state, so exercising them meant opening a browser — and both are the kind of
// derivation that fails quietly rather than loudly.

// ⚠️ TYPE-ONLY, AND `.ts` ON THE VALUE IMPORT IF ONE IS EVER ADDED — this
// file is loaded by the bare-node harness, which resolves specifiers literally.
import type { DeliveryResult } from "@/vesta/shared/reportsTypes";

/** Which tabs a reader may see, and which one opens.
 *
 * ⚠️ THE DEFAULT IS THE FIRST VISIBLE TAB, NEVER A LITERAL, AND THIS HAS BEEN
 * GOT WRONG TWICE. Hard-coding one opened a facility manager on a tab that was
 * not in their list — every chip unselected, the body empty. The fix then
 * reintroduced it through a FALLBACK: `tabs[0]?.id ?? "tasks"`, where `"tasks"`
 * had stopped being a member of the tab union. `tsc` cannot see that, because
 * `tabs[0]?.id` is non-nullable so the `??` right-hand type is discarded and
 * the literal is never checked.
 *
 * ⚠️ AND AN EMPTY LIST IS A REAL STATE, NOT AN IMPOSSIBLE ONE. Every tab is
 * owner-only, so a facility manager filters the list to nothing — `null` says
 * that, and the dialog answers it with a sentence instead of a blank pane.
 */
export function visibleTabs<T extends { id: string; configure?: true }>(
  all: readonly T[],
  canConfigure: boolean,
): { tabs: T[]; initial: string | null } {
  const tabs = all.filter((t) => canConfigure || !t.configure);
  return { tabs, initial: tabs.length > 0 ? tabs[0].id : null };
}

/** What to tell the reader after a send.
 *
 * ⚠️ "Sent to 0 recipient(s)" WAS THE ANSWER FOR A SCHEDULE WITH NOWHERE TO GO,
 * and it reads as success. The pre-flight refusal that used to catch it could
 * only see the schedule's own list; destinations now come from the profile, so
 * the add-on is the only thing that knows and the empty answer has to be named
 * where it arrives.
 *
 * ⚠️ A NULL RESULT IS NOT AN EMPTY ONE. "The request failed" and "the request
 * succeeded and reached nobody" need different sentences, and collapsing them
 * is how a broken notify platform came to look like a quiet villa.
 */
export function noticeFor(
  result: { deliveries?: DeliveryResult[] } | null,
): { text: string; bad: boolean } {
  if (!result) {
    return { text: "Could not send. See the add-on log.", bad: true };
  }
  const rows = result.deliveries ?? [];
  const sent = rows.filter((d) => d.status === "sent");
  const failed = rows.filter((d) => d.status === "failed");
  if (failed.length) {
    return {
      text: `Sent to ${sent.length}, failed for ${failed.length}: `
        + failed.map((d) => d.detail || d.target).join("; "),
      bad: true,
    };
  }
  if (sent.length === 0) {
    return {
      text: "Nobody is set up to receive this profile's briefings, so nothing "
        + "was sent.",
      bad: true,
    };
  }
  return { text: `Sent to ${sent.length} recipient(s).`, bad: false };
}
