// src/utils/pushBatch.ts
// Live Home Assistant state events, batched for React.
//
// ⚠️ ONE OBJECT SPREAD AND ONE FULL RE-RENDER PER EVENT (2.496.197). The state
// store did `setEntities((prev) => ({ ...prev, [id]: ns }))` for every
// `state_changed` — several a second in a villa this size — and `entities`
// is the context value every useHA() reader keys on, so each event re-ran
// villaDevices (twice), the summary tiles, the villa summary, the weather
// station search and the attention list. The reconnect path had been diffed
// and instrumented for exactly this reason; the live path never was.
//
// The 3D layer is NOT behind this: badges, lights and fans take each event
// synchronously through the store's imperative `notify`. Only what React
// renders waits, and it waits at most `windowMs`.
//
// Pure: the store gives it a clock and a scheduler, so the rule ("the newest
// state per entity, drained once per window") is driven by value.

export class PushBatch<T extends { entity_id: string }> {
  private readonly pending = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly drain: (batch: ReadonlyMap<string, T>) => void;
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (t: ReturnType<typeof setTimeout>) => void;

  // No parameter properties: Node's type stripping (the oracles) refuses them.
  constructor(
    windowMs: number,
    drain: (batch: ReadonlyMap<string, T>) => void,
    schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    cancel: (t: ReturnType<typeof setTimeout>) => void = clearTimeout,
  ) {
    this.windowMs = windowMs; this.drain = drain; this.schedule = schedule; this.cancel = cancel;
  }

  /** Take an event. The newest state per entity wins within a window; the
   *  first event of a window arms the drain. */
  push(state: T): void {
    this.pending.set(state.entity_id, state);
    if (this.timer === null) this.timer = this.schedule(() => this.flush(), this.windowMs);
  }

  /** The window's drain. */
  private flush(): void {
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null; }
    if (this.pending.size === 0) return;
    const batch = new Map(this.pending);
    this.pending.clear();
    this.drain(batch);
  }

  /** Forget what is pending without draining (the store is being disposed). */
  dispose(): void {
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null; }
    this.pending.clear();
  }

  get size(): number { return this.pending.size; }

  /** `base` with the pending states laid over it — what an imperative reader
   *  (a badge being built between two drains) must see. Allocates only while
   *  something is pending. */
  overlay(base: Record<string, T>): Record<string, T> {
    if (this.pending.size === 0) return base;
    return { ...base, ...Object.fromEntries(this.pending) };
  }
}
