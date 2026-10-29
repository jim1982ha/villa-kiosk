// src/messages/speaker.ts
// VESTA's answer said aloud (ticket 24 of "One inbox"), ONE module for the page (architecture review, 2026-10-30): when an
// answer's sound plays as it comes (only on the tablet that asked, while the add-on would keep that question), what is
// said when it cannot (Listen's line), Listen's own press, and the stop when a profile goes. The provider (ConversationContext)
// and the Listen button only hand it what happened; a check drives it with a player and a clock of its own
// (tests/oracles/speaker.mjs). The sound itself is played by messages/voice (playSpeech: the page's one audio context).

import { LISTEN_FAILED, LISTEN_SAID, type Turn } from "./conversation";
import { arrivedSpeech, playsAloud } from "./conversationModel";

/** What the speaker needs from the page: injected, never stored browser functions (kiosk-code: "Node green, browser
 *  dead"). `play`: messages/voice.playSpeech; `sound`: the answer's sound by its name (conversation.fetchSpeech). */
export interface SpeakerDeps {
  play: (sound: () => Promise<ArrayBuffer | null>, atTheTouch: boolean) => Promise<boolean>;
  stop: () => void;
  sound: (name: string) => Promise<ArrayBuffer | null>;
  tell: (line: string | null) => void;
  now: () => number;
}

export class Speaker {
  private spokenAt: number | null = null;
  private held: readonly Turn[] = [];
  private deps: SpeakerDeps;
  constructor(deps: SpeakerDeps) { this.deps = deps; }

  /** This page sent a spoken question: its answer is said aloud here. */
  asked(): void { this.spokenAt = this.deps.now(); }

  /** A read of the conversation: the sound that just arrived plays, once, on the tablet that asked; one the tablet
   *  will not start says to tap Listen. Whether it was played. */
  async read(turns: readonly Turn[]): Promise<boolean> {
    const name = arrivedSpeech(this.held, turns);
    this.held = turns;
    if (!name || !playsAloud(this.spokenAt, this.deps.now())) return false;
    this.spokenAt = null;
    const played = await this.deps.play(() => this.deps.sound(name), false);
    if (!played) this.deps.tell(LISTEN_SAID);
    return played;
  }

  /** Listen pressed: the answer's sound from the press itself (an iPad starts a page's sound only there); one that
   *  cannot be played says so, never nothing. */
  async listen(name: string): Promise<boolean> {
    const played = await this.deps.play(() => this.deps.sound(name), true);
    this.deps.tell(played ? null : LISTEN_FAILED);
    return played;
  }

  /** The profile changed: nothing it asked goes on speaking for the next one. */
  close(): void {
    this.spokenAt = null;
    this.held = [];
    this.deps.stop();
  }
}
