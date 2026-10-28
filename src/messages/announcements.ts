// src/messages/announcements.ts
// The villa's announcements: what its automations announce (the doorbell, an alarm, the weekly test), kept by the
// add-on (supervisor-proxy.py `/announcements`, ticket 13 of "One inbox", owner 2026-10-28). The add-on is the one
// listener; a page reads what it kept and waits on it for the next one, so a ring reaches every tablet the moment it
// is kept, with or without the VESTA Agent, whatever Telegram did with it.
//
// An announcement's text is the VESTA message layout (custom_templates/vesta_message.jinja, written by the Agent's
// message_format): "<b>title</b>\nTo: roles\n<blockquote>text</blockquote>\n\nStatus:\n<blockquote><i>status</i>
// </blockquote>" — or plain text when the layout is missing. Read here into its parts, never shown as HTML.

import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";

export interface Announcement {
  /** Its order in the add-on's store: a page asks for what came after the last one it holds. */
  seq: number;
  /** When the villa's system announced it (ISO). */
  at: string;
  title: string;
  /** Who it is for, as the layout says it ("Owner & FM"); empty when it does not. */
  to: string;
  text: string;
  /** The layout's bottom line ("⚠️ New alert", "✅ Cleared on 28/10/2026 14:05."); empty when there is none. */
  status: string;
  /** Its photo's id in the add-on (a ring's snapshot, copied when it arrived; announcementPhotoUrl serves it); null
   *  without one, or for a profile that may not view cameras (the add-on does not name it). */
  photo: string | null;
  /** What ties it to its rewrite (the add-on keeps one per key); null without one. */
  key: string | null;
  /** The buttons it offers (the doorbell's Unlock), label and command as the villa sent them: the Kiosk names no
   *  device and no command. None without a key: a press names its announcement by it. */
  buttons: AnnouncementButton[];
}

export interface AnnouncementButton { label: string; command: string }

/** Where a problem is: raised, still open, cleared. null: the announcement says none (a weekly test, a digest). */
export type Stage = "new" | "existing" | "closed";

/** The mark the layout writes before a stage's status (vesta_message.jinja `vm_icons`, the VESTA Agent's
 *  message_format.STAGE_ICONS), the longest first: "⚠️ ⚙️" opens with "⚠️". Read from 2026-10-28 on every source that
 *  fires the announcement (research 01 of "One inbox"): no source without a stage writes one of these marks. */
const STAGE_MARKS: readonly [string, Stage][] = [["⚠️ ⚙️", "existing"], ["⚠️", "new"], ["✅", "closed"]];

/** An announcement's stage, read from its bottom line; null without one. Pure: tests/oracles/announcements.mjs. */
export function stageOf(status: string): Stage | null {
  return STAGE_MARKS.find(([mark]) => status.startsWith(mark))?.[1] ?? null;
}

/** What "Full screen for" offers (Advanced Settings › Messages): each title the add-on keeps, once, in order, without
 *  the ones already `picked`. The villa's own words, never named in code. Pure: tests/oracles/announcements.mjs. */
export function announcedTitles(kept: readonly Announcement[], picked: readonly string[]): string[] {
  return [...new Set(kept.map((a) => a.title))].filter((t) => t && !picked.includes(t)).sort((x, y) => x.localeCompare(y));
}

/** How long a new announcement stays on screen as a notice. */
export const ANNOUNCEMENT_NOTICE_MS = 10_000;
/** The settings that decide how an announcement shows (AppConfig: the first two the villa's, Advanced Settings ›
 *  Messages; the third this tablet's, Settings › Messages). */
export interface ShowSettings {
  /** The titles the owner picked to take the whole screen; empty by default. */
  fullScreenFor: readonly string[];
  /** How long one of them holds the screen, in seconds ("Ring shown for"). */
  ringShownForS: number;
  /** Whether this tablet lets one take the screen ("Rings full screen on this tablet"). */
  ringsFullScreen: boolean;
}

/** How an announcement shows: full screen first for `fullScreenMs` (null: not full screen), then a notice for
 *  `noticeMs` (null: until dismissed or replaced; 0: no notice). */
export interface HowShown { fullScreenMs: number | null; noticeMs: number | null }

/**
 * How a new announcement shows (ticket 16 of "One inbox", owner 2026-10-28). Its notice goes by itself after
 * ANNOUNCEMENT_NOTICE_MS, a problem included (owner, 2.496.562: "the user shall not have to press the X"); only one
 * offering a button stays, while the button can still be pressed (until the villa's rewrite withdraws it). A title the
 * owner picked takes the whole screen first, for "Ring shown for", on a tablet that allows it; then a notice that
 * stays carries on, any other is gone. A cleared one, or a
 * `rewrite` of one already shown (a ring answered, timed out, still open), never takes the screen again: it would
 * hold the screen a second "Ring shown for". Pure: tests/oracles/announcements.mjs.
 */
export function noticeFor(a: Announcement, s: ShowSettings, { rewrite = false } = {}): HowShown {
  const stays = a.buttons.length > 0;
  const full = s.ringsFullScreen && !rewrite && stageOf(a.status) !== "closed" && s.fullScreenFor.includes(a.title);
  if (!full) return { fullScreenMs: null, noticeMs: stays ? null : ANNOUNCEMENT_NOTICE_MS };
  return { fullScreenMs: s.ringShownForS * 1000, noticeMs: stays ? null : 0 };
}

/** Pause before asking again when the add-on could not be reached. */
const RETRY_MS = 5_000;
/** A read the add-on holds open waits at most 25s (ANNOUNCEMENT_WAIT_S); one still open well after that is a
 *  connection a sleeping tablet left behind, given up so the next read can start. */
const READ_GIVE_UP_MS = 40_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text with its tags removed and its entities read, each line trimmed. */
function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[name.toLowerCase()] ?? all;
    })
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** An announcement's text read into its parts. Pure: tests/oracles/announcements.mjs drives it. */
export function readLayout(message: string): Pick<Announcement, "title" | "to" | "text" | "status"> {
  const [head, tail = ""] = message.split(/\n\s*Status:\s*\n/);
  const title = /<b>([\s\S]*?)<\/b>/i.exec(head);
  if (!title) {
    // The plain text an automation sends when the layout is missing: its first line is its title.
    const [first = "", ...rest] = plain(message).split("\n");
    return { title: first, to: "", text: rest.join("\n"), status: "" };
  }
  const to = /^\s*To:\s*(.*)$/m.exec(head.replace(title[0], ""));
  const quotes = [...head.matchAll(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi)].map((m) => plain(m[1]));
  return { title: plain(title[1]), to: to ? plain(to[1]) : "", text: quotes.filter(Boolean).join("\n"), status: plain(tail) };
}

const PHOTO_ID = /^[0-9a-f]{32}\.(?:jpg|png)$/;

/** The add-on's kept buttons ([[label, command], …] per row), in one list; a malformed one left out. */
function buttonsOf(raw: unknown): AnnouncementButton[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => (Array.isArray(row) ? row : []))
    .filter((b): b is [string, string] => Array.isArray(b) && b.length === 2 && typeof b[0] === "string"
      && typeof b[1] === "string" && b[0].trim() !== "" && b[1] !== "")
    .map(([label, command]) => ({ label, command }));
}

/** One stored record, narrowed to what this build shows; null for anything it cannot. */
export function parseAnnouncement(raw: unknown): Announcement | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.seq !== "number" || !Number.isInteger(r.seq) || typeof r.message !== "string") return null;
  const parts = readLayout(r.message);
  if (!parts.title && !parts.text) return null;
  const key = typeof r.key === "string" && r.key ? r.key : null;
  return {
    seq: r.seq, at: typeof r.at === "string" ? r.at : "", ...parts,
    photo: typeof r.photo === "string" && PHOTO_ID.test(r.photo) ? r.photo : null,
    key,
    buttons: key ? buttonsOf(r.buttons) : [],
  };
}

/** Where the add-on serves an announcement's photo. */
export const announcementPhotoUrl = (id: string): string => ingressPath(`announcement-photo/${id}`);

/** What became of a press: the villa's system has it; the button is no longer offered (the ring was answered, opened
 *  at the gate, or timed out); not sent. */
export type PressOutcome = "sent" | "withdrawn" | "failed";

/** The words under a pressed button. */
export const PRESS_SAID: Record<PressOutcome, string> = {
  sent: "Sent",
  withdrawn: "No longer offered",
  failed: "Not sent, try again",
};

/** Press a button an announcement offers: the add-on fires the villa's one press event with this key and command,
 *  only while it still offers the button (supervisor-proxy.py /announcement-press). `send` is backendFetch (a check
 *  passes its own). */
export async function pressButton(
  key: string, command: string, send: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>,
): Promise<PressOutcome> {
  try {
    const r = await send(ingressPath("announcement-press"), {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, command }),
    });
    return r.ok ? "sent" : r.status === 409 ? "withdrawn" : "failed";
  } catch {
    return "failed";
  }
}

export interface AnnouncementsRead { items: Announcement[]; last: number }

/** The kept announcements; with `after`, only newer ones, the add-on waiting for one to come. null = not reached. */
export async function fetchAnnouncements(after: number | null, stop: AbortSignal): Promise<AnnouncementsRead | null> {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  stop.addEventListener("abort", abort);
  const giveUp = setTimeout(abort, READ_GIVE_UP_MS);
  try {
    const r = await backendFetch(ingressPath(after === null ? "announcements" : `announcements?after=${after}`),
      { credentials: "same-origin", signal: ctl.signal });
    if (!r.ok) return null;
    const b = (await r.json()) as { announcements?: unknown; last?: unknown };
    const items = Array.isArray(b.announcements) ? b.announcements.map(parseAnnouncement) : [];
    return { items: items.filter((a): a is Announcement => a !== null), last: typeof b.last === "number" ? b.last : 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(giveUp);
    stop.removeEventListener("abort", abort);
  }
}

/** Calls `onNew` with each announcement kept from now on, until `stop`. What was kept before it started is not new:
 *  a page reloaded does not announce the last ring again, nor a tablet waking up what came while it slept. `read` is fetchAnnouncements (a check passes its own). */
export async function watchAnnouncements(
  read: (after: number | null, stop: AbortSignal) => Promise<AnnouncementsRead | null>,
  onNew: (items: Announcement[]) => void,
  stop: AbortSignal,
  pause: (ms: number, stop: AbortSignal) => Promise<void>,
): Promise<void> {
  let last: number | null = null;
  while (!stop.aborted) {
    const got = await read(last, stop);
    if (stop.aborted) return;
    if (got === null) {
      // Not reached, or a read a sleeping tablet left open: what was kept meanwhile is not news now, and the next
      // read starts again from what is kept (a ring from an hour ago is never a notice).
      last = null;
      await pause(RETRY_MS, stop);
      continue;
    }
    if (last !== null && got.items.length) onNew(got.items);
    // The add-on's store started again (a reinstall): its own count from now on.
    last = got.last;
  }
}

/** Waits `ms`, or less when `stop` comes first. */
export function pauseFor(ms: number, stop: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      stop.removeEventListener("abort", done);
      resolve();
    }
    stop.addEventListener("abort", done);
  });
}
