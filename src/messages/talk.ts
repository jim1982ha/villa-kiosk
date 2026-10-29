// src/messages/talk.ts
// ⚠️ ONE SPOKEN QUESTION AT A TIME, FOR THE WHOLE PAGE (architecture review R, 2026-10-29; owner: "an orb while VESTA
// listens, as Cornelius does … from an already open conversation, not the whole orb again"). Hold to talk is pressed
// in two places, the top bar and the conversation's own box, and drawn in two sizes (the orb over the screen from the
// top bar, the button's own small orb in the conversation): what a press does (tap or hold, the microphone, the
// longest question, a touch the tablet cut short, what is sent and what is said) lives here once, out of React, so a
// check drives it press by press (tests/oracles/talk_session.mjs). The buttons only hand it their pointer.

import { TALK_SAID } from "./conversation";
import type { Listening, Recording } from "./voice";

/** Where the hold began: the top bar (the conversation not open yet: the big orb) or the conversation itself. */
export type TalkPlace = "bar" | "thread";
/** What the page shows of the press now. */
export interface TalkView { phase: "idle" | "listening" | "sending"; place: TalkPlace | null }
export const TALK_IDLE: TalkView = { phase: "idle", place: null };

/** What the session needs from the page: injected, so a check gives it a recorder and a clock of its own.
 *  ⚠️ `after`/`cancel` are called, never stored browser functions (kiosk-code: "Node green, browser dead"). */
export interface TalkDeps {
  record: (onLevel: (level: number) => void) => Recording;
  /** The microphone may open at the touch (voice.microphoneAllowed): the person allowed it. */
  allowed: () => boolean;
  send: (wav: Blob) => Promise<unknown>;
  tell: (line: string | null) => void;
  after: (ms: number, fn: () => void) => unknown;
  cancel: (timer: unknown) => void;
  holdMs: number;
  /** The longest question, in ms (the agreement's conversation.voice.seconds). */
  capMs: number;
}

interface Press { rec: Recording; place: TalkPlace; open: () => void; held: boolean; over: boolean; hold: unknown;
  cap?: unknown }

export class TalkSession {
  private press: Press | null = null;
  private view: TalkView = TALK_IDLE;
  private views = new Set<(v: TalkView) => void>();
  private levels = new Set<(level: number) => void>();
  // the click that follows a press is no tap when the press was a hold, or was refused (a question still sending)
  private swallow = false;
  private deps: TalkDeps;
  constructor(deps: TalkDeps) { this.deps = deps; }

  /** What the page shows, told again at each change. */
  watch(fn: (v: TalkView) => void): () => void { this.views.add(fn); fn(this.view); return () => this.views.delete(fn); }
  /** How loud the voice is (0…1), many times a second: for the orb, never for React state. */
  hear(fn: (level: number) => void): () => void { this.levels.add(fn); return () => this.levels.delete(fn); }
  get now(): TalkView { return this.view; }

  private show(v: TalkView) { this.view = v; this.views.forEach((fn) => fn(v)); }

  private end(p: Press) {
    p.over = true;
    this.deps.cancel(p.hold);
    if (p.cap !== undefined) this.deps.cancel(p.cap);
    if (this.press === p) this.press = null;
  }

  /** A finger down on a talk button: the recording begins (the microphone too once allowed: nothing said is lost);
   *  `open` shows the conversation. False when this press is not taken (one already runs, or a question is sending). */
  down(place: TalkPlace, open: () => void): boolean {
    this.swallow = false;
    if (this.press || this.view.phase === "sending") { this.swallow = true; return false; }
    let rec: Recording;
    try {
      rec = this.deps.record((level) => this.levels.forEach((fn) => fn(level)));
    } catch {
      return false;
    }
    if (this.deps.allowed()) void rec.listen();
    const p: Press = { rec, place, open, held: false, over: false, hold: undefined };
    p.hold = this.deps.after(this.deps.holdMs, () => void this.held(p));
    this.press = p;
    return true;
  }

  private async held(p: Press) {
    p.held = true;
    this.show({ phase: "listening", place: p.place });
    const got: Listening = await p.rec.listen();
    if (p.over) return;                                  // already let go (finish told what was recorded)
    if (got !== "listening") {
      this.end(p);
      this.show(TALK_IDLE);
      this.deps.tell(TALK_SAID[got]);
      p.open();
      return;
    }
    p.cap = this.deps.after(this.deps.capMs, () => void this.finish(p));
  }

  /** The finger lifted: "tap" (nothing recorded: the button's click opens the conversation) or "held" (sent). */
  up(): "tap" | "held" | null {
    const p = this.press;
    if (!p) return null;
    if (!p.held) { this.end(p); p.rec.cancel(); return "tap"; }
    this.swallow = true;
    void this.finish(p);
    return "held";
  }

  /** The button's click: true when it is a tap to act on (a tap, or a key press with no finger at all); false after a
   *  hold, or after a press refused while a question was sending (architecture review R, round 2: the conversation's
   *  button said "Hold the microphone while you speak" to a person who had just held it). */
  clicked(): boolean {
    const tap = !this.swallow;
    this.swallow = false;
    return tap;
  }

  /** The touch taken away (a banner, a call): a hold says its question was not sent, never vanishes in silence. */
  interrupted(): void {
    const p = this.press;
    if (!p) return;
    this.end(p);
    p.rec.cancel();
    this.show(TALK_IDLE);
    if (p.held) { this.deps.tell(TALK_SAID.cut); p.open(); }
  }

  /** Let go, or the longest question reached: the orb goes, the conversation shows, the recording is sent. */
  private async finish(p: Press) {
    if (p.over) return;
    this.end(p);
    this.show({ phase: "sending", place: p.place });
    p.open();
    const wav = await p.rec.stop();
    if (wav) await this.deps.send(wav);
    else this.deps.tell(TALK_SAID.silent);
    this.show(TALK_IDLE);
  }

  /** The page goes (a profile signed out mid-hold, VESTA stopped): nothing outlives it. */
  close(): void {
    const p = this.press;
    if (p) { this.end(p); p.rec.cancel(); }
    this.show(TALK_IDLE);
  }
}
