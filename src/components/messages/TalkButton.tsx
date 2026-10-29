// src/components/messages/TalkButton.tsx
// Hold to talk to VESTA (ticket 23 of "One inbox"), ONE button for both places it is pressed (architecture review R,
// 2026-10-29): the top bar's, left of the robot (a TAP opens the conversation, as it always has), and the one in the
// conversation's own box. What a press does is the page's one session (messages/talk); this hands it the pointer and
// draws it. ⚠️ THE ORB (owner, 2026-10-29: "an orb while VESTA listens, as Cornelius does … from an already open
// conversation, not the whole orb again"): a hold from the top bar puts the big orb over the screen until the finger
// lifts, then the conversation shows; a hold in the conversation lights this button's own small orb. ⚠️ THE MICROPHONE
// ONLY WHERE THE PAGE CAN RECORD (spec story 49): an http page, or a browser with no microphone, keeps the speech
// bubble on the top bar (tap only) and no button in the conversation, so nothing on screen is dead.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Mic } from "lucide-react";
import { useConversation } from "@/messages/ConversationContext";
import type { TalkPlace } from "@/messages/talk";
import VoiceOrb from "./VoiceOrb";

/** What the button says (its title, for a reader too) in each phase of its own press. */
const SAYS = {
  listening: "VESTA is listening: let go to send",
  sending: "Sending your question to VESTA",
} as const;

export default function TalkButton({ place, onOpen, onTap, className, idle, children }: {
  place: TalkPlace;
  /** Shows the conversation (after a hold, and for a tap of the top bar's button). */
  onOpen: () => void;
  /** A tap, the finger lifted before the hold: the top bar opens the conversation; the conversation's box says how. */
  onTap: () => void;
  className: string;
  /** What the button says while nothing is pressed. */
  idle: string;
  /** Drawn beside the icon (the conversation's button names itself). */
  children?: ReactNode;
}) {
  const { talker, talk } = useConversation();
  // a question sending is the page's (both buttons say so: neither takes a press then); listening, the held button's
  const phase = talk.phase === "sending" || talk.place === place ? talk.phase : "idle";
  const label = phase === "idle" ? idle : SAYS[phase];
  return (
    <>
      <button
        type="button"
        className={`${className} talk-btn${phase !== "idle" ? ` talk-${phase}` : ""}`}
        title={label} aria-label={label}
        onPointerDown={(e) => {
          // a finger that slides off while talking still sends on release
          if (talker && e.button === 0 && talker.down(place, onOpen)) e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={() => talker?.up()}
        onPointerCancel={() => talker?.interrupted()}
        onContextMenu={(e) => { if (talker) e.preventDefault(); }}
        // the session says whether this click is a tap (never after a hold, nor a press refused while sending)
        onClick={() => { if (!talker || talker.clicked()) onTap(); }}
      >
        {place === "thread" && phase === "listening" && <VoiceOrb size="small" />}
        {talker && <Mic size={place === "bar" ? 24 : 16} aria-hidden />}
        {!talker && <MessageCircle size={24} aria-hidden />}
        {children}
      </button>
      {place === "bar" && phase === "listening" && <ListeningOverScreen />}
    </>
  );
}

/** The big orb over the whole screen, above every window, while a hold from the top bar listens. */
function ListeningOverScreen() {
  return createPortal(
    <div className="talk-orb-overlay" role="status" aria-live="assertive">
      <VoiceOrb size="full" />
      <p className="talk-orb-says">VESTA is listening</p>
      <p className="talk-orb-hint">Let go to send</p>
    </div>, document.body);
}
