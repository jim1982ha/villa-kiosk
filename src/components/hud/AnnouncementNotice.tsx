// src/components/hud/AnnouncementNotice.tsx
// What the villa just announced — "🔔 Visitor at the gate · Someone is at the door." — on every tablet and phone, as
// messages/announcements noticeFor says (ticket 16 of "One inbox"): full screen for what the owner picked, a notice
// for ANNOUNCEMENT_NOTICE_MS, a ring's button kept while it can be pressed; drawn as every notice is (Notice). Its own place in
// the column, above AppNotice's: a motion notice (the visitor walking up) must not replace the ring.
//
// A ring offers its buttons here too (ticket 15 of "One inbox", owner 2026-10-28: the doorbell's Unlock, for every
// profile, no PIN): their labels and commands are the announcement's, never named in the Kiosk. Such a notice stays
// until the villa's rewrite of the same ring replaces it (answered, opened at the gate, timed out) or its ✕.

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { NoticeView } from "./Notice";
import Window from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";
import { useConfig } from "@/config/ConfigContext";
import { backendFetch } from "@/auth/sessionLost";
import {
  announcementPhotoUrl, fetchAnnouncements, noticeFor, pauseFor, pressButton, watchAnnouncements, PRESS_SAID,
  type Announcement, type PressOutcome,
} from "@/messages/announcements";

/** What became of each button pressed on the notice, by command ("sending" until the add-on answers). */
export type PressState = Record<string, PressOutcome | "sending">;

/** The buttons an announcement offers, and what became of the last press: the same row on the notice and full
 *  screen. */
function Actions({ announcement, onPress, presses }: {
  announcement: Announcement; onPress: (command: string) => void; presses: PressState;
}) {
  // The latest answer to a press (a failed one leaves its button pressable again).
  const answer = Object.values(presses).reverse().find((s): s is PressOutcome => s !== "sending");
  return (
    <span className="vesta-notice-actions">
      {announcement.buttons.map((b) => (
        <button key={b.command} type="button" className="btn primary vesta-notice-action"
          disabled={presses[b.command] !== undefined && presses[b.command] !== "failed"} onClick={() => onPress(b.command)}>
          {b.label}
        </button>
      ))}
      {answer && <span className="vesta-notice-said">{PRESS_SAID[answer]}</span>}
    </span>
  );
}

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
  const line = announcement.text.split("\n")[0];
  const buttons = onPress ? announcement.buttons : [];
  const words = line ? `${announcement.title} · ${line}` : announcement.title;
  return (
    <NoticeView tone="info" icon={<Bell size={16} />} onDismiss={buttons.length ? onDismiss : undefined}>
      {announcement.photo && <img className="vesta-notice-photo" src={announcementPhotoUrl(announcement.photo)} alt="" />}
      {words}
      {onPress && buttons.length > 0 && <Actions announcement={announcement} onPress={onPress} presses={presses} />}
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
        {announcement.photo && <img className="announcement-full-photo" src={announcementPhotoUrl(announcement.photo)} alt="" />}
        {announcement.text && <p className="announcement-full-text">{announcement.text}</p>}
        {announcement.status && <p className="announcement-full-status">{announcement.status}</p>}
        {onPress && announcement.buttons.length > 0 && <Actions announcement={announcement} onPress={onPress} presses={presses} />}
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

/** What is on screen: the announcement, whether it is a rewrite of one already shown (its key seen), and whether it
 *  holds the whole screen or its notice. */
interface Shown { a: Announcement; rewrite: boolean; full: boolean }

export default function AnnouncementNotice() {
  const { config } = useConfig();
  // read when an announcement arrives
  const settings = useRef(config);
  settings.current = config;
  const [shown, setShown] = useState<Shown | null>(null);
  const [presses, setPresses] = useState<PressState>({});
  // The ring on screen, read when a press is answered: its rewrite may have replaced it meanwhile.
  const shownKey = useRef<string | null>(null);
  shownKey.current = shown?.a.key ?? null;
  // the keys already shown: their rewrite (the ring answered, timed out) never takes the screen again
  const seenKeys = useRef(new Set<string>());

  useEffect(() => {
    const stop = new AbortController();
    // The newest of what arrived together: two rings in one read are one notice, the later.
    void watchAnnouncements(fetchAnnouncements, (items) => {
      const a = items[items.length - 1];
      const rewrite = a.key !== null && seenKeys.current.has(a.key);
      if (a.key) seenKeys.current.add(a.key);
      setShown({ a, rewrite, full: noticeFor(a, settings.current, { rewrite }).fullScreenMs !== null });
      setPresses({});
    }, stop.signal, pauseFor);
    return () => stop.abort();
  }, []);

  const how = shown ? noticeFor(shown.a, config, { rewrite: shown.rewrite }) : null;
  // full screen ends (its time, Close, this tablet's switch turned off): its notice carries on when that one stays,
  // else it is gone
  const endFull = () => setShown((s) => (s && how?.noticeMs !== 0 ? { ...s, full: false } : null));
  useEffect(() => {
    if (shown?.full && !config.ringsFullScreen) endFull();
  });
  useEffect(() => {
    if (!shown || !how) return;
    const lasts = shown.full ? how.fullScreenMs : how.noticeMs;
    if (lasts === null) return;
    const t = setTimeout(shown.full ? endFull : () => setShown(null), lasts);
    return () => clearTimeout(t);
    // once per announcement and per phase: "Ring shown for" changed meanwhile applies to the next announcement
  }, [shown]);

  if (!shown || !how) return null;
  const { key } = shown.a;
  const press = (command: string) => {
    if (!key) return;
    setPresses((p) => ({ ...p, [command]: "sending" }));
    void pressButton(key, command, backendFetch).then((outcome) => {
      if (shownKey.current === key) setPresses((p) => ({ ...p, [command]: outcome }));
    });
  };
  if (shown.full) return <FullScreen announcement={shown.a} onPress={press} onDismiss={endFull} presses={presses} />;
  return <AnnouncementNoticeView announcement={shown.a} onPress={press} onDismiss={() => setShown(null)} presses={presses} />;
}
