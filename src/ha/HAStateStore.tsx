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
import type { HAWebSocket } from "./HAWebSocket";
import { EntityStore, type EntityStoreState, type HAConfig } from "./entityStore";
import type { HassEntity, HassServiceTarget } from "@/types/ha.types";
import type { ServiceOutcome } from "./serviceOutcome";

export type { HAConfig };

type EntityCallback = (entity: HassEntity) => void;

/** Everything the store's state carries (EntityStoreState — its fields are
 *  documented there, once: this interface restated all of them until
 *  2.496.263), plus the store's imperative handles. */
interface HAStateContextType extends EntityStoreState {
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
  connected: boolean;
  ws: HAWebSocket;
  /** Imperative subscribe used by Babylon EntityVisuals; returns unsubscribe. */
  subscribe: (entityId: string, cb: EntityCallback) => () => void;
  /** Subscribe to *every* state change (used to drive the scene + alerts). */
  subscribeAll: (cb: (entity: HassEntity) => void) => () => void;
  /** Resolves with what the command came to, never rejects (serviceOutcome.ts). */
  callService: (domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget) => Promise<ServiceOutcome>;
  /** Open the token-less connection to HA through the add-on's Supervisor proxy. */
  connect: () => Promise<void>;
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
      ...state,
      getEntitiesSnapshot: store.snapshot,
      connected: state.connection === "connected",
      ws: store.ws,
      subscribe: store.subscribe,
      subscribeAll: store.subscribeAll,
      callService: store.callService,
      connect: store.connect,
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
