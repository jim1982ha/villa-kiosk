// src/hooks/useDraftCommit.ts
// Shared "instant local echo, debounced heavy commit" pattern. Every field
// in Advanced Settings / Bindings / Settings that writes into AppConfig used
// to hand-roll its own copy of this (a Record<key, draft> + a
// Record<key, timer>) — see git history on ConfigEditor.tsx/BindingsTable.tsx/
// SettingsModal.tsx. The heavy part they're all protecting against is a full
// Babylon scene structural rebuild (SceneManager.updateConfig, whose own
// docstring covers the OTHER half of this fix — yielding the main thread
// during that rebuild). This hook is the half that avoids triggering one
// per keystroke/click/pixel-of-drag in the first place: type/click/drag
// updates a local draft immediately (so the control never lags behind the
// input), and the real commit — which is what actually pays for the
// rebuild — fires once after a short pause, so a quick run of edits
// coalesces into a single commit.
//
// Use a stable per-item key (an entity ID, a mesh name, or any constant
// string for a single non-keyed field) so concurrent edits to different
// items don't share one timer/draft.

import { useCallback, useEffect, useRef, useState } from "react";

export interface DraftCommit<T> {
  /** Not-yet-committed values, keyed the same way commit()/draft() are. */
  drafts: Record<string, T>;
  /** Update the draft for `key` instantly and (re)start its commit timer —
   *  a further draft() call for the same key before the timer fires resets
   *  it, so a burst of edits coalesces into one commit. */
  draft: (key: string, value: T, delayMs?: number) => void;
  /** Commit `key` right now if it has a pending draft (no-op otherwise). */
  flush: (key: string) => void;
  /** Commit every pending draft right now. */
  flushAll: () => void;
}

const DEFAULT_DELAY_MS = 350;

export function useDraftCommit<T>(
  commit: (key: string, value: T) => void,
  defaultDelayMs = DEFAULT_DELAY_MS,
): DraftCommit<T> {
  const [drafts, setDrafts] = useState<Record<string, T>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Always call the LATEST commit (closes over the latest config/update from
  // the caller's most recent render), not whichever one was in scope when
  // the timer was scheduled — a strict improvement over the per-file copies
  // this replaces, which could apply a stale base if another edit committed
  // elsewhere while this one's timer was still pending.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback((key: string) => {
    clearTimeout(timers.current[key]);
    delete timers.current[key];
    setDrafts((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: value, ...rest } = prev;
      commitRef.current(key, value);
      return rest;
    });
  }, []);

  const flushAll = useCallback(() => {
    for (const key of Object.keys(timers.current)) flush(key);
  }, [flush]);

  const draft = useCallback((key: string, value: T, delayMs = defaultDelayMs) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => flush(key), delayMs);
  }, [defaultDelayMs, flush]);

  // Safety net: commit anything still pending if the component unmounts some
  // other way than an explicit flush (a modal closed via Escape, a parent
  // re-render tearing this row down, etc.).
  useEffect(() => () => flushAll(), [flushAll]);

  return { drafts, draft, flush, flushAll };
}
