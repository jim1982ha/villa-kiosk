// src/agent/AgentContext.tsx
// The VESTA Agent as the Kiosk's screen sees it: its presence, kept fresh for a
// profile that may see it (viewAgent: owner, facility manager).
//
// ⚠️ A GUEST'S DEVICE ASKS NOTHING. The provider is mounted for every profile
// (it sits with FmDataProvider inside ProfileGate), but without viewAgent it
// never fetches — the server would refuse, and a refused request every minute
// from every guest phone is noise in the add-on's log for no answer.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useStoreRefresh } from "@/hooks/useStoreRefresh";
import { fetchAgentStatus, type AgentStatus } from "./agentApi";
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
  /** Show anything about the agent at all (profile may, and it is configured). */
  visible: boolean;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { role } = useProfile();
  const allowed = roleCan(role, "viewAgent");
  const [status, setStatus] = useState<AgentStatus | null>(null);

  const refresh = useCallback(() => {
    if (!allowed) return;
    // unreachable keeps the last status: a blip must not blank the presence
    void fetchAgentStatus().then((s) => { if (s) setStatus(s); });
  }, [allowed]);

  // Switching to a profile without viewAgent must drop what the last one saw.
  useEffect(() => {
    if (!allowed) setStatus(null);
  }, [allowed]);

  useStoreRefresh(refresh, AGENT_POLL_MS);

  const visible = allowed && agentVisible(status);
  const value = useMemo(() => ({ status, visible }), [status, visible]);
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
