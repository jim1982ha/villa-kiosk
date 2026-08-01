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
  /** entity_ids kept out of every auto-populated list (SummaryBar tiles,
   *  SummaryGroupPanel) the same way HA's own auto-generated dashboards do:
   *  either the user marked the entity "hidden" (Settings > Entities >
   *  Visible toggle), or HA itself filed it under entity_category
   *  "config"/"diagnostic" (still fully visible on the entity's own HA page —
   *  this only affects the kiosk's own auto-built lists). Empty until the
   *  one-shot registry fetch on connect resolves. */
  suppressedEntityIds: Set<string>;
  /** The subset of suppressedEntityIds suppressed SPECIFICALLY because a user
   *  hid it in HA (registry hidden_by != null) — not merely because HA itself
   *  filed it under entity_category config/diagnostic. Lets a UI surface that
   *  chooses to still show a suppressed-but-mapped entity (see
   *  Dashboard.tsx's category browse) mark THIS specific reason explicitly
   *  ("Hidden in HA") rather than presenting it as an ordinary device with no
   *  indication the user made a deliberate choice about it elsewhere. */
  hiddenInHaEntityIds: Set<string>;
  /** entity_id -> HA's own Area name (this entity's registry row, falling
   *  back to its device's), resolved once from the registry fetch on
   *  connect. Empty until that resolves, and empty for any entity HA has no
   *  area assigned to — always this installation's live data, a room-name
   *  SIGNAL to suggest/cross-check against, never authoritative on its own
   *  (see roomForEntity's geometric room-polygon test, which wins when it
   *  has an answer). */
  entityAreaNames: Record<string, string>;
  /** entity_id -> HA's own device_id (from the entity registry) — the
   *  authoritative "these entities belong to the same physical device"
   *  signal, used to suggest device groups (see config/deviceGroups.ts)
   *  without guessing from entity_id naming conventions. Empty until the
   *  registry fetch resolves; entities with no device behind them (helpers,
   *  templates) are simply absent as keys. */
  entityDeviceIds: Record<string, string>;
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
  const [suppressedEntityIds, setSuppressedEntityIds] = useState<Set<string>>(new Set());
  const [hiddenInHaEntityIds, setHiddenInHaEntityIds] = useState<Set<string>>(new Set());
  const [entityAreaNames, setEntityAreaNames] = useState<Record<string, string>>({});
  const [entityDeviceIds, setEntityDeviceIds] = useState<Record<string, string>>({});
  // Mirrors `entities` synchronously (no extra render/effect lag) so
  // getEntitiesSnapshot() below is never stale — see its docstring.
  const entitiesRef = useRef<Record<string, HassEntity>>({});
  const setEntities = useCallback((next: Record<string, HassEntity> | ((prev: Record<string, HassEntity>) => Record<string, HassEntity>)) => {
    setEntitiesState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      entitiesRef.current = value;
      return value;
    });
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
    setEntities(map);
    // Push initial values to imperative subscribers (scene paints correct state).
    for (const e of all) notify(e);
  }, [ws, notify]);

  const connect = useCallback(
    async () => {
      setLastError(null);
      try {
        await ws.connect();
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
          .catch((err) => devLog("[HA] get_config failed (onboarding auto-fill skipped)", err));
        // Registry-only data (get_states never reports hidden_by/entity_category/
        // area_id) — best effort: a profile without registry read access just
        // sees nothing filtered/suggested, same as before this existed.
        ws.getEntityRegistry()
          .then(async (rows) => {
            setSuppressedEntityIds(new Set(
              rows
                .filter((r) => r.hidden_by != null || r.entity_category === "config" || r.entity_category === "diagnostic")
                .map((r) => r.entity_id),
            ));
            setHiddenInHaEntityIds(new Set(
              rows.filter((r) => r.hidden_by != null).map((r) => r.entity_id),
            ));
            // device_id sits directly on the entity registry row — no extra
            // fetch needed, and it works even when the device/area registry
            // calls below fail (a profile that can read entities but not
            // devices still gets this). The authoritative "these entities are
            // really one physical device" signal — see suggestDeviceGroups.
            const deviceIds: Record<string, string> = {};
            for (const r of rows) if (r.device_id) deviceIds[r.entity_id] = r.device_id;
            setEntityDeviceIds(deviceIds);
            // Resolve each entity's Area NAME: its own area_id, falling back to
            // its device's (HA's own inheritance rule — most entities carry no
            // area_id of their own and get it from the device they belong to).
            // Both registry fetches are separate best-effort steps so a profile
            // that can read entities but not devices/areas still gets whatever
            // resolves rather than losing the whole feature.
            const [devices, areas] = await Promise.all([
              ws.getDeviceRegistry().catch(() => []),
              ws.getAreaRegistry().catch(() => []),
            ]);
            if (devices.length === 0 && areas.length === 0) return;
            const areaNameById = new Map(areas.map((a) => [a.area_id, a.name]));
            const deviceAreaById = new Map(devices.map((d) => [d.id, d.area_id]));
            const resolved: Record<string, string> = {};
            for (const r of rows) {
              const areaId = r.area_id ?? (r.device_id ? deviceAreaById.get(r.device_id) : null);
              const name = areaId ? areaNameById.get(areaId) : null;
              if (name) resolved[r.entity_id] = name;
            }
            setEntityAreaNames(resolved);
          })
          .catch((err) => devLog("[HA] entity_registry/list failed (hidden filter + area names skipped)", err));
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
      suppressedEntityIds,
      hiddenInHaEntityIds,
      entityAreaNames,
      entityDeviceIds,
      getEntitiesSnapshot,
      connection,
      connected: connection === "connected",
      haConfig,
      ws,
      subscribe,
      subscribeAll,
      callService,
      connect,
      lastError,
      serviceError,
    }),
    [entities, suppressedEntityIds, hiddenInHaEntityIds, entityAreaNames, entityDeviceIds, getEntitiesSnapshot, connection, haConfig, ws, subscribe, subscribeAll, callService, connect, lastError, serviceError],
  );

  return <HAStateContext.Provider value={value}>{children}</HAStateContext.Provider>;
}

export function useHA(): HAStateContextType {
  const ctx = useContext(HAStateContext);
  if (!ctx) throw new Error("useHA must be used within HAStateProvider");
  return ctx;
}
