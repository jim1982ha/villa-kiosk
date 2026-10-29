// src/messages/ConversationContext.tsx
// The page's ONE watch on this profile's conversation with VESTA (ticket 21 of "One inbox"): its lines for the pinned
// thread, whether VESTA runs (the robot, the thread and "Ask VESTA" show only then, for every profile: the add-on says it
// with each read, a guest included), and a question asked, typed or spoken (hold to talk, messages/voice) — with the
// ONE line saying why the last one did not go, shown under the thread's box whichever way it was asked — and the page's
// one spoken question (messages/talk: both talk buttons and the orb read it). Mounted beside the announcements' watch
// (pages/Dashboard).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HOLD_MS_HUD } from "@/utils/tapThresholds";
import { backendFetch } from "@/auth/sessionLost";
import { useProfile } from "@/auth/ProfileContext";
import { ASK_SAID, askVesta, fetchConversation, vestaRuns, type AskOutcome, type Turn } from "./conversation";
import { answersOf, mergeTurns, threadView, type ThreadView } from "./conversationModel";
import { pauseFor, watchFeed } from "./feed";
import { TALK_IDLE, TalkSession, type TalkView } from "./talk";
import { VOICE, canRecord, microphoneAllowed, startRecording, watchMicrophone } from "./voice";

interface Conversation {
  thread: ThreadView;
  /** VESTA's short answers to this profile's presses, by press number (conversationModel.answersOf). */
  answers: ReadonlyMap<number, string>;
  /** Ask VESTA, words or a spoken question's WAV (the add-on stamps who asks): what became of it. */
  ask: (question: string | Blob) => Promise<AskOutcome>;
  /** Why the last question did not go (ASK_SAID, or a recording's TALK_SAID), null once one went. */
  said: string | null;
  /** Say why a spoken question was not even recorded (the microphone refused, nothing heard). */
  tell: (line: string | null) => void;
  /** The page's one spoken question (hold to talk), and what it shows now. */
  talker: TalkSession | null;
  talk: TalkView;
}

const ConversationContext = createContext<Conversation>({ thread: threadView([], false), answers: new Map(),
  ask: async () => "failed", said: null, tell: () => undefined, talker: null, talk: TALK_IDLE });

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ turns: Turn[]; online: boolean }>({ turns: [], online: false });
  // ⚠️ READ AGAIN FROM NOTHING WHEN THE PROFILE CHANGES: the owner's lines must never stay on screen for the guest who
  // signs in after them on the same tablet
  const { role } = useProfile();
  useEffect(() => {
    setState({ turns: [], online: false });
    tell(null);
    const stop = new AbortController();
    void watchFeed(fetchConversation, (items, full, first, kept, got) => setState((s) => ({
      turns: mergeTurns(s.turns, items, full, first, kept), online: vestaRuns(got),
    })), stop.signal, pauseFor);
    return () => stop.abort();
  }, [role]);
  const [said, tell] = useState<string | null>(null);
  const ask = useCallback(async (question: string | Blob) => {
    tell(null);
    const out = await askVesta(question, backendFetch);
    tell(out === "sent" ? null : ASK_SAID[out]);
    return out;
  }, []);
  // one session for the page, made once; null where the page cannot record (http, no microphone): no button records
  const [talker] = useState(() => canRecord() ? new TalkSession({
    record: startRecording, allowed: microphoneAllowed, send: ask, tell,
    after: (ms, fn) => setTimeout(fn, ms), cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    holdMs: HOLD_MS_HUD, capMs: VOICE.seconds * 1000,
  }) : null);
  const [talk, setTalk] = useState<TalkView>(TALK_IDLE);
  useEffect(() => {
    if (!talker) return;
    watchMicrophone();
    return talker.watch(setTalk);
  }, [talker]);
  // a question being spoken never outlives the profile that held the button
  useEffect(() => () => talker?.close(), [role, talker]);
  const value = useMemo(() => ({ thread: threadView(state.turns, state.online), answers: answersOf(state.turns), ask,
    said, tell, talker, talk }), [state, ask, said, talker, talk]);
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export const useConversation = (): Conversation => useContext(ConversationContext);
