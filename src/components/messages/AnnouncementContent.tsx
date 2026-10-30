// src/components/messages/AnnouncementContent.tsx
// An announcement's own parts, drawn the same wherever it shows: its buttons (the doorbell's Unlock, labels and
// commands the villa's) with what became of a press, and its whole content (photo, words, bottom line, buttons) for
// the full screen and the Cockpit's Messages (ticket 17 of "One inbox"). The notice draws its one line with the same
// buttons (components/hud/AnnouncementNotice).

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { documentUrl } from "@/fm/fmApi";
import { CARD_BUTTON } from "@/components/fm/WorkButtons";
import { useProfileOrNull } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useConfirmDialog, type Question } from "@/hooks/useConfirmDialog";
import { useAnnouncementPress } from "@/messages/AnnouncementsContext";
import { useConversation } from "@/messages/ConversationContext";
import { announcementPhotoUrl, offeredButtons, pressedRow, type Announcement, type AnnouncementButton,
  type Pressable } from "@/messages/announcements";
import type { PressState } from "@/messages/presses";

/** An announcement's photo, served by the add-on; hidden when the add-on refuses it (review Q round 2): a guest is
 *  served only the current notification's photo (supervisor-proxy.py _current_photo), so a page that read it while it
 *  was current drew an empty frame once it was not. The add-on decides; the page only hides what it is refused. */
export function AnnouncementPhoto({ id, className }: { id: string; className: string }) {
  const [refused, setRefused] = useState<string | null>(null);
  if (refused === id) return null;
  return <img className={className} src={announcementPhotoUrl(id)} alt="" onError={() => setRefused(id)} />;
}

/** A page VESTA attached (a report's, an investigation's), opened in the document viewer — ONE link for every place a
 *  VESTA message shows (the Inbox's report, the conversation's answer: architecture review 2026-10-29 #4). The caller
 *  offers it only to a profile the add-on serves pages to. */
export function PageLink({ page }: { page: string }) {
  return (
    <div className="fm-documents">
      <a className="fm-document-link" href={documentUrl(page)} target="_blank" rel="noopener noreferrer">
        <FileText size={15} aria-hidden="true" /> Open the page
      </a>
    </div>
  );
}

/** A record's buttons, drawn — pure (a check draws it): the ones `buttons` lists (announcements.offeredButtons: what this
 *  profile is offered) until one is pressed, then the choice made with VESTA's own short answer (`answer`) or the
 *  add-on's word (announcements.pressedRow). */
export function ButtonRow({ buttons, onPress, presses, answer }: {
  buttons: readonly AnnouncementButton[]; onPress: (b: AnnouncementButton) => void; presses: PressState; answer?: string;
}) {
  if (buttons.length === 0) return null;
  // the buttons still offered, or the choice made (announcements.pressedRow: every row of buttons alike)
  const row = pressedRow(buttons, presses, answer);
  return (
    <span className="vesta-notice-actions">
      {row.buttons.map((b) => (
        <button key={b.command} type="button" className={`${CARD_BUTTON} vesta-notice-action`}
          disabled={presses[b.command] === "sending"} onClick={() => onPress(b)}>
          {b.label}
        </button>
      ))}
      {row.said && <span className="vesta-notice-said">{row.said}</span>}
    </span>
  );
}

/** ⚠️ THE ONE BUTTON ROW OF EVERY RECORD (owner, 2026-10-29: "implement button in the notification for every use case
 *  it's relevant … DRY, centralising all the configuration and layout"): a villa announcement's (the doorbell's Unlock),
 *  one of VESTA's messages (Approve / Refuse, Done, Need help, an offer) or a turn of VESTA's conversation (Continue) —
 *  in the notice, the full screen, the Inbox's card and the conversation alike. Who is offered which button is
 *  announcements.offeredButtons; a button that asks first asks in the tablet's one confirmation box (useConfirmDialog:
 *  an approval, owner 2026-10-28); a press goes through the page's one record (useAnnouncementPress) to its record's door
 *  (announcements.pressOf); VESTA's short answer comes back in this profile's conversation (ConversationContext). */
export function RecordButtons({ record }: { record: Pressable }) {
  const profile = useProfileOrNull();
  const { presses, press, numberOf } = useAnnouncementPress(record);
  const { answers } = useConversation();
  const { ask, dialog } = useConfirmDialog();
  const offered = offeredButtons(record.buttons, roleCan(profile?.role ?? null, "viewAgent"));
  // VESTA's answer to the last of this record's presses that has one
  const answer = offered.map((b) => numberOf(b.command)).reverse()
    .map((n) => (n !== undefined ? answers.get(n) : undefined)).find(Boolean);
  return <><ButtonRow buttons={offered} onPress={(b) => pressOrAsk(b, ask, press)} presses={presses} answer={answer} />
    {dialog}</>;
}

/** A tap on `b`: sent at once, or — a button that asks first (an approval: its kind's `confirm`) — asked in the one
 *  confirmation box, sent only once confirmed. Pure: tests/oracles/conversation_model.mjs. */
export function pressOrAsk(b: AnnouncementButton, ask: (q: Question) => void, press: (command: string) => void): void {
  if (b.confirm) ask({ title: b.label, message: b.confirm, confirmLabel: b.label, run: () => press(b.command) });
  else press(b.command);
}

/** Everything an announcement says, below its title: its photo large, all its words, its bottom line — then `buttons`
 *  (RecordButtons, where the screen shows them under the words). Pure: a check draws it. */
export function AnnouncementContent({ announcement, buttons }: { announcement: Announcement; buttons?: ReactNode }) {
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
      {buttons}
    </>
  );
}
