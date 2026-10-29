// src/messages/conversation.ts
// Talking to VESTA on the tablet (ticket 21 of "One inbox", owner 2026-10-28): the signed-in profile's conversation, kept
// by the add-on (supervisor-proxy.py /vesta-conversation), and a question asked (/vesta-ask). ⚠️ THE PAGE SENDS WORDS
// ONLY: the add-on stamps the question with the session's profile and keeps it for the VESTA Agent, which collects it and
// writes its answer back; the page never names a profile, a role or the Agent. Each profile reads its own conversation,
// apart from every Telegram chat.

import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";
import { fetchFeed, type FeedRead } from "./feed";
import { vestaButtons, type AnnouncementButton, type Pressable } from "./announcements";
import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

/** One line of the conversation: the person's question, or VESTA's answer. */
export interface Turn {
  /** Its order in the add-on's store: a page asks for what came after the last one it holds. */
  seq: number;
  /** One line per key: a rewrite (a "being prepared" answer become its result) replaces it. */
  key: string;
  from: "person" | "vesta";
  /** When it was said (ISO). */
  at: string;
  text: string;
  /** The camera pictures VESTA's answer carries (the add-on's photo ids); none for a profile that may not view cameras. */
  photos: string[];
  /** A page VESTA attached (the add-on's document id), opened in the document viewer. */
  page: string | null;
  /** VESTA withdrew it (as a message deleted on Telegram): not shown. */
  gone: boolean;
  /** VESTA's buttons under it (Continue, an offer), read as a message's are (announcements.vestaButtons). */
  buttons: AnnouncementButton[];
  /** A press's short answer: the number of the press it answers (shown under that button, never as a line). */
  answers: number | null;
  /** VESTA says it is answering (Telegram's "typing…"), as of `at`: the dots in its bubble, never a line. */
  typing: boolean;
  /** The person's question was spoken (hold to talk): its words are the ones VESTA heard, empty until it heard them. */
  voice: boolean;
  /** VESTA's answer said aloud by the villa's voice (ticket 24): the add-on's name for its sound, read at /vesta-speech. */
  speech: string | null;
}

/** The longest question the add-on keeps (agent-contract.json conversation.limits.question). */
export const QUESTION_MAX: number = AGENT_CONTRACT.conversation.limits.question;

/** A turn as the add-on sent it, or null when it is not one. Pure: tests/oracles/conversation_model.mjs. */
export function parseTurn(raw: unknown): Turn | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.seq !== "number" || typeof r.key !== "string" || (r.from !== "person" && r.from !== "vesta")) return null;
  return {
    seq: r.seq, key: r.key, from: r.from, at: typeof r.at === "string" ? r.at : "",
    text: typeof r.text === "string" ? r.text : "",
    photos: Array.isArray(r.photos) ? r.photos.filter((p): p is string => typeof p === "string") : [],
    page: typeof r.page === "string" && r.page ? r.page : null,
    gone: r.gone === true,
    buttons: vestaButtons(r.buttons),
    answers: typeof r.answers === "number" ? r.answers : null,
    typing: r.typing === true,
    voice: r.voice === true,
    speech: typeof r.speech === "string" && r.speech ? r.speech : null,
  };
}

/** An answer's sound (the add-on serves it to the profile it answered only), or null when it cannot be had. */
export async function fetchSpeech(name: string): Promise<ArrayBuffer | null> {
  try {
    const r = await backendFetch(ingressPath(`vesta-speech/${encodeURIComponent(name)}`), { credentials: "same-origin" });
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** This profile's conversation, a read of the add-on's feed (messages/feed); the read also says whether VESTA runs. */
export const fetchConversation = (after: number | null, stop: AbortSignal): Promise<FeedRead<Turn> | null> =>
  fetchFeed("vesta-conversation", "turns", parseTurn, after, stop);

/** Whether a read says VESTA runs (the add-on reads its heartbeat: every profile is told, a guest too). */
export const vestaRuns = (read: FeedRead<Turn>): boolean => read.said.vesta === "online";

/** What became of a question: kept for VESTA; VESTA is not running; too many at once; not sent. */
export type AskOutcome = "sent" | "offline" | "busy" | "failed";

/** The line under the box when a question did not go. */
export const ASK_SAID: Record<Exclude<AskOutcome, "sent">, string> = {
  offline: "VESTA is not running: nobody can answer now.",
  busy: "Too many questions at once: wait a minute.",
  failed: "Not sent, try again.",
};

/** The line under the box when a spoken question was not recorded (hold to talk): the microphone refused, none, or
 *  nothing heard while the button was held. */
export const TALK_SAID: Record<"refused" | "none" | "silent" | "cut" | "hold", string> = {
  refused: "The microphone is not allowed: allow it for this page in the browser's settings, then hold to talk again.",
  none: "No microphone could be used on this device.",
  silent: "Nothing was recorded: keep holding the button while you speak.",
  cut: "Your question was not sent: the touch was interrupted. Hold to talk again.",
  hold: "Hold the microphone while you speak, then let go to send.",
};

/** The line under the box when VESTA's answer could not start aloud by itself (the tablet stopped the page's sound since
 *  the question: the screen locked, a call): Listen plays it. */
export const LISTEN_SAID = "Tap Listen to hear VESTA's answer.";

/** What a spoken question's line says until VESTA has heard its words. */
export const SPOKEN_WAITING = "Spoken question";

/** What "New conversation" sends: the command the Agent's gate reads, as on Telegram. */
export const NEW_CONVERSATION = "/new";

/** Ask VESTA: words typed, or a spoken question's WAV (messages/voice: hold to talk) — the add-on stamps who asks.
 *  `send` is backendFetch (a check passes its own). */
export async function askVesta(
  question: string | Blob, send: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>,
): Promise<AskOutcome> {
  const spoken = typeof question !== "string";
  try {
    const r = await send(ingressPath("vesta-ask"), {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": spoken ? "audio/wav" : "application/json" },
      body: spoken ? question : JSON.stringify({ text: question }),
    });
    return r.ok ? "sent" : r.status === 503 ? "offline" : r.status === 429 ? "busy" : "failed";
  } catch {
    return "failed";
  }
}

/** A turn as its buttons are pressed (announcements.pressOf: VESTA's door). */
export const pressableOf = (t: Turn): Pressable => ({ seq: t.seq, key: t.key, buttons: t.buttons, feed: "turn" });
