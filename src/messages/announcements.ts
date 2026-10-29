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
  /** It offered buttons once and was rewritten since (agent-contract.json `_asked`: the add-on stamps it): with none
   *  offered now, its question was answered or is over (messagesModel.placeOf). */
  asked?: boolean;
  /** VESTA's card: its alert's stage as its title says it ("new", "existing", "watch", "closed"); none without one. */
  vestaStage?: string;
  /** VESTA's report (ticket 20 of "One inbox"): the scheduled job that sent it (the morning digest, the weekly and monthly
   *  reports, the night check's message); listed under Reports, never as a notification. None for anything else. */
  report?: string;
  /** A report's page: the add-on's document id, opened in the document viewer (fmApi.documentUrl). */
  page?: string;
}

export interface AnnouncementButton {
  label: string;
  /** What a press sends: the villa's own command (the doorbell's Unlock), or VESTA's "<kind>:<id>". */
  command: string;
  /** It acts (VESTA's kinds: agent-contract.json vestaMessage.buttonKinds): never offered to a guest. */
  acts?: boolean;
  /** The question asked first, in the tablet's one confirmation box (an approval: owner, 2026-10-28). */
  confirm?: string;
}

/** What may be pressed: a villa announcement, one of VESTA's messages, a turn of VESTA's conversation. */
export interface Pressable { seq: number; key: string | null; buttons: AnnouncementButton[]; feed?: "vesta" | "turn" }

/** Each of VESTA's button kinds' rules for the tablet, read from the agreement both sides read. */
const BUTTON_KINDS = AGENT_CONTRACT.vestaMessage.buttonKinds as Record<string, { acts?: boolean; confirm?: string }>;

/** VESTA's buttons as a record carries them ([{label, kind, id}]), with their kind's rules; a malformed one left out.
 *  ONE reading for its messages and its conversation's turns (ticket 22 of "One inbox"). Pure. */
export function vestaButtons(raw: unknown): AnnouncementButton[] {
  return (Array.isArray(raw) ? raw : []).flatMap((b): AnnouncementButton[] => {
    const r = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    if (![r.label, r.kind, r.id].every((x) => typeof x === "string" && x)) return [];
    const rules = BUTTON_KINDS[r.kind as string];
    return [{ label: r.label as string, command: `${r.kind}:${r.id}`, acts: rules?.acts ?? true,
      ...(rules?.confirm ? { confirm: rules.confirm } : {}) }];
  });
}

/** ⚠️ THE ONE RULE OF WHO IS OFFERED A BUTTON (owner, 2026-10-29: "consistently", "DRY"): every profile the villa's own
 *  (the doorbell's Unlock) and VESTA's that do not act (Continue); one that acts, only a profile that may act (`mayAct`:
 *  the owner, the facility manager — a guest gets answers only). The same wherever a record shows (owner, 2026-10-29: an
 *  alert's Done · Need help on its notice, its card and its issue alike). Read by every screen that draws buttons. Pure. */
export function offeredButtons(buttons: readonly AnnouncementButton[], mayAct: boolean): AnnouncementButton[] {
  return buttons.filter((b) => !b.acts || mayAct);
}

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

/** An alert's stage as every screen reads it — ⚠️ ONE READER (owner, 2026-10-28: "the same code … consistently"): VESTA's
 *  card says it (its title's word: new, existing, watch, closed); the villa's own message by its bottom line's mark
 *  (stageOf: both ends read "closed"). null: no stage (a weekly test, a ring not answered). */
export type AlertStage = keyof typeof AGENT_CONTRACT.stageMarks;
const STAGES = Object.keys(AGENT_CONTRACT.stageMarks) as AlertStage[];

export function alertStage(a: Announcement): AlertStage | null {
  if (a.feed === "vesta") return STAGES.find((s) => s === a.vestaStage) ?? null;
  return stageOf(a.status);
}

/** An alert that is over: watched after it cleared, or closed — parked in Watch or Closed, never unread. */
export const isOver = (a: Announcement): boolean => {
  const s = alertStage(a);
  return s === "watch" || s === "closed";
};

/** VESTA's card key of alert number `n` (agent-contract.json vestaMessage.incidentKey: the form the Agent writes). */
export const incidentKey = (n: number): string =>
  String(AGENT_CONTRACT.vestaMessage.incidentKey).replace("{number}", String(n));

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

/** How an announcement shows: full screen first for `fullScreenMs` (null: not full screen), else a notice for
 *  `noticeMs`. */
export interface HowShown { fullScreenMs: number | null; noticeMs: number }

/**
 * How a new announcement shows (ticket 16 of "One inbox", owner 2026-10-28). ⚠️ EVERY NOTICE GOES BY ITSELF AFTER
 * ANNOUNCEMENT_NOTICE_MS, ONE TIME FOR ALL (owner, 2026-10-29: "this pill shall remain few seconds also, similarly to
 * other notification pills … consistently and centrally defined … once the timer expires the pill shall disappear and
 * the user will find the same card in the Cockpit"): one offering buttons (the doorbell's Unlock, an approval) too —
 * its card keeps them in the Inbox. A title the owner picked takes the whole screen instead, for "Ring shown for", on a
 * tablet that allows it, and then goes (no notice after it). A cleared one, or a `rewrite` of one already shown (a ring
 * answered, timed out), never takes the screen again: it would hold the screen a second "Ring shown for". Pure:
 * tests/oracles/announcements.mjs.
 */
export function noticeFor(a: Announcement, s: ShowSettings, { rewrite = false } = {}): HowShown {
  const full = s.ringsFullScreen && !rewrite && !isOver(a) && s.fullScreenFor.includes(a.title);
  return full ? { fullScreenMs: s.ringShownForS * 1000, noticeMs: 0 } : { fullScreenMs: null, noticeMs: ANNOUNCEMENT_NOTICE_MS };
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
    ...(r.asked === true ? { asked: true } : {}),
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
 * "What to do", its Status story and bottom line, its snapshot, its buttons (ticket 22 of "One inbox": pressed on the
 * tablet as on Telegram, vestaButtons). null for anything this build cannot read. Pure: tests/oracles/messages_model.mjs.
 */
export function parseVestaMessage(raw: unknown): Announcement | null {
  const r = numbered(raw);
  if (!r || typeof r.key !== "string" || !r.key) return null;
  const lines = strings(r.status);
  const shown = inTabletLanguage(r);
  const text = [r.lead, shown.body].filter((x): x is string => typeof x === "string" && x.trim() !== "").join("\n");
  const title = typeof r.title === "string" ? r.title : "";
  if (!title && !text && !lines.length) return null;
  return {
    seq: r.seq, at: atOf(r), title, to: typeof r.to === "string" ? r.to : "", text,
    status: lines[lines.length - 1] ?? "", story: lines.slice(0, -1), photo: photoOf(r),
    key: r.key, buttons: vestaButtons(r.buttons), feed: "vesta", takes: strings(r.takes),
    ...(r.asked === true ? { asked: true } : {}),
    ...(typeof r.stage === "string" && r.stage ? { vestaStage: r.stage } : {}),
    ...(typeof r.report === "string" && r.report ? { report: r.report } : {}),
    ...(typeof shown.page === "string" && shown.page ? { page: shown.page } : {}),
  };
}

/** The language the tablet reads: English (a tablet language is ticket 28 of "One inbox", parked: owner 2026-10-28). */
const TABLET_LANGUAGE = "en";

/** A record's words and page in the tablet's language when VESTA wrote them in it (its `languages`), else as written
 *  (owner, spec story 38). */
function inTabletLanguage(r: Record<string, unknown>): { body: unknown; page: unknown } {
  const langs = r.languages && typeof r.languages === "object" ? (r.languages as Record<string, unknown>) : {};
  const there = langs[TABLET_LANGUAGE];
  if (r.language !== TABLET_LANGUAGE && there && typeof there === "object" && typeof (there as { body?: unknown }).body === "string") {
    const t = there as { body: string; page?: unknown };
    return { body: t.body, page: t.page };
  }
  return { body: r.body, page: r.page };
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
  return (await pressAt("announcement-press", key, command, send)).outcome;
}

/** What a press came to: its outcome, and — one of VESTA's buttons — its number, which VESTA's short answer names. */
export interface PressResult { outcome: PressOutcome; press?: number }

/** ⚠️ ONE DOOR PER KIND OF RECORD, CHOSEN HERE (ticket 22 of "One inbox"): the villa's own buttons go to its press event
 *  (/announcement-press), VESTA's — a message's or a conversation turn's — to VESTA (/vesta-press, kept for it as a
 *  question is). Every screen presses through this. `send` is backendFetch (a check passes its own). */
export function pressOf(
  a: Pressable, command: string, send: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status"> & { json?: () => Promise<unknown> }>,
): Promise<PressResult> {
  return a.key ? pressAt(a.feed ? "vesta-press" : "announcement-press", a.key, command, send)
    : Promise.resolve({ outcome: "failed" });
}

async function pressAt(
  door: string, key: string, command: string,
  send: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status"> & { json?: () => Promise<unknown> }>,
): Promise<PressResult> {
  try {
    const r = await send(ingressPath(door), {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, command }),
    });
    if (!r.ok) return { outcome: r.status === 409 ? "withdrawn" : "failed" };
    const body = r.json ? ((await r.json().catch(() => null)) as { press?: unknown } | null) : null;
    return { outcome: "sent", ...(typeof body?.press === "number" ? { press: body.press } : {}) };
  } catch {
    return { outcome: "failed" };
  }
}

/** Erase kept message `a` with a one-shot superadmin authorisation (held on its row, then the code: owner,
 *  2026-10-29): whether the add-on removed it. Every page then drops it at its next read (feed `kept`). `send` is
 *  backendFetch (a check passes its own). */
export async function eraseMessage(
  a: Announcement, elevation: string, send: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>,
): Promise<boolean> {
  try {
    const r = await send(ingressPath("message-erase"), {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feed: a.feed === "vesta" ? "vesta" : "villa", seq: a.seq, elevation }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** The kept announcements, a read of the add-on's feed (messages/feed); with `after`, only newer ones, the add-on
 *  waiting for one to come. null = not reached. */
export const fetchAnnouncements = (after: number | null, stop: AbortSignal): Promise<FeedRead<Announcement> | null> =>
  fetchFeed("announcements", "announcements", parseAnnouncement, after, stop);
