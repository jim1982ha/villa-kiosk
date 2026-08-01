// src/config/DeviceConfigSync.tsx
// Keeps this client's DEVICE configuration (entity/mesh bindings, per-device
// metadata, rooms, device groups — see deviceConfig.ts for the exact slice) in
// sync with the add-on's shared server store, so configuring a device in
// Advanced Settings on one client configures it for every client, the same way
// the uploaded GLB is already shared.
//
// Renders nothing: the config itself already flows through ConfigContext, so
// there is no new state to expose — this only reconciles it.
//
// The server is authoritative, with three ordering rules that make it safe:
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
//   3. A PULL NEVER CLOBBERS AN UNCONFIRMED LOCAL EDIT. Pushes are debounced
//      but pulls fire on every focus/visibilitychange, so a pull could land
//      while an edit is still queued OR already sent-but-not-yet-committed
//      server-side, and write the server's older copy back over it. Guarded
//      by comparing local state against the last CONFIRMED server baseline
//      (see the check in pull()) — the baseline only ever advances once a
//      push actually SUCCEEDS (see the push effect below), never
//      optimistically before it's sent, so this covers the whole at-risk
//      window, not just the pre-send debounce.
//
// Writes are owner-only (the server 403s anything else, and we skip the
// request entirely for other roles) — shared state is exactly what a guest
// must not be able to rewrite for the whole house.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConfig } from "./ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import {
  fetchSharedConfig, saveSharedConfig, pickSharedConfig, SHARED_CONFIG_KEYS,
} from "./deviceConfig";

/** Debounce for outbound writes. Advanced Settings edits arrive in bursts (a
 *  label typed character by character already debounces at 500ms upstream via
 *  useDraftCommit, but a room/type change is immediate) — coalesce them into
 *  one PUT rather than one per keystroke. */
const PUSH_DEBOUNCE_MS = 900;

export default function DeviceConfigSync() {
  const { config, update } = useConfig();
  const { role } = useProfile();

  // Recompute the slice ONLY when one of the shared fields actually changes
  // identity — not on every render. Config edits re-render this component
  // constantly (every keystroke in Advanced Settings), and the slice feeds the
  // serialisation below; rebuilding both unconditionally meant stringifying
  // the entire entityMap on each of those renders, which is exactly the kind
  // of per-keystroke work the rest of this app goes out of its way to avoid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const local = useMemo(() => pickSharedConfig(config), SHARED_CONFIG_KEYS.map((k) => config[k]));
  /** Serialised form of `local`, computed once per real change and reused for
   *  every comparison — the push gate below is a string compare, not a fresh
   *  deep-equal walk. */
  const localJson = useMemo(() => JSON.stringify(local), [local]);

  // Read the latest local slice without making the callbacks depend on it
  // (which would re-register the focus listener on every single config edit).
  const localRef = useRef(local);
  localRef.current = local;

  /** Serialised slice the server is known to hold — the baseline both ordering
   *  rules compare against. null until the first successful pull. */
  const serverJsonRef = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pull = useCallback(async () => {
    const server = await fetchSharedConfig();
    if (server === null) return; // couldn't reach it — keep what we have
    const keys = Object.keys(server);
    if (keys.length === 0) {
      // Nothing stored yet (fresh install, or first run after upgrading from
      // the localStorage-only versions). Seed the store from whatever THIS
      // device already has rather than letting an empty pull blank it.
      serverJsonRef.current = JSON.stringify(localRef.current);
      if (role === "owner") void saveSharedConfig(localRef.current);
      return;
    }
    // Server wins for every field it actually carries; fields it omits keep
    // their current local value (an older store, or one written before a field
    // existed, must not blank that field). The baseline is that MERGED result,
    // which is what the local slice will equal once `update` commits — so the
    // push effect sees no change and the pull can't bounce straight back.
    // RULE 3: A PULL MUST NEVER CLOBBER AN UNPUSHED LOCAL EDIT.
    //
    // Checked FIRST, and against the baseline as it stood BEFORE this pull —
    // if the local slice has drifted from what the server was last known to
    // hold, this client is mid-edit and its own push is still in the debounce
    // window. Pushes wait PUSH_DEBOUNCE_MS but pull() runs on every focus and
    // visibilitychange, and on several platforms interacting with a native
    // <select> blurs then refocuses the window — so picking a room in
    // Advanced Settings fired a pull while that very edit was still pending,
    // fetched the server's older copy, and wrote it back over the change.
    // Reported from the field as "I set the room, and seconds later it
    // reverts". The merge below can't save us either: it is per-KEY over the
    // shared slice and entityMap is ONE key, so the server's whole entityMap
    // replaces the local one wholesale, pending edit and all.
    //
    // Compared after the await, since the edit may have landed while the
    // request was in flight — precisely the window at risk. serverJsonRef is
    // deliberately left alone so the push gate still sees a difference and
    // sends this client's edit; the next pull then reconciles normally.
    // Losing a beat of remote changes is fine, losing the user's edit is not.
    const priorBaseline = serverJsonRef.current;
    if (priorBaseline !== null && JSON.stringify(localRef.current) !== priorBaseline) return;

    // Server wins for every field it actually carries; fields it omits keep
    // their current local value (an older store, or one written before a field
    // existed, must not blank that field). The baseline is that MERGED result,
    // which is what the local slice will equal once `update` commits — so the
    // push effect sees no change and the pull can't bounce straight back.
    const merged = { ...localRef.current, ...server };
    const mergedJson = JSON.stringify(merged);
    serverJsonRef.current = mergedJson;
    // Skip the update entirely when the server genuinely has nothing new for
    // us. `pull()` runs on every mount AND every window focus/visibilitychange
    // (below) — so on a kiosk that's just been minimised and restored, or a
    // phone brought back from the background, this fires constantly with
    // data that hasn't moved an inch. update() still hands React (and from
    // there, SceneManager) a BRAND NEW object reference for every field in
    // `server` on every call, even when its content is byte-identical to what
    // config already holds — a fresh JSON parse can never be `===` the
    // existing object. SceneManager's structural-change gate content-diffs
    // entityMap (entityMapDelta) but compares meshBindings by REFERENCE, so
    // an unconditional update() here forced a full mesh re-index — visible as
    // covers/locks snapping back to their hardcoded default pose mid-rebuild,
    // and the multi-second freeze the rebuild itself costs — on literally
    // every focus regain, whether or not anything had actually changed.
    if (mergedJson === JSON.stringify(localRef.current)) return;

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
    if (role !== "owner") return;                 // non-owners never write
    const known = serverJsonRef.current;
    if (known === null) return;                   // rule 1: no pull yet
    if (localJson === known) return;              // rule 2: nothing changed

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const next = localRef.current;
      const nextJson = JSON.stringify(next);
      void saveSharedConfig(next).then((ok) => {
        // Baseline advances ONLY on confirmed success — NOT before awaiting.
        //
        // This used to be set optimistically right here, before the PUT even
        // went out, on the reasoning that a further edit landing mid-flight
        // should compare against what's being sent rather than re-send an
        // unchanged payload. But the push effect only re-fires when localJson
        // itself changes (its dependency array), so that reasoning didn't
        // actually depend on the baseline being pre-advanced — and setting it
        // early opened a real race: the PUT is in flight but NOT YET
        // committed server-side, and if a pull() fires in that window (this
        // device regaining focus, a visibilitychange, another device's own
        // mount-pull), rule 3's guard (localRef.current !== priorBaseline ⇒
        // "mid-edit, abort") saw the OPTIMISTIC baseline already matching
        // local and let the pull proceed — fetching the server's still-old
        // copy and merging it straight over the edit that hadn't landed yet.
        // Reported from the field as "I set a link/room/label, and a few
        // seconds later it's gone" — reproducible on a SINGLE device with no
        // second client involved, just an unlucky focus event in that window.
        //
        // Only advancing here means rule 3 now correctly treats the entire
        // in-flight window (queued AND sent-but-unconfirmed) as "pending
        // edit", so any pull that lands during it aborts and retries later
        // instead of racing a write that hasn't landed. A failed write simply
        // never advances the baseline, so the next edit or focus-pull retries
        // against the old one — no separate rollback branch needed.
        if (ok) serverJsonRef.current = nextJson;
      });
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [localJson, role]);

  return null;
}
