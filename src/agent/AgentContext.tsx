// src/agent/AgentContext.tsx
// The VESTA Agent as the Kiosk's screen sees it: presence and messages, kept
// fresh for a profile that may see them (viewAgent: owner, facility manager).
//
// ⚠️ A GUEST'S DEVICE ASKS NOTHING. The provider is mounted for every profile
// (it sits with FmDataProvider inside ProfileGate), but without viewAgent it
// never fetches — the server would refuse, and a refused request every minute
// from every guest phone is noise in the add-on's log for no answer.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useStoreRefresh, STORE_ACTIVE_MS } from "@/hooks/useStoreRefresh";
import {
  answerAgentMessage, clearAgentMessages, fetchAgentMessages, fetchAgentStatus,
  type AgentMessage, type AgentStatus, type AnswerResult,
} from "./agentApi";
import { agentVisible } from "./agentView";
import RoomShare from "./RoomShare";

/** Presence cadence in the background. Minutes are the unit the offline window
 *  is set in (agent_offline_after_minutes), so a minute is the coarsest poll
 *  that still shows a change within the window — the three-minute store
 *  heartbeat would lag it by more than the default window's half. */
const AGENT_POLL_MS = 60 * 1000;

interface AgentContextValue {
  /** null until the first answer (and whenever the add-on cannot be reached). */
  status: AgentStatus | null;
  messages: AgentMessage[];
  /** Show anything about the agent at all (profile may, and it is configured). */
  visible: boolean;
  answer: (messageId: string, buttonId: string) => Promise<AnswerResult>;
  /** Clear these messages for everyone; null on success, else what went wrong. */
  clear: (ids: readonly string[]) => Promise<string | null>;
  refresh: () => void;
  registerWatcher: () => () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { role } = useProfile();
  const allowed = roleCan(role, "viewAgent");
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [watchers, setWatchers] = useState(0);

  const refresh = useCallback(() => {
    if (!allowed) return;
    void fetchAgentStatus().then((s) => {
      if (!s) return;                    // unreachable: keep what we know
      setStatus(s);
      if (s.state === "not_configured") { setMessages([]); return; }
      void fetchAgentMessages().then((m) => { if (m) setMessages(m); });
    });
  }, [allowed]);

  // Switching to a profile without viewAgent must drop what the last one saw.
  useEffect(() => {
    if (!allowed) { setStatus(null); setMessages([]); }
  }, [allowed]);

  const registerWatcher = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);
  useStoreRefresh(refresh, watchers > 0 ? STORE_ACTIVE_MS : AGENT_POLL_MS);

  const answer = useCallback(async (messageId: string, buttonId: string) => {
    const result = await answerAgentMessage(messageId, buttonId);
    refresh();                           // either way, show the server's truth
    return result;
  }, [refresh]);

  const clear = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0) return null;
    const result = await clearAgentMessages(ids);
    // Gone from this screen at once; the re-read below confirms it.
    if (result.ok) setMessages((list) => list.filter((m) => !ids.includes(m.id)));
    refresh();
    return result.ok ? null : result.message;
  }, [refresh]);

  const visible = allowed && agentVisible(status);
  const value = useMemo(
    () => ({ status, messages, visible, answer, clear, refresh, registerWatcher }),
    [status, messages, visible, answer, clear, refresh, registerWatcher],
  );
  return (
    <AgentContext.Provider value={value}>
      {visible && <RoomShare />}
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within an AgentProvider");
  return ctx;
}

/** Call from the panel that shows the agent's messages: while it is open they
 *  re-read every STORE_ACTIVE_MS, so an answer given on another device lands
 *  in seconds on the screen someone is watching. */
export function useAgentLiveView(): void {
  const { registerWatcher } = useAgent();
  useEffect(() => registerWatcher(), [registerWatcher]);
}
