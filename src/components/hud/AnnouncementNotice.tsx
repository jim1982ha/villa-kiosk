// src/components/hud/AnnouncementNotice.tsx
// What the villa just announced — "🔔 Visitor at the gate · Someone is at the door." — on every tablet and phone, as
// messages/announcements noticeFor says (ticket 16 of "One inbox"): full screen for what the owner picked, a notice
// for ANNOUNCEMENT_NOTICE_MS, a ring's button kept while it can be pressed; drawn as every notice is (Notice). Its own place in
// the column, above AppNotice's: a motion notice (the visitor walking up) must not replace the ring.
//
// A ring offers its buttons here too (ticket 15 of "One inbox", owner 2026-10-28: the doorbell's Unlock, for every
// profile, no PIN): their labels and commands are the announcement's, never named in the Kiosk. Such a notice stays
// until the villa's rewrite of the same ring replaces it (answered, opened at the gate, timed out) or its ✕.

import { useEffect, useReducer, useRef } from "react";
import { Bell } from "lucide-react";
import { NoticeView } from "./Notice";
import Window from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";
import { useConfig } from "@/config/ConfigContext";
import type { Announcement } from "@/messages/announcements";
import { NO_NOTICE, noticeStep } from "@/messages/noticeModel";
import { useAnnouncementPress, useAnnouncements } from "@/messages/AnnouncementsContext";
import { announcementWords, idOf } from "@/messages/messagesModel";
import type { PressState } from "@/messages/presses";
import { AnnouncementActions, AnnouncementContent, AnnouncementPhoto } from "@/components/messages/AnnouncementContent";

/** One announcement, drawn — pure (a check draws it): its photo above its words when it has one (a ring's snapshot,
 *  the notice then square-cornered: 08-shared.css), its title and the first line of what it says, then the buttons
 *  it offers. A rewrite of the same ring replaces it in place (the add-on's key). Only a notice offering a button
 *  stays, so only it carries a ✕; every other goes by itself. */
export function AnnouncementNoticeView({ announcement, onPress, onDismiss, presses = {} }: {
  announcement: Announcement;
  onPress?: (command: string) => void;
  onDismiss?: () => void;
  presses?: PressState;
}) {
  // its words as every screen says them (messagesModel.announcementWords): the title, then its first line or bottom line
  const { title, line } = announcementWords(announcement);
  const buttons = onPress ? announcement.buttons : [];
  const words = line ? `${title} · ${line}` : title;
  return (
    <NoticeView tone="info" icon={<Bell size={16} />} onDismiss={buttons.length ? onDismiss : undefined}>
      {announcement.photo && <AnnouncementPhoto id={announcement.photo} className="vesta-notice-photo" />}
      {words}
      {onPress && buttons.length > 0 && <AnnouncementActions announcement={announcement} onPress={onPress} presses={presses} />}
    </NoticeView>
  );
}

/** An announcement the owner picked for the whole screen (Advanced Settings › Messages › "Full screen for"), drawn
 *  over everything for "Ring shown for", in the one window frame (its "screen" kind): its title in the header; its
 *  photo large, all it says and its buttons in the body; Close, which hands it back to its notice, in the footer. */
export function AnnouncementFullScreenView({ announcement, onPress, onDismiss, presses = {} }: {
  announcement: Announcement;
  onPress?: (command: string) => void;
  onDismiss: () => void;
  presses?: PressState;
}) {
  return (
    <>
      <div className="modal-header"><h2 className="announcement-full-title">{announcement.title}</h2></div>
      <div className="modal-body announcement-full">
        <AnnouncementContent announcement={announcement} onPress={onPress} presses={presses} />
      </div>
      <ModalFooter onClose={onDismiss} />
    </>
  );
}

/** The full-screen view in its window; Escape / Back and Close dismiss it alike. */
function FullScreen(props: Parameters<typeof AnnouncementFullScreenView>[0]) {
  return (
    <Window kind="screen" label={props.announcement.title} onClose={props.onDismiss}>
      <AnnouncementFullScreenView {...props} />
    </Window>
  );
}

/** One notice with its own buttons, pressed through the page's one record (messages/presses). */
function OneNotice({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  const { presses, press } = useAnnouncementPress(announcement);
  return <AnnouncementNoticeView announcement={announcement} onPress={press} onDismiss={onDismiss} presses={presses} />;
}

/** The full screen with its own buttons. */
function OneFullScreen({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  const { presses, press } = useAnnouncementPress(announcement);
  return <FullScreen announcement={announcement} onPress={press} onDismiss={onDismiss} presses={presses} />;
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
  const { fresh } = useAnnouncements();
  useEffect(() => {
    for (const { announcement, rewrite } of fresh?.arrived ?? []) {
      send({ type: "arrived", announcement, rewrite, settings: settings.current });
    }
  }, [fresh]);
  // the full screen ends with its time, Close, or this tablet's switch turned off; the passing one with its own time
  useEffect(() => {
    if (state.full && !config.ringsFullScreen) send({ type: "fullEnded" });
  }, [state.full, config.ringsFullScreen]);
  useEffect(() => {
    if (!state.full) return;
    const t = setTimeout(() => send({ type: "fullEnded" }), state.full.ms);
    return () => clearTimeout(t);
  }, [state.full]);
  useEffect(() => {
    const p = state.passing;
    if (!p) return;
    const t = setTimeout(() => send({ type: "passingEnded", id: idOf(p.announcement) }), p.ms);
    return () => clearTimeout(t);
  }, [state.passing]);

  const passing = state.passing?.announcement;
  return (
    <>
      {state.full && <OneFullScreen announcement={state.full.announcement} onDismiss={() => send({ type: "fullEnded" })} />}
      {state.staying.map((a) => <OneNotice key={idOf(a)} announcement={a} onDismiss={() => send({ type: "dismissed", id: idOf(a) })} />)}
      {passing && <OneNotice key={idOf(passing)} announcement={passing} onDismiss={() => send({ type: "dismissed", id: idOf(passing) })} />}
    </>
  );
}
