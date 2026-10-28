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
}

/** How long a new announcement stays on screen as a notice. */
export const ANNOUNCEMENT_NOTICE_MS = 10_000;
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

/** One stored record, narrowed to what this build shows; null for anything it cannot. */
export function parseAnnouncement(raw: unknown): Announcement | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.seq !== "number" || !Number.isInteger(r.seq) || typeof r.message !== "string") return null;
  const parts = readLayout(r.message);
  if (!parts.title && !parts.text) return null;
  return {
    seq: r.seq, at: typeof r.at === "string" ? r.at : "", ...parts,
    photo: typeof r.photo === "string" && PHOTO_ID.test(r.photo) ? r.photo : null,
  };
}

/** Where the add-on serves an announcement's photo. */
export const announcementPhotoUrl = (id: string): string => ingressPath(`announcement-photo/${id}`);

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
