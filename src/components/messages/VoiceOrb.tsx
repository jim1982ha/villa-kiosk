// src/components/messages/VoiceOrb.tsx
// The orb that shows VESTA hears the person (owner, 2026-10-29, after Cornelius): it swells with the voice. Two sizes,
// one drawing (09-agent.css .voice-orb): over the screen for a hold from the top bar, inside the conversation's talk
// button for a hold there. ⚠️ THE LEVEL NEVER GOES THROUGH REACT: it changes many times a second, and a state would
// draw the whole page (the 3D villa's controls included) as often; it is a CSS variable on this element only.

import { useEffect, useRef } from "react";
import { useConversation } from "@/messages/ConversationContext";

export default function VoiceOrb({ size }: { size: "full" | "small" }) {
  const { talker } = useConversation();
  const orb = useRef<HTMLSpanElement>(null);
  useEffect(() => talker?.hear((level) => orb.current?.style.setProperty("--voice", level.toFixed(3))), [talker]);
  return <span ref={orb} className={`voice-orb voice-orb-${size}`} aria-hidden />;
}
