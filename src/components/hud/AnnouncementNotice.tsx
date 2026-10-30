// src/components/hud/AnnouncementNotice.tsx
// What the villa just announced — "🔔 Visitor at the gate · Someone is at the door." — on every tablet and phone, as
// messages/announcements noticeFor says (ticket 16 of "One inbox"): full screen for what the owner picked, else a notice
// for ANNOUNCEMENT_NOTICE_MS, each its own time, none replacing another (noticeModel); drawn as every notice is (Notice).
// Its own place in the column, above AppNotice's: a motion notice (the visitor walking up) must not replace the ring.
//
// A notice offers its record's buttons too (RecordButtons: the doorbell's Unlock, an approval's Approve / Refuse) for
// its few seconds; its card in the Cockpit's Inbox keeps them after (owner, 2026-10-29). A rewrite of the same record
// (answered, opened at the gate, decided) takes its place and says what changed.

import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { Bell } from "lucide-react";
import { NoticeView } from "./Notice";
import Window from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";
import { useConfig } from "@/config/ConfigContext";
import type { Announcement } from "@/messages/announcements";
import { NO_NOTICE, noticeStep } from "@/messages/noticeModel";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { announcementWords, idOf } from "@/messages/messagesModel";
import { AnnouncementContent, AnnouncementPhoto, RecordButtons } from "@/components/messages/AnnouncementContent";

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

/** An announcement the owner picked for the whole screen (Advanced Settings › Messages › "Full screen for"), drawn
 *  over everything for "Ring shown for", in the one window frame (its "screen" kind): its title in the header; its
 *  photo large, all it says and its buttons in the body; Close, which hands it back to its notice, in the footer. */
export function AnnouncementFullScreenView({ announcement, onDismiss, buttons }: {
  announcement: Announcement;
  onDismiss: () => void;
  buttons?: ReactNode;
}) {
  return (
    <>
      <div className="modal-header"><h2 className="announcement-full-title">{announcement.title}</h2></div>
      <div className="modal-body announcement-full">
        <AnnouncementContent announcement={announcement} buttons={buttons} />
      </div>
      <ModalFooter onClose={onDismiss} />
    </>
  );
}

/** One notice with its record's buttons (RecordButtons: the one row, wherever a record shows). */
function OneNotice({ announcement, onDismiss, step }: { announcement: Announcement; onDismiss: () => void; step: boolean }) {
  return <AnnouncementNoticeView announcement={announcement} onDismiss={onDismiss} step={step}
    buttons={<RecordButtons record={announcement} />} />;
}

/** The full screen in its window, with its record's buttons; Escape / Back and Close dismiss it alike. */
function OneFullScreen({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  return (
    <Window kind="screen" label={announcement.title} onClose={onDismiss}>
      <AnnouncementFullScreenView announcement={announcement} onDismiss={onDismiss}
        buttons={<RecordButtons record={announcement} />} />
    </Window>
  );
}

export default function AnnouncementNotice() {
  const { config } = useConfig();
  // read when an announcement arrives: "Ring shown for" changed meanwhile applies to the next one
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
      {state.full && <OneFullScreen announcement={state.full.announcement} onDismiss={() => send({ type: "fullEnded" })} />}
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
