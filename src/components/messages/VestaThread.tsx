// src/components/messages/VestaThread.tsx
// VESTA's thread, open on the right of Messages (ticket 21 of "One inbox", owner 2026-10-28): this profile's conversation
// with VESTA, a box to ask, and "New conversation" (Telegram's /new). The question is sent as typed; the add-on stamps who
// asks, and VESTA's answer arrives in the thread (messages/ConversationContext). What it shows is the model's
// (messages/conversationModel); this draws it.

import { useEffect, useRef, useState } from "react";
import { FileText, RotateCcw, Send } from "lucide-react";
import { localStamp } from "@/fm/fmEngine";
import { documentUrl } from "@/fm/fmApi";
import { ASK_SAID, NEW_CONVERSATION, QUESTION_MAX, type Turn } from "@/messages/conversation";
import { useConversation } from "@/messages/ConversationContext";
import { unanswered } from "@/messages/conversationModel";
import { AnnouncementPhoto } from "./AnnouncementContent";

/** One line of the thread: who said it, when, its words, the camera pictures VESTA looked at and the page it attached
 *  ("Open the page" only for a profile the add-on serves pages to). Pure: a check draws it. */
export function TurnLine({ turn, canOpenPage }: { turn: Turn; canOpenPage: boolean }) {
  return (
    <div className={`vesta-turn ${turn.from === "person" ? "asked" : "answered"}`}>
      <div className="vesta-turn-head">
        <b>{turn.from === "person" ? "You" : "VESTA"}</b>
        {turn.at && <span className="muted">{localStamp(turn.at)}</span>}
      </div>
      {turn.photos.map((id) => <AnnouncementPhoto key={id} id={id} className="announcement-full-photo" />)}
      {turn.text && <p className="vesta-turn-text">{turn.text}</p>}
      {turn.page && canOpenPage && (
        <a className="fm-document-link" href={documentUrl(turn.page)} target="_blank" rel="noopener noreferrer">
          <FileText size={15} aria-hidden="true" /> Open the page
        </a>
      )}
    </div>
  );
}

export default function VestaThread({ canOpenPage }: { canOpenPage: boolean }) {
  const { thread, ask } = useConversation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const lastKey = thread.lines.length ? `${thread.lines[thread.lines.length - 1].seq}` : "";
  // the newest line in view as it arrives, as a chat does
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [lastKey]);

  const send = async (words: string) => {
    setSending(true);
    setSaid(null);
    const out = await ask(words);
    setSending(false);
    if (out !== "sent") setSaid(ASK_SAID[out]);
    else if (words !== NEW_CONVERSATION) setText("");
  };
  const submit = () => { if (text.trim() && !sending) void send(text.trim()); };

  return (
    <div className="vesta-thread">
      <div className="messages-note-head">
        <strong>VESTA</strong>
        <button type="button" className="btn ghost" disabled={sending} onClick={() => void send(NEW_CONVERSATION)}>
          <RotateCcw size={16} aria-hidden /> New conversation
        </button>
      </div>
      <div className="vesta-thread-lines" role="log" aria-live="polite">
        {thread.lines.length === 0 && (
          <p className="muted body-text messages-empty">Ask VESTA about the villa: what is on, what happened, what to check.</p>
        )}
        {thread.lines.map((t) => <TurnLine key={t.key} turn={t} canOpenPage={canOpenPage} />)}
        {unanswered(thread.lines, Date.now()) && <p className="muted body-text">No answer came. Ask again.</p>}
        <div ref={end} />
      </div>
      <form className="vesta-thread-ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea value={text} maxLength={QUESTION_MAX} rows={2} placeholder="Ask VESTA" aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          // Enter sends, Shift+Enter starts a new line, as in a chat
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button type="submit" className="btn primary" disabled={sending || !text.trim()}>
          <Send size={16} aria-hidden /> Ask
        </button>
      </form>
      {said && <p className="muted body-text">{said}</p>}
    </div>
  );
}
