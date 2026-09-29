// src/ha/HAStateStore.tsx
// Hands the live Home Assistant picture (ha/entityStore.ts) to React. The
// store itself — the socket, the batching, the reconnect ordering, the
// imperative path the 3D canvas repaints from without a React render (the
// Key 3Dash pattern) — is a plain module; this is only its adapter, and the
// context shape every screen reads through useHA() is unchanged.

import {
  createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore,
  type ReactNode,
} from "react";
import type { HAWebSocket, ConnectionState } from "./HAWebSocket";
import { EntityStore, type HAConfig } from "./entityStore";
import type { HassEntity, HassServiceTarget } from "@/types/ha.types";
import type { ServiceOutcome } from "./serviceOutcome";

export type { HAConfig };

type EntityCallback = (entity: HassEntity) => void;

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
   *  back to its device's) — LIVE: re-resolved on connect and again every
   *  time HA reports an entity/device/area registry change (see the
   *  `*_registry_updated` subscriptions below), so renaming or assigning a
   *  device's Area in Home Assistant reaches every kiosk session without a
   *  reload. Empty for any entity HA has no area assigned to. This is now
   *  the AUTHORITATIVE room source for a device (see config/EntityMap.ts's
   *  resolveEntityRoom) — geometric room-polygon detection is the fallback
   *  for whatever this doesn't cover, not the other way around. */
  entityAreaNames: Record<string, string>;
  /** entity_id -> HA's own Floor NUMBER (via the entity's resolved Area's
   *  floor_id — see HassAreaRegistryEntry/HassFloorRegistryEntry), live the
   *  same way entityAreaNames is. Absent for any entity whose Area has no
   *  Floor assigned (or that resolves to no Area at all) — see
   *  cockpitData.ts's buildRoomGroups for the geometric (sh3dRooms) fallback
   *  this feeds into, same precedence as room resolution itself. */
  entityFloorNumbers: Record<string, number>;
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
  /** Resolves with what the command came to, never rejects (serviceOutcome.ts). */
  callService: (domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget) => Promise<ServiceOutcome>;
  /** Open the token-less connection to HA through the add-on's Supervisor proxy. */
  connect: () => Promise<void>;
  lastError: string | null;
  /** Most recent failed service call (tap did nothing) — shown as a toast.
   *  Wrapped in an object so firing the SAME error twice still re-triggers. */
  serviceError: { message: string; at: number } | null;
}

const HAStateContext = createContext<HAStateContextType | null>(null);

export function HAStateProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<EntityStore>();
  if (!storeRef.current) storeRef.current = new EntityStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.onChange, store.getState);

  useEffect(() => store.attach(), [store]);
  // Fully tear the socket down if this provider ever unmounts (it lives at the
  // app root, so normally only on a real teardown) — the socket, its timers
  // and the listeners its constructor registered, none of which React can
  // reclaim on its own.
  useEffect(() => () => store.dispose(), [store]);

  const value = useMemo<HAStateContextType>(
    () => ({
      entities: state.entities,
      suppressedEntityIds: state.suppressedEntityIds,
      hiddenInHaEntityIds: state.hiddenInHaEntityIds,
      entityAreaNames: state.entityAreaNames,
      entityFloorNumbers: state.entityFloorNumbers,
      entityDeviceIds: state.entityDeviceIds,
      getEntitiesSnapshot: store.snapshot,
      connection: state.connection,
      connected: state.connection === "connected",
      haConfig: state.haConfig,
      ws: store.ws,
      subscribe: store.subscribe,
      subscribeAll: store.subscribeAll,
      callService: store.callService,
      connect: store.connect,
      lastError: state.lastError,
      serviceError: state.serviceError,
    }),
    [state, store],
  );

  return <HAStateContext.Provider value={value}>{children}</HAStateContext.Provider>;
}

export function useHA(): HAStateContextType {
  const ctx = useContext(HAStateContext);
  if (!ctx) throw new Error("useHA must be used within HAStateProvider");
  return ctx;
}
