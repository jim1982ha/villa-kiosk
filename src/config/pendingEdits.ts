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
// ⚠️ AND WHAT THE DIALOG SAVES ON THE VILLA ITSELF, NOT IN ITS SETTINGS (owner, 2026-11-06: a chat taken off "Who gets
// the messages" was written to the villa at once while Save stayed grey): such a change is HELD here (`hold`), with no
// pause, and sent by Save only; Cancel drops it like a value being typed. One store, so Save lights for it too.
//
// Pure, no React: hooks/useDraftedSlice subscribes to it (useSyncExternalStore); tests/oracles/dialog_pending.mjs,
// tests/oracles/settings_save.mjs.

import type { AppConfig } from "./AppConfig";
import type { ConfigEdit } from "./mappingEdits";

/** A write, as ConfigContext takes it. */
export type PendingWrite = Partial<AppConfig> | ConfigEdit;

/** A change sent to the villa itself when the dialog is saved (a list of who gets the messages): what went wrong, in
 *  words, or null once it landed. */
export type VillaSend = () => Promise<string | null>;

interface Entry {
  /** What the field shows meanwhile (the text as typed). */
  shown: unknown;
  /** What it writes; null: nothing (a half-typed number) — the field then falls back to the stored value. */
  write: PendingWrite | null;
  /** A held change's send (`hold`): no timer, sent by Save only. */
  send?: VillaSend;
  timer?: ReturnType<typeof setTimeout>;
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
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Moves on every change: what a section reading several of its values subscribes to (usePendingStore). */
  version = 0;

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

  /** A change to send to the villa on Save, shown at once (`shown`): never on a timer, Cancel drops it. */
  hold(key: string, shown: unknown, send: VillaSend): void {
    const was = this.entries.get(key);
    if (was) clearTimeout(was.timer);
    this.entries.set(key, { shown, write: null, send });
    this.changed();
  }

  /** The held changes, in the order they were first made, left in place until each one lands (`forget`). */
  held(): [string, VillaSend][] {
    return [...this.entries].flatMap(([key, e]) => (e.send ? [[key, e.send] as [string, VillaSend]] : []));
  }

  /** `key` waits no more: its held change landed, or it is back to what the villa holds. */
  forget(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    this.entries.delete(key);
    this.changed();
  }

  /** Write `key`'s waiting value now (leaving the field, Enter, a drag released); a held change is sent. */
  commit(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    this.entries.delete(key);
    if (e.write) this.write(e.write);
    if (e.send) void e.send();
    this.changed();
  }

  /** Write every waiting value now: the dialog goes away without Save or Cancel. Its held changes are sent, as every
   *  change of a dialog closed that way is kept. */
  flushAll(): void {
    for (const key of [...this.entries.keys()]) this.commit(key);
  }

  /** Take every value waiting its pause out without writing it, for Save to write as kept (held changes stay: Save
   *  sends them, `held`). */
  take(): PendingWrite[] {
    const writes: PendingWrite[] = [];
    for (const [key, e] of [...this.entries]) {
      if (e.send) continue;
      clearTimeout(e.timer);
      if (e.write) writes.push(e.write);
      this.entries.delete(key);
    }
    this.changed();
    return writes;
  }

  /** Cancel: every waiting value and every held change dropped, timers with them (a timer left would write it back
   *  after the undo). */
  drop(): void {
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
    this.changed();
  }
}
