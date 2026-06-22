// src/ha/HAStateStore.tsx
// Single source of truth for entity states. React UI reads from Context; the
// Babylon scene registers imperative callbacks here (NOT React re-renders) so
// the 3D canvas never re-renders on a state_changed event. (Key 3Dash pattern.)

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { HAWebSocket, type ConnectionState } from "./HAWebSocket";
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
  connect: (url: string, token: string) => Promise<void>;
  lastError: string | null;
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

  const [entities, setEntities] = useState<Record<string, HassEntity>>({});
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [haConfig, setHaConfig] = useState<HAConfig | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Imperative subscriber registries (don't trigger React renders).
  const perEntity = useRef(new Map<string, Set<EntityCallback>>());
  const allSubs = useRef(new Set<(e: HassEntity) => void>());

  const notify = useCallback((entity: HassEntity) => {
    perEntity.current.get(entity.entity_id)?.forEach((cb) => cb(entity));
    allSubs.current.forEach((cb) => cb(entity));
  }, []);

  useEffect(() => {
    ws.onStateChange = setConnection;
    return () => {
      ws.onStateChange = () => {};
    };
  }, [ws]);

  const hydrate = useCallback(async () => {
    const all = await ws.getStates();
    const map: Record<string, HassEntity> = {};
    for (const e of all) map[e.entity_id] = e;
    setEntities(map);
    // Push initial values to imperative subscribers (scene paints correct state).
    for (const e of all) notify(e);
  }, [ws, notify]);

  const connect = useCallback(
    async (url: string, token: string) => {
      setLastError(null);
      try {
        await ws.connect(url, token);
        await ws.subscribeEvents("state_changed", (event) => {
          const { data } = event as StateChangedEvent;
          if (!data?.new_state) return;
          const ns = data.new_state;
          setEntities((prev) => ({ ...prev, [ns.entity_id]: ns }));
          notify(ns);
        });
        await hydrate();
        // Pull the instance's location + name so onboarding can auto-fill the
        // map coordinates and the dashboard title without manual entry.
        ws.sendMessage<HAConfig>("get_config")
          .then((cfg) => setHaConfig(cfg))
          .catch(() => {});
      } catch (err) {
        const msg = (err as Error).message;
        setLastError(msg);
        throw err;
      }
    },
    [ws, hydrate, notify],
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

  const value = useMemo<HAStateContextType>(
    () => ({
      entities,
      connection,
      connected: connection === "connected",
      haConfig,
      ws,
      subscribe,
      subscribeAll,
      callService,
      connect,
      lastError,
    }),
    [entities, connection, haConfig, ws, subscribe, subscribeAll, callService, connect, lastError],
  );

  return <HAStateContext.Provider value={value}>{children}</HAStateContext.Provider>;
}

export function useHA(): HAStateContextType {
  const ctx = useContext(HAStateContext);
  if (!ctx) throw new Error("useHA must be used within HAStateProvider");
  return ctx;
}
