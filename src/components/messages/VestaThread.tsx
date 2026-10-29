// src/components/messages/VestaThread.tsx
// VESTA's conversation, a window of its own (ticket 21 of "One inbox"; owner, 2026-10-29: "a dedicated icon in the top
// bar, next to the robot … re-using the same graphical components as any other modal"): this profile's conversation with
// VESTA, a box to ask, and "New conversation" (Telegram's /new). The question is sent as typed; the add-on stamps who
// asks, and VESTA's answer arrives in the thread (messages/ConversationContext). What it shows is the model's
// (messages/conversationModel); this draws it.

import { momentText } from "@/utils/dateText";
import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Send } from "lucide-react";
import Window from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";

import { NEW_CONVERSATION, QUESTION_MAX, SPOKEN_WAITING, TALK_SAID, pressableOf, type Turn } from "@/messages/conversation";
import { useConversation } from "@/messages/ConversationContext";
import { unanswered, vestaWorking } from "@/messages/conversationModel";
import { AnnouncementPhoto, PageLink, RecordButtons } from "./AnnouncementContent";
import TalkButton from "./TalkButton";

/** One line of the thread: who said it, when, its words, the camera pictures VESTA looked at and the page it attached
 *  ("Open the page" only for a profile the add-on serves pages to). A spoken question (hold to talk) carries the
 *  microphone, and says it was spoken until VESTA heard its words. Pure: a check draws it. */
export function TurnLine({ turn, canOpenPage }: { turn: Turn; canOpenPage: boolean }) {
  return (
    <div className={`vesta-turn ${turn.from === "person" ? "asked" : "answered"}${turn.voice ? " vesta-turn-spoken" : ""}`}>
      <div className="vesta-turn-head">
        <b>{turn.from === "person" ? "You" : "VESTA"}</b>
        {turn.voice && <Mic size={14} aria-label="spoken" />}
        {turn.at && <span className="muted">{momentText(turn.at)}</span>}
      </div>
      {turn.photos.map((id) => <AnnouncementPhoto key={id} id={id} className="announcement-full-photo" />)}
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
    <div className="vesta-turn answered vesta-working" role="status" aria-label="VESTA is answering">
      <span className="vesta-working-dot" /><span className="vesta-working-dot" /><span className="vesta-working-dot" />
    </div>
  );
}

export default function VestaWindow({ onClose, canOpenPage }: { onClose: () => void; canOpenPage: boolean }) {
  const { thread, ask, said, tell, talker } = useConversation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const working = vestaWorking(thread, Date.now());
  // the dots come in view as a new line does
  const lastKey = `${thread.lines.length ? thread.lines[thread.lines.length - 1].seq : ""}${working ? "…" : ""}`;
  // the newest line in view as it arrives, as a chat does
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [lastKey]);

  const send = async (words: string) => {
    setSending(true);
    const out = await ask(words);
    setSending(false);
    if (out === "sent" && words !== NEW_CONVERSATION) setText("");
  };
  const submit = () => { if (text.trim() && !sending) void send(text.trim()); };

  return (
    <Window kind="content" label="VESTA" onClose={onClose} className="settings-modal vesta-modal">
      <div className="modal-header">
        <h2>VESTA</h2>
        <div className="modal-header-actions">
          <button type="button" className="btn ghost" disabled={sending} onClick={() => void send(NEW_CONVERSATION)}>
            <RotateCcw size={16} aria-hidden /> New conversation
          </button>
        </div>
      </div>
      <div className="modal-body vesta-thread">
      <div className="vesta-thread-lines" role="log" aria-live="polite">
        {thread.lines.length === 0 && (
          <p className="muted body-text messages-empty">Ask VESTA about the villa: what is on, what happened, what to check.</p>
        )}
        {thread.lines.map((t) => <TurnLine key={t.key} turn={t} canOpenPage={canOpenPage} />)}
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
        <button type="submit" className="btn primary" disabled={sending || !text.trim()}>
          <Send size={16} aria-hidden /> Ask
        </button>
      </form>
      {said && <p className="muted body-text">{said}</p>}
      </div>
      <ModalFooter onClose={onClose} />
    </Window>
  );
}
