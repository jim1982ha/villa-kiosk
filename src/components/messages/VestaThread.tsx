// src/components/messages/VestaThread.tsx
// VESTA's conversation, a window of its own (ticket 21 of "One inbox"; owner, 2026-10-29: "a dedicated icon in the top
// bar, next to the robot … re-using the same graphical components as any other modal"): this profile's conversation with
// VESTA, a box to ask, and "New conversation" (Telegram's /new). The question is sent as typed; the add-on stamps who
// asks, and VESTA's answer arrives in the thread (messages/ConversationContext). What it shows is the model's
// (messages/conversationModel); this draws it.

import { momentText } from "@/utils/dateText";
import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Send, Square, Volume2 } from "lucide-react";
import IconButton from "@/components/common/IconButton";
import Window, { WindowHeader } from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";

import { NEW_CONVERSATION, QUESTION_MAX, SPOKEN_WAITING, TALK_SAID, pressableOf, type Turn } from "@/messages/conversation";
import { useConversation } from "@/messages/ConversationContext";
import { followOf, unanswered, vestaWorking } from "@/messages/conversationModel";
import { PageLink, PhotoRow, RecordButtons } from "./AnnouncementContent";
import TalkButton from "./TalkButton";
import EmptyLine from "@/components/common/EmptyLine";

/** One line of the thread: who said it, when, its words, the camera pictures VESTA looked at and the page it attached
 *  ("Open the page" only for a profile the add-on serves pages to). A spoken question (hold to talk) carries the
 *  microphone, and says it was spoken until VESTA heard its words; an answer said aloud offers Listen. Pure: a check
 *  draws it. */
export function TurnLine({ turn, canOpenPage, onListen, playing = false, onStop }: { turn: Turn; canOpenPage: boolean;
  /** Listen pressed (the page's speaker: messages/speaker); none: no Listen drawn. */
  onListen?: (name: string) => void;
  /** Its sound is being said now: Stop in Listen's place (onStop: Stop pressed). */
  playing?: boolean; onStop?: () => void }) {
  return (
    <div data-turn={turn.key} className={`vesta-turn${turn.from === "person" ? " asked" : ""}${turn.voice ? " vesta-turn-spoken" : ""}`}>
      <div className="vesta-turn-head">
        <b>{turn.from === "person" ? "You" : "VESTA"}</b>
        {turn.voice && <Mic size={14} aria-label="spoken" />}
        {turn.at && <span className="muted">{momentText(turn.at)}</span>}
        {turn.speech && playing && onStop ? (
          // being said now: Stop in Listen's place, back to Listen once it ends or is stopped (owner, 2026-10-30)
          <IconButton small label="Stop" className="vesta-turn-listen" onClick={onStop}><Square size={16} aria-hidden /></IconButton>
        ) : turn.speech && onListen && (
          // the answer said aloud (ticket 24): played as it came on the tablet that asked; heard again from here, an
          // icon at the end of the line (owner, 2026-10-29: not a button the width of the answer)
          <IconButton small label="Listen" className="vesta-turn-listen" onClick={() => { if (turn.speech) onListen(turn.speech); }}>
            <Volume2 size={18} aria-hidden />
          </IconButton>
        )}
      </div>
      {/* the camera pictures the answer carries: the one row of photos, no camera named (the answer's words say it) */}
      <PhotoRow photos={turn.photos.map((id) => ({ id, label: "", at: "" }))} />
      {turn.text && <p className="vesta-turn-text">{turn.text}</p>}
      {turn.voice && !turn.text && <p className="vesta-turn-text muted">{SPOKEN_WAITING}</p>}
      {turn.page && canOpenPage && <PageLink page={turn.page} />}
      {turn.buttons.length > 0 && <RecordButtons record={pressableOf(turn)} />}
    </div>
  );
}

/** VESTA answering: its bubble with three dots, as every chat app shows "typing" (conversationModel.vestaWorking). */
export function WorkingBubble() {
  return (
    <div className="vesta-turn vesta-working" role="status" aria-label="VESTA is answering">
      <span className="vesta-working-dot" /><span className="vesta-working-dot" /><span className="vesta-working-dot" />
    </div>
  );
}

export default function VestaWindow({ onClose, canOpenPage }: { onClose: () => void; canOpenPage: boolean }) {
  const { thread, ask, said, tell, talker, talk, listen, playing, stopListening } = useConversation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const working = vestaWorking(thread, Date.now());
  // each step in view as it comes, as a chat does: a question and the dots at the bottom, an answer from its start
  const follow = followOf(thread, working);
  useEffect(() => {
    const answer = follow.answer ? end.current?.parentElement?.querySelector(`[data-turn="${CSS.escape(follow.answer)}"]`) : null;
    (answer ?? end.current)?.scrollIntoView?.({ block: follow.to === "answer" ? "start" : "end" });
  }, [follow.key, follow.to, follow.answer]);

  const send = async (words: string) => {
    setSending(true);
    const out = await ask(words);
    setSending(false);
    if (out === "sent" && words !== NEW_CONVERSATION) setText("");
  };
  const submit = () => { if (text.trim() && !sending) void send(text.trim()); };

  return (
    <Window kind="content" label="VESTA" onClose={onClose} className="settings-modal vesta-modal">
      <WindowHeader title="VESTA">
        <button type="button" className="btn" disabled={sending} onClick={() => void send(NEW_CONVERSATION)}>
          <RotateCcw size={16} aria-hidden /> New conversation
        </button>
      </WindowHeader>
      <div className="modal-body vesta-thread">
      <div className="vesta-thread-lines" role="log" aria-live="polite">
        {thread.lines.length === 0 && <EmptyLine>Ask VESTA about the villa: what is on, what happened, what to check.</EmptyLine>}
        {thread.lines.map((t) => <TurnLine key={t.key} turn={t} canOpenPage={canOpenPage} onListen={listen}
          playing={!!t.speech && t.speech === playing} onStop={stopListening} />)}
        {vestaWorking(thread, Date.now()) && <WorkingBubble />}
        {unanswered(thread.lines, Date.now()) && <p className="muted body-text">No answer came. Ask again.</p>}
        <div ref={end} />
      </div>
      <form className="vesta-thread-ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea value={text} maxLength={QUESTION_MAX} rows={2} placeholder="Ask VESTA" aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          // Enter sends, Shift+Enter starts a new line, as in a chat
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        {/* a spoken question from the open conversation: this button's own orb, never the big one again */}
        {talker && (
          <TalkButton place="thread" onOpen={() => undefined} onTap={() => tell(TALK_SAID.hold)} className="btn"
            idle="Hold to talk to VESTA" />
        )}
        {/* one question at a time: never typed while a spoken one is still sending (talk.phase) */}
        <button type="submit" className="btn primary" disabled={sending || talk.phase === "sending" || !text.trim()}>
          <Send size={16} aria-hidden /> Ask
        </button>
      </form>
      {said && <p className="muted body-text">{said}</p>}
      </div>
      <ModalFooter onClose={onClose} />
    </Window>
  );
}
