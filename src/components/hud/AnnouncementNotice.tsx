// src/components/hud/AnnouncementNotice.tsx
// What the villa just announced — "🔔 Visitor at the gate · Someone is at the door." — on every tablet and phone, as
// messages/announcements noticeFor says (ticket 16 of "One inbox"): full screen for what the owner picked, else a notice
// for ANNOUNCEMENT_NOTICE_MS, each its own time, none replacing another (noticeModel); drawn as every notice is (Notice).
// Its own place in the column, above AppNotice's: a motion notice (the visitor walking up) must not replace the ring.
//
// A notice offers its record's buttons too (RecordButtons: the doorbell's Unlock, an approval's Approve / Refuse) for
// its few seconds; its card in the Cockpit's Inbox keeps them after (owner, 2026-10-29). A rewrite of the same record
// (answered, opened at the gate, decided) takes its place and says what changed.

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import { fmtDuration } from "@/components/panels/chartUtils";
import { useNow } from "@/hooks/useInterval";
import { NoticeView } from "./Notice";
import Window from "@/components/common/Window";
import { useConfig } from "@/config/ConfigContext";
import type { Announcement } from "@/messages/announcements";
import { NO_NOTICE, noticeStep } from "@/messages/noticeModel";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { announcementWords, idOf } from "@/messages/messagesModel";
import { AnnouncementPhoto, RecordButtons } from "@/components/messages/AnnouncementContent";

/** One announcement, drawn — pure (a check draws it): its photo above its words when it has one (a ring's snapshot,
 *  the notice then square-cornered: 08-shared.css), its title and the first line of what it says, then `buttons` (its
 *  RecordButtons: the doorbell's Unlock, an approval's Approve / Refuse). A rewrite of the same record replaces it in
 *  place (the add-on's key). Its ✕ (NoticeView: every notice's) closes it before its time (`onDismiss`: the notices'
 *  record, noticeModel "dismissed"). */
export function AnnouncementNoticeView({ announcement, onDismiss, buttons, step = false }: {
  announcement: Announcement;
  onDismiss?: () => void;
  buttons?: ReactNode;
  /** It arrived as a rewrite (noticeModel `steps`): it says what changed, its bottom line. */
  step?: boolean;
}) {
  // its words as every screen says them (messagesModel.announcementWords): the title, then its first line or bottom line
  const { title, line } = announcementWords(announcement, { step });
  const words = line ? `${title} · ${line}` : title;
  return (
    <NoticeView tone="info" icon={<Bell size={16} />} onDismiss={onDismiss}>
      {announcement.photo && <AnnouncementPhoto id={announcement.photo} className="vesta-notice-photo" />}
      {words}
      {buttons}
    </NoticeView>
  );
}

/** What the countdown says and draws: the time left in the shared duration words (fmtDuration: "24s", "1min"), and
 *  the share of its time left, 0 to 1 (the ring round Close). Pure: tests/oracles/announcements.mjs. */
export function countdownOf(totalMs: number, leftMs: number): { words: string; fraction: number } {
  const left = Math.max(0, Math.min(totalMs, leftMs));
  return { words: fmtDuration(Math.max(1000, left)), fraction: totalMs > 0 ? left / totalMs : 0 };
}

/** The ring's circumference, for a radius of 39 in an 84 box (08-shared.css .announcement-night-close). */
const RING_R = 39;
const RING_C = 2 * Math.PI * RING_R;

/**
 * An announcement the owner picked for the whole screen (Settings › Messages › "Full-screen announcements"), drawn over
 * everything for its own seconds, in the one window frame (its "screen" kind).
 *
 * ⚠️ THE NIGHT LOOK, THE COUNTDOWN ROUND CLOSE (owner, 2026-11-04: proposal 5 of the five, "implement it fully"; and
 * "show a timer … that count down when the notification will disappear"): a dark screen whatever the theme (a camera's
 * night picture reads best on it), its title and what it says at the top, its photo as large as the screen allows, then
 * its buttons (the doorbell's Unlock, an approval's) and Close inside a ring that empties as its time runs out, with
 * "Closes in 24s" beside it. No "To:" line here: it says whom the villa sent it to on Telegram, never who is looking (it
 * read "To: FM" on the owner's tablet); its Inbox card keeps it. The shell's header, body and footer, as every window
 * (its window carries `announcement-night`: 08-shared.css). Pure: a check draws it.
 */
export function AnnouncementFullScreenView({ announcement, onDismiss, buttons, totalMs, leftMs }: {
  announcement: Announcement;
  onDismiss: () => void;
  buttons?: ReactNode;
  /** Its whole time on screen, and what is left of it (OneFullScreen ticks it). */
  totalMs: number;
  leftMs: number;
}) {
  const { words, fraction } = countdownOf(totalMs, leftMs);
  const story = announcement.story ?? [];
  return (
    <>
      <div className="modal-header announcement-night-head">
        <h2 className="announcement-full-title">{announcement.title}</h2>
        {announcement.text && <p className="announcement-night-text">{announcement.text}</p>}
        {(story.length > 0 || announcement.status) && (
          <p className="announcement-night-text">{[...story, announcement.status].filter(Boolean).join("\n")}</p>
        )}
      </div>
      <div className="modal-body announcement-night-body">
        {announcement.photo && <AnnouncementPhoto id={announcement.photo} className="announcement-night-photo" />}
      </div>
      <div className="modal-footer announcement-night-actions">
        {buttons}
        <span className="announcement-night-close">
          <svg viewBox="0 0 84 84" aria-hidden="true">
            <circle cx="42" cy="42" r={RING_R} className="announcement-night-track" />
            <circle cx="42" cy="42" r={RING_R} className="announcement-night-left"
              strokeDasharray={`${(fraction * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`} transform="rotate(-90 42 42)" />
          </svg>
          <button type="button" onClick={onDismiss} aria-label={`Close, it closes by itself in ${words}`}>
            <X size={26} aria-hidden="true" />
          </button>
        </span>
        <span className="announcement-night-words" aria-hidden="true">Closes in {words}</span>
      </div>
    </>
  );
}

/** One notice with its record's buttons (RecordButtons: the one row, wherever a record shows). */
function OneNotice({ announcement, onDismiss, step }: { announcement: Announcement; onDismiss: () => void; step: boolean }) {
  return <AnnouncementNoticeView announcement={announcement} onDismiss={onDismiss} step={step}
    buttons={<RecordButtons record={announcement} />} />;
}

/** The full screen in its window, with its record's buttons; Escape / Back and Close dismiss it alike. Its countdown
 *  ticks every second from when it came on screen; its end is AnnouncementNotice's one timer, never this one. */
function OneFullScreen({ announcement, ms, onDismiss }: { announcement: Announcement; ms: number; onDismiss: () => void }) {
  const [shownAt] = useState(() => Date.now());
  const now = useNow(1000);          // the app's one ticking clock (hooks/useInterval)
  return (
    <Window kind="screen" className="announcement-night" label={announcement.title} onClose={onDismiss}>
      <AnnouncementFullScreenView announcement={announcement} onDismiss={onDismiss} totalMs={ms} leftMs={ms - Math.max(0, now - shownAt)}
        buttons={<RecordButtons record={announcement} />} />
    </Window>
  );
}

export default function AnnouncementNotice() {
  const { config } = useConfig();
  // read when an announcement arrives: a full-screen time changed meanwhile applies to the next one
  const settings = useRef(config);
  settings.current = config;
  // what is on screen, as the notice model says (messages/noticeModel): a ring waiting for its answer stays whatever
  // else arrives (review Q round 2)
  const [state, send] = useReducer(noticeStep, NO_NOTICE);
  // what just came, from the page's one watch (messages/AnnouncementsContext), each saying whether it rewrites one the
  // page held: a rewrite (the ring answered, timed out) never takes the screen again, a reload or a wake-up between
  // the two included (review Q 1)
  const { fresh, kept, villa, loaded } = useAnnouncements();
  useEffect(() => {
    for (const { announcement, rewrite } of fresh?.arrived ?? []) {
      send({ type: "arrived", announcement, rewrite, settings: settings.current });
    }
  }, [fresh]);
  // what the add-on keeps now: a ring that ended while this page was not listening leaves the screen too
  useEffect(() => {
    if (loaded) send({ type: "kept", kept: [...villa, ...kept] });
  }, [kept, villa, loaded]);
  // the full screen ends with its time, Close, or this tablet's switch turned off; each notice with its own time
  useEffect(() => {
    if (state.full && !config.ringsFullScreen) send({ type: "fullEnded" });
  }, [state.full, config.ringsFullScreen]);
  useEffect(() => {
    if (!state.full) return;
    const t = setTimeout(() => send({ type: "fullEnded" }), state.full.ms);
    return () => clearTimeout(t);
  }, [state.full]);

  return (
    <>
      {/* keyed by the announcement: a new one on screen starts its own countdown */}
      {state.full && <OneFullScreen key={idOf(state.full.announcement)} announcement={state.full.announcement} ms={state.full.ms}
        onDismiss={() => send({ type: "fullEnded" })} />}
      {state.shown.map(({ announcement: a, ms }) => (
        <TimedNotice key={idOf(a)} announcement={a} ms={ms} step={state.steps.includes(idOf(a))}
          onEnded={() => send({ type: "noticeEnded", id: idOf(a) })} onDismiss={() => send({ type: "dismissed", id: idOf(a) })} />
      ))}
    </>
  );
}

/** One notice for its own time (noticeFor: one time for every notice), then gone; its card stays in the Inbox. */
function TimedNotice({ announcement, ms, step, onEnded, onDismiss }: {
  announcement: Announcement; ms: number; step: boolean; onEnded: () => void; onDismiss: () => void;
}) {
  const ended = useRef(onEnded);
  ended.current = onEnded;
  useEffect(() => {
    const t = setTimeout(() => ended.current(), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return <OneNotice announcement={announcement} onDismiss={onDismiss} step={step} />;
}
