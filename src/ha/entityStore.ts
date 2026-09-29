// src/ha/entityStore.ts
// THE live picture of Home Assistant, as a plain module: every entity's
// state, where each one is (areas, floors, devices, hidden ones), the
// connection, and the imperative path the 3D map repaints from.
//
// It lived inside the React provider (HAStateStore.tsx) until 2.496.226,
// where its ordering rules — subscribe BEFORE reading the states, re-read the
// states and the registry once on every (re)connect, push only what changed
// on a reconnect, coalesce registry bursts — could only be pinned by regexes
// on source order. Here the fake socket drives them by value
// (tests/oracles/entity_store.mjs); HAStateStore is now a thin adapter that
// hands this store's state to React.

import { PushBatch } from "@/utils/pushBatch";
import { HAWebSocket, type ConnectionState } from "./HAWebSocket";
import { devLog } from "@/utils/devLog";
import { report as reportTelemetry } from "@/utils/telemetry";
import { hasBootMark } from "@/utils/bootTimeline";
import { placesAfterRefresh, entityRegistryFacts } from "./registryResolve";
import type { HassEntity, HassServiceTarget } from "@/types/ha.types";
import type { ServiceOutcome } from "./serviceOutcome";

/** Subset of HA's `get_config` we use to auto-fill onboarding (location + name). */
export interface HAConfig {
  latitude: number;
  longitude: number;
  location_name: string;
  /** Home Assistant's units — every climate/temperature state is in these. */
  unit_system?: { temperature?: string };
  /** The currency set in Home Assistant (Settings → System → General) —
   *  every Facility money figure is written in it (fm/fmTypes.fmTerms). */
  currency?: string;
}

/** What React renders from. Replaced whole on every change (never mutated),
 *  so a reference comparison says whether anything moved. */
export interface EntityStoreState {
  entities: Record<string, HassEntity>;
  suppressedEntityIds: Set<string>;
  hiddenInHaEntityIds: Set<string>;
  entityAreaNames: Record<string, string>;
  entityFloorNumbers: Record<string, number>;
  entityDeviceIds: Record<string, string>;
  connection: ConnectionState;
  haConfig: HAConfig | null;
  lastError: string | null;
  /** Wrapped in an object so firing the SAME error twice still re-triggers. */
  serviceError: { message: string; at: number } | null;
}

type EntityCallback = (entity: HassEntity) => void;

interface StateChangedEvent {
  event_type: string;
  data: { entity_id: string; new_state: HassEntity | null; old_state: HassEntity | null };
}

export interface EntityStoreOptions {
  /** How long React may lag the socket. Four drains a second is faster than
   *  anyone reads a panel; the badges do not wait at all (notify). */
  pushWindowMs?: number;
  /** How long to wait for a burst of registry-change events to finish before
   *  refetching. One device edit in HA touches the entity, device and area
   *  registries within milliseconds of each other, and an integration reload
   *  emits a long run of them; only the last event's answer matters. */
  registryDebounceMs?: number;
}

const REGISTRY_EVENTS = ["entity_registry_updated", "device_registry_updated", "area_registry_updated", "floor_registry_updated"];

export class EntityStore {
  readonly ws: HAWebSocket;
  private state: EntityStoreState = {
    entities: {}, suppressedEntityIds: new Set(), hiddenInHaEntityIds: new Set(),
    entityAreaNames: {}, entityFloorNumbers: {}, entityDeviceIds: {},
    connection: "disconnected", haConfig: null, lastError: null, serviceError: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly perEntity = new Map<string, Set<EntityCallback>>();
  private readonly allSubs = new Set<EntityCallback>();
  private readonly batch: PushBatch<HassEntity>;
  private readonly registryDebounceMs: number;
  private registryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Settles once connect()'s subscriptions are registered — what the
   *  on-connected pass waits for, so the states are read AFTER the
   *  subscription and no change can fall between them. */
  private subscribed: Promise<void> = Promise.resolve();

  constructor(ws: HAWebSocket = new HAWebSocket(), opts: EntityStoreOptions = {}) {
    this.ws = ws;
    this.registryDebounceMs = opts.registryDebounceMs ?? 750;
    // Live events reach React in ONE batch per window — utils/pushBatch.
    this.batch = new PushBatch<HassEntity>(opts.pushWindowMs ?? 250, (drained) => {
      const next = { ...this.state.entities };
      for (const [id, e] of drained) next[id] = e;
      this.set({ entities: next });
    });
  }

  // ── what React reads ─────────────────────────────────────────────────────
  getState = (): EntityStoreState => this.state;
  onChange = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private set(patch: Partial<EntityStoreState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** ALWAYS-current entities: the pending batch laid over the last drained
   *  map, so an imperative reader between two drains is never behind the
   *  socket. */
  snapshot = (): Record<string, HassEntity> => this.batch.overlay(this.state.entities);

  // ── the imperative path into the 3D map (no React render) ────────────────
  subscribe = (entityId: string, cb: EntityCallback): (() => void) => {
    let set = this.perEntity.get(entityId);
    if (!set) { set = new Set(); this.perEntity.set(entityId, set); }
    set.add(cb);
    return () => { set!.delete(cb); };
  };
  subscribeAll = (cb: EntityCallback): (() => void) => {
    this.allSubs.add(cb);
    return () => { this.allSubs.delete(cb); };
  };
  private notify(entity: HassEntity): void {
    this.perEntity.get(entity.entity_id)?.forEach((cb) => cb(entity));
    this.allSubs.forEach((cb) => cb(entity));
  }

  callService = (
    domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget,
  ): Promise<ServiceOutcome> => this.ws.callService(domain, service, data ?? {}, target);

  // ── the socket ───────────────────────────────────────────────────────────
  /** Listen to the socket. Returns the undo. Separate from the constructor so
   *  a React adapter can attach in an effect and detach in its cleanup. */
  attach(): () => void {
    this.ws.onStateChange = (connection) => {
      this.set({ connection });
      // ── EVERY (RE)CONNECT, ONE PASS (round 10, 2.496.160) ────────────────
      // States, config and registry, after the subscriptions are in place:
      // HAWebSocket re-sends them itself right after reporting "connected"
      // on a reconnect, and the pass's first step waits a turn for that (and
      // for connect()'s own on the first connect).
      if (connection === "connected") void this.onConnected();
    };
    this.ws.onServiceError = (err) => this.set({ serviceError: { message: err.message, at: Date.now() } });
    return () => {
      this.ws.onStateChange = () => {};
      this.ws.onServiceError = () => {};
    };
  }

  /** Close the socket and every timer — the provider's final teardown. */
  dispose(): void {
    this.batch.dispose();
    clearTimeout(this.registryTimer);
    this.ws.disconnect();
  }

  /** Open the token-less connection to HA through the add-on's proxy. */
  connect = async (): Promise<void> => {
    this.set({ lastError: null });
    let done: () => void = () => {};
    this.subscribed = new Promise<void>((r) => { done = r; });
    try {
      await this.ws.connect();
      await this.ws.subscribeEvents("state_changed", (event) => {
        const ns = (event as StateChangedEvent).data?.new_state;
        if (!ns) return;
        this.batch.push(ns);   // React, once per window
        this.notify(ns);       // the 3D layer, now
      });
      // A rename, a new Area assignment, a device moved between areas —
      // every kiosk session follows the moment HA reports it. COALESCED:
      // each refresh is a full entity-registry fetch (1,582 rows on a real
      // villa) and HA emits these in bursts (field telemetry: ~25 refetches
      // in 33 minutes, twice within one second).
      const onRegistryChanged = () => {
        clearTimeout(this.registryTimer);
        this.registryTimer = setTimeout(() => { void this.refreshRegistry(); }, this.registryDebounceMs);
      };
      for (const eventType of REGISTRY_EVENTS) {
        this.ws.subscribeEvents(eventType, onRegistryChanged)
          .catch((err) => devLog(`[HA] subscribe ${eventType} failed`, err));
      }
    } catch (err) {
      this.set({ lastError: (err as Error).message });
      throw err;
    } finally {
      done();
    }
  };

  private async onConnected(): Promise<void> {
    await this.subscribed;
    await this.hydrate().catch(() => {});
    this.ws.sendMessage<HAConfig>("get_config")
      .then((haConfig) => this.set({ haConfig }))
      .catch((err) => devLog("[HA] get_config failed (onboarding auto-fill skipped)", err));
    void this.refreshRegistry();
  }

  /**
   * Read every state and push to the 3D map only what CHANGED (2.202.0).
   *
   * Runs on the first connect and on every reconnect. On the first, every
   * entity is new; on a reconnect almost nothing moved — a kiosk whose socket
   * dropped every ~17 minutes overnight replayed 1,074 entities through a full
   * scene repaint each time. `last_updated`, not `last_changed`: HA bumps it
   * on an attributes-only change too (brightness, a track), which subscribers
   * do render.
   */
  private async hydrate(): Promise<void> {
    // Timed: this runs BEFORE login, while the profile picker is on screen,
    // and `states` is the whole HA install, not just the villa's devices.
    const t0 = performance.now();
    const all = await this.ws.getStates();
    const tFetched = performance.now();
    const prev = this.state.entities;
    const map: Record<string, HassEntity> = {};
    for (const e of all) map[e.entity_id] = e;
    // A full fetch supersedes anything still batched (it is at least as new).
    this.batch.dispose();
    this.set({ entities: map });
    let pushed = 0;
    for (const e of all) {
      const before = prev[e.entity_id];
      if (before && before.state === e.state && before.last_updated === e.last_updated) continue;
      pushed++;
      this.notify(e);
    }
    reportTelemetry("ha-connect", {
      phase: "hydrate", states: all.length, pushed,
      fetchMs: Math.round(tFetched - t0),
      applyMs: Math.round(performance.now() - tFetched),
      preLogin: !hasBootMark("scene"),
    });
  }

  /**
   * Registry-only data (get_states never reports hidden_by/entity_category/
   * area_id) — best effort: a profile without registry read access just sees
   * nothing filtered. The device/area/floor registries are separate steps, so
   * one that fails keeps what it had (placesAfterRefresh; one failed area
   * fetch used to blank every room name).
   */
  private async refreshRegistry(): Promise<void> {
    try {
      const tReg = performance.now();
      const rows = await this.ws.getEntityRegistry();
      reportTelemetry("ha-connect", {
        phase: "registry", rows: rows.length,
        ms: Math.round(performance.now() - tReg), preLogin: !hasBootMark("scene"),
      });
      const facts = entityRegistryFacts(rows);
      this.set({
        suppressedEntityIds: facts.suppressed,
        hiddenInHaEntityIds: facts.hiddenInHa,
        entityDeviceIds: facts.deviceIds,
      });
      const failed = () => null;
      const [devices, areas, floors] = await Promise.all([
        this.ws.getDeviceRegistry().catch(failed),
        this.ws.getAreaRegistry().catch(failed),
        this.ws.getFloorRegistry().catch(failed),
      ]);
      const prev = { areaNames: this.state.entityAreaNames, floorNumbers: this.state.entityFloorNumbers };
      const places = placesAfterRefresh(prev, rows, { devices, areas, floors });
      if (places === prev) return;
      this.set({ entityAreaNames: places.areaNames, entityFloorNumbers: places.floorNumbers });
    } catch (err) {
      devLog("[HA] entity_registry/list failed (hidden filter + area names skipped)", err);
    }
  }
}
