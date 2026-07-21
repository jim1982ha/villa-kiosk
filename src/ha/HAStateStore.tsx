// src/ha/HAStateStore.tsx
// Single source of truth for entity states. React UI reads from Context; the
// Babylon scene registers imperative callbacks here (NOT React re-renders) so
// the 3D canvas never re-renders on a state_changed event. (Key 3Dash pattern.)

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { HAWebSocket, type ConnectionState } from "./HAWebSocket";
import { devLog } from "@/utils/devLog";
import type { HassEntity, HassServiceTarget } from "@/types/ha.types";

type EntityCallback = (entity: HassEntity) => void;

/** Subset of HA's `get_config` we use to auto-fill onboarding (location + name). */
export interface HAConfig {
  latitude: number;
  longitude: number;
  location_name: string;
}

interface HAStateContextType {
  entities: Record<string, HassEntity>;
  /**
   * Imperative, ALWAYS-current read of `entities` — for the rare caller that
   * needs the latest snapshot at some later moment rather than reacting to
   * every change. `entities` itself is fine for normal rendering, but a
   * one-shot effect with an empty (or otherwise stable) dependency array
   * closes over whatever `entities` WAS at the render that effect was created
   * from — typically `{}`, since the initial HA hydrate is an async
   * round-trip that hasn't resolved yet at mount. That's exactly the bug this
   * fixed: BabylonCanvas's "paint the villa with whatever's already known"
   * step ran once, using a permanently-empty entities snapshot, so every
   * badge/mesh sat at its default visual until HA happened to send THAT
   * specific entity's next live state_changed event — invisible for a
   * frequently-updating entity, but leaving a slow-to-report one (a BLE
   * weather station reporting every 10–20 min, say) showing stale/default
   * state — including its icon — for a long time after the villa loaded.
   */
  getEntitiesSnapshot: () => Record<string, HassEntity>;
  connection: ConnectionState;
  connected: boolean;
  /** HA instance config (location + name), fetched on connect. Null until then. */
  haConfig: HAConfig | null;
  ws: HAWebSocket;
  /** Imperative subscribe used by Babylon EntityVisuals; returns unsubscribe. */
  subscribe: (entityId: string, cb: EntityCallback) => () => void;
  /** Subscribe to *every* state change (used to drive the scene + alerts). */
  subscribeAll: (cb: (entity: HassEntity) => void) => () => void;
  callService: (domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget) => Promise<void>;
  /** Optimistically overwrite an entity's state locally and notify subscribers
   *  IMMEDIATELY, without waiting for HA's round-trip echo — so a tapped light
   *  flips the instant you touch it. HA's real state_changed event then arrives
   *  and reconciles (normally identical). Returns undefined; no-op if the entity
   *  isn't known yet. Attribute patch is optional (e.g. leave brightness alone). */
  optimistic: (entityId: string, state: string, attrs?: Record<string, unknown>) => void;
  /** Open the token-less connection to HA through the add-on's Supervisor proxy. */
  connect: () => Promise<void>;
  lastError: string | null;
  /** Most recent failed service call (tap did nothing) — shown as a toast.
   *  Wrapped in an object so firing the SAME error twice still re-triggers. */
  serviceError: { message: string; at: number } | null;
}

const HAStateContext = createContext<HAStateContextType | null>(null);

interface StateChangedEvent {
  event_type: string;
  data: { entity_id: string; new_state: HassEntity | null; old_state: HassEntity | null };
}

export function HAStateProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<HAWebSocket>();
  if (!wsRef.current) wsRef.current = new HAWebSocket();
  const ws = wsRef.current;

  const [entities, setEntitiesState] = useState<Record<string, HassEntity>>({});
  // Mirrors `entities` for getEntitiesSnapshot() below — MUST be written
  // synchronously and unconditionally at the call site, never inside a React
  // state UPDATER function. React does not guarantee an updater passed to
  // setState runs before the setState call returns (it's queued for the next
  // render, which for a plain DOM/pointer-driven call — exactly how a map tap
  // arrives here — can land a task or more later). The bug this fixes: two
  // taps close together (e.g. ON then OFF) each call optimistic() below; if
  // the SECOND tap's getEntitiesSnapshot() read the ref before React had
  // flushed the FIRST tap's updater, it saw the pre-tap state, computed the
  // toggle in the WRONG direction (a silent no-op), and the light only
  // caught up once Home Assistant's real echo eventually arrived — exactly
  // the "OFF right after ON feels laggy" symptom. commitEntities below is the
  // ONLY writer of entitiesRef, and it writes the ref BEFORE calling
  // setEntitiesState, so a read immediately after (even from the very next
  // synchronous call) is always correct.
  const entitiesRef = useRef<Record<string, HassEntity>>({});
  const commitEntities = useCallback((next: Record<string, HassEntity>) => {
    entitiesRef.current = next;
    setEntitiesState(next);
  }, []);
  const getEntitiesSnapshot = useCallback(() => entitiesRef.current, []);
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [haConfig, setHaConfig] = useState<HAConfig | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<{ message: string; at: number } | null>(null);

  // Imperative subscriber registries (don't trigger React renders).
  const perEntity = useRef(new Map<string, Set<EntityCallback>>());
  const allSubs = useRef(new Set<(e: HassEntity) => void>());

  const notify = useCallback((entity: HassEntity) => {
    perEntity.current.get(entity.entity_id)?.forEach((cb) => cb(entity));
    allSubs.current.forEach((cb) => cb(entity));
  }, []);

  useEffect(() => {
    ws.onStateChange = setConnection;
    ws.onServiceError = (err) => setServiceError({ message: err.message, at: Date.now() });
    return () => {
      ws.onStateChange = () => {};
      ws.onServiceError = () => {};
    };
  }, [ws]);

  // Fully tear the socket down if this provider ever unmounts (it lives at the
  // app root, so normally only on a real teardown) — closes the socket and
  // clears its reconnect/heartbeat timers + the document/window listeners its
  // constructor registered, none of which React can reclaim on its own.
  useEffect(() => () => ws.disconnect(), [ws]);

  const hydrate = useCallback(async () => {
    const all = await ws.getStates();
    const map: Record<string, HassEntity> = {};
    for (const e of all) map[e.entity_id] = e;
    commitEntities(map);
    // Push initial values to imperative subscribers (scene paints correct state).
    for (const e of all) notify(e);
  }, [ws, notify, commitEntities]);

  const connect = useCallback(
    async () => {
      setLastError(null);
      try {
        await ws.connect();
        await ws.subscribeEvents("state_changed", (event) => {
          const { data } = event as StateChangedEvent;
          if (!data?.new_state) return;
          const ns = data.new_state;
          commitEntities({ ...entitiesRef.current, [ns.entity_id]: ns });
          notify(ns);
        });
        await hydrate();
        // Pull the instance's location + name so onboarding can auto-fill the
        // map coordinates and the dashboard title without manual entry.
        ws.sendMessage<HAConfig>("get_config")
          .then((cfg) => setHaConfig(cfg))
          .catch((err) => devLog("[HA] get_config failed (onboarding auto-fill skipped)", err));
      } catch (err) {
        const msg = (err as Error).message;
        setLastError(msg);
        throw err;
      }
    },
    [ws, hydrate, notify, commitEntities],
  );

  // Re-hydrate after an automatic reconnect.
  useEffect(() => {
    if (connection === "connected") hydrate().catch(() => {});
  }, [connection, hydrate]);

  const subscribe = useCallback((entityId: string, cb: EntityCallback) => {
    let set = perEntity.current.get(entityId);
    if (!set) {
      set = new Set();
      perEntity.current.set(entityId, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }, []);

  const subscribeAll = useCallback((cb: (e: HassEntity) => void) => {
    allSubs.current.add(cb);
    return () => allSubs.current.delete(cb);
  }, []);

  const callService = useCallback(
    (domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget) =>
      ws.callService(domain, service, data ?? {}, target),
    [ws],
  );

  const optimistic = useCallback((entityId: string, state: string, attrs?: Record<string, unknown>) => {
    // Reads entitiesRef.current DIRECTLY — always the true latest value (see
    // commitEntities' docstring) — so back-to-back calls (a fast ON then OFF
    // tap) each see the OTHER's result, never a stale pre-tap snapshot.
    const cur = entitiesRef.current[entityId];
    if (!cur) return;
    const next: HassEntity = {
      ...cur,
      state,
      attributes: attrs ? { ...cur.attributes, ...attrs } : cur.attributes,
      last_changed: new Date().toISOString(),
    };
    commitEntities({ ...entitiesRef.current, [entityId]: next });
    notify(next); // drive the imperative scene subscribers (badges + 3D visuals)
  }, [notify, commitEntities]);

  const value = useMemo<HAStateContextType>(
    () => ({
      entities,
      getEntitiesSnapshot,
      connection,
      connected: connection === "connected",
      haConfig,
      ws,
      subscribe,
      subscribeAll,
      callService,
      optimistic,
      connect,
      lastError,
      serviceError,
    }),
    [entities, getEntitiesSnapshot, connection, haConfig, ws, subscribe, subscribeAll, callService, optimistic, connect, lastError, serviceError],
  );

  return <HAStateContext.Provider value={value}>{children}</HAStateContext.Provider>;
}

export function useHA(): HAStateContextType {
  const ctx = useContext(HAStateContext);
  if (!ctx) throw new Error("useHA must be used within HAStateProvider");
  return ctx;
}
