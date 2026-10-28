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
import { fetchFeed, type FeedRead } from "./feed";
import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

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
  /** Where it comes from: the villa's own announcement (none said), or VESTA's card as it stands on Telegram (ticket 25-27
   *  of "One inbox": the add-on's /vesta-messages). Two feeds number apart: `vesta` keeps their numbers apart here. */
  feed?: "vesta";
  /** VESTA's card: the Status lines above its bottom line (the history: alert sent, reminder, pressed…); none for the
   *  villa's own. */
  story?: string[];
  /** VESTA's card: the automation runs whose villa announcements it stands for (shown in their place). */
  takes?: string[];
  /** The villa's own: the automation run that announced it (the add-on reads it from the event). */
  run?: string;
}

export interface AnnouncementButton { label: string; command: string }

/** Where a problem is: raised, still open, cleared. null: the announcement says none (a weekly test, a digest). */
export type Stage = "new" | "existing" | "closed";

/** The mark the layout writes before a stage's status, READ FROM THE AGREEMENT (agent-contract.json `stageMarks`, the
 *  one list the VESTA Agent writes them from and generates the villa's template with; review Q 3, 2026-10-28: this
 *  was a hand-made copy, so a mark changed on the Agent's side read a cleared alarm as new here). The longest first:
 *  "⚠️ ⚙️" opens with "⚠️". Both ends — watch (cleared, still watched) and closed — are "closed" here: a problem that
 *  ended; a stage this build does not know is not read. Every source that fires the announcement writes these marks only with a stage (research 01 of "One inbox"). */
const AS_STAGE: Record<string, Stage> = { new: "new", existing: "existing", watch: "closed", closed: "closed" };
const STAGE_MARKS: readonly [string, Stage][] = (Object.entries(AGENT_CONTRACT.stageMarks) as [string, string][])
  .flatMap(([stage, mark]): [string, Stage][] => (AS_STAGE[stage] ? [[mark, AS_STAGE[stage]]] : []))
  .sort(([x], [y]) => y.length - x.length);

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
  const r = numbered(raw);
  if (!r || typeof r.message !== "string") return null;
  const parts = readLayout(r.message);
  if (!parts.title && !parts.text) return null;
  const key = typeof r.key === "string" && r.key ? r.key : null;
  return {
    seq: r.seq, at: atOf(r), ...parts, photo: photoOf(r), key,
    buttons: key ? buttonsOf(r.buttons) : [],
    ...(typeof r.run === "string" && r.run ? { run: r.run } : {}),
  };
}

/** A stored record of either feed with its number; null for anything else. */
function numbered(raw: unknown): (Record<string, unknown> & { seq: number }) | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  return r && typeof r.seq === "number" && Number.isInteger(r.seq) ? (r as Record<string, unknown> & { seq: number }) : null;
}
const atOf = (r: Record<string, unknown>) => (typeof r.at === "string" ? r.at : "");
const photoOf = (r: Record<string, unknown>) => (typeof r.photo === "string" && PHOTO_ID.test(r.photo) ? r.photo : null);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/**
 * One of VESTA's cards as the add-on keeps it (agent-contract.json `vestaMessage`), read as an announcement so every
 * screen draws it the way it draws the villa's: its title as Telegram heads it ("#91-P2 (new)"), "To:", its alert and
 * "What to do", its Status story and bottom line, its snapshot. ⚠️ ITS BUTTONS ARE NOT DRAWN: VESTA's Done and Need help
 * are pressed on Telegram until the tablet can press them (ticket 22 of "One inbox"); a button that does nothing is not
 * shown. null for anything this build cannot read. Pure: tests/oracles/messages_model.mjs.
 */
export function parseVestaMessage(raw: unknown): Announcement | null {
  const r = numbered(raw);
  if (!r || typeof r.key !== "string" || !r.key) return null;
  const lines = strings(r.status);
  const text = [r.lead, r.body].filter((x): x is string => typeof x === "string" && x.trim() !== "").join("\n");
  const title = typeof r.title === "string" ? r.title : "";
  if (!title && !text && !lines.length) return null;
  return {
    seq: r.seq, at: atOf(r), title, to: strings(r.roles).join(" & "), text,
    status: lines[lines.length - 1] ?? "", story: lines.slice(0, -1), photo: photoOf(r),
    key: r.key, buttons: [], feed: "vesta", takes: strings(r.takes),
  };
}

/** VESTA's cards, a read of the add-on's feed (messages/feed), as the announcements are read. */
export const fetchVestaMessages = (after: number | null, stop: AbortSignal): Promise<FeedRead<Announcement> | null> =>
  fetchFeed("vesta-messages", "messages", parseVestaMessage, after, stop);

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

/** The kept announcements, a read of the add-on's feed (messages/feed); with `after`, only newer ones, the add-on
 *  waiting for one to come. null = not reached. */
export const fetchAnnouncements = (after: number | null, stop: AbortSignal): Promise<FeedRead<Announcement> | null> =>
  fetchFeed("announcements", "announcements", parseAnnouncement, after, stop);
