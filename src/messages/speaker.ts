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
  play: (sound: () => Promise<ArrayBuffer | null>, atTheTouch: boolean, ended: () => void) => Promise<boolean>;
  stop: () => void;
  sound: (name: string) => Promise<ArrayBuffer | null>;
  tell: (line: string | null) => void;
  now: () => number;
}

export class Speaker {
  private spokenAt: number | null = null;
  private held: readonly Turn[] = [];
  private deps: SpeakerDeps;
  // ⚠️ AN ANSWER BEING SAID CAN BE STOPPED (owner, 2026-10-30: "make sure the user can stop the voice streaming /
  // replay, by showing a stop button instead of the Play button"): the sound being said now (its name), each play its
  // own run so the end of one stopped by the next never clears the next
  private saying: string | null = null;
  private run = 0;
  private listeners = new Set<(name: string | null) => void>();
  constructor(deps: SpeakerDeps) { this.deps = deps; }

  /** The answer's sound being said now (its name), null when none: its line shows Stop in place of Listen. */
  get playing(): string | null { return this.saying; }

  /** Told each time `playing` changes; the returned function stops telling. */
  watch(listener: (name: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Stop pressed: the answer stops being said. */
  stop(): void {
    this.run += 1;
    this.deps.stop();
    this.said(null);
  }

  private said(name: string | null): void {
    if (this.saying === name) return;
    this.saying = name;
    this.listeners.forEach((l) => l(name));
  }

  private async say(name: string, atTheTouch: boolean): Promise<boolean> {
    const run = ++this.run;
    const played = await this.deps.play(() => this.deps.sound(name), atTheTouch, () => {
      if (this.run === run) this.said(null);
    });
    if (played && this.run === run) this.said(name);
    return played;
  }

  /** This page sent a spoken question: its answer is said aloud here. */
  asked(): void { this.spokenAt = this.deps.now(); }

  /** A read of the conversation: the sound that just arrived plays, once, on the tablet that asked; one the tablet
   *  will not start says to tap Listen. Whether it was played. */
  async read(turns: readonly Turn[]): Promise<boolean> {
    const name = arrivedSpeech(this.held, turns);
    this.held = turns;
    if (!name || !playsAloud(this.spokenAt, this.deps.now())) return false;
    this.spokenAt = null;
    const played = await this.say(name, false);
    if (!played) this.deps.tell(LISTEN_SAID);
    return played;
  }

  /** Listen pressed: the answer's sound from the press itself (an iPad starts a page's sound only there); one that
   *  cannot be played says so, never nothing. */
  async listen(name: string): Promise<boolean> {
    const played = await this.say(name, true);
    this.deps.tell(played ? null : LISTEN_FAILED);
    return played;
  }

  /** The profile changed: nothing it asked goes on speaking for the next one. */
  close(): void {
    this.spokenAt = null;
    this.held = [];
    this.stop();
  }
}
