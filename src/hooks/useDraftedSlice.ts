// src/hooks/useDraftedSlice.ts
// A dialog that edits a SLICE of the config live, with what it changed to go
// back from: what its controls show, how a change is written, whether anything
// changed since it opened, Save and Discard — in one place.
//
// ⚠️ ONE COPY OF EACH VALUE. The Settings window used to keep its own
// `useState` copy of four fields beside the draft mechanism (so a slider could
// move before the debounced write), re-seeded by hand on Discard — the shape
// that lost data in another window before (2.496.194): a field whose copy was
// missed read as changed while the villa showed the old value. Here the
// controls read `view`, which is the live config with only the values being
// typed laid over it, and Discard clears those.
//
// ⚠️ CANCEL TAKES BACK WHAT THIS DIALOG SET, NOTHING ELSE (2.496.499): its
// ledger, item by item (configSlice recordEdit). A write from elsewhere on
// this tablet or from another tablet never enters it.
//
// ⚠️ ONE PENDING STORE FOR THE WHOLE DIALOG (2.496.500, config/pendingEdits): the slice's own waiting write and every
// field's typed value (Advanced Settings' coordinates, a device's label: usePendingField under PendingFields). Dirty,
// Save, Cancel and closing see them all; a value still waiting when the dialog goes away is written, not dropped.
//
// ⚠️ THE SLICE'S KEYS ARE THE ONLY KEYS `set` ACCEPTS. A control that writes
// a key not in the list is a type error — the key would otherwise be
// silently un-revertable (Discard restores its siblings and leaves it).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AppConfig } from "@/config/AppConfig";
import { useConfig } from "@/config/ConfigContext";
import { PendingEdits } from "@/config/pendingEdits";
import {
  draftedView, EMPTY_LEDGER, ledgerDirty, ledgerOnRemote, recordEdit, revertLedger, sliceOf, withReplaced,
  type DraftLedger, type ReplacedSubject, type Slice,
} from "@/config/configSlice";

export interface DraftedSlice<K extends keyof AppConfig> {
  /** What every control renders from. */
  view: Slice<K>;
  /** Change values. By default shown at once and written after `delayMs` of
   *  quiet (a slider drag is one write); `now` writes at once (a toggle).
   *  `stored` is what to write when it differs from what to show (a title
   *  shown as typed, stored trimmed). */
  set: (shown: Partial<Slice<K>>, opts?: { now?: boolean; stored?: Partial<Slice<K>> }) => void;
  /** Anything THIS dialog changed since it opened (or was last saved) and has not put back; no other write is one. */
  dirty: boolean;
  /** Keep the changes: write what is waiting, and forget what was changed. */
  save: () => void;
  /** Put back exactly what this dialog changed — written, so the scene and every tablet follow — and return the
   *  slice as it then is, for the caller to re-apply anything it drives directly. */
  discard: () => Slice<K>;
  /** Write what is waiting now (before closing). */
  flush: () => void;
  /** The dialog's one pending store, for its fields (PendingFields / usePendingField). */
  pending: PendingEdits;
  /** This dialog's changes another tablet has since replaced (configSlice ledgerOnRemote), for the dialog to say
   *  (components/settings/RemoteReplacedNote); gone when dismissed or when the dialog closes. */
  replaced: ReplacedSubject[];
  dismissReplaced: () => void;
}

const DRAFT = "slice";

export function useDraftedSlice<K extends keyof AppConfig>(keys: readonly K[], delayMs = 500): DraftedSlice<K> {
  const { config, update, editByDialog, onDialogEdit, onRemoteChange } = useConfig();
  // the dialog's writes are its own: recorded in its ledger (and any other open draft's) as they land
  const [pending] = useState(() => new PendingEdits(editByDialog));
  pending.write = editByDialog;
  const waitingCount = useSyncExternalStore(pending.subscribe, () => pending.size);
  // ⚠️ A VALUE STILL WAITING WHEN THE DIALOG GOES AWAY IS WRITTEN (Back from Advanced Settings over Settings, a
  // close that is not Cancel): directly, never from inside a state updater, which does not run once it is unmounted
  // (useDraftCommit's net, to 2.496.499, never wrote anything).
  useEffect(() => () => pending.flushAll(), [pending]);
  // ⚠️ THE LEDGER: WHAT THIS DIALOG ITSELF SET, ITEM BY ITEM, and its value before (configSlice recordEdit). Until
  // 2.496.498 the draft was a copy of the slice taken on open, so every write while the dialog was open read as its
  // own: the devices a 3D model just uploaded adds lit Save, and Cancel deleted them on every tablet. Written inside
  // the config's own update (ConfigContext onDialogEdit), hence a ref; the config change it comes with re-renders.
  const ledger = useRef<DraftLedger>(EMPTY_LEDGER);
  const [heard, setHeard] = useState(0);
  const [typing, setTyping] = useState<Partial<Slice<K>>>({});
  const [replaced, setReplaced] = useState<ReplacedSubject[]>([]);
  const latest = useRef({ config, keys });
  latest.current = { config, keys };
  useEffect(() => onDialogEdit((prev, next) => {
    ledger.current = recordEdit(ledger.current, latest.current.keys, prev, next);
  }), [onDialogEdit]);
  // A change from ANOTHER tablet (DeviceConfigSync, on a pull and after a push) never enters the ledger: the items of
  // it the change touches go back to the other tablet's value on Cancel, and those it took over are said (one line
  // per device), never a field flipping by itself with Save going grey.
  useEffect(() => onRemoteChange((change) => {
    const r = ledgerOnRemote(ledger.current, latest.current.config, change);
    ledger.current = r.ledger;
    if (r.replaced.length > 0) setReplaced((said) => withReplaced(said, r.replaced));
    setHeard((n) => n + 1);
  }), [onRemoteChange]);
  // compared item by item once per config (the ledger can hold the villa's whole entity map since Advanced Settings
  // joined Settings' draft, 2026-10-22): never per render
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ledger is a ref, moved with `config` or `heard`
  const dirty = useMemo(() => waitingCount > 0 || ledgerDirty(ledger.current, config), [config, heard, waitingCount]);

  return {
    view: draftedView(config, keys, typing),
    set: (shown, opts = {}) => {
      const stored = { ...shown, ...opts.stored };
      if (opts.now) {
        // Nothing to lay over the config: it is written at once. Drop any
        // typed value of the same keys so the view follows the config.
        setTyping((t) => {
          const next = { ...t };
          for (const k of Object.keys(shown)) delete next[k as K];
          return next;
        });
        editByDialog(stored);
        return;
      }
      setTyping((t) => ({ ...t, ...shown }));
      pending.stage(DRAFT, undefined, { ...(pending.writeOf(DRAFT) as Partial<AppConfig> | undefined), ...stored }, delayMs);
    },
    dirty,
    save: () => {
      // what is waiting is kept, so written as such: never recorded as a change still to cancel
      for (const write of pending.take()) update(write);
      ledger.current = EMPTY_LEDGER;
      setHeard((n) => n + 1);
    },
    discard: () => {
      pending.drop();
      setTyping({});
      const undo = ledger.current;
      ledger.current = EMPTY_LEDGER;
      setHeard((n) => n + 1);
      // put back on the config as it is when the write lands: what this dialog changed, and nothing else
      update((now) => revertLedger(undo, now));
      return sliceOf({ ...config, ...revertLedger(undo, config) } as AppConfig, keys);
    },
    flush: () => pending.flushAll(),
    pending,
    replaced,
    dismissReplaced: () => setReplaced([]),
  };
}
