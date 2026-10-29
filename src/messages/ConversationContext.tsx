// src/messages/ConversationContext.tsx
// The page's ONE watch on this profile's conversation with VESTA (ticket 21 of "One inbox"): its lines for the pinned
// thread, whether VESTA runs (the robot, the thread and "Ask VESTA" show only then, for every profile: the add-on says it
// with each read, a guest included), and a question asked. Mounted beside the announcements' watch (pages/Dashboard).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { backendFetch } from "@/auth/sessionLost";
import { useProfile } from "@/auth/ProfileContext";
import { askVesta, fetchConversation, vestaRuns, type AskOutcome, type Turn } from "./conversation";
import { answersOf, mergeTurns, threadView, type ThreadView } from "./conversationModel";
import { pauseFor, watchFeed } from "./feed";

interface Conversation {
  thread: ThreadView;
  /** VESTA's short answers to this profile's presses, by press number (conversationModel.answersOf). */
  answers: ReadonlyMap<number, string>;
  /** Ask VESTA (the add-on stamps who asks): what became of it. */
  ask: (text: string) => Promise<AskOutcome>;
}

const ConversationContext = createContext<Conversation>({ thread: threadView([], false), answers: new Map(),
  ask: async () => "failed" });

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ turns: Turn[]; online: boolean }>({ turns: [], online: false });
  // ⚠️ READ AGAIN FROM NOTHING WHEN THE PROFILE CHANGES: the owner's lines must never stay on screen for the guest who
  // signs in after them on the same tablet
  const { role } = useProfile();
  useEffect(() => {
    setState({ turns: [], online: false });
    const stop = new AbortController();
    void watchFeed(fetchConversation, (items, full, first, kept, got) => setState((s) => ({
      turns: mergeTurns(s.turns, items, full, first, kept), online: vestaRuns(got),
    })), stop.signal, pauseFor);
    return () => stop.abort();
  }, [role]);
  const ask = useCallback((text: string) => askVesta(text, backendFetch), []);
  const value = useMemo(() => ({ thread: threadView(state.turns, state.online), answers: answersOf(state.turns), ask }),
    [state, ask]);
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export const useConversation = (): Conversation => useContext(ConversationContext);
