// src/components/messages/AnnouncementContent.tsx
// An announcement's own parts, drawn the same wherever it shows: its buttons (the doorbell's Unlock, labels and
// commands the villa's) with what became of a press, and its whole content (photo, words, bottom line, buttons) for
// the full screen and the Cockpit's Messages (ticket 17 of "One inbox"). The notice draws its one line with the same
// buttons (components/hud/AnnouncementNotice).

import { useState } from "react";
import { announcementPhotoUrl, PRESS_SAID, type Announcement, type PressOutcome } from "@/messages/announcements";
import type { PressState } from "@/messages/presses";

/** An announcement's photo, served by the add-on; hidden when the add-on refuses it (review Q round 2): a guest is
 *  served only the current notification's photo (supervisor-proxy.py _current_photo), so a page that read it while it
 *  was current drew an empty frame once it was not. The add-on decides; the page only hides what it is refused. */
export function AnnouncementPhoto({ id, className }: { id: string; className: string }) {
  const [refused, setRefused] = useState<string | null>(null);
  if (refused === id) return null;
  return <img className={className} src={announcementPhotoUrl(id)} alt="" onError={() => setRefused(id)} />;
}

/** The buttons an announcement offers, and what became of the last press. */
export function AnnouncementActions({ announcement, onPress, presses }: {
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

/** Everything an announcement says, below its title: its photo large, all its words, its bottom line, its buttons.
 *  Pure: a check draws it. */
export function AnnouncementContent({ announcement, onPress, presses = {} }: {
  announcement: Announcement;
  onPress?: (command: string) => void;
  presses?: PressState;
}) {
  const story = announcement.story ?? [];
  return (
    <>
      {/* who it is for, as Telegram's "To:" line says it */}
      {announcement.to && <p className="announcement-full-to">To: {announcement.to}</p>}
      {announcement.photo && <AnnouncementPhoto id={announcement.photo} className="announcement-full-photo" />}
      {announcement.text && <p className="announcement-full-text">{announcement.text}</p>}
      {/* VESTA's card: its Status story, then where it stands, as on Telegram */}
      {(story.length > 0 || announcement.status) && (
        <div className="announcement-full-status">
          {story.length > 0 && <span className="announcement-status-label">Status:</span>}
          {story.map((line, i) => <span key={i} className="announcement-story-line">{line}</span>)}
          {announcement.status && <span>{announcement.status}</span>}
        </div>
      )}
      {onPress && announcement.buttons.length > 0 && <AnnouncementActions announcement={announcement} onPress={onPress} presses={presses} />}
    </>
  );
}
