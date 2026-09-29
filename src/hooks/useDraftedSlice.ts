// src/hooks/useDraftedSlice.ts
// A dialog that edits a SLICE of the config live, with a baseline to go back
// to: what its controls show, how a change is written, whether anything
// changed since it opened, Save and Discard — in one place.
//
// ⚠️ ONE COPY OF EACH VALUE. The Settings window used to keep its own
// `useState` copy of four fields beside the draft mechanism (so a slider could
// move before the debounced write), re-seeded by hand on Discard — the shape
// that lost data in another window before (2.496.194): a field whose copy was
// missed read as changed while the villa showed the old value. Here the
// controls read `view`, which is the live config with only the values being
// typed laid over it, and Discard clears those.
//
// ⚠️ THE SLICE'S KEYS ARE THE ONLY KEYS `set` ACCEPTS. A control that writes
// a key not in the list is a type error — the key would otherwise be
// silently un-revertable (Discard restores its siblings and leaves it).

import { useState } from "react";
import type { AppConfig } from "@/config/AppConfig";
import { useConfig } from "@/config/ConfigContext";
import { useDraftCommit } from "./useDraftCommit";
import { draftedView, sliceChanged, sliceOf, type Slice } from "@/config/configSlice";

export interface DraftedSlice<K extends keyof AppConfig> {
  /** What every control renders from. */
  view: Slice<K>;
  /** Change values. By default shown at once and written after `delayMs` of
   *  quiet (a slider drag is one write); `now` writes at once (a toggle).
   *  `stored` is what to write when it differs from what to show (a title
   *  shown as typed, stored trimmed). */
  set: (shown: Partial<Slice<K>>, opts?: { now?: boolean; stored?: Partial<Slice<K>> }) => void;
  /** Anything changed since the dialog opened (or was last saved). */
  dirty: boolean;
  /** Keep the changes: write what is waiting, and make this the baseline. */
  save: () => void;
  /** Put the baseline back — written, so the scene follows — and return it,
   *  for the caller to re-apply anything it drives directly. */
  discard: () => Slice<K>;
  /** Write what is waiting now (before closing). */
  flush: () => void;
}

const DRAFT = "slice";

export function useDraftedSlice<K extends keyof AppConfig>(keys: readonly K[], delayMs = 500): DraftedSlice<K> {
  const { config, update } = useConfig();
  const pending = useDraftCommit<Partial<AppConfig>>((_key, patch) => update(patch), delayMs);
  // Captured once, on open — `useState`'s initialiser, not a live read — so a
  // change while the dialog is open moves `dirty` rather than the thing dirty
  // is measured against.
  const [baseline, setBaseline] = useState<Slice<K>>(() => sliceOf(config, keys));
  const [typing, setTyping] = useState<Partial<Slice<K>>>({});
  const waiting = pending.drafts[DRAFT];

  return {
    view: draftedView(config, keys, typing),
    set: (shown, opts = {}) => {
      const stored = { ...shown, ...opts.stored };
      if (opts.now) {
        // Nothing to lay over the config: it is written at once. Drop any
        // typed value of the same keys so the view follows the config.
        setTyping((t) => {
          const next = { ...t };
          for (const k of Object.keys(shown)) delete next[k as K];
          return next;
        });
        update(stored);
        return;
      }
      setTyping((t) => ({ ...t, ...shown }));
      pending.draft(DRAFT, { ...waiting, ...stored });
    },
    dirty: sliceChanged(config, keys, baseline, waiting !== undefined),
    save: () => {
      pending.flush(DRAFT);
      setBaseline(sliceOf({ ...config, ...waiting } as AppConfig, keys));
    },
    discard: () => {
      pending.cancel(DRAFT);
      setTyping({});
      update(baseline);
      return baseline;
    },
    flush: () => pending.flush(DRAFT),
  };
}
