// src/components/hud/TalkButton.tsx
// The top bar's VESTA button, left of the robot (ticket 23 of "One inbox", owner 2026-10-28: "hold to talk, tap to
// open VESTA's thread"). A TAP opens the thread, as it always has; a HOLD records a spoken question while the finger
// stays down, and sends it on release (messages/voice: the villa's own Whisper writes it out, never Apple's or
// Google's dictation). ⚠️ THE MICROPHONE ONLY WHERE THE PAGE CAN RECORD (spec story 49): an http page, or a browser with
// no microphone, keeps the speech bubble, tap only, so nothing on screen is dead.
//
// ⚠️ THE MICROPHONE IS ASKED FOR ONLY ONCE THE HOLD IS A HOLD (HOLD_MS_HUD, the top bar's one hold): a tap never
// prompts. The sound is started AT THE PRESS (startRecording), because an iPad lets a page make sound only inside the
// person's gesture, and a timer is not one.

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { MessageCircle, Mic } from "lucide-react";
import { useConversation } from "@/messages/ConversationContext";
import { TALK_SAID } from "@/messages/conversation";
import { VOICE, canRecord, startRecording, type Recording } from "@/messages/voice";
import { HOLD_MS_HUD } from "@/utils/tapThresholds";

type Phase = "idle" | "listening" | "sending";

/** One press: its recording, its timers (the hold, the longest question), whether it became a hold, whether it ended. */
interface Press { rec: Recording; hold: ReturnType<typeof setTimeout>; cap?: ReturnType<typeof setTimeout>; held: boolean;
  over: boolean }

export default function TalkButton({ onOpen }: { onOpen: () => void }) {
  const { ask, tell } = useConversation();
  const [phase, setPhase] = useState<Phase>("idle");
  // one press at a time; a hold's click that follows is then no tap (heldClick)
  const press = useRef<Press | null>(null);
  const heldClick = useRef(false);
  // a button that cannot record is the speech bubble: decided once, the page's security does not change while it runs
  const [talks] = useState(canRecord);

  const end = (p: Press) => {
    p.over = true;
    clearTimeout(p.hold);
    if (p.cap) clearTimeout(p.cap);
    if (press.current === p) press.current = null;
  };

  /** Let go (or the longest question reached): the recording sent, the thread opened on it. */
  const finish = async (p: Press) => {
    if (p.over) return;
    end(p);
    setPhase("sending");
    const wav = await p.rec.stop();
    if (wav) await ask(wav);
    else tell(TALK_SAID.silent);
    setPhase("idle");
    onOpen();
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    heldClick.current = false;     // a hold whose click never came (the finger slid off) never swallows this tap
    if (!talks || e.button !== 0 || press.current || phase === "sending") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);   // a finger that slides off while talking still sends on release
    let rec: Recording;
    try {
      rec = startRecording();
    } catch {
      return;
    }
    const p: Press = { rec, held: false, over: false, hold: setTimeout(async () => {
      p.held = true;
      heldClick.current = true;
      setPhase("listening");
      const got = await rec.listen();
      if (p.over) return;                                  // already let go (finish told what was recorded)
      if (got !== "listening") {
        end(p);
        setPhase("idle");
        tell(TALK_SAID[got]);
        onOpen();
        return;
      }
      p.cap = setTimeout(() => void finish(p), VOICE.seconds * 1000);
    }, HOLD_MS_HUD) };
    press.current = p;
  };

  const up = () => {
    const p = press.current;
    if (!p) return;
    if (p.held) void finish(p);
    else { end(p); p.rec.cancel(); }                       // a tap: the click that follows opens the thread
  };

  const cancel = () => {
    const p = press.current;
    if (!p) return;
    end(p);
    p.rec.cancel();
    setPhase("idle");
  };

  // a recording never outlives the button (a profile signed out mid-hold, VESTA stopped)
  useEffect(() => () => { const p = press.current; if (p) { end(p); p.rec.cancel(); } }, []);

  const label = phase === "listening" ? "Recording: let go to send to VESTA"
    : phase === "sending" ? "Sending your question to VESTA"
    : talks ? "Ask VESTA: tap to open, hold to talk" : "Ask VESTA";
  return (
    <button
      className={`icon-btn talk-btn${phase !== "idle" ? ` talk-${phase}` : ""}`}
      title={label} aria-label={label}
      onPointerDown={down} onPointerUp={up} onPointerCancel={cancel}
      onContextMenu={(e) => { if (talks) e.preventDefault(); }}
      onClick={() => {
        if (heldClick.current) { heldClick.current = false; return; }
        if (phase === "idle") onOpen();
      }}
    >
      {talks && <Mic size={24} />}
      {!talks && <MessageCircle size={24} />}
    </button>
  );
}
