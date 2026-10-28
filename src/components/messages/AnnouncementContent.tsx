// src/components/messages/AnnouncementContent.tsx
// An announcement's own parts, drawn the same wherever it shows: its buttons (the doorbell's Unlock, labels and
// commands the villa's) with what became of a press, and its whole content (photo, words, bottom line, buttons) for
// the full screen and the Cockpit's Messages (ticket 17 of "One inbox"). The notice draws its one line with the same
// buttons (components/hud/AnnouncementNotice).

import { useEffect, useRef, useState } from "react";
import { backendFetch } from "@/auth/sessionLost";
import { announcementPhotoUrl, pressButton, PRESS_SAID, type Announcement, type PressOutcome } from "@/messages/announcements";

/** What became of each button pressed, by command ("sending" until the add-on answers). */
export type PressState = Record<string, PressOutcome | "sending">;

/** Pressing `a`'s buttons: what became of each press, kept for this announcement only (a rewrite starts afresh). */
export function useAnnouncementPress(a: Announcement | null): { presses: PressState; press: (command: string) => void } {
  const [presses, setPresses] = useState<PressState>({});
  // The ring shown, read when a press is answered: its rewrite may have replaced it meanwhile.
  const current = useRef<string | null>(null);
  current.current = a?.key ?? null;
  const seq = a?.seq;
  useEffect(() => setPresses({}), [seq]);
  const press = (command: string) => {
    const key = a?.key;
    if (!key) return;
    setPresses((p) => ({ ...p, [command]: "sending" }));
    void pressButton(key, command, backendFetch).then((outcome) => {
      if (current.current === key) setPresses((p) => ({ ...p, [command]: outcome }));
    });
  };
  return { presses, press };
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
  return (
    <>
      {announcement.photo && <img className="announcement-full-photo" src={announcementPhotoUrl(announcement.photo)} alt="" />}
      {announcement.text && <p className="announcement-full-text">{announcement.text}</p>}
      {announcement.status && <p className="announcement-full-status">{announcement.status}</p>}
      {onPress && announcement.buttons.length > 0 && <AnnouncementActions announcement={announcement} onPress={onPress} presses={presses} />}
    </>
  );
}
