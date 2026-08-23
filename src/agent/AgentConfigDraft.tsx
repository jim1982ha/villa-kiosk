// src/agent/AgentConfigDraft.tsx
//
// ONE draft of `/agent-config`, shared by every panel that edits a slice of it,
// and committed by the dialog's own Save button.
//
// ⚠️ IT EXISTS BECAUSE TWO PANELS EDITING ONE DOCUMENT IS A LOST-UPDATE BUG,
// NOT BECAUSE IT IS TIDIER. The Supervision tab holds two panels — the people
// table and the cadence/cost dials — and each one used to load the document,
// keep its OWN `rev`, and PUT the whole thing. The store refuses a write whose
// `rev` is not current, so saving one panel made the other's copy stale: the
// second save was refused, showed "that change was not saved", reloaded, and
// the operator's edit was gone. Reported as settings in that tab not being
// saved. One loader, one revision, one write closes it by construction.
//
// ⚠️ AND THE SAVE IS DEFERRED, WHICH IS THE POLICY THIS FAMILY NOW FOLLOWS. A
// panel that wrote on every change was fine for a toggle and wrong for a number
// field — typing 150 wrote 1, then 15, then 150, and the middle values are real
// cadences the scheduler picks up. So nothing here writes until the footer's
// Save is pressed, and the exit button says Cancel exactly while there is
// something to discard.
//
// ⚠️ THE CARRY-OVER IS NOT OPTIONAL. `_json_store_handlers` REPLACES the whole
// document on write, so a PUT must send everything — including keys this
// version of the app has never heard of, which is how a newer add-on's settings
// survive a downgrade. Sending only what changed deleted an owner's sender list
// in the field.

import { createContext, useCallback, useContext, useEffect, useMemo,
         useState, type ReactNode } from "react";

import { loadAgentConfig, saveAgentConfig,
         type AgentConfig } from "@/agent/agentApi";

export interface AgentConfigDraft {
  /** The FIRST read only. A refresh after a save is not a load: swapping the
   *  panel for a spinner on every commit reads as a fault. */
  loading: boolean;
  /** Stored values with the operator's unsaved edits laid over them. */
  config: Partial<AgentConfig>;
  edit: (patch: Partial<AgentConfig>) => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  save: () => Promise<boolean>;
  discard: () => void;
}

const EMPTY: AgentConfigDraft = {
  loading: true, config: {}, edit: () => {}, dirty: false, saving: false,
  error: null, save: async () => false, discard: () => {},
};

const Ctx = createContext<AgentConfigDraft>(EMPTY);

/** ⚠️ USED BY THE FOOTER AS WELL AS THE PANELS, which is why the provider wraps
 *  the whole dialog rather than the one tab that edits: a draft must survive a
 *  tab switch, and the button that commits it lives outside every tab. */
export const useAgentConfigDraft = () => useContext(Ctx);

export function AgentConfigProvider(
  { enabled, children }: { enabled: boolean; children: ReactNode },
) {
  const [stored, setStored] = useState<Partial<AgentConfig>>({});
  const [patch, setPatch] = useState<Partial<AgentConfig>>({});
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const [rev, setRev] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!enabled) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    const got = await loadAgentConfig();
    setStored(got?.config ?? {});
    setRaw(got?.raw ?? {});
    setRev(got?.rev ?? null);
    setLoading(false);
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  const edit = useCallback((next: Partial<AgentConfig>) => {
    setPatch((current) => ({ ...current, ...next }));
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (Object.keys(patch).length === 0) return true;
    setSaving(true);
    setError(null);
    const ok = await saveAgentConfig(patch, raw, rev);
    setSaving(false);
    if (!ok) {
      // ⚠️ RELOAD RATHER THAN RETRY. A refused write is almost always a
      // revision conflict — another device saved first — so re-sending the same
      // body would discard their edit. Reloading rebases on theirs, which is
      // the rule `DeviceConfigSync` states for every shared store here.
      setError("That change was not saved — another device may have saved "
               + "first. Reloading the stored settings.");
      void load(true);
      return false;
    }
    setPatch({});
    await load(true);
    return true;
  }, [patch, raw, rev, load]);

  const value = useMemo<AgentConfigDraft>(() => ({
    loading,
    config: { ...stored, ...patch },
    edit,
    dirty: Object.keys(patch).length > 0,
    saving,
    error,
    save,
    discard: () => { setPatch({}); setError(null); },
  }), [loading, stored, patch, edit, saving, error, save]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
