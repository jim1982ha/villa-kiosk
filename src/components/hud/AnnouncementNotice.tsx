// src/components/hud/AnnouncementNotice.tsx
// What the villa just announced — "🔔 Visitor at the gate · Someone is at the door." — on every tablet and phone, for
// ANNOUNCEMENT_NOTICE_MS, drawn as every notice is (Notice). Its own place in the column, above AppNotice's: a motion
// notice (the visitor walking up) must not replace the ring.
//
// A ring offers its buttons here too (ticket 15 of "One inbox", owner 2026-10-28: the doorbell's Unlock, for every
// profile, no PIN): their labels and commands are the announcement's, never named in the Kiosk. Such a notice stays
// until the villa's rewrite of the same ring replaces it (answered, opened at the gate, timed out) or its ✕.

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { NoticeView } from "./Notice";
import { backendFetch } from "@/auth/sessionLost";
import {
  announcementPhotoUrl, fetchAnnouncements, noticeLasts, pauseFor, pressButton, watchAnnouncements, PRESS_SAID,
  type Announcement, type PressOutcome,
} from "@/messages/announcements";

/** What became of each button pressed on the notice, by command ("sending" until the add-on answers). */
export type PressState = Record<string, PressOutcome | "sending">;

/** One announcement, drawn — pure (a check draws it): its photo when it has one (a ring's snapshot), its title,
 *  then the first line of what it says, then the buttons it offers. A rewrite of the same ring replaces it in place
 *  (the add-on's key). */
export function AnnouncementNoticeView({ announcement, onPress, onDismiss, presses = {} }: {
  announcement: Announcement;
  onPress?: (command: string) => void;
  onDismiss?: () => void;
  presses?: PressState;
}) {
  const line = announcement.text.split("\n")[0];
  const buttons = onPress ? announcement.buttons : [];
  // The latest answer to a press (a failed one leaves its button pressable again).
  const answer = Object.values(presses).reverse().find((s): s is PressOutcome => s !== "sending");
  return (
    <NoticeView tone="info" icon={<Bell size={16} />} onDismiss={buttons.length ? onDismiss : undefined}>
      {announcement.photo && <img className="vesta-notice-photo" src={announcementPhotoUrl(announcement.photo)} alt="" />}
      {line ? `${announcement.title} · ${line}` : announcement.title}
      {buttons.length > 0 && (
        <span className="vesta-notice-actions">
          {buttons.map((b) => (
            <button key={b.command} type="button" className="btn primary vesta-notice-action"
              disabled={presses[b.command] !== undefined && presses[b.command] !== "failed"} onClick={() => onPress?.(b.command)}>
              {b.label}
            </button>
          ))}
          {answer && <span className="vesta-notice-said">{PRESS_SAID[answer]}</span>}
        </span>
      )}
    </NoticeView>
  );
}

export default function AnnouncementNotice() {
  const [shown, setShown] = useState<Announcement | null>(null);
  const [presses, setPresses] = useState<PressState>({});
  // The ring on screen, read when a press is answered: its rewrite may have replaced it meanwhile.
  const shownKey = useRef<string | null>(null);
  shownKey.current = shown?.key ?? null;

  useEffect(() => {
    const stop = new AbortController();
    // The newest of what arrived together: two rings in one read are one notice, the later.
    void watchAnnouncements(fetchAnnouncements, (items) => {
      setShown(items[items.length - 1]);
      setPresses({});
    }, stop.signal, pauseFor);
    return () => stop.abort();
  }, []);

  useEffect(() => {
    const lasts = shown ? noticeLasts(shown) : null;
    if (lasts === null) return;
    const t = setTimeout(() => setShown(null), lasts);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  const { key } = shown;
  const press = (command: string) => {
    if (!key) return;
    setPresses((p) => ({ ...p, [command]: "sending" }));
    void pressButton(key, command, backendFetch).then((outcome) => {
      if (shownKey.current === key) setPresses((p) => ({ ...p, [command]: outcome }));
    });
  };
  return <AnnouncementNoticeView announcement={shown} onPress={press} onDismiss={() => setShown(null)} presses={presses} />;
}
