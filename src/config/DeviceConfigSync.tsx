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
// villa-kiosk is routinely open on SEVERAL devices at once (a phone, a
// MacBook, an iPad, a wall tablet) — this file has to make concurrent edits
// from different devices commute, not just get one device's own read-then-
// write loop right. Four rules make that safe:
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
//      push actually SUCCEEDS (see pushOwnDiff below), never optimistically
//      before it's sent, so this covers the whole at-risk window, not just
//      the pre-send debounce.
//
//   4. A PUSH NEVER OVERWRITES ANOTHER DEVICE'S CONCURRENT EDIT. This is the
//      one rule 1-3 don't cover: two devices editing DIFFERENT items (one
//      relabels a light, the other links a sensor) around the same time.
//      Sending "everything this device currently has" can't distinguish "I
//      changed this" from "I'm just carrying this unchanged" — whichever
//      push lands last would silently win for the WHOLE key (entityMap etc
//      is one JSON blob), erasing the other device's item. Instead, a push
//      diffs the local slice against the baseline THIS device last synced
//      against (see deviceConfig.ts's diffSharedConfig — per-item, keyed by
//      entity_id / mesh name / group id / room name), fetches the server's
//      freshest copy, and replays only that per-item diff on top of it — so
//      an unrelated item the other device wrote survives untouched. The
//      write itself carries the revision it was computed against (an
//      optimistic-concurrency token from the server, see supervisor-proxy.py)
//      and is rejected with 409 + the fresher copy if another write landed
//      in the gap; pushOwnDiff rebases and retries a bounded number of times.
//
// Writes are owner-only (the server 403s anything else, and we skip the
// request entirely for other roles) — shared state is exactly what a guest
// must not be able to rewrite for the whole house.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConfig } from "./ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { useSyncReporter } from "@/utils/syncTelemetry";
import { SyncedDocument } from "@/utils/syncedDocument";
import { useStoreRefresh } from "@/hooks/useStoreRefresh";
import {
  fetchSharedConfig, saveSharedConfig, pickSharedConfig, SHARED_CONFIG_KEYS,
  diffSharedConfig, applySharedConfigDiff, isSharedConfigDiffEmpty, describeSharedConfigDiff,
  mergeSharedConfig,
  loadSyncBaseline, saveSyncBaseline, baselineFromServer,
  type SharedDeviceConfig,
} from "./deviceConfig";

/** Debounce for outbound writes. Advanced Settings edits arrive in bursts (a
 *  label typed character by character already debounces at 500ms upstream via
 *  useDraftCommit, but a room/type change is immediate) — coalesce them into
 *  one PUT rather than one per keystroke. */
const PUSH_DEBOUNCE_MS = 900;

/** How many times pushOwnDiff will rebase-and-retry against a fresher server
 *  copy before giving up for this debounce cycle (the next edit or pull will
 *  try again). Only matters in the narrow window between this device's own
 *  pre-push fetch and its PUT landing — a genuine collision there is rare. */
const MAX_PUSH_ATTEMPTS = 3;

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
  /** Read by the document's write gate. A ref rather than the closed-over
   *  `role` so a push already scheduled when the profile changes is judged by
   *  the role that holds when it RUNS, not the one that held when it was queued. */
  const roleRef = useRef(role);
  roleRef.current = role;
  /** The FULL config, not the shared slice. mergeSharedConfig needs it: the
   *  slice has already had this device's derived items filtered out, so
   *  merging against it would find nothing to carry across and would blank
   *  exactly the rows it exists to preserve. */
  const configRef = useRef(config);
  configRef.current = config;

  /** The serialised confirmed baseline — the push effect's cheap gate for
   *  rules 1 and 2. Moves with the document's baseline (onBaseline). */
  const serverJsonRef = useRef<string | null>(null);

  // Reports this store's pulls/pushes, deduped, tagged `store:"config"` so a
  // dump can never be mistaken for the Facility store's. See syncTelemetry.
  const reportSync = useSyncReporter("config");

  /** The sync state machine — utils/syncedDocument, the SAME one the Facility
   *  store runs (round 10, 2.496.154). It owns the baseline this device is
   *  known to be in sync with, its revision and the writes in flight; this
   *  component keeps only the config store's own policy: the debounce, the
   *  derived rows (mergeSharedConfig), the persisted baseline — seeded from it,
   *  so an edit whose push hadn't landed before a reload is still recognised
   *  as pending — and owner-only writes. */
  const doc = useMemo(() => {
    const initial = loadSyncBaseline();
    serverJsonRef.current = initial === null ? null : JSON.stringify(initial);
    return new SyncedDocument({
      fetch: async () => {
        const f = await fetchSharedConfig();
        return f === null ? null : { doc: baselineFromServer(f.config), rev: f.rev, raw: f.raw, config: f.config };
      },
      save: saveSharedConfig,
      diff: diffSharedConfig,
      isEmpty: isSharedConfigDiffEmpty,
      apply: applySharedConfigDiff,
      // Keys the server omits fall back to this device's baseline rather than
      // to empty, so a push can never blank a field just because the server
      // hasn't got it yet — the diff is what decides changes, not the base.
      rebase: (base: SharedDeviceConfig, fresh: SharedDeviceConfig) => ({ ...base, ...fresh }),
      // Nothing stored yet (fresh install): the baseline is EMPTY — the truth —
      // so the debounced push then seeds the store through the one write path
      // that has CAS, retries and telemetry.
      serverEmpty: (f) => Object.keys(f.config).length === 0,
      empty: baselineFromServer({}),
      // ⚠️ THE ROLE GATE LIVES IN THE ONE PLACE THAT WRITES, judged when the
      // push RUNS: a pull's re-push used to run for every role (67c32ccb).
      canWrite: () => roleRef.current === "owner",
      onBaseline: (b) => { serverJsonRef.current = JSON.stringify(b); saveSyncBaseline(b); },
      maxAttempts: MAX_PUSH_ATTEMPTS,
    }, initial);
  }, []);

  // RULE 4: this device's own diff, replayed onto the server's freshest copy
  // under optimistic concurrency (utils/syncedDocument → keyedSync).
  const pushOwnDiff = useCallback(async () => {
    const baseline = doc.baseline;
    // WHICH keys are being sent, by item count. See describeSharedConfigDiff:
    // without this a push driven by a key that churns on its own is
    // indistinguishable in a dump from a push driven by a real edit.
    const changed = baseline ? describeSharedConfigDiff(diffSharedConfig(baseline, localRef.current)) : undefined;
    const outcome = await doc.push(localRef.current);
    if (outcome.ok) {
      reportSync({
        op: "push", ok: true, attempts: outcome.attempts, rev: outcome.rev,
        changed,
        dismissed: outcome.next.dismissedEntityIds.length,
        entities: Object.keys(outcome.next.entityMap).length,
      });
      // Fold in whatever another device contributed, through mergeSharedConfig:
      // `outcome.next` is the SHARED slice, which carries no derived items, and
      // handing it straight to update() would empty the fitted rooms out of
      // config on every successful push.
      update(mergeSharedConfig(configRef.current, outcome.next));
      return;
    }
    if (outcome.reason === "nothing-to-push" || outcome.reason === "not-allowed" || outcome.reason === "not-pulled") return;
    reportSync({ op: "push", ok: false, reason: outcome.reason, changed });
  }, [doc, update, reportSync]);

  const pull = useCallback(async () => {
    // What applying the server's copy would make the local slice: server wins
    // for every field it carries; fields it omits keep their local value; this
    // device's DERIVED rows survive (mergeSharedConfig).
    const mergedOf = (config: Partial<SharedDeviceConfig>) =>
      ({ ...localRef.current, ...mergeSharedConfig(configRef.current, config) }) as SharedDeviceConfig;
    const r = await doc.pull(
      () => localRef.current,
      (f) => JSON.stringify(mergedOf(f.config)) !== JSON.stringify(localRef.current),
    );
    switch (r.action) {
      case "wait":
        reportSync({ op: "pull", skipped: "write-in-flight" });
        return;
      case "unreachable":
        reportSync({ op: "pull", aborted: "unreachable" });
        return;
      case "repush":
        // RULE 3: a pull never clobbers an unpushed local edit — and aborting
        // is only half of it: if that edit's own push failed, nothing else
        // would retry it (the push effect only fires when the slice CHANGES),
        // so the pull is what unwedges it. Also the answer when a write
        // started while this pull's fetch was out: the fetched copy is older.
        reportSync({
          op: "pull", aborted: "pending-local-edit",
          dismissed: localRef.current.dismissedEntityIds.length,
          entities: Object.keys(localRef.current.entityMap).length,
        });
        void pushOwnDiff();
        return;
      case "seed":
        reportSync({
          op: "pull", seededEmptyStore: true, rev: r.fetched.rev,
          dismissed: localRef.current.dismissedEntityIds.length,
        });
        return;
    }
    const merged = mergedOf(r.fetched.config);
    reportSync({
      op: "pull", rev: r.fetched.rev,
      dismissed: merged.dismissedEntityIds.length,
      entities: Object.keys(merged.entityMap).length,
      serverHadDismissed: Array.isArray(r.fetched.config.dismissedEntityIds),
    });
    // Skip the update when nothing moved: update() hands SceneManager brand-new
    // objects for every field even when byte-identical, and meshBindings is
    // compared by reference there — an unconditional update forced a full mesh
    // re-index (and its freeze) on every focus regain.
    if (r.action === "noop") return;
    update(mergeSharedConfig(configRef.current, r.fetched.config));
  }, [doc, update, pushOwnDiff, reportSync]);

  // Mount + focus/visibility + a slow visible-only heartbeat, via the shared
  // hook — the SAME triggers the Facility Manager store uses, so "how fresh is
  // this screen" has one answer across the app rather than one per store.
  useStoreRefresh(useCallback(() => { void pull(); }, [pull]));

  // Push local edits up, debounced. Gated on rules 1 and 2 above.
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (role !== "owner") return;                 // non-owners never write
    const known = serverJsonRef.current;
    if (known === null) return;                   // rule 1: no pull yet
    if (localJson === known) return;               // rule 2: nothing changed

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => { void pushOwnDiff(); }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [localJson, role, pushOwnDiff]);

  return null;
}
