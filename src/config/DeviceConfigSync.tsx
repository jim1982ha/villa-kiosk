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
import { pushWithRebase } from "@/utils/keyedSync";
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
  /** The FULL config, not the shared slice. mergeSharedConfig needs it: the
   *  slice has already had this device's derived items filtered out, so
   *  merging against it would find nothing to carry across and would blank
   *  exactly the rows it exists to preserve. */
  const configRef = useRef(config);
  configRef.current = config;

  /** The full shared-config object THIS device is known to be in sync with —
   *  both the server's own last-seen state (pull) and, once a push succeeds,
   *  what was just written. This is what a push diffs local against (rule 4)
   *  and what a pull uses to detect a still-pending local edit (rule 3). null
   *  until the first successful pull. */
  // Seeded from the PERSISTED baseline (see deviceConfig's loadSyncBaseline)
  // rather than starting null, so an edit whose push hadn't landed when the
  // page reloaded is still recognised as pending and gets re-pushed instead
  // of being silently overwritten by the next pull.
  const baselineRef = useRef<SharedDeviceConfig | null>(loadSyncBaseline());
  /** Serialised form of baselineRef, kept in lockstep — cheap string-compare
   *  gate for rules 2 and 3 without re-stringifying on every check. */
  const serverJsonRef = useRef<string | null>(
    baselineRef.current === null ? null : JSON.stringify(baselineRef.current),
  );

  /** Advance the baseline — the ONE place it moves, so the in-memory pair and
   *  the persisted copy can never drift apart. */
  const commitBaseline = useCallback((next: SharedDeviceConfig, json?: string) => {
    baselineRef.current = next;
    serverJsonRef.current = json ?? JSON.stringify(next);
    saveSyncBaseline(next);
  }, []);
  /** Optimistic-concurrency revision last confirmed from the server (see
   *  supervisor-proxy.py's _store_revision) — sent with the next write so a
   *  write that's gone stale gets rejected instead of silently overwriting a
   *  different device's newer one. */
  const revRef = useRef<string>("0");
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reports this store's pulls/pushes, deduped, tagged `store:"config"` so a
  // dump can never be mistaken for the Facility store's. See syncTelemetry.
  const reportSync = useSyncReporter("config");

  // RULE 4: diff this device's local edits against the baseline it last
  // synced against, replay ONLY that diff onto the server's freshest copy,
  // and write it back under optimistic concurrency — retrying against a
  // fresher copy if another device's write lands in the gap. See the file
  // header for why a whole-object PUT of `local` can't be used here.
  const pushOwnDiff = useCallback(async () => {
    const baseline = baselineRef.current;
    if (!baseline) return; // rule 1: no pull yet

    // The fetch-rebase-write-retry protocol itself lives in utils/keyedSync —
    // the SAME loop the Facility Manager store uses. Only what a "diff" means
    // for this document, and what to report, belong here.
    const ownDiff = diffSharedConfig(baseline, localRef.current);
    // WHICH keys are being sent, by item count. See describeSharedConfigDiff:
    // without this a push driven by a key that churns on its own is
    // indistinguishable in a dump from a push driven by a real edit.
    const changed = describeSharedConfigDiff(ownDiff);

    const outcome = await pushWithRebase({
      diff: ownDiff,
      isEmpty: isSharedConfigDiffEmpty,
      baseline,
      fetchFresh: async () => {
        const fresh = await fetchSharedConfig();
        return fresh === null
          ? null
          : { doc: baselineFromServer(fresh.config), rev: fresh.rev, raw: fresh.raw };
      },
      // Keys the server omits fall back to this device's baseline rather than
      // to empty, so a push can never blank a field just because the server
      // hasn't got it yet — the diff is what decides changes, not the base.
      rebase: (base, fresh) => ({ ...base, ...fresh }),
      apply: applySharedConfigDiff,
      save: saveSharedConfig,
      maxAttempts: MAX_PUSH_ATTEMPTS,
    });

    if (outcome.ok) {
      commitBaseline(outcome.next);
      revRef.current = outcome.rev;
      reportSync({
        op: "push", ok: true, attempts: outcome.attempts, rev: outcome.rev,
        changed,
        dismissed: outcome.next.dismissedEntityIds.length,
        entities: Object.keys(outcome.next.entityMap).length,
      });
      // Fold in whatever another device contributed, so this client's view
      // reflects it immediately rather than waiting for its next pull. Through
      // mergeSharedConfig for the same reason the pull is: `outcome.next` is
      // the SHARED slice, which by construction carries no derived items, and
      // handing it straight to update() would empty the fitted rooms out of
      // config on every successful push.
      update(mergeSharedConfig(configRef.current, outcome.next));
      return;
    }
    if (outcome.reason === "nothing-to-push") return;
    reportSync({ op: "push", ok: false, reason: outcome.reason, changed });
  }, [update, reportSync, commitBaseline]);

  const pull = useCallback(async () => {
    const result = await fetchSharedConfig();
    if (result === null) {
      reportSync({ op: "pull", aborted: "unreachable" });
      return; // couldn't reach it — keep what we have
    }
    const { config: server, rev } = result;
    const keys = Object.keys(server);
    if (keys.length === 0) {
      // Nothing stored yet (fresh install, or first run after upgrading from
      // the localStorage-only versions). Record the baseline as EMPTY — which
      // is the truth — rather than as this device's local slice. Recording
      // local here would claim it was already synced, so the push gate would
      // see no change and the seed would never actually be written; the old
      // code papered over that with its own un-awaited save, whose failure
      // nothing could detect or retry. With an honest empty baseline the
      // normal debounced push does the seeding through the one write path
      // that has CAS, retries and telemetry.
      commitBaseline(baselineFromServer({}));
      revRef.current = rev;
      reportSync({
        op: "pull", seededEmptyStore: true, rev,
        dismissed: localRef.current.dismissedEntityIds.length,
      });
      return;
    }
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
    // reverts".
    //
    // Compared after the await, since the edit may have landed while the
    // request was in flight — precisely the window at risk. baselineRef is
    // deliberately left alone so the push gate still sees a difference and
    // sends this client's edit; the next pull then reconciles normally.
    // Losing a beat of remote changes is fine, losing the user's edit is not.
    const priorBaseline = serverJsonRef.current;
    if (priorBaseline !== null && JSON.stringify(localRef.current) !== priorBaseline) {
      // Aborting the pull is only half the answer: the reason we're aborting
      // is that this device holds an edit the server hasn't got. If that
      // edit's own push already failed (a flaky phone connection is the
      // normal case), nothing would ever retry it — the push effect only
      // re-fires when the local slice CHANGES — so the device would sit here
      // refusing every pull for an edit it never sends, permanently out of
      // sync in both directions until the user happened to edit something
      // else. Retry the push instead, so a focus/heartbeat pull is what
      // unwedges it.
      // The single most diagnostic line here: this device is holding an edit
      // the server hasn't got. If a phone logs this repeatedly while a desktop
      // logs clean pulls, the divergence is a stuck local edit, not a bad read.
      reportSync({
        op: "pull", aborted: "pending-local-edit",
        dismissed: localRef.current.dismissedEntityIds.length,
        entities: Object.keys(localRef.current.entityMap).length,
      });
      void pushOwnDiff();
      return;
    }

    // Server wins for every field it actually carries; fields it omits keep
    // their current local value (an older store, or one written before a field
    // existed, must not blank that field). The baseline is that MERGED result,
    // which is what the local slice will equal once `update` commits — so the
    // push effect sees no change and the pull can't bounce straight back.
    // mergeSharedConfig, not a bare spread: the server's copy of a key may be
    // missing this device's DERIVED items (see pickSharedConfig's pair), and a
    // plain overwrite would drop the fitted rooms out of config until the next
    // calibration happened to put them back.
    const fromServer = mergeSharedConfig(configRef.current, server);
    const merged = { ...localRef.current, ...fromServer } as SharedDeviceConfig;
    const mergedJson = JSON.stringify(merged);
    // `merged` decides what local CONFIG becomes; the BASELINE is what the
    // server actually holds. They are not the same object and conflating them
    // is what stranded dismissedEntityIds on one device — see
    // baselineFromServer's docstring.
    commitBaseline(baselineFromServer(server));
    revRef.current = rev;
    // What the server actually handed this device. `dismissed` is the number
    // that matters when "Remove" works on one device and not another: if the
    // desktop shows a count here and the phone shows 0, the write never
    // reached the store; if both show the same count, the divergence is on
    // the rendering side, not the sync side.
    reportSync({
      op: "pull", rev,
      dismissed: merged.dismissedEntityIds.length,
      entities: Object.keys(merged.entityMap).length,
      serverHadDismissed: Array.isArray(server.dismissedEntityIds),
    });
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

    update(fromServer);
  }, [update, role, pushOwnDiff, reportSync]);

  // Mount + focus/visibility + a slow visible-only heartbeat, via the shared
  // hook — the SAME triggers the Facility Manager store uses, so "how fresh is
  // this screen" has one answer across the app rather than one per store.
  useStoreRefresh(useCallback(() => { void pull(); }, [pull]));

  // Push local edits up, debounced. Gated on rules 1 and 2 above.
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
