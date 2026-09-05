// src/hooks/useRemoteList.ts
//
// The load → busy → act → reload lifecycle every agent panel hand-rolls.
//
// ⚠️ THE SHAPE WAS DUPLICATED AND THE SEMANTICS WERE NOT (2026-09-06), which
// is the part that cost something. Eight panels each declared
// `useState<T[] | null>(null)`, a `load` in `useCallback`, a
// `useEffect(() => { void load(); }, [load])` and a setBusy/await/clear/reload
// sandwich — and then disagreed about what any of it meant:
//
//   * `busy` was `string | null` in six panels, `""` in one (compared with
//     `busy !== ""`), and a plain boolean in two;
//   * the error channel was `error`, or `note`, or ABSENT;
//   * failure was `.catch(() => [])` in some and unguarded in others;
//   * none of the eight had an unmount guard.
//
// ⚠️ THREE STATES, NOT TWO, AND THIS IS THE ONE THAT BIT. `null` means not
// loaded; `[]` means loaded and there is genuinely nothing; `error` means the
// question could not be asked. Collapsing the third into the second is how the
// alert wall came to render an add-on that was down as "No alerts right now".
// A panel that legitimately wants "unreachable reads as empty" gets it by
// catching inside its own fetcher, where a reader can see the decision.
//
// ⚠️ IT IS A HOOK, SO IT STILL NEEDS A RENDERER TO TEST, and this repo has no
// JS test runner. That limit is real and is not being dressed up: what this
// buys is LOCALITY — one answer to "what does busy mean here" instead of
// eight — not testability.

import { useCallback, useEffect, useRef, useState } from "react";

export interface RemoteList<T> {
  /** `null` until the first load settles. */
  rows: T[] | null;
  /** The id of the row currently mid-action, or `""` for a whole-panel
   *  operation, or `null` for idle. ⚠️ ONE CANONICAL SHAPE — the `""`-as-idle
   *  spelling is what made `busy !== ""` necessary in one panel and wrong in
   *  every other. */
  busy: string | null;
  /** Why the last load or action failed, or `null`. */
  error: string | null;
  setError: (message: string | null) => void;
  /** Re-run the fetcher. */
  reload: () => Promise<void>;
  /** Mark `id` busy, run `fn`, clear, then reload. ⚠️ RELOAD LAST AND ALWAYS:
   *  a write whose reload is skipped on failure leaves the panel showing state
   *  the server has already rejected. */
  run: (id: string, fn: () => Promise<unknown>) => Promise<void>;
  /** For the panels that derive extra lists from the same fetch. */
  setRows: (rows: T[] | null) => void;
}

export function useRemoteList<T>(
  fetcher: () => Promise<T[]>,
  deps: unknown[] = [],
): RemoteList<T> {
  const [rows, setRows] = useState<T[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ THE UNMOUNT GUARD NONE OF THE EIGHT HAD. A modal closed while its load
  // is in flight resolves into a component that is gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      if (!alive.current) return;
      setRows(next);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      // ⚠️ THE ROWS ARE LEFT ALONE. A refresh that fails must say so, not
      // blank a list the reader was already looking at.
      setError(e instanceof Error ? e.message : "could not load");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "that did not work");
      }
    } finally {
      if (alive.current) setBusy(null);
    }
    await reload();
  }, [reload]);

  return { rows, busy, error, setError, reload, run, setRows };
}
