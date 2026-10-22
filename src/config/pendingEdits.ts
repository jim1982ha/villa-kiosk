// src/config/pendingEdits.ts
// A dialog's values still being typed: what each field shows, and the write it will make after a pause (a label typed
// key by key is one write, a slider drag is one write). ONE store per dialog draft (hooks/useDraftedSlice), so the
// dialog's Save, Cancel and Back see every one of them (2.496.500).
//
// ⚠️ IT USED TO BE ONE STORE PER FIELD (hooks/useDraftCommit, to 2.496.499). Advanced Settings' coordinates, the days
// records are kept, and a device's label and intensity each held their own: Save stayed grey while one was typed, and
// closing the dialog before the pause dropped the value, because the "commit on unmount" ran inside a React state
// updater that never runs once the field is gone.
//
// Pure, no React: hooks/useDraftedSlice subscribes to it (useSyncExternalStore); tests/oracles/dialog_pending.mjs.

import type { AppConfig } from "./AppConfig";
import type { ConfigEdit } from "./mappingEdits";

/** A write, as ConfigContext takes it. */
export type PendingWrite = Partial<AppConfig> | ConfigEdit;

interface Entry {
  /** What the field shows meanwhile (the text as typed). */
  shown: unknown;
  /** What it writes; null: nothing (a half-typed number) — the field then falls back to the stored value. */
  write: PendingWrite | null;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingEdits {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  /** How a waiting value is written when its pause ends, or on flush (the dialog's own write). */
  write: (w: PendingWrite) => void;

  constructor(write: (w: PendingWrite) => void) {
    this.write = write;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private changed(): void {
    for (const l of this.listeners) l();
  }

  /** How many values are waiting (dirty while any is). */
  get size(): number { return this.entries.size; }

  /** What `key`'s field shows while its value waits; undefined when nothing waits. */
  shown(key: string): unknown { return this.entries.get(key)?.shown; }

  /** The write waiting under `key`, if any. */
  writeOf(key: string): PendingWrite | null | undefined { return this.entries.get(key)?.write; }

  /** A value typed: shown at once, written after `delayMs` of quiet (a further value for the key restarts the wait). */
  stage(key: string, shown: unknown, write: PendingWrite | null, delayMs: number): void {
    const was = this.entries.get(key);
    if (was) clearTimeout(was.timer);
    this.entries.set(key, { shown, write, timer: setTimeout(() => this.commit(key), delayMs) });
    this.changed();
  }

  /** Write `key`'s waiting value now (leaving the field, Enter, a drag released). */
  commit(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    this.entries.delete(key);
    if (e.write) this.write(e.write);
    this.changed();
  }

  /** Write every waiting value now: the dialog closes back (Back) or goes away. */
  flushAll(): void {
    for (const key of [...this.entries.keys()]) this.commit(key);
  }

  /** Take every waiting value out without writing it, for Save to write as kept. */
  take(): PendingWrite[] {
    const writes: PendingWrite[] = [];
    for (const e of this.entries.values()) {
      clearTimeout(e.timer);
      if (e.write) writes.push(e.write);
    }
    this.entries.clear();
    this.changed();
    return writes;
  }

  /** Cancel: every waiting value dropped, its timer with it (a timer left would write it back after the undo). */
  drop(): void {
    this.take();
  }
}
