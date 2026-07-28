// src/config/DeviceConfigSync.tsx
// Keeps this client's DEVICE configuration (entity/mesh bindings, per-device
// metadata, rooms, device groups — see deviceConfig.ts for the exact slice) in
// sync with the add-on's shared server store, so configuring a device in
// Advanced Settings on one client configures it for every client, the same way
// the uploaded GLB is already shared.
//
// Renders nothing: the config itself already flows through ConfigContext, so
// there is no new state to expose — this only reconciles it. (Contrast
// ScenesProvider, which is a real provider because it exposes scenes/setScenes.)
//
// The server is authoritative, with two ordering rules that make it safe:
//
//   1. PULL BEFORE PUSH. A push is only ever emitted after the first pull has
//      completed (`hydrated`). This is what stops the dangerous race: the app
//      auto-detects entities from the GLB and writes them into entityMap on
//      model load, so without this ordering a client could push a bare
//      freshly-detected map and wipe the owner's carefully-edited labels,
//      rooms and links for everyone.
//
//   2. PUSH ONLY REAL CHANGES. A pull writes the server's own data into
//      config, which would otherwise immediately read as a local edit worth
//      pushing — an endless round-trip. Every push and every pull records what
//      the server is known to hold; we only send when the local slice actually
//      differs from that.
//
// Writes are owner-only (the server 403s anything else, and we skip the
// request entirely for other roles) — shared state is exactly what a guest
// must not be able to rewrite for the whole house.

import { useCallback, useEffect, useRef } from "react";
import { useConfig } from "./ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import {
  fetchSharedConfig, saveSharedConfig, pickSharedConfig, sharedConfigEquals,
  type SharedDeviceConfig,
} from "./deviceConfig";

/** Debounce for outbound writes. Advanced Settings edits arrive in bursts (a
 *  label typed character by character already debounces at 500ms upstream via
 *  useDraftCommit, but a room/type change is immediate) — coalesce them into
 *  one PUT rather than one per keystroke. */
const PUSH_DEBOUNCE_MS = 900;

export default function DeviceConfigSync() {
  const { config, update } = useConfig();
  const { role } = useProfile();

  const local = pickSharedConfig(config);
  // Read the latest local slice without making the callbacks depend on it
  // (which would re-register the focus listener on every single config edit).
  const localRef = useRef(local);
  localRef.current = local;

  /** What the server is known to hold — the baseline both rules above compare
   *  against. null until the first successful pull. */
  const serverRef = useRef<SharedDeviceConfig | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pull = useCallback(async () => {
    const server = await fetchSharedConfig();
    if (server === null) return; // couldn't reach it — keep what we have
    const keys = Object.keys(server);
    if (keys.length === 0) {
      // Nothing stored yet (fresh install, or first run after upgrading from
      // the localStorage-only versions). Seed the store from whatever THIS
      // device already has rather than letting an empty pull blank it — the
      // same first-run migration ScenesProvider does.
      serverRef.current = localRef.current;
      if (role === "owner") void saveSharedConfig(localRef.current);
      return;
    }
    // Server wins for every field it actually carries; fields it omits keep
    // their current local value (an older store, or one written before a field
    // existed, must not blank that field).
    const merged = { ...localRef.current, ...server };
    serverRef.current = merged;
    update(server);
  }, [update, role]);

  // Pull once on mount, then whenever the tab is refocused / becomes visible —
  // so a change made on another client lands here without a reload.
  useEffect(() => {
    void pull();
    const onFocus = () => { void pull(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pull]);

  // Push local edits up, debounced. Gated on BOTH ordering rules above.
  useEffect(() => {
    if (role !== "owner") return;              // non-owners never write
    const known = serverRef.current;
    if (known === null) return;                // rule 1: no pull yet
    if (sharedConfigEquals(local, known)) return; // rule 2: nothing changed

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const next = localRef.current;
      // Record the new baseline BEFORE awaiting: further edits made while the
      // request is in flight must compare against what we're sending, not
      // against the pre-edit state (which would re-send the same payload).
      serverRef.current = next;
      void saveSharedConfig(next).then((ok) => {
        // Failed write — drop the baseline back so the next edit (or the next
        // focus-pull) retries instead of assuming the server has it.
        if (!ok) serverRef.current = known;
      });
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [local, role]);

  return null;
}
